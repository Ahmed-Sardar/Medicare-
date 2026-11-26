import { api } from './api';

export type PlatformReservation = {
  _id: string;
  status: string;
  quantity: number;
  createdAt: string;
  medicineId?: { name?: string; strength?: string };
  pharmacyId?: { name?: string };
};

export const adminReservations = {
  list: async (status: string, page: number, signal?: AbortSignal): Promise<{ reservations: PlatformReservation[]; total: number; page: number; limit: number }> =>
    (await api.get('/reservations', { params: { ...(status ? { status } : {}), page, limit: 25 }, signal })).data.data,
};
