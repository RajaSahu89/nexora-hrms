import { useAuth } from '../contexts/AuthContext';
import { isHR } from '../types';
import { useApi, useLookups } from './useApi';

/** Employee options for selects. HR gets everyone, a manager gets their team, an employee gets nothing (self only). */
export function usePeople() {
  const { user } = useAuth();
  const lk = useLookups();
  const team = useApi<any>(user!.role === 'MANAGER' ? '/employees' : null, { limit: 100 });
  const list: any[] = isHR(user!.role) ? lk.employees : team.data?.data ?? [];
  return list.map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName}${e.employeeCode ? ` (${e.employeeCode})` : ''}` }));
}
