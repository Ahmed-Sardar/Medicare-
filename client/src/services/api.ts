import axios from 'axios';
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1', withCredentials: true, headers: { 'Content-Type': 'application/json' } });
let refreshPromise: Promise<unknown> | undefined;
export function refreshSession(): Promise<unknown> { refreshPromise ??= api.post('/auth/refresh').finally(() => { refreshPromise = undefined; }); return refreshPromise; }
api.interceptors.response.use((response) => response, async (error) => {
  const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
  if (error.response?.status === 401 && original && !original._retried && !original.url?.includes('/auth/')) { original._retried = true; await refreshSession(); return api(original); }
  return Promise.reject(error);
});
export function errorMessage(error: unknown): string { if (axios.isAxiosError(error)) return error.response?.data?.error?.message || error.message; return error instanceof Error ? error.message : 'Something went wrong'; }
