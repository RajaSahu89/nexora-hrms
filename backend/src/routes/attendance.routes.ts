import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError, asyncHandler } from '../utils/http';
import { validate } from '../middleware/validate';
import { HR, requireRole } from '../middleware/auth';
import { scopeWhere } from '../utils/scope';
import { audit } from '../utils/audit';
import { dateOnly, iso, minutesBetween, monthRange, todayDate } from '../utils/dates';
import { getSetting } from '../utils/employees';
import { employeeUserId, notifyUsers } from '../utils/notify';
import { dateStr, optStr, pageQuery } from '../validators/common';

const r = Router();
const RULES = { workStart: '09:00', workEnd: '18:00', graceMinutes: 10, halfDayHours: 4, fullDayHours: 8 };

const needEmp = (req: any) => { if (!req.auth.employeeId) throw new AppError(400, 'No employee profile linked to this account'); return req.auth.employeeId as string; };
const atTime = (base: Date, hhmm: string, addMin = 0) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(base); d.setHours(h, m + addMin, 0, 0); return d; };

async function recompute(att: { id: string; checkIn: Date | null; checkOut: Date | null; status?: string }, rules: typeof RULES) {
  if (!att.checkIn || !att.checkOut) return {};
  const breaks = await prisma.attendanceBreak.findMany({ where: { attendanceId: att.id, endedAt: { not: null } } });
  const brk = breaks.reduce((s, b) => s + minutesBetween(b.startedAt, b.endedAt!), 0);
  const worked = Math.max(0, minutesBetween(att.checkIn, att.checkOut) - brk);
  const late = att.checkIn > atTime(att.checkIn, rules.workStart, rules.graceMinutes);
  return { workedMinutes: worked, overtimeMinutes: Math.max(0, worked - rules.fullDayHours * 60), isLate: late, isEarlyDeparture: att.checkOut < atTime(att.checkOut, rules.workEnd) };
}

r.get('/today', asyncHandler(async (req, res) => {
  const a = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: needEmp(req), date: todayDate() } }, include: { breaks: { orderBy: { startedAt: 'asc' } } } });
  res.json(a);
}));

r.post('/check-in', asyncHandler(async (req, res) => {
  const employeeId = needEmp(req);
  const rules = await getSetting('attendance.rules', RULES);
  const now = new Date();
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  if (emp.employmentStatus !== 'ACTIVE') throw new AppError(400, 'Only active employees can check in');
  const date = todayDate();
  if (await prisma.holiday.findUnique({ where: { date } })) throw new AppError(400, 'Today is a company holiday');
  const onLeave = await prisma.leaveRequest.findFirst({ where: { employeeId, status: 'APPROVED', startDate: { lte: date }, endDate: { gte: date } } });
  if (onLeave) throw new AppError(400, 'You are on approved leave today');
  const late = now > atTime(now, rules.workStart, rules.graceMinutes);
  try {
    const a = await prisma.attendance.create({ data: { employeeId, date, checkIn: now, status: late ? 'LATE' : 'PRESENT', isLate: late } });
    res.status(201).json(a);
  } catch (e: any) {
    if (e.code === 'P2002') throw new AppError(409, 'You have already checked in today');
    throw e;
  }
}));

r.post('/check-out', asyncHandler(async (req, res) => {
  const employeeId = needEmp(req);
  const rules = await getSetting('attendance.rules', RULES);
  const a = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date: todayDate() } } });
  if (!a?.checkIn) throw new AppError(400, 'Check in first');
  if (a.checkOut) throw new AppError(409, 'You have already checked out today');
  const now = new Date();
  await prisma.attendanceBreak.updateMany({ where: { attendanceId: a.id, endedAt: null }, data: { endedAt: now } });
  const calc: any = await recompute({ ...a, checkOut: now }, rules);
  const status = calc.workedMinutes < rules.halfDayHours * 60 ? 'HALF_DAY' : a.status;
  res.json(await prisma.attendance.update({ where: { id: a.id }, data: { checkOut: now, ...calc, status }, include: { breaks: true } }));
}));

r.post('/break/start', asyncHandler(async (req, res) => {
  const a = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: needEmp(req), date: todayDate() } }, include: { breaks: true } });
  if (!a?.checkIn || a.checkOut) throw new AppError(400, 'You are not checked in');
  if (a.breaks.some((b) => !b.endedAt)) throw new AppError(409, 'A break is already running');
  res.status(201).json(await prisma.attendanceBreak.create({ data: { attendanceId: a.id, startedAt: new Date() } }));
}));
r.post('/break/end', asyncHandler(async (req, res) => {
  const a = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: needEmp(req), date: todayDate() } }, include: { breaks: true } });
  const open = a?.breaks.find((b) => !b.endedAt);
  if (!a || !open) throw new AppError(400, 'No running break');
  res.json(await prisma.attendanceBreak.update({ where: { id: open.id }, data: { endedAt: new Date() } }));
}));

r.get('/', validate(pageQuery.extend({
  from: dateStr.optional(), to: dateStr.optional(), employeeId: z.string().optional(), departmentId: z.string().optional(),
  status: z.string().optional(), correction: z.string().optional(),
}), 'query'), asyncHandler(async (req, res) => {
  const q: any = req.query;
  const emp: Prisma.EmployeeWhereInput[] = [scopeWhere(req.auth!)];
  if (q.employeeId) emp.push({ id: q.employeeId });
  if (q.departmentId) emp.push({ departmentId: q.departmentId });
  const where: Prisma.AttendanceWhereInput = {
    employee: { AND: emp },
    ...(q.from || q.to ? { date: { ...(q.from ? { gte: dateOnly(q.from) } : {}), ...(q.to ? { lte: dateOnly(q.to) } : {}) } } : {}),
    ...(q.status ? { status: q.status } : {}), ...(q.correction ? { correctionStatus: q.correction } : {}),
  };
  const [total, data] = await Promise.all([
    prisma.attendance.count({ where }),
    prisma.attendance.findMany({ where, orderBy: [{ date: 'desc' }, { checkIn: 'desc' }], skip: (q.page - 1) * q.limit, take: q.limit,
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } } }),
  ]);
  res.json({ data, total, page: q.page, limit: q.limit });
}));

r.get('/calendar', validate(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), employeeId: z.string().optional() }), 'query'), asyncHandler(async (req, res) => {
  const q: any = req.query;
  const { start, end } = monthRange(q.month);
  const target = q.employeeId ?? req.auth!.employeeId;
  const allowed = await prisma.employee.findFirst({ where: { AND: [{ id: target ?? '__none__' }, scopeWhere(req.auth!)] }, select: { id: true } });
  if (!allowed) throw new AppError(403, 'Not allowed');
  const [records, holidays, leaves] = await Promise.all([
    prisma.attendance.findMany({ where: { employeeId: allowed.id, date: { gte: start, lte: end } }, select: { date: true, status: true, workedMinutes: true } }),
    prisma.holiday.findMany({ where: { date: { gte: start, lte: end } } }),
    prisma.leaveRequest.findMany({ where: { employeeId: allowed.id, status: 'APPROVED', startDate: { lte: end }, endDate: { gte: start } }, select: { startDate: true, endDate: true } }),
  ]);
  res.json({ records, holidays, leaves });
}));

r.get('/summary', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'), validate(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), departmentId: z.string().optional() }), 'query'), asyncHandler(async (req, res) => {
  const q: any = req.query;
  const { start, end } = monthRange(q.month);
  const emps = await prisma.employee.findMany({
    where: { AND: [scopeWhere(req.auth!), { employmentStatus: 'ACTIVE' }, ...(q.departmentId ? [{ departmentId: q.departmentId }] : [])] },
    select: { id: true, firstName: true, lastName: true, employeeCode: true, attendance: { where: { date: { gte: start, lte: end } } } },
  });
  res.json(emps.map((e) => {
    const c = (s: string) => e.attendance.filter((a) => a.status === s).length;
    return { id: e.id, name: `${e.firstName} ${e.lastName}`, code: e.employeeCode, present: c('PRESENT'), late: c('LATE'), halfDay: c('HALF_DAY'), absent: c('ABSENT'), onLeave: c('ON_LEAVE'),
      hours: Math.round(e.attendance.reduce((s, a) => s + a.workedMinutes, 0) / 6) / 10, overtimeHours: Math.round(e.attendance.reduce((s, a) => s + a.overtimeMinutes, 0) / 6) / 10 };
  }));
}));

// HR: manual record (e.g. mark absent) — duplicates blocked by unique(employeeId, date)
r.post('/manual', requireRole(...HR), validate(z.object({
  employeeId: z.string(), date: dateStr, status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY']),
  checkIn: optStr(30), checkOut: optStr(30), note: optStr(300),
})), asyncHandler(async (req, res) => {
  const b = req.body;
  const date = dateOnly(b.date);
  if (date > todayDate()) throw new AppError(400, 'Cannot create attendance for a future date');
  const ci = b.checkIn ? new Date(b.checkIn) : null, co = b.checkOut ? new Date(b.checkOut) : null;
  if (co && !ci) throw new AppError(400, 'Check-out needs a check-in');
  if (ci && co && co <= ci) throw new AppError(400, 'Check-out must be after check-in');
  const rules = await getSetting('attendance.rules', RULES);
  const created = await prisma.attendance.create({ data: { employeeId: b.employeeId, date, status: b.status, checkIn: ci, checkOut: co, note: b.note, correctionStatus: 'APPROVED', correctedById: req.auth!.userId } });
  const calc = await recompute(created, rules);
  const a = await prisma.attendance.update({ where: { id: created.id }, data: calc });
  audit(req, 'attendance.manual', 'Attendance', a.id);
  res.status(201).json(a);
}));

r.post('/:id/correction', validate(z.object({ reason: z.string().trim().min(5).max(300) })), asyncHandler(async (req, res) => {
  const a = await prisma.attendance.findUnique({ where: { id: req.params.id } });
  if (!a || a.employeeId !== req.auth!.employeeId) throw new AppError(404, 'Record not found');
  const u = await prisma.attendance.update({ where: { id: a.id }, data: { correctionStatus: 'PENDING', correctionReason: req.body.reason } });
  const hrs = await prisma.user.findMany({ where: { isActive: true, role: { name: { in: ['SUPER_ADMIN', 'HR_ADMIN'] } } }, select: { id: true } });
  await notifyUsers(hrs.map((h) => h.id), 'ATTENDANCE_ALERT', 'Attendance correction requested', `A correction was requested for ${iso(a.date)}.`, '/attendance');
  res.json(u);
}));

r.post('/:id/decide', requireRole(...HR), validate(z.object({
  approve: z.boolean(), checkIn: optStr(30), checkOut: optStr(30), status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY']).optional(), note: optStr(300),
})), asyncHandler(async (req, res) => {
  const a = await prisma.attendance.findUnique({ where: { id: req.params.id } });
  if (!a) throw new AppError(404, 'Record not found');
  const b = req.body;
  let data: any = { correctionStatus: b.approve ? 'APPROVED' : 'REJECTED', correctedById: req.auth!.userId };
  if (b.approve) {
    const ci = b.checkIn ? new Date(b.checkIn) : a.checkIn, co = b.checkOut ? new Date(b.checkOut) : a.checkOut;
    if (ci && co && co <= ci) throw new AppError(400, 'Check-out must be after check-in');
    const rules = await getSetting('attendance.rules', RULES);
    data = { ...data, checkIn: ci, checkOut: co, status: b.status ?? a.status, note: b.note ?? a.note, ...(await recompute({ id: a.id, checkIn: ci, checkOut: co }, rules)) };
  }
  const u = await prisma.attendance.update({ where: { id: a.id }, data });
  const uid = await employeeUserId(a.employeeId);
  if (uid) await notifyUsers([uid], 'ATTENDANCE_ALERT', `Attendance correction ${b.approve ? 'approved' : 'rejected'}`, `Your request for ${iso(a.date)} was ${b.approve ? 'approved' : 'rejected'}.`, '/attendance');
  audit(req, 'attendance.decide', 'Attendance', a.id, { approve: b.approve });
  res.json(u);
}));

export default r;
