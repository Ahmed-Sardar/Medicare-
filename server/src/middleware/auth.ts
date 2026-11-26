import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../modules/models.js';
import { ApiError } from '../utils/errors.js';
import { effectivePermissions } from '../services/rbac.js';

export interface AuthUser { id: string; roles: string[]; permissions: string[]; email?: string; }
declare global { namespace Express { interface Request { auth?: AuthUser; pharmacyId?: string } } }
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.accessToken || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new ApiError(401, 'Authentication required', 'UNAUTHENTICATED');
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string') throw new ApiError(401, 'Invalid access token', 'INVALID_TOKEN');
    const user = await User.findById(payload.sub).select('roles active email authVersion');
    if (!user || !user.active) throw new ApiError(401, 'Account is unavailable', 'ACCOUNT_INACTIVE');
    if ((payload.version ?? 0) !== (user.authVersion ?? 0)) throw new ApiError(401, 'Session has been revoked', 'INVALID_TOKEN');
    req.auth = { id: user.id, roles: user.roles, permissions: await effectivePermissions(user.roles), email: user.email ?? undefined };
    next();
  } catch (error) { next(error instanceof ApiError ? error : new ApiError(401, 'Invalid or expired access token', 'INVALID_TOKEN')); }
}
export function optionalAuthentication(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.accessToken || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return next();
  authenticate(req, _res, next);
}
