import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, refreshSession, setToken } from '../services/api';
import { User } from '../types';
import { setCurrency } from '../utils/format';

interface AuthCtx {
  user: User | null; loading: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>; refreshUser: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSettings = () => api.get('/settings/public').then((r) => setCurrency(r.data.currency)).catch(() => {});

  useEffect(() => {
    refreshSession().then((d) => { setUser(d.user); loadSettings(); }).catch(() => {}).finally(() => setLoading(false));
    const out = () => { setToken(null); setUser(null); };
    window.addEventListener('auth:logout', out);
    return () => window.removeEventListener('auth:logout', out);
  }, []);

  const login = useCallback(async (email: string, password: string, remember: boolean) => {
    const r = await api.post('/auth/login', { email, password, remember });
    setToken(r.data.accessToken); setUser(r.data.user); loadSettings();
  }, []);
  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setToken(null); setUser(null);
  }, []);
  const refreshUser = useCallback(async () => { const r = await api.get('/auth/me'); setUser(r.data.user); }, []);

  return <Ctx.Provider value={{ user, loading, login, logout, refreshUser }}>{children}</Ctx.Provider>;
}
