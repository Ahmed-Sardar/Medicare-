import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AuditLog, EmailDelivery, Notification, Pharmacist, Pharmacy, PharmacyStaff, PhoneChallenge, PrivacyRequest, Reservation, SavedPharmacy, SearchHistory, SupportTicket, User } from '../models.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { sharedAccountLimit } from '../../services/sharedRateLimit.js';
import { disconnectUser } from '../../services/realtime.js';

export const privacyRouter = Router();
privacyRouter.use(['/users/me/deletion-request', '/admin/privacy-requests'], authenticate);
privacyRouter.use('/admin/retention-holds', authenticate);
privacyRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
privacyRouter.get('/users/me/deletion-request', asyncHandler(async (req, res) => {
  const request = await PrivacyRequest.findOne({ userId: req.auth!.id }).sort({ createdAt: -1 }).select('-reviewedBy').lean(); res.json({ success: true, data: { request } });
}));
privacyRouter.post('/users/me/deletion-request', sharedAccountLimit('privacy-request', 3, 3600000), asyncHandler(async (req, res) => {
  const { password } = z.object({ password: z.string().min(1).max(128), confirm: z.literal('DELETE MY ACCOUNT') }).strict().parse(req.body);
  const user = await User.findById(req.auth!.id).select('+passwordHash');
  if (!user || !await bcrypt.compare(password, user.passwordHash)) throw new ApiError(400, 'Current password is incorrect');
  const session = await User.startSession(); let requestId = '';
  let status: 'PENDING' | 'HOLD' = 'PENDING';
  try { await session.withTransaction(async () => {
    const lock = await User.updateOne({ _id: user.id, active: true, passwordHash: user.passwordHash }, { $inc: { searchHistoryRevision: 1 } }, { session }); if (!lock.matchedCount) throw new ApiError(409, 'Account changed; sign in again');
    const existing = await PrivacyRequest.findOne({ userId: user.id, status: { $in: ['PENDING', 'HOLD'] } }).session(session); if (existing) { requestId = existing.id; status = existing.status as 'PENDING' | 'HOLD'; return; }
    const [request] = await PrivacyRequest.create([{ userId: user.id }], { session }); requestId = request!.id;
    await AuditLog.create([{ actorId: user.id, action: 'user.deletion.requested', resourceType: 'User', resourceId: user.id, ipAddress: req.ip }], { session });
  }); } finally { await session.endSession(); }
  res.status(201).json({ success: true, data: { requestId, status } });
}));
privacyRouter.post('/users/me/deletion-request/cancel', asyncHandler(async (req, res) => {
  const session = await User.startSession(); let requestId = '';
  try { await session.withTransaction(async () => {
    const request = await PrivacyRequest.findOneAndUpdate({ userId: req.auth!.id, status: { $in: ['PENDING', 'HOLD'] } }, { $set: { status: 'CANCELLED' }, $inc: { revision: 1 } }, { new: true, session });
    if (!request) throw new ApiError(404, 'No pending deletion request'); requestId = request.id;
    await AuditLog.create([{ actorId: req.auth!.id, action: 'user.deletion.cancelled', resourceType: 'PrivacyRequest', resourceId: requestId, ipAddress: req.ip }], { session });
  }); } finally { await session.endSession(); }
  res.json({ success: true, data: { requestId, status: 'CANCELLED' } });
}));
privacyRouter.get('/admin/privacy-requests', requirePermission('privacy:manage'), asyncHandler(async (req, res) => {
  const input = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), status: z.enum(['PENDING', 'HOLD', 'REJECTED', 'CANCELLED', 'COMPLETED']).default('PENDING') }).strict().parse(req.query);
  const filter = { status: input.status }; const [requests, total] = await Promise.all([PrivacyRequest.find(filter).sort({ createdAt: 1, _id: 1 }).skip((input.page - 1) * 20).limit(20).populate('userId', 'name email roles active'), PrivacyRequest.countDocuments(filter)]);
  res.json({ success: true, data: { requests, total, page: input.page, limit: 20 } });
}));
privacyRouter.put('/admin/retention-holds/:id', requirePermission('privacy:manage'), asyncHandler(async (req, res) => {
  const id = z.string().regex(/^[0-9a-f]{24}$/i).parse(req.params.id);
  const input = z.object({ hold: z.boolean(), revision: z.number().int().nonnegative(), reason: z.string().trim().min(5).max(500) }).strict().parse(req.body);
  const session = await User.startSession();
  try { await session.withTransaction(async () => {
    const ticket = await SupportTicket.findOneAndUpdate({ _id: id, revision: input.revision, contentPurgedAt: { $exists: false } }, { $set: { retentionHold: input.hold }, $inc: { revision: 1 } }, { new: true, session });
    if (!ticket) throw new ApiError(409, 'Ticket changed, is unavailable, or its content was already purged');
    await AuditLog.create([{ actorId: req.auth!.id, action: 'user.retention_hold.updated', resourceType: 'SupportTicket', resourceId: id, metadata: { reason: input.reason, active: input.hold }, ipAddress: req.ip }], { session });
  }); } finally { await session.endSession(); }
  res.json({ success: true, data: { hold: input.hold, revision: input.revision + 1 } });
}));
privacyRouter.post('/admin/privacy-requests/:id/review', requirePermission('privacy:manage'), asyncHandler(async (req, res) => {
  const id = z.string().regex(/^[0-9a-f]{24}$/i).parse(req.params.id);
  const input = z.object({ revision: z.number().int().nonnegative(), decision: z.enum(['HOLD', 'REJECTED', 'ERASE']), reason: z.string().trim().min(5).max(500) }).strict().parse(req.body);
  const session = await User.startSession(); let targetId = '';
  const erasedPassword = input.decision === 'ERASE' ? await bcrypt.hash(randomBytes(48).toString('hex'), 12) : undefined;
  try { await session.withTransaction(async () => {
    const request = await PrivacyRequest.findOne({ _id: id, revision: input.revision, status: { $in: ['PENDING', 'HOLD'] } }).session(session); if (!request) throw new ApiError(409, 'Request changed or is no longer reviewable');
    const actor = await User.findOne({ _id: req.auth!.id, active: true, roles: 'SUPER_ADMIN' }).session(session); if (!actor) throw new ApiError(403, 'Current super-administrator authority required');
    targetId = String(request.userId); if (targetId === actor.id) throw new ApiError(409, 'Another administrator must review your request');
    if (input.decision === 'ERASE') {
      // Write the account before reading dependencies. Account-scoped creation also writes this
      // document, so a racing reservation/support write retries and observes the inactive account.
      const target = await User.findOneAndUpdate({ _id: targetId, deletedAt: { $exists: false } }, { $inc: { searchHistoryRevision: 1 } }, { new: true, session });
      if (!target) throw new ApiError(409, 'Account is unavailable');
      if (target.roles.some((role) => ['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN'].includes(role))) throw new ApiError(409, 'Remove administrative authority before erasure');
      if (await Pharmacy.exists({ ownerId: targetId }).session(session) || await PharmacyStaff.exists({ userId: targetId, active: true }).session(session) || await Pharmacist.exists({ userId: targetId }).session(session)) throw new ApiError(409, 'Professional/ownership records require a separate retention and closure review. Place this request on hold.');
      if (await Reservation.exists({ customerId: targetId, status: { $in: ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'] } }).session(session) || await SupportTicket.exists({ requesterId: targetId, status: { $nin: ['RESOLVED', 'CLOSED'] } }).session(session)) throw new ApiError(409, 'Resolve active reservations and support tickets before erasure');
      if (await SupportTicket.exists({ requesterId: targetId, retentionHold: true }).session(session)) throw new ApiError(409, 'A support record is under retention hold. Place this request on hold.');
      await User.updateOne({ _id: targetId }, { $set: { name: 'Deleted account', active: false, roles: ['CUSTOMER'], passwordHash: erasedPassword, savedLocations: [], preferences: { recordSearchHistory: false, searchRadiusKm: 10, searchView: 'list' }, deletedAt: new Date() },
        $unset: { email: 1, phone: 1, phoneVerifiedAt: 1, phoneVerifiedFor: 1, emailVerifiedAt: 1, refreshTokenHash: 1, refreshTokenExpiresAt: 1, passwordResetHash: 1, passwordResetExpiresAt: 1, emailVerificationHash: 1, emailVerificationExpiresAt: 1 }, $inc: { authVersion: 1, accessRevision: 1, settingsRevision: 1 } }, { session });
      await SearchHistory.deleteMany({ userId: targetId }).session(session); await SavedPharmacy.deleteMany({ userId: targetId }).session(session); await Notification.deleteMany({ userId: targetId }).session(session); await PhoneChallenge.deleteOne({ _id: targetId }).session(session);
      await EmailDelivery.updateMany({ userId: targetId }, { $set: { status: 'CANCELLED' }, $unset: { payload: 1, tokenHash: 1, providerId: 1, lockToken: 1, lockedUntil: 1 } }, { session });
      await Reservation.updateMany({ customerId: targetId }, { $unset: { notes: 1, 'history.$[].note': 1 } }, { session });
      await SupportTicket.updateMany({ requesterId: targetId }, { $set: { subject: 'Deleted account support record', comments: [], contentPurgedAt: new Date() }, $unset: { resolutionNotes: 1, 'statusHistory.$[].resolutionNotes': 1 }, $inc: { revision: 1 } }, { session });
      // Operational identifiers, status/quantity history and audit evidence are retained. Do not
      // claim complete anonymization of other parties' free text or external backups/providers.
    }
    request.status = input.decision === 'ERASE' ? 'COMPLETED' : input.decision; request.reason = input.reason; request.reviewedBy = actor._id; request.reviewedAt = new Date(); request.revision++;
    if (input.decision === 'ERASE') request.completedAt = new Date(); await request.save({ session });
    await AuditLog.create([{ actorId: actor.id, action: `user.deletion.${request.status.toLowerCase()}`, resourceType: 'User', resourceId: targetId, metadata: { reason: input.reason }, ipAddress: req.ip }], { session });
  }); } finally { await session.endSession(); }
  if (input.decision === 'ERASE') disconnectUser(targetId);
  res.json({ success: true, data: { status: input.decision === 'ERASE' ? 'COMPLETED' : input.decision } });
}));
