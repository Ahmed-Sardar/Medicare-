import { Router } from 'express';
import { z } from 'zod';
import { AuditLog, Permission, Role } from '../models.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { assertAccessAdministrator, lockAccessAdministration, updateUserAccess } from '../../services/accessAdministration.js';
import { defaultRolePermissions, fixedRolePermissions, roleCodes, rolePermissionCeilings, type RoleCode } from '../../services/rbacCatalog.js';

export const rolesRouter = Router();
rolesRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
rolesRouter.get('/roles', authenticate, requirePermission('roles:manage'), asyncHandler(async (_req, res) => {
  const [roles, permissions] = await Promise.all([Role.find({ code: { $in: roleCodes } }).sort({ code: 1 }).lean(), Permission.find().sort({ code: 1 }).lean()]);
  res.json({ success: true, data: { roles: roles.map((role) => ({ code: role.code, name: role.name, permissions: role.permissions, revision: role.revision ?? 0,
    immutable: role.code === 'SUPER_ADMIN', allowedPermissions: rolePermissionCeilings[role.code as RoleCode] || [], fixedPermissions: fixedRolePermissions[role.code as RoleCode] || [], defaultPermissions: defaultRolePermissions[role.code as RoleCode] || [] })), permissions } });
}));
rolesRouter.put('/roles/:code', authenticate, requirePermission('roles:manage'), asyncHandler(async (req, res) => {
  const code = z.enum(roleCodes).parse(req.params.code);
  if (code === 'SUPER_ADMIN') throw new ApiError(409, 'Super administrator authority cannot be edited');
  const input = z.object({ revision: z.number().int().nonnegative(), permissions: z.array(z.string()).max(50), reason: z.string().trim().min(5).max(500) }).strict().parse(req.body);
  const permissions = [...new Set(input.permissions)].sort();
  if (permissions.some((permission) => !rolePermissionCeilings[code].includes(permission))) throw new ApiError(400, 'A permission is outside this role’s permitted scope');
  if ((fixedRolePermissions[code] || []).some((permission) => !permissions.includes(permission))) throw new ApiError(400, 'Basic account ownership permissions cannot be removed');
  const session = await Role.startSession(); let updated: unknown;
  try { await session.withTransaction(async () => {
    await lockAccessAdministration(session); await assertAccessAdministrator(req.auth!.id, 'roles:manage', session);
    const prior = await Role.findOne({ code, revision: input.revision }).session(session);
    if (!prior) throw new ApiError(409, 'Role policy changed; reload before saving', 'ROLE_CONFLICT');
    updated = await Role.findOneAndUpdate({ code, revision: input.revision }, { $set: { permissions, updatedBy: req.auth!.id }, $inc: { revision: 1 } }, { new: true, session });
    await AuditLog.create([{ actorId: req.auth!.id, action: 'role.permissions.updated', resourceType: 'Role', resourceId: prior.id, metadata: { code, previousPermissions: prior.permissions, permissions, reason: input.reason }, ipAddress: req.ip }], { session });
  }); } finally { await session.endSession(); }
  res.json({ success: true, data: { role: updated } });
}));
rolesRouter.patch('/users/:id/access', authenticate, requirePermission('user:roles:manage'), asyncHandler(async (req, res) => {
  const id = z.string().regex(/^[0-9a-f]{24}$/i).parse(req.params.id);
  const input = z.object({ revision: z.number().int().nonnegative(), roles: z.array(z.enum(roleCodes)).min(1).max(roleCodes.length), active: z.boolean().optional(), reason: z.string().trim().min(5).max(500) }).strict().parse(req.body);
  res.json({ success: true, data: { user: await updateUserAccess(req.auth!, id, input, req.ip) } });
}));
