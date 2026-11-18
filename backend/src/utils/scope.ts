import { Prisma } from '@prisma/client';
import { AuthInfo } from '../types/express';

export const isHR = (role: string) => role === 'SUPER_ADMIN' || role === 'HR_ADMIN';

/** Which employees this user may see. Applied on every backend query (never UI-only). */
export const scopeWhere = (a: AuthInfo): Prisma.EmployeeWhereInput => {
  if (isHR(a.role)) return {};
  const me = a.employeeId ?? '__none__';
  if (a.role === 'MANAGER') {
    return { OR: [{ id: me }, { managerId: me }, { department: { headId: me } }] };
  }
  return { id: me };
};
