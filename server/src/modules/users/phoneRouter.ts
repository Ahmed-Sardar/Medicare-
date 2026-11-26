import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditLog, PhoneChallenge, User } from '../models.js';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { sharedAccountLimit } from '../../services/sharedRateLimit.js';
import { checkPhoneVerification, codeDigest, startPhoneVerification } from '../../services/phoneVerification.js';
import { env } from '../../config/env.js';
export const phoneRouter = Router(); phoneRouter.use(authenticate);
phoneRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
phoneRouter.get('/me/phone-verification', asyncHandler(async (req, res) => {
  const user = await User.findById(req.auth!.id).select('phone phoneVerifiedAt +phoneVerifiedFor');
  res.json({ success: true, data: { available: env.SMS_PROVIDER === 'twilio' || env.NODE_ENV === 'development', verified: Boolean(user?.phone && user.phone === user.phoneVerifiedFor && user.phoneVerifiedAt), verifiedAt: user?.phone === user?.phoneVerifiedFor ? user?.phoneVerifiedAt || null : null } });
}));
phoneRouter.post('/me/phone-verification', sharedAccountLimit('phone-start', 5), asyncHandler(async (req, res) => {
  const { channel } = z.object({ channel: z.enum(['sms', 'whatsapp']), consent: z.literal(true) }).strict().parse(req.body);
  const user = await User.findById(req.auth!.id).select('phone'); if (!user?.phone) throw new ApiError(409, 'Save your phone number before requesting verification');
  const revision = randomUUID(); const expiresAt = new Date(Date.now() + 600000);
  // The per-account limiter is shared; the challenge is bound to this exact saved number.
  const result = await startPhoneVerification(user.phone, channel);
  await PhoneChallenge.findOneAndUpdate({ _id: user.id }, { $set: { phone: user.phone, channel, revision, attempts: 0, consumed: false, expiresAt, ...(result.providerSid ? { providerSid: result.providerSid } : {}), ...(result.developmentCode ? { codeHash: codeDigest(user.id, revision, result.developmentCode) } : {}) }, $unset: { ...(result.providerSid ? { codeHash: 1 } : { providerSid: 1 }) } }, { upsert: true });
  res.status(201).json({ success: true, data: { revision, expiresAt, ...(env.NODE_ENV === 'development' && result.developmentCode ? { developmentCode: result.developmentCode } : {}) } });
}));
phoneRouter.post('/me/phone-verification/check', sharedAccountLimit('phone-check', 15), asyncHandler(async (req, res) => {
  const input = z.object({ revision: z.string().uuid(), code: z.string().regex(/^[0-9]{4,10}$/) }).strict().parse(req.body);
  const challenge = await PhoneChallenge.findOneAndUpdate({ _id: req.auth!.id, revision: input.revision, consumed: false, attempts: { $lt: 5 }, expiresAt: { $gt: new Date() } }, { $inc: { attempts: 1 } }, { new: true }).select('+phone +providerSid +codeHash');
  if (!challenge || !await checkPhoneVerification(challenge, req.auth!.id, input.code)) throw new ApiError(400, 'Code is incorrect, expired or exhausted. Request a new code.', 'INVALID_PHONE_CODE');
  const session = await User.startSession();
  try { await session.withTransaction(async () => {
    const claimed = await PhoneChallenge.updateOne({ _id: req.auth!.id, revision: input.revision, consumed: false, expiresAt: { $gt: new Date() } }, { $set: { consumed: true }, $unset: { codeHash: 1, providerSid: 1 } }, { session });
    if (!claimed.modifiedCount) throw new ApiError(409, 'This code was already used or replaced');
    const changed = await User.updateOne({ _id: req.auth!.id, phone: challenge.phone, active: true }, { $set: { phoneVerifiedAt: new Date(), phoneVerifiedFor: challenge.phone } }, { session });
    if (!changed.matchedCount) throw new ApiError(409, 'Your phone number changed. Request a new code.');
    await AuditLog.create([{ actorId: req.auth!.id, action: 'user.phone.verified', resourceType: 'User', resourceId: req.auth!.id, ipAddress: req.ip }], { session });
  }); } finally { await session.endSession(); }
  res.json({ success: true, data: { verified: true } });
}));
