import { api } from './api';
export const phoneVerification = {
  status: async (): Promise<{ available: boolean; verified: boolean; verifiedAt: string | null }> => (await api.get('/users/me/phone-verification')).data.data,
  start: async (channel: 'sms' | 'whatsapp'): Promise<{ revision: string; expiresAt: string; developmentCode?: string }> => (await api.post('/users/me/phone-verification', { channel, consent: true })).data.data,
  check: async (revision: string, code: string): Promise<void> => { await api.post('/users/me/phone-verification/check', { revision, code }); },
};
