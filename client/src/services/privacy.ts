import { api } from './api';
export type DeletionRequest = { _id: string; status: string; revision: number; reason?: string; createdAt: string; userId: { _id: string; name: string; email?: string; roles: string[] } | null };
export const privacy = {
  mine: async (): Promise<{ request: DeletionRequest | null }> => (await api.get('/users/me/deletion-request')).data.data,
  request: async (password: string): Promise<void> => { await api.post('/users/me/deletion-request', { password, confirm: 'DELETE MY ACCOUNT' }); },
  cancel: async (): Promise<void> => { await api.post('/users/me/deletion-request/cancel', {}); },
  list: async (status: string, page: number, signal?: AbortSignal): Promise<{ requests: DeletionRequest[]; total: number }> => (await api.get('/admin/privacy-requests', { params: { status, page }, signal })).data.data,
  review: async (request: DeletionRequest, decision: string, reason: string): Promise<void> => { await api.post(`/admin/privacy-requests/${request._id}/review`, { revision: request.revision, decision, reason }); },
};
