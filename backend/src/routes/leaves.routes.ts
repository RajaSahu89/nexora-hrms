import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError, asyncHandler } from '../utils/http';
import { validate } from '../middleware/validate';
import { isHR, scopeWhere } from '../utils/scope';
import { audit } from '../utils/audit';
import { countWorkingDays, dateOnly, iso, monthRange, todayDate } from '../utils/dates';
import { employeeUserId, hrUserIds, notifyUsers } from '../utils/notify';
import { dateStr, optStr, pageQuery } from '../validators/common';
import { ensureLeaveBalances } from '../utils/employees';

const r = Router();
const inc = {
  employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
  leaveType: { select: { id: true, name: true, code: true } },
  approver: { select: { firstName: true, lastName: true } },
} as const;

r.get('/balances', asyncHandler(async (req, res) => {
  const q: any = req.query;
  const target = q.employeeId ?? req.auth!.employeeId;
  const ok = await prisma.employee.findFirst({ where: { AND: [{ id: target ?? '__none__' }, scopeWhere(req.auth!)] }, select: { id: true } });
  if (!ok) throw new AppError(403, 'Not allowed');
  const year = Number(q.year) || new Date().getFullYear();
  await ensureLeaveBalances(ok.id, year);
  res.json(await prisma.leaveBalance.findMany({ where: { employeeId: ok.id, year }, include: { leaveType: true }, orderBy: { leaveType: { name: 'asc' } } }));
}));

r.get('/', validate(pageQuery.extend({ status: z.string().optional(), employeeId: z.string().optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional() }), 'query'), asyncHandler(async (req, res) => {
  const q: any = req.query;
  const emp: Prisma.EmployeeWhereInput[] = [scopeWhere(req.auth!)];
  if (q.employeeId) emp.push({ id: q.employeeId });
  let where: Prisma.LeaveRequestWhereInput = { employee: { AND: emp }, ...(q.status ? { status: q.status } : {}) };
  if (q.month) { const { start, end } = monthRange(q.month); where = { ...where, startDate: { lte: end }, endDate: { gte: start } }; }
  const [total, data] = await Promise.all([
    prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.findMany({ where, include: inc, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
  ]);
  res.json({ data, total, page: q.page, limit: q.limit });
}));

r.post('/', validate(z.object({ leaveTypeId: z.string(), startDate: dateStr, endDate: dateStr, reason: z.string().trim().min(3).max(500) })), asyncHandler(async (req, res) => {
  const employeeId = req.auth!.employeeId;
  if (!employeeId) throw new AppError(400, 'No employee profile linked');
  const { leaveTypeId, reason } = req.body;
  const s = dateOnly(req.body.startDate), e = dateOnly(req.body.endDate);
  if (e < s) throw new AppError(400, 'End date cannot be before start date');
  if (s.getUTCFullYear() !== e.getUTCFullYear()) throw new AppError(400, 'Please split requests that cross a year boundary');
  const type = await prisma.leaveType.findUniqueOrThrow({ where: { id: leaveTypeId } });
  const holidays = new Set((await prisma.holiday.findMany({ where: { date: { gte: s, lte: e } } })).map((h) => iso(h.date)));
  const days = countWorkingDays(s, e, holidays);
  if (days <= 0) throw new AppError(400, 'Selected dates contain no working days');
  const clash = await prisma.leaveRequest.findFirst({ where: { employeeId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: e }, endDate: { gte: s } } });
  if (clash) throw new AppError(409, 'You already have a leave request overlapping these dates');
  if (type.isPaid || Number(type.defaultDays) > 0) {
    const year = s.getUTCFullYear();
    await ensureLeaveBalances(employeeId, year);
    const bal = await prisma.leaveBalance.findUniqueOrThrow({ where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } } });
    const remaining = Number(bal.allocated) - Number(bal.used);
    const pending = await prisma.leaveRequest.aggregate({ where: { employeeId, leaveTypeId, status: 'PENDING', startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } }, _sum: { days: true } });
    if (days > remaining - Number(pending._sum.days ?? 0)) throw new AppError(400, `Not enough ${type.name} balance (${remaining} day(s) left)`);
  }
  const lr = await prisma.leaveRequest.create({ data: { employeeId, leaveTypeId, startDate: s, endDate: e, days, reason }, include: inc });
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, include: { manager: { select: { userId: true } }, department: { select: { head: { select: { userId: true } } } } } });
  const targets = [emp.manager?.userId, emp.department?.head?.userId, ...(await hrUserIds())].filter((x): x is string => !!x && x !== req.auth!.userId);
  await notifyUsers(targets, 'LEAVE_REQUESTED', 'New leave request', `${emp.firstName} ${emp.lastName} requested ${days} day(s) of ${type.name}.`, '/leaves');
  audit(req, 'leave.apply', 'LeaveRequest', lr.id);
  res.status(201).json(lr);
}));

const decide = (approve: boolean) => asyncHandler(async (req, res) => {
  const lr = await prisma.leaveRequest.findUnique({ where: { id: req.params.id }, include: { leaveType: true } });
  if (!lr) throw new AppError(404, 'Request not found');
  if (lr.status !== 'PENDING') throw new AppError(409, `Request is already ${lr.status.toLowerCase()}`);
  if (lr.employeeId === req.auth!.employeeId) throw new AppError(403, 'You cannot decide your own leave request');
  if (req.auth!.role === 'EMPLOYEE') throw new AppError(403, 'Forbidden');
  if (!isHR(req.auth!.role)) {
    const inScope = await prisma.employee.findFirst({ where: { AND: [{ id: lr.employeeId }, scopeWhere(req.auth!)] } });
    if (!inScope) throw new AppError(403, 'This employee is not assigned to you');
  }
  const note = optStr(300).parse(req.body?.note) ?? null;
  const year = lr.startDate.getUTCFullYear();
  await prisma.$transaction([
    prisma.leaveRequest.update({ where: { id: lr.id }, data: { status: approve ? 'APPROVED' : 'REJECTED', approverId: req.auth!.employeeId ?? null, decidedAt: new Date(), decisionNote: note } }),
    ...(approve ? [prisma.leaveBalance.updateMany({ where: { employeeId: lr.employeeId, leaveTypeId: lr.leaveTypeId, year }, data: { used: { increment: lr.days } } })] : []),
  ]);
  const uid = await employeeUserId(lr.employeeId);
  if (uid) await notifyUsers([uid], approve ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED', `Leave ${approve ? 'approved' : 'rejected'}`, `Your ${lr.leaveType.name} (${iso(lr.startDate)} to ${iso(lr.endDate)}) was ${approve ? 'approved' : 'rejected'}.${note ? ' Note: ' + note : ''}`, '/leaves');
  audit(req, approve ? 'leave.approve' : 'leave.reject', 'LeaveRequest', lr.id);
  res.json({ ok: true });
});
r.post('/:id/approve', decide(true));
r.post('/:id/reject', decide(false));

r.post('/:id/cancel', asyncHandler(async (req, res) => {
  const lr = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
  if (!lr || lr.employeeId !== req.auth!.employeeId) throw new AppError(404, 'Request not found');
  if (!['PENDING', 'APPROVED'].includes(lr.status)) throw new AppError(409, 'This request cannot be cancelled');
  if (lr.status === 'APPROVED' && lr.startDate <= todayDate()) throw new AppError(400, 'Leave that has started cannot be cancelled');
  await prisma.$transaction([
    prisma.leaveRequest.update({ where: { id: lr.id }, data: { status: 'CANCELLED' } }),
    ...(lr.status === 'APPROVED' ? [prisma.leaveBalance.updateMany({ where: { employeeId: lr.employeeId, leaveTypeId: lr.leaveTypeId, year: lr.startDate.getUTCFullYear() }, data: { used: { decrement: lr.days } } })] : []),
  ]);
  audit(req, 'leave.cancel', 'LeaveRequest', lr.id);
  res.json({ ok: true });
}));

export default r;
