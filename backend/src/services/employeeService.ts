import bcrypt from 'bcrypt';
import { Prisma, RoleName } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { HttpError } from '../utils/httpError';
import { parseDate } from '../utils/dates';

export function mapEmployeeInput(d: Record<string, any>) {
  const out: Record<string, any> = { ...d };
  delete out.role;
  delete out.password;
  if ('dateOfBirth' in d) out.dateOfBirth = d.dateOfBirth ? parseDate(d.dateOfBirth) : null;
  if (d.joiningDate) out.joiningDate = parseDate(d.joiningDate);
  for (const k of ['education', 'experience', 'bankDetails']) if (k in d) out[k] = d[k] === null ? Prisma.DbNull : d[k];
  return out;
}

export async function ensureBalances(employeeId: string, year = new Date().getFullYear()) {
  const types = await prisma.leaveType.findMany();
  if (!types.length) return;
  await prisma.leaveBalance.createMany({
    data: types.map((t) => ({ employeeId, leaveTypeId: t.id, year, allocated: t.defaultDays })),
    skipDuplicates: true,
  });
}

export async function createEmployeeWithUser(
  input: Record<string, any>,
  role: RoleName,
  password: string,
  mustChangePassword = false,
) {
  if (
    (await prisma.user.findUnique({ where: { email: input.email } })) ||
    (await prisma.employee.findUnique({ where: { email: input.email } }))
  ) throw new HttpError(409, 'Email is already in use');

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const data = mapEmployeeInput(input);

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const roleRow = await tx.role.findUniqueOrThrow({ where: { name: role } });
        const last = await tx.employee.findFirst({ orderBy: { employeeCode: 'desc' }, select: { employeeCode: true } });
        const n = (last ? parseInt(last.employeeCode.replace(/\D/g, ''), 10) || 0 : 0) + 1 + attempt;
        const user = await tx.user.create({ data: { email: input.email, passwordHash, roleId: roleRow.id, mustChangePassword } });
        const emp = await tx.employee.create({
          data: { ...(data as Prisma.EmployeeUncheckedCreateInput), employeeCode: `NX-${String(n).padStart(4, '0')}`, userId: user.id },
        });
        const types = await tx.leaveType.findMany();
        if (types.length) {
          await tx.leaveBalance.createMany({
            data: types.map((t) => ({ employeeId: emp.id, leaveTypeId: t.id, year: new Date().getFullYear(), allocated: t.defaultDays })),
          });
        }
        return emp;
      });
    } catch (e: any) {
      if (e.code === 'P2002' && String(e.meta?.target).includes('employeeCode') && attempt < 3) continue;
      throw e;
    }
  }
  throw new HttpError(500, 'Could not generate an employee ID');
}

export async function deactivateEmployee(employeeId: string, status: 'TERMINATED' | 'INACTIVE' = 'TERMINATED') {
  const emp = await prisma.employee.update({ where: { id: employeeId }, data: { employmentStatus: status } });
  if (emp.userId) {
    await prisma.user.update({ where: { id: emp.userId }, data: { isActive: false } });
    await prisma.session.updateMany({ where: { userId: emp.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  return emp;
}
