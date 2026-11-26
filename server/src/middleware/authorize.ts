import type { Request, Response, NextFunction } from 'express';
import { assertPharmacyAction, type PharmacyAction } from '../services/pharmacyAuthorization.js';
import { permissionAllows } from '../services/rbacCatalog.js';
import { forbidden, ApiError } from '../utils/errors.js';

export { permissionAllows as hasPermission } from '../services/rbacCatalog.js';
export function requirePermission(permission: string) { return (req: Request, _res: Response, next: NextFunction): void => { if (!req.auth) return next(new ApiError(401, 'Authentication required')); if (!permissionAllows(req.auth.permissions, permission)) return next(forbidden()); next(); }; }
export async function resolvePharmacyScope(req: Request, pharmacyId: string, action: PharmacyAction): Promise<void> {
  if (!req.auth) throw new ApiError(401, 'Authentication required');
  await assertPharmacyAction(req.auth, pharmacyId, action);
  req.pharmacyId = pharmacyId;
}
