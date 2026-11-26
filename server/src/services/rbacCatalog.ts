export const roleCodes = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN', 'CUSTOMER', 'PHARMACY_OWNER', 'PHARMACIST', 'PHARMACY_STAFF'] as const;
export type RoleCode = typeof roleCodes[number];
export const defaultRolePermissions: Record<RoleCode, string[]> = {
  SUPER_ADMIN: ['*'],
  ADMIN: ['pharmacy:review', 'pharmacy:manage', 'user:read', 'user:manage', 'user:roles:manage', 'medicine:manage', 'report:read', 'inventory:read:any', 'reservation:read:any', 'reservation:manage:any', 'audit:read', 'audit:read:pharmacy', 'audit:read:catalogue', 'audit:read:reports', 'audit:read:details', 'pharmacist:review', 'support:manage'],
  SUPPORT_ADMIN: ['support:manage'],
  CUSTOMER: ['search:read', 'reservation:create', 'reservation:read:own', 'profile:manage', 'pharmacy:save'],
  PHARMACY_OWNER: ['pharmacy:manage:own', 'staff:manage:own', 'inventory:manage:own', 'reservation:manage:own', 'report:read:own'],
  PHARMACIST: ['reservation:review:assigned', 'inventory:update:assigned', 'inventory:read:assigned', 'report:read:assigned'],
  PHARMACY_STAFF: ['inventory:update:assigned', 'reservation:read:assigned', 'inventory:read:assigned', 'report:read:assigned'],
};
// Ceilings prevent a configurable role from acquiring platform or professional authority belonging to another role.
export const rolePermissionCeilings: Record<RoleCode, string[]> = { ...defaultRolePermissions, ADMIN: [...defaultRolePermissions.ADMIN, 'inventory:write:any', 'audit:read:security', 'audit:read:support'] };
export const fixedRolePermissions: Partial<Record<RoleCode, string[]>> = { CUSTOMER: ['search:read', 'profile:manage', 'reservation:read:own'] };
export const permissionCodes = [...new Set([...Object.values(rolePermissionCeilings).flat().filter((code) => code !== '*'), 'roles:manage', 'settings:read', 'settings:manage', 'audit:read:ip', 'audit:read:system', 'privacy:manage'])];
export const permissionAllows = (permissions: readonly string[], permission: string): boolean => permissions.includes('*') || permissions.includes(permission);
