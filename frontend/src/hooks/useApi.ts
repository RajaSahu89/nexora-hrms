import { useCallback, useEffect, useState } from 'react';
import { api, errMsg } from '../services/api';

export function useApi<T = any>(url: string | null, params?: Record<string, any>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(params ?? {});
  useEffect(() => {
    if (!url) { setLoading(false); return; }
    let off = false;
    setLoading(true);
    api.get(url, { params }).then((r) => { if (!off) { setData(r.data); setError(null); } })
      .catch((e) => { if (!off) setError(errMsg(e)); })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [url, key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload, setData };
}

export function useLookups() {
  const { data } = useApi<{ departments: any[]; designations: any[]; leaveTypes: any[]; employees: any[] }>('/settings/lookups');
  return data ?? { departments: [], designations: [], leaveTypes: [], employees: [] };
}
