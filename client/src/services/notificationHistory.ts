import { api } from './api';
export type Notice = { _id: string; title: string; message: string; createdAt: string; readAt?: string; data?: { ticketId?: string; view?: string; reservationId?: string } };
export const notificationHistory = {
  list: async (page: number, signal?: AbortSignal): Promise<{ notifications: Notice[]; unread: number; total: number; limit: number }> => (await api.get('/notifications', { params: { page, limit: 20 }, signal })).data.data,
  read: async (id: string): Promise<void> => { await api.patch(`/notifications/${id}/read`, {}); },
  allRead: async (): Promise<void> => { await api.post('/notifications/read-all', {}); },
};
