import { api } from './api';
export type AdminPharmacy = { _id: string; name: string; address: string; city: string; state: string; pinCode: string; phone?: string; email?: string; ownerId: { name?: string; email?: string } | string; verificationStatus: string; active: boolean; isDemo?: boolean; licenseNumber?: string; licenseDocumentOriginalName?: string; registeredPharmacistName?: string; revision?: number; verificationHistory?: Array<{ _id?: string; status: string; reason?: string; at: string }> };
export type MonitoredStock = { _id: string; medicineId?: { name?: string; strength?: string }; availableQuantity: number; stockStatus: string; freshness: string; lastUpdatedAt: string };
export type MonitoredReservation = { _id: string; medicineId?: { name?: string }; quantity: number; status: string; createdAt: string };
export const pharmacyAdministration = {
  list: async (q: string, status: string, page: number, signal?: AbortSignal): Promise<{ pharmacies: AdminPharmacy[]; total: number }> => (await api.get('/admin/pharmacies', { params: { q, ...(status ? { status } : {}), page, limit: 20 }, signal })).data.data,
  pharmacy: async (id: string, signal?: AbortSignal): Promise<AdminPharmacy> => (await api.get(`/pharmacies/${id}`, { signal })).data.data.pharmacy,
  inventory: async (id: string, page: number, signal?: AbortSignal): Promise<{ inventory: MonitoredStock[]; total: number }> => (await api.get('/inventory', { params: { pharmacyId: id, page, limit: 20 }, signal })).data.data,
  reservations: async (id: string, page: number, signal?: AbortSignal): Promise<{ reservations: MonitoredReservation[]; total: number }> => (await api.get('/reservations', { params: { pharmacyId: id, page, limit: 20 }, signal })).data.data,
  review: async (pharmacy: AdminPharmacy, status: string, reason: string): Promise<void> => { await api.patch(`/admin/pharmacies/${pharmacy._id}/verification`, { status, reason, revision: pharmacy.revision ?? 0 }); },
};
