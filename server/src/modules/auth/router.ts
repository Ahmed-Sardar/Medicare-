import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User } from '../models.js';
import { env } from '../../config/env.js';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../../services/audit.js';
import { deliverAccountEmail } from '../../services/email.js';
import { disconnectUser } from '../../services/realtime.js';
import { effectivePermissions } from '../../services/rbac.js';

export const authRouter = Router();
const registerSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().transform((v) => v.toLowerCase()), phone: z.string().regex(/^\+?[0-9]{10,15}$/).optional(), password: z.string().min(10).max(128), accountType: z.enum(['CUSTOMER', 'PHARMACY_OWNER']).default('CUSTOMER') });
const loginSchema = z.object({ email: z.string().email().transform((v) => v.toLowerCase()), password: z.string().min(1) });
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
function issueAccess(userId: string, roles: string[], version: number): string { return jwt.sign({ roles, version }, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'] }); }
async function sessionUser(user: { id: string; name: string; email?: string | null; phone?: string | null; roles: string[]; emailVerifiedAt?: Date | null }) { return { id: user.id, name: user.name, email: user.email ?? '', phone: user.phone ?? null, roles: user.roles, permissions: await effectivePermissions(user.roles), emailVerifiedAt: user.emailVerifiedAt ?? null }; }
function setRefreshCookie(res: import('express').Response, token: string): void { res.cookie('refreshToken', token, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1/auth', maxAge: env.REFRESH_TOKEN_DAYS * 86400000 }); }
function setAccessCookie(res: import('express').Response, token: string): void { res.cookie('accessToken', token, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 15 * 60 * 1000 }); }
async function rotateTokens(user: { id: string; passwordHash: string }, res: import('express').Response): Promise<void> {
  const refresh = crypto.randomBytes(48).toString('base64url');
  // Password hash in the filter prevents an in-flight login from reviving a session after a password reset.
  const record = await User.findOneAndUpdate({ _id: user.id, active: true, passwordHash: user.passwordHash }, { $set: { refreshTokenHash: hash(refresh), refreshTokenExpiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400000) } }, { new: true });
  if (!record) throw new ApiError(401, 'Account is unavailable or credentials changed');
  setAccessCookie(res, issueAccess(record.id, record.roles, record.authVersion ?? 0)); setRefreshCookie(res, refresh);
}
async function prepareAccountDelivery(kind: 'verify' | 'reset', userId: string, email: string, token: string): Promise<void> {
  const session = await User.startSession();
  try { await session.withTransaction(async () => {
    const expiresAt = new Date(Date.now() + (kind === 'verify' ? 86400000 : 1800000));
    const fields = kind === 'verify' ? { emailVerificationHash: hash(token), emailVerificationExpiresAt: expiresAt } : { passwordResetHash: hash(token), passwordResetExpiresAt: expiresAt };
    const result = await User.updateOne({ _id: userId, email, active: true }, { $set: fields }, { session });
    if (!result.matchedCount) throw new ApiError(409, 'Account changed; request new instructions');
    await deliverAccountEmail(kind, email, token, userId, expiresAt, session);
  }); } finally { await session.endSession(); }
}

authRouter.post('/register', asyncHandler(async (req, res) => {
  const input = registerSchema.parse(req.body); const passwordHash = await bcrypt.hash(input.password, 12);
  const roles = [input.accountType]; const verification = crypto.randomBytes(32).toString('hex'); const expiresAt = new Date(Date.now() + 86400000); const session = await User.startSession();
  let user;
  try { user = await session.withTransaction(async () => {
    const [created] = await User.create([{ name: input.name, email: input.email, phone: input.phone, passwordHash, roles, emailVerificationHash: hash(verification), emailVerificationExpiresAt: expiresAt }], { session });
    await deliverAccountEmail('verify', input.email, verification, created!.id, expiresAt, session); return created;
  }); } finally { await session.endSession(); }
  if (!user) throw new ApiError(503, 'Account registration could not be committed');
  await rotateTokens(user, res);
  await recordAudit({ actorId: user.id, action: 'auth.register', resourceType: 'User', resourceId: user.id, ipAddress: req.ip });
  res.status(201).json({ success: true, data: { user: await sessionUser(user), emailVerificationRequired: true, ...(env.NODE_ENV === 'development' ? { developmentVerificationToken: verification } : {}) } });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body); const user = await User.findOne({ email: input.email }).select('+passwordHash');
  if (!user || !user.active || !(await bcrypt.compare(input.password, user.passwordHash))) throw new ApiError(401, 'Email or password is incorrect', 'INVALID_CREDENTIALS');
  await rotateTokens(user, res); await recordAudit({ actorId: user.id, action: 'auth.login', resourceType: 'User', resourceId: user.id, ipAddress: req.ip });
  res.json({ success: true, data: { user: await sessionUser(user) } });
}));

authRouter.post('/refresh', asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken as string | undefined; if (!token) throw new ApiError(401, 'Refresh token required');
  const replacement = crypto.randomBytes(48).toString('base64url');
  const user = await User.findOneAndUpdate({ refreshTokenHash: hash(token), refreshTokenExpiresAt: { $gt: new Date() }, active: true }, { $set: { refreshTokenHash: hash(replacement), refreshTokenExpiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400000) } }, { new: true });
  if (!user) throw new ApiError(401, 'Refresh token is expired or revoked');
  setAccessCookie(res, issueAccess(user.id, user.roles, user.authVersion ?? 0)); setRefreshCookie(res, replacement);
  res.json({ success: true, data: { user: await sessionUser(user) } });
}));

authRouter.post('/logout', asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken as string | undefined; if (token) { const user = await User.findOneAndUpdate({ refreshTokenHash: hash(token) }, { $unset: { refreshTokenHash: 1, refreshTokenExpiresAt: 1 }, $inc: { authVersion: 1 } }); if (user) disconnectUser(user.id); }
  res.clearCookie('accessToken', { path: '/' }); res.clearCookie('refreshToken', { path: '/api/v1/auth' }); res.json({ success: true, data: { loggedOut: true } });
}));

authRouter.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = z.object({ email: z.string().trim().email() }).parse(req.body);
  const user = await User.findOne({ email: email.toLowerCase(), active: true });
  let developmentResetToken: string | undefined;
  if (user?.email) {
    const reset = crypto.randomBytes(32).toString('hex');
    await prepareAccountDelivery('reset', user.id, user.email, reset);
    if (env.NODE_ENV === 'development') developmentResetToken = reset;
  }
  // Do not disclose account existence or provider failures in production responses.
  res.json({ success: true, data: { message: 'If this account exists, reset instructions will be sent.', ...(developmentResetToken ? { developmentResetToken } : {}) } });
}));

authRouter.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, password } = z.object({ token: z.string().min(32).max(256), password: z.string().min(10).max(128) }).parse(req.body);
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.findOneAndUpdate({ passwordResetHash: hash(token), passwordResetExpiresAt: { $gt: new Date() }, active: true }, { $set: { passwordHash }, $inc: { authVersion: 1 }, $unset: { refreshTokenHash: 1, refreshTokenExpiresAt: 1, passwordResetHash: 1, passwordResetExpiresAt: 1 } });
  if (!user) throw new ApiError(400, 'Password reset token is invalid or expired');
  disconnectUser(user.id);
  res.clearCookie('accessToken', { path: '/' }); res.clearCookie('refreshToken', { path: '/api/v1/auth' });
  res.json({ success: true, data: { passwordReset: true } });
}));

authRouter.post('/verify-email', asyncHandler(async (req, res) => {
  const { token } = z.object({ token: z.string().min(32).max(256) }).parse(req.body);
  const user = await User.findOneAndUpdate({ emailVerificationHash: hash(token), emailVerificationExpiresAt: { $gt: new Date() }, active: true }, { $set: { emailVerifiedAt: new Date() }, $unset: { emailVerificationHash: 1, emailVerificationExpiresAt: 1 } });
  if (!user) throw new ApiError(400, 'Verification token is invalid or expired');
  res.json({ success: true, data: { verified: true } });
}));

authRouter.post('/resend-verification', authenticate, asyncHandler(async (req, res) => {
  const verification = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  // The previous 24-hour expiry is also a one-minute resend cooldown.
  const session = await User.startSession();
  let user;
  try { user = await session.withTransaction(async () => {
    const expiresAt = new Date(now + 86400000);
    const updated = await User.findOneAndUpdate({ _id: req.auth!.id, active: true, emailVerifiedAt: { $exists: false }, $or: [{ emailVerificationExpiresAt: { $exists: false } }, { emailVerificationExpiresAt: { $lte: new Date(now + 86400000 - 60000) } }] }, { $set: { emailVerificationHash: hash(verification), emailVerificationExpiresAt: expiresAt } }, { new: true, session });
    if (updated?.email) await deliverAccountEmail('verify', updated.email, verification, updated.id, expiresAt, session);
    return updated;
  }); } finally { await session.endSession(); }
  if (!user) {
    const current = await User.findById(req.auth!.id).select('emailVerifiedAt');
    if (current?.emailVerifiedAt) return res.json({ success: true, data: { alreadyVerified: true } });
    throw new ApiError(429, 'Wait a minute before requesting another verification email');
  }
  if (!user.email) throw new ApiError(409, 'This account has no email address');
  res.json({ success: true, data: { message: 'Verification instructions have been sent if delivery is configured.', ...(env.NODE_ENV === 'development' ? { developmentVerificationToken: verification } : {}) } });
}));

authRouter.get('/me', authenticate, asyncHandler(async (req, res) => { const user = await User.findById(req.auth!.id).select('name email phone roles active emailVerifiedAt'); if (!user) throw new ApiError(401, 'Account is unavailable'); res.json({ success: true, data: { user: await sessionUser(user) } }); }));
authRouter.patch('/me', authenticate, asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().trim().min(2).max(120).optional(), phone: z.string().regex(/^\+?[0-9]{10,15}$/).optional() }).parse(req.body);
  const user = await User.findByIdAndUpdate(req.auth!.id, { $set: input, $inc: { settingsRevision: 1 } }, { new: true, runValidators: true }).select('name email phone roles emailVerifiedAt'); if (!user) throw new ApiError(401, 'Account is unavailable'); res.json({ success: true, data: { user: await sessionUser(user) } });
}));
