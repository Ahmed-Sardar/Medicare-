import type { ClientSession } from 'mongoose';
import { Permission, Role, SystemSetting } from '../modules/models.js';
import { defaultRolePermissions, permissionAllows, permissionCodes, roleCodes, rolePermissionCeilings, type RoleCode } from './rbacCatalog.js';
import { env } from '../config/env.js';

export async function ensureRbacCatalog(): Promise<void> {
  await Promise.all([Role.init(), Permission.init(), SystemSetting.init()]);
  if (env.NODE_ENV === 'production') {
    for (const [collection, field] of [[Role.collection, 'code'], [Permission.collection, 'code'], [SystemSetting.collection, 'key']] as const) {
      const indexes = await collection.indexes();
      if (!indexes.some((index) => index.unique && !index.sparse && !index.partialFilterExpression && Object.keys(index.key).length === 1 && index.key[field] === 1)) throw new Error(`Provision a unique ${field} index on ${collection.name} before starting the API`);
    }
  }
  for (const code of permissionCodes) await Permission.updateOne({ code }, { $set: { code, allowedRoles: roleCodes.filter((role) => role === 'SUPER_ADMIN' || rolePermissionCeilings[role].includes(code)) } }, { upsert: true });
  for (const code of roleCodes) await Role.updateOne({ code }, { $setOnInsert: { code, name: code.replaceAll('_', ' '), permissions: defaultRolePermissions[code], revision: 0 } }, { upsert: true });
  await SystemSetting.updateOne({ key: 'rbacAdministration' }, { $setOnInsert: { key: 'rbacAdministration', value: { sequence: 0 } } }, { upsert: true });
}
export async function effectivePermissions(roles: string[], session?: ClientSession): Promise<string[]> {
  if (roles.includes('SUPER_ADMIN')) return ['*'];
  const policies = await Role.find({ code: { $in: roles } }).select('code permissions').session(session ?? null).lean();
  return [...new Set(policies.flatMap((policy) => {
    const ceiling = rolePermissionCeilings[policy.code as RoleCode] || [];
    return policy.permissions.filter((code) => code !== '*' && ceiling.includes(code));
  }))];
}
export async function roleCodesWithPermission(permission: string, session?: ClientSession): Promise<string[]> {
  const policies = await Role.find({ code: { $in: roleCodes }, permissions: permission }).select('code').session(session ?? null).lean();
  return ['SUPER_ADMIN', ...policies.filter((policy) => permissionAllows(rolePermissionCeilings[policy.code as RoleCode] || [], permission)).map((policy) => policy.code)];
}
