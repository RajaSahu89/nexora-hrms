import { prisma } from '../config/prisma';

export const nextEmployeeCode = async () => {
  const last = await prisma.employee.findFirst({ orderBy: { employeeCode: 'desc' }, select: { employeeCode: true } });
  const n = last ? parseInt(last.employeeCode.replace(/\D/g, ''), 10) || 0 : 0;
  return `NX-${String(n + 1).padStart(4, '0')}`;
};

export const ensureLeaveBalances = async (employeeId: string, year = new Date().getFullYear()) => {
  const types = await prisma.leaveType.findMany();
  for (const t of types) {
    await prisma.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: t.id, year } },
      update: {}, create: { employeeId, leaveTypeId: t.id, year, allocated: t.defaultDays },
    });
  }
};

export const getSetting = async <T = any>(key: string, fallback: T): Promise<T> => {
  const s = await prisma.companySetting.findUnique({ where: { key } });
  return (s?.value as T) ?? fallback;
};
