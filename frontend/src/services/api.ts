import axios from 'axios';

let accessToken: string | null = null;
export const setToken = (t: string | null) => { accessToken = t; };

export const api = axios.create({ baseURL: '/api', withCredentials: true });
api.interceptors.request.use((c) => { if (accessToken) c.headers.Authorization = `Bearer ${accessToken}`; return c; });

let refreshing: Promise<any> | null = null;
export const refreshSession = () => {
  if (!refreshing) {
    refreshing = axios.post('/api/auth/refresh', {}, { withCredentials: true })
      .then((r) => { setToken(r.data.accessToken); return r.data; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
};

api.interceptors.response.use((r) => r, async (err) => {
  const o = err.config;
  if (err.response?.status === 401 && o && !o._retry && !String(o.url).includes('/auth/')) {
    o._retry = true;
    try { await refreshSession(); return api(o); } catch { window.dispatchEvent(new Event('auth:logout')); }
  }
  return Promise.reject(err);
});

export const errMsg = (e: any): string => e?.response?.data?.error || e?.message || 'Something went wrong';

export const download = async (url: string, params: any, filename: string) => {
  const r = await api.get(url, { params, responseType: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(r.data);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
