import { api } from './api';

export type SavedLocation = { id?: string; label: string; pinCode?: string; latitude?: number; longitude?: number; isDefault: boolean };
export type CustomerSettings = { revision: number; name: string; email: string; phone: string | null; locations: SavedLocation[];
  preferences: { searchRadiusKm: number; searchView: 'list' | 'map'; recordSearchHistory: boolean } };
export type SearchHistoryEntry = { _id: string; query: string; medicineId?: string; createdAt: string };
export const customerSettings = {
  get: async (signal?: AbortSignal): Promise<CustomerSettings> => (await api.get('/users/me/settings', { signal })).data.data,
  save: async (settings: CustomerSettings): Promise<CustomerSettings> => {
    const { email: _email, ...input } = settings;
    return (await api.put('/users/me/settings', input)).data.data;
  },
  history: async (signal?: AbortSignal): Promise<SearchHistoryEntry[]> => (await api.get('/search/history', { signal })).data.data.history,
  clearHistory: async (): Promise<void> => { await api.delete('/search/history'); },
};
