import { api } from './api';
export const roleCodes = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN', 'CUSTOMER', 'PHARMACY_OWNER', 'PHARMACIST', 'PHARMACY_STAFF'] as const;
export type AccessUser = { _id: string; name: string; email?: string; roles: string[]; active: boolean; accessRevision?: number; isDemo?: boolean };
export type RolePolicy = { code: string; name: string; permissions: string[]; revision: number; immutable: boolean; allowedPermissions: string[]; fixedPermissions: string[]; defaultPermissions: string[] };
export type UserDetails = { user: AccessUser & { phone?: string; emailVerifiedAt?: string; createdAt?: string; updatedAt?: string }; assignments: Array<{ _id: string; role: string; permissions: string[]; active: boolean; pharmacyId: { _id: string; name: string; city?: string; verificationStatus?: string } | null }> | null; assignmentTotal: number | null; page: number; limit: number };
export const accessAdministration = {
  users: async (q: string, page: number, signal?: AbortSignal): Promise<{ users: AccessUser[]; total: number; page: number; limit: number }> => (await api.get('/admin/users', { params: { q, page, limit: 25 }, signal })).data.data,
  user: async (id: string, page: number, signal?: AbortSignal): Promise<UserDetails> => (await api.get(`/admin/users/${id}`, { params: { page, limit: 10 }, signal })).data.data,
  updateUser: async (target: AccessUser, values: { roles?: string[]; active?: boolean; reason: string }): Promise<void> => {
    const revision = target.accessRevision ?? 0;
    if (values.roles) await api.patch(`/admin/users/${target._id}/access`, { revision, ...values });
    else await api.patch(`/admin/users/${target._id}/active`, { revision, ...values });
  },
  roles: async (signal?: AbortSignal): Promise<RolePolicy[]> => (await api.get('/admin/roles', { signal })).data.data.roles,
  saveRole: async (policy: RolePolicy, permissions: string[], reason: string): Promise<{ permissions: string[]; revision: number }> => (await api.put(`/admin/roles/${policy.code}`, { revision: policy.revision, permissions, reason })).data.data.role,
};
