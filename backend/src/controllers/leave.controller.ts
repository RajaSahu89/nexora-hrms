import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { parseOrThrow } from '../middleware/validate';
import { leaveApplySchema, leaveDecisionSchema, leaveTypeSchema } from '../validators';
import { ensureBalances } from '../services/employeeService';
import { asyncHandler } from '../utils/asyncHandler';
import { audit } from '../utils/audit';
import { countWorkingDays, dateOnly, iso, parseDate } from '../utils/dates';
import { badRequest, forbidden, HttpError, notFound } from '../utils/httpError';
import { hrUserIds, notify, userIdsOfEmployees } from '../utils/notify';
import { canAccessEmployee, employeeScope, isHR } from '../utils/scope';

const include = {
  leaveType: { select: { id: true, name: true, code: true, isPaid: true } },
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } } } },
  approver: { select: { firstName: true, lastName: true } },
} satisfies Prisma.LeaveRequestInclude;

export const list = asyncHandler(async (req, res) => {
  const u = req.user!;
  const q = req.query as Record<string, string>;
  const and: Prisma.LeaveRequestWhereInput[] = [];
  if (q.scope === 'mine' || u.role === 'EMPLOYEE') and.push({ employeeId: u.employeeId ?? '__none__' });
  else and.push({ employee: employeeScope(u) });
  if (q.status) and.push({ status: q.status as any });
  if (q.from) and.push({ endDate: { gte: parseDate(q.from) } });
  if (q.to) and.push({ startDate: { lte: parseDate(q.to) } });
  res.json({ data: await prisma.leaveRequest.findMany({ where: { AND: and }, include, orderBy: { createdAt: 'desc' }, take: 500 }) });
});

export const balance = asyncHandler(async (req, res) => {
  const u = req.user!;
  const employeeId = (req.query.employeeId as string) || u.employeeId;
  if (!employeeId) throw badRequest('No employee profile');
  if (!(await canAccessEmployee(u, employeeId))) throw forbidden();
  const year = Number(req.query.year) || new Date().getFullYear();
  await ensureBalances(employeeId, year);
  const rows = await prisma.leaveBalance.findMany({ where: { employeeId, year }, include: { leaveType: true }, orderBy: { leaveType: { name: 'asc' } } });
  res.json({ data: rows.map((r) => ({ id: r.id, leaveType: r.leaveType, year, allocated: Number(r.allocated), used: Number(r.used), remaining: Number(r.allocated) - Number(r.used) })) });
});

export const apply = asyncHandler(async (req, res) => {
  const u = req.user!;
  if (!u.employeeId) throw badRequest('No employee profile');
  const b = parseOrThrow(leaveApplySchema, req.body);
  const start = parseDate(b.startDate), end = parseDate(b.endDate);
  if (end < start) throw badRequest('End date cannot be before start date');
  if (start.getUTCFullYear() !== end.getUTCFullYear()) throw badRequest('Please split leave that spans two calendar years');
  if (end < dateOnly()) throw badRequest('You cannot apply for leave in the past');
  const type = await prisma.leaveType.findUnique({ where: { id: b.leaveTypeId } });
  if (!type) throw badRequest('Unknown leave type');
  const holidays = new Set((await prisma.holiday.findMany({ where: { date: { gte: start, lte: end } } })).map((h) => iso(h.date)));
  const days = countWorkingDays(start, end, holidays);
  if (days === 0) throw badRequest('The selected dates contain no working days');
  const overlap = await prisma.leaveRequest.count({ where: { employeeId: u.employeeId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: end }, endDate: { gte: start } } });
  if (overlap) throw new HttpError(409, 'You already have a leave request overlapping these dates');
  if (type.isPaid) {
    const year = start.getUTCFullYear();
    await ensureBalances(u.employeeId, year);
    const bal = await prisma.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId: u.employeeId, leaveTypeId: type.id, year } } });
    const pending = await prisma.leaveRequest.aggregate({ where: { employeeId: u.employeeId, leaveTypeId: type.id, status: 'PENDING', startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } }, _sum: { days: true } });
    const remaining = Number(bal?.allocated ?? 0) - Number(bal?.used ?? 0) - Number(pending._sum.days ?? 0);
    if (days > remaining) throw badRequest(`Insufficient ${type.name} balance (${remaining} day(s) available)`);
  }
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: u.employeeId }, select: { firstName: true, lastName: true, managerId: true, departmentId: true } });
  const leave = await prisma.leaveRequest.create({
    data: { employeeId: u.employeeId, leaveTypeId: type.id, startDate: start, endDate: end, days, reason: b.reason, approverId: emp.managerId },
    include,
  });
  const managerUsers = emp.managerId ? await userIdsOfEmployees([emp.managerId]) : [];
  await notify([...managerUsers, ...(await hrUserIds())].filter((id) => id !== u.id), {
    type: 'LEAVE_REQUESTED', title: 'New leave request', message: `${emp.firstName} ${emp.lastName} requested ${days} day(s) of ${type.name}.`, link: '/leaves',
  });
  audit(req, 'leave.apply', 'LeaveRequest', leave.id);
  res.status(201).json({ data: leave });
});

export const decide = asyncHandler(async (req, res) => {
  const u = req.user!;
  const { status, note } = parseOrThrow(leaveDecisionSchema, req.body);
  const leave = await prisma.leaveRequest.findUnique({ where: { id: req.params.id }, include: { leaveType: true } });
  if (!leave) throw notFound('Leave request not found');
  if (leave.employeeId === u.employeeId) throw forbidden('You cannot decide your own leave request');
  if (!isHR(u) && !(u.role === 'MANAGER' && (await canAccessEmployee(u, leave.employeeId)))) throw forbidden('Only HR or the employee\'s manager can decide this request');
  if (leave.status !== 'PENDING') throw new HttpError(409, `This request is already ${leave.status.toLowerCase()}`);
  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({ where: { id: leave.id }, data: { status, decisionNote: note ?? null, decidedAt: new Date(), approverId: u.employeeId } });
    if (status === 'APPROVED' && leave.leaveType.isPaid) {
      const year = leave.startDate.getUTCFullYear();
      await tx.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId: leave.employeeId, leaveTypeId: leave.leaveTypeId, year } },
        update: { used: { increment: leave.days } },
        create: { employeeId: leave.employeeId, leaveTypeId: leave.leaveTypeId, year, allocated: leave.leaveType.defaultDays, used: leave.days },
      });
    }
  });
  await notify(await userIdsOfEmployees([leave.employeeId]), {
    type: status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED', title: `Leave ${status.toLowerCase()}`,
    message: `Your ${leave.leaveType.name} request (${iso(leave.startDate)} to ${iso(leave.endDate)}) was ${status.toLowerCase()}.${note ? ` Note: ${note}` : ''}`, link: '/leaves',
  });
  audit(req, `leave.${status.toLowerCase()}`, 'LeaveRequest', leave.id);
  res.json({ data: { message: `Leave ${status.toLowerCase()}` } });
});

export const cancel = asyncHandler(async (req, res) => {
  const u = req.user!;
  const leave = await prisma.leaveRequest.findUnique({ where: { id: req.params.id }, include: { leaveType: true } });
  if (!leave) throw notFound('Leave request not found');
  if (leave.employeeId !== u.employeeId) throw forbidden('You can only cancel your own requests');
  if (!['PENDING', 'APPROVED'].includes(leave.status)) throw new HttpError(409, 'This request cannot be cancelled');
  if (leave.status === 'APPROVED' && leave.startDate <= dateOnly()) throw badRequest('Leave that has already started cannot be cancelled');
  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({ where: { id: leave.id }, data: { status: 'CANCELLED', decidedAt: new Date() } });
    if (leave.status === 'APPROVED' && leave.leaveType.isPaid) {
      await tx.leaveBalance.updateMany({
        where: { employeeId: leave.employeeId, leaveTypeId: leave.leaveTypeId, year: leave.startDate.getUTCFullYear() },
        data: { used: { decrement: leave.days } },
      });
    }
  });
  audit(req, 'leave.cancel', 'LeaveRequest', leave.id);
  res.json({ data: { message: 'Leave cancelled' } });
});
export const listTypes = asyncHandler(async (_req, res) => {
  res.json({ data: await prisma.leaveType.findMany({ orderBy: { name: 'asc' } }) });
});
export const createType = asyncHandler(async (req, res) => {
  const t = await prisma.leaveType.create({ data: parseOrThrow(leaveTypeSchema, req.body) });
  const emps = await prisma.employee.findMany({ select: { id: true } });
  await prisma.leaveBalance.createMany({ data: emps.map((e) => ({ employeeId: e.id, leaveTypeId: t.id, year: new Date().getFullYear(), allocated: t.defaultDays })), skipDuplicates: true });
  audit(req, 'leave_type.create', 'LeaveType', t.id);
  res.status(201).json({ data: t });
});
export const updateType = asyncHandler(async (req, res) => {
  const b = parseOrThrow(leaveTypeSchema, req.body);
  const t = await prisma.leaveType.update({ where: { id: req.params.id }, data: b });
  audit(req, 'leave_type.update', 'LeaveType', t.id);
  res.json({ data: t });
});
export const deleteType = asyncHandler(async (req, res) => {
  if (await prisma.leaveRequest.count({ where: { leaveTypeId: req.params.id } })) throw new HttpError(409, 'This leave type has requests and cannot be deleted');
  await prisma.leaveType.delete({ where: { id: req.params.id } });
  audit(req, 'leave_type.delete', 'LeaveType', req.params.id);
  res.json({ data: { message: 'Leave type deleted' } });
});
