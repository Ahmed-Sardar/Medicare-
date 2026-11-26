import type { AuthUser } from '../middleware/auth.js';
import { Pharmacist, PharmacyStaff } from '../modules/models.js';
import { ApiError } from '../utils/errors.js';
import { permissionAllows } from './rbacCatalog.js';

export type PharmacyAction = 'inventory:read' | 'inventory:update' | 'reservation:read' | 'reservation:manage' | 'report:read' | 'pharmacy:manage';
export function allowsPharmacyAction(auth: AuthUser, assignment: { role: string; permissions: string[] } | null, verifiedPharmacist: boolean, action: PharmacyAction): boolean {
  const has = (permission: string) => permissionAllows(auth.permissions, permission);
  if (has('*')) return true;
  if ((action === 'inventory:read' && (has('inventory:read:any') || has('inventory:write:any'))) || (action === 'inventory:update' && has('inventory:write:any'))
    || (action === 'reservation:read' && (has('reservation:read:any') || has('reservation:manage:any'))) || (action === 'reservation:manage' && has('reservation:manage:any'))
    || (action === 'report:read' && has('report:read')) || (action === 'pharmacy:manage' && has('pharmacy:manage'))) return true;
  if (!assignment || !auth.roles.includes(assignment.role)) return false;
  if (assignment.role === 'PHARMACY_OWNER') {
    const permission = { 'inventory:read': 'inventory:manage:own', 'inventory:update': 'inventory:manage:own', 'reservation:read': 'reservation:manage:own', 'reservation:manage': 'reservation:manage:own', 'report:read': 'report:read:own', 'pharmacy:manage': 'pharmacy:manage:own' }[action];
    if (has(permission)) return true;
  } else if (assignment.role === 'PHARMACIST') {
    const permission = { 'inventory:read': 'inventory:read:assigned', 'inventory:update': 'inventory:update:assigned', 'reservation:read': 'reservation:review:assigned', 'reservation:manage': 'reservation:review:assigned', 'report:read': 'report:read:assigned', 'pharmacy:manage': '' }[action];
    if (permission && has(permission) && (action === 'inventory:read' || verifiedPharmacist)) return true;
  } else {
    const assigned = (permission: string) => assignment.permissions.includes('*') || assignment.permissions.includes(permission);
    if (action === 'inventory:read' && ((has('inventory:read:assigned') && assigned('inventory:read')) || (has('inventory:update:assigned') && assigned('inventory:update')))) return true;
    if (action === 'inventory:update' && has('inventory:update:assigned') && assigned('inventory:update')) return true;
    if (action === 'reservation:read' && has('reservation:read:assigned') && assigned('reservation:read')) return true;
    if (action === 'report:read' && has('report:read:assigned') && assigned('report:read')) return true;
  }
  return false;
}
export async function assertPharmacyAction(auth: AuthUser, pharmacyId: string, action: PharmacyAction): Promise<void> {
  if (allowsPharmacyAction(auth, null, false, action)) return;
  const assignment = await PharmacyStaff.findOne({ userId: auth.id, pharmacyId, active: true });
  const verified = assignment?.role === 'PHARMACIST' && action !== 'inventory:read' && Boolean(await Pharmacist.exists({ userId: auth.id, pharmacyIds: pharmacyId, verificationStatus: 'VERIFIED', evidenceDocumentPath: { $type: 'string' }, evidenceUploadedAt: { $type: 'date' } }));
  if (allowsPharmacyAction(auth, assignment, verified, action)) return;
  throw new ApiError(403, `Pharmacy permission required: ${action}`);
}
