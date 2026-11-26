import type { ClientSession } from 'mongoose';
import type { AuthUser } from '../middleware/auth.js';
import { AuditLog, Notification, Pharmacy, PharmacyStaff, SystemSetting, User } from '../modules/models.js';
import { ApiError } from '../utils/errors.js';
import { effectivePermissions } from './rbac.js';
import { permissionAllows } from './rbacCatalog.js';
import { disconnectUser } from './realtime.js';

export async function lockAccessAdministration(session: ClientSession): Promise<void> {
  const lock = await SystemSetting.updateOne({ key: 'rbacAdministration' }, { $inc: { 'value.sequence': 1 } }, { session });
  if (!lock.matchedCount) throw new ApiError(503, 'Authorization catalogue is not initialized');
}
export async function assertAccessAdministrator(actorId: string, permission: string, session: ClientSession) {
  const actor = await User.findOne({ _id: actorId, active: true }).select('roles').session(session);
  if (!actor || !actor.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)) || !permissionAllows(await effectivePermissions(actor.roles, session), permission)) throw new ApiError(403, 'Administrative access changed; sign in again');
  return actor;
}
export async function updateUserAccess(auth: AuthUser, targetId: string, input: { revision: number; roles?: string[]; active?: boolean; reason: string }, ipAddress?: string) {
  const session = await User.startSession(); let result: { id: string; roles: string[]; active: boolean; accessRevision: number; changed: boolean } | undefined;
  try { await session.withTransaction(async () => {
    await lockAccessAdministration(session);
    const actor = await assertAccessAdministrator(auth.id, input.roles ? 'user:roles:manage' : 'user:manage', session);
    if (input.active !== undefined && !permissionAllows(await effectivePermissions(actor.roles, session), 'user:manage')) throw new ApiError(403, 'Account activation permission required');
    const target = await User.findById(targetId).session(session);
    if (!target) throw new ApiError(404, 'User not found');
    if (actor.id === target.id) throw new ApiError(409, 'Ask another administrator to change your own access');
    if ((target.accessRevision ?? 0) !== input.revision) throw new ApiError(409, 'Account access changed; reload before saving', 'ACCESS_CONFLICT');
    const roles = [...new Set(input.roles ?? target.roles)].sort(); const active = input.active ?? target.active;
    const privileged = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN']; const superAdmin = actor.roles.includes('SUPER_ADMIN');
    if (!superAdmin && [...roles, ...target.roles].some((role) => privileged.includes(role))) throw new ApiError(403, 'Only a super administrator can manage administrator accounts');
    if (target.deletedAt) throw new ApiError(409, 'An erased account cannot be reactivated or assigned roles');
    if (target.isDemo && roles.some((role) => privileged.includes(role))) throw new ApiError(409, 'Demo accounts cannot be promoted to platform administrators');
    if (roles.some((role) => privileged.includes(role) && !target.roles.includes(role)) && (!active || !target.email || !target.emailVerifiedAt)) throw new ApiError(409, 'Administrator appointments require an active account with a verified email');
    if (target.roles.includes('SUPER_ADMIN') && target.active && (!active || !roles.includes('SUPER_ADMIN')) && await User.countDocuments({ active: true, roles: 'SUPER_ADMIN' }).session(session) <= 1) throw new ApiError(409, 'At least one active super administrator is required');
    const assignments = await PharmacyStaff.find({ userId: target.id, active: true }).select('role').session(session);
    if (assignments.some((assignment) => !roles.includes(assignment.role))) throw new ApiError(409, 'Revoke or change active pharmacy assignments before removing their account roles');
    if (!roles.includes('PHARMACY_OWNER') && await Pharmacy.exists({ ownerId: target.id }).session(session)) throw new ApiError(409, 'This account owns a pharmacy and must retain its owner role');
    const changed = active !== target.active || roles.join(',') !== [...target.roles].sort().join(',');
    if (!changed) { result = { id: target.id, roles: target.roles, active: target.active, accessRevision: target.accessRevision ?? 0, changed: false }; return; }
    const updated = await User.findOneAndUpdate({ _id: target.id }, { $set: { roles, active }, $inc: { authVersion: 1, accessRevision: 1 }, $unset: { refreshTokenHash: 1, refreshTokenExpiresAt: 1, passwordResetHash: 1, passwordResetExpiresAt: 1 } }, { new: true, session, runValidators: true });
    if (!updated) throw new ApiError(409, 'Account access changed; reload before saving', 'ACCESS_CONFLICT');
    await AuditLog.create([{ actorId: actor.id, action: 'user.access.updated', resourceType: 'User', resourceId: target.id, ipAddress,
      metadata: { reason: input.reason, previousRoles: target.roles, roles, previousActive: target.active, active, revision: updated.accessRevision } }], { session });
    await Notification.create([{ userId: target.id, type: 'ACCOUNT_ACCESS_UPDATED', title: 'Your account access changed', message: 'An administrator changed your account access. Sign in again to review your available workspaces.' }], { session });
    result = { id: updated.id, roles: updated.roles, active: updated.active, accessRevision: updated.accessRevision ?? 0, changed: true };
  }); } finally { await session.endSession(); }
  if (result?.changed) disconnectUser(result.id);
  return result!;
}
