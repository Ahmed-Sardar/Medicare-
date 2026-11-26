import { api } from './api';
export type PrescriptionClass = 'UNVERIFIED' | 'OTC' | 'PRESCRIPTION' | 'CONTROLLED';
export type Category = { _id: string; name: string; description?: string; active?: boolean; revision?: number };
export type MedicineFields = { name: string; brand: string; genericName: string; composition: string; strength: string; dosageForm: string; manufacturer: string; packSize: string; aliases: string[]; categoryIds: string[];
  prescriptionClass: PrescriptionClass; classificationVerified: boolean; classificationSource: string; active: boolean };
export type CatalogueMedicine = Partial<MedicineFields> & { _id: string; name: string; strength: string; dosageForm: string; revision?: number; identityLocked?: boolean; isDemo?: boolean; classificationReviewedAt?: string; categories?: Category[] };
export type PublicMedicine = Omit<MedicineFields, 'active' | 'categoryIds' | 'classificationSource'> & { _id: string; isDemo: boolean; categories: Array<{ id: string; name: string }>; classificationSource?: string; classificationReviewedAt?: string };
type Page<T, K extends string> = Record<K, T[]> & { total: number; page: number; limit: number };
export const catalogue = {
  medicines: async (params: { q?: string; active?: string; categoryId?: string; page: number }, signal?: AbortSignal): Promise<Page<CatalogueMedicine, 'medicines'>> => (await api.get('/admin/medicines', { params: { ...params, limit: 25 }, signal })).data.data,
  medicine: async (id: string): Promise<CatalogueMedicine> => (await api.get(`/admin/medicines/${id}`)).data.data.medicine,
  saveMedicine: async (fields: MedicineFields, reason: string, previous?: CatalogueMedicine): Promise<CatalogueMedicine> => {
    const body = { ...fields, reason, ...(previous ? { revision: previous.revision ?? 0 } : {}) };
    return (previous ? await api.patch(`/admin/medicines/${previous._id}`, body) : await api.post('/admin/medicines', body)).data.data.medicine;
  },
  categories: async (params: { q?: string; active?: string; page: number; limit?: number }, signal?: AbortSignal): Promise<Page<Category, 'categories'>> => (await api.get('/admin/medicine-categories', { params: { limit: 25, ...params }, signal })).data.data,
  saveCategory: async (fields: { name: string; description: string; active: boolean }, reason: string, previous?: Category): Promise<Category> => {
    const body = { ...fields, reason, ...(previous ? { revision: previous.revision ?? 0 } : {}) };
    return (previous ? await api.patch(`/admin/medicine-categories/${previous._id}`, body) : await api.post('/admin/medicine-categories', body)).data.data.category;
  },
  publicMedicine: async (id: string, signal?: AbortSignal): Promise<PublicMedicine> => (await api.get(`/medicines/${id}`, { signal })).data.data.medicine,
};
export function medicineDraft(medicine?: CatalogueMedicine): MedicineFields {
  return { name: medicine?.name || '', brand: medicine?.brand || '', genericName: medicine?.genericName || '', composition: medicine?.composition || '', strength: medicine?.strength || '', dosageForm: medicine?.dosageForm || '', manufacturer: medicine?.manufacturer || '', packSize: medicine?.packSize || '', aliases: medicine?.aliases || [], categoryIds: medicine?.categoryIds || [], prescriptionClass: medicine?.prescriptionClass || 'UNVERIFIED', classificationVerified: Boolean(medicine?.classificationVerified), classificationSource: medicine?.classificationSource || '', active: medicine?.active ?? true };
}
