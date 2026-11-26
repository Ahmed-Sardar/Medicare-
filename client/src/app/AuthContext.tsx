import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import { api, refreshSession } from '../services/api';
export type SessionUser = { id: string; name: string; email: string; roles: string[]; permissions: string[]; emailVerifiedAt?: string | null };
type AuthValue = { user: SessionUser | null; loading: boolean; signIn: (email: string, password: string) => Promise<void>; signOut: () => Promise<void>; refresh: () => Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null); const [loading, setLoading] = useState(true);
  const refresh = async () => { try { let response; try { response = await api.get('/auth/me'); } catch { await refreshSession(); response = await api.get('/auth/me'); } setUser(response.data.data.user); } catch { setUser(null); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { const onFocus = () => { void refresh(); }; window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus); }, []);
  useEffect(() => { if (!user) return; const socketBase = new URL(import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1', window.location.origin); socketBase.pathname = ''; const socket = io(socketBase.toString(), { withCredentials: true, transports: ['websocket', 'polling'] }); socket.on('connect', () => window.dispatchEvent(new Event('medfind:socket-connected'))); socket.on('disconnect', (reason) => { if (reason === 'io server disconnect') { void refreshSession().then(() => socket.connect()).catch(() => undefined); } }); socket.on('notification:new', (notification) => window.dispatchEvent(new CustomEvent('medfind:notification', { detail: notification }))); return () => { socket.disconnect(); }; }, [user?.id]);
  const value = useMemo<AuthValue>(() => ({ user, loading, refresh, signIn: async (email, password) => { const { data } = await api.post('/auth/login', { email, password }); setUser(data.data.user); }, signOut: async () => { await api.post('/auth/logout'); setUser(null); } }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthValue { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be used within AuthProvider'); return value; }
