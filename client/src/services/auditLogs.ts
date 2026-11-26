import { api } from './api';
export type AuditFilters = { from: string; to: string; family?: string; action?: string; actorId?: string; pharmacyId?: string; resourceType?: string; resourceId?: string; limit: number };
export type AuditEvent = { _id: string; action: string; family: string; createdAt: string; actor: { id: string; name?: string } | null; pharmacyId: string | null; resourceType: string | null; resourceId: string | null; metadata?: Record<string, unknown>; ipAddress?: string | null };
export type AuditPage = { logs: AuditEvent[]; currentCursor: string; nextCursor: string | null; snapshotAt: string; period: { from: string; to: string }; limit: number; canViewDetails: boolean; canViewIp: boolean };
export type AuditOptions = { families: Array<{ code: string; name: string }>; actions: string[]; resourceTypes: string[]; optionsLimited: boolean; canViewDetails: boolean; canViewIp: boolean };
const clean = (filters: AuditFilters) => Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
export const auditLogs = {
  list: async (filters: AuditFilters, cursor?: string, signal?: AbortSignal): Promise<AuditPage> => (await api.get('/admin/audit-logs', { params: { ...clean(filters), ...(cursor ? { cursor } : {}) }, signal })).data.data,
  options: async (filters: AuditFilters, signal?: AbortSignal): Promise<AuditOptions> => (await api.get('/admin/audit-logs/options', { params: clean(filters), signal })).data.data,
  event: async (id: string, signal?: AbortSignal): Promise<{ event: AuditEvent; canViewDetails: boolean; canViewIp: boolean }> => (await api.get(`/admin/audit-logs/${id}`, { signal })).data.data,
};
