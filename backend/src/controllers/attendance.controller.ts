import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { parseOrThrow } from '../middleware/validate';
import { correctSchema, correctionRequestSchema, manualAttendanceSchema, dateStr } from '../validators';
import { asyncHandler } from '../utils/asyncHandler';
import { audit } from '../utils/audit';
import { combine, dateOnly, hhmmToMinutes, iso, minutesBetween, monthRange, parseDate } from '../utils/dates';
import { badRequest, forbidden, HttpError, notFound } from '../utils/httpError';
import { hrUserIds, notify, userIdsOfEmployees } from '../utils/notify';
import { canAccessEmployee, employeeScope, isHR } from '../utils/scope';
import { getSetting } from '../utils/settings';

const needEmployee = (req: any) => {
  if (!req.user.employeeId) throw badRequest('Your account has no employee profile');
  return req.user.employeeId as string;
};

async function totals(attendanceId: string, checkIn: Date, checkOut: Date) {
  const rules = await getSetting('attendance.rules');
  const breaks = await prisma.attendanceBreak.findMany({ where: { attendanceId, endedAt: { not: null } } });
  const breakMin = breaks.reduce((s, b) => s + minutesBetween(b.startedAt, b.endedAt!), 0);
  const worked = Math.max(0, minutesBetween(checkIn, checkOut) - breakMin);
  const overtime = Math.max(0, worked - rules.fullDayHours * 60);
  const outMin = checkOut.getHours() * 60 + checkOut.getMinutes();
  return { workedMinutes: worked, overtimeMinutes: overtime, isEarlyDeparture: outMin < hhmmToMinutes(rules.workEnd) - 5, halfDay: worked < rules.halfDayHours * 60 };
}

export const checkIn = asyncHandler(async (req, res) => {
  const employeeId = needEmployee(req);
  const today = dateOnly();
  const onLeave = await prisma.leaveRequest.count({ where: { employeeId, status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today } } });
  if (onLeave) throw new HttpError(400, 'You are on approved leave today');
  const existing = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date: today } } });
  if (existing?.checkIn) throw new HttpError(409, 'You have already checked in today');
  const rules = await getSetting('attendance.rules');
  const now = new Date();
  const isLate = now.getHours() * 60 + now.getMinutes() > hhmmToMinutes(rules.workStart) + rules.graceMinutes;
  const data = { checkIn: now, isLate, status: isLate ? ('LATE' as const) : ('PRESENT' as const) };
  const rec = existing
    ? await prisma.attendance.update({ where: { id: existing.id }, data })
    : await prisma.attendance.create({ data: { employeeId, date: today, ...data } });
  audit(req, 'attendance.check_in', 'Attendance', rec.id);
  res.status(201).json({ data: rec });
});

export const checkOut = asyncHandler(async (req, res) => {
  const employeeId = needEmployee(req);
  const rec = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId, date: dateOnly() } }, include: { breaks: true },
  });
  if (!rec?.checkIn) throw new HttpError(400, 'You have not checked in today');
  if (rec.checkOut) throw new HttpError(409, 'You have already checked out today');
  if (rec.breaks.some((b) => !b.endedAt)) throw new HttpError(400, 'End your break before checking out');
  const out = new Date();
  const t = await totals(rec.id, rec.checkIn, out);
  const updated = await prisma.attendance.update({
    where: { id: rec.id },
    data: { checkOut: out, workedMinutes: t.workedMinutes, overtimeMinutes: t.overtimeMinutes, isEarlyDeparture: t.isEarlyDeparture, status: t.halfDay ? 'HALF_DAY' : rec.isLate ? 'LATE' : 'PRESENT' },
  });
  audit(req, 'attendance.check_out', 'Attendance', rec.id);
  res.json({ data: updated });
});

export const breakStart = asyncHandler(async (req, res) => {
  const employeeId = needEmployee(req);
  const rec = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date: dateOnly() } }, include: { breaks: true } });
  if (!rec?.checkIn || rec.checkOut) throw new HttpError(400, 'You must be checked in to start a break');
  if (rec.breaks.some((b) => !b.endedAt)) throw new HttpError(409, 'A break is already running');
  res.status(201).json({ data: await prisma.attendanceBreak.create({ data: { attendanceId: rec.id, startedAt: new Date() } }) });
});

export const breakEnd = asyncHandler(async (req, res) => {
  const employeeId = needEmployee(req);
  const rec = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date: dateOnly() } }, include: { breaks: true } });
  const open = rec?.breaks.find((b) => !b.endedAt);
  if (!open) throw new HttpError(400, 'No break is running');
  res.json({ data: await prisma.attendanceBreak.update({ where: { id: open.id }, data: { endedAt: new Date() } }) });
});

export const today = asyncHandler(async (req, res) => {
  const employeeId = needEmployee(req);
  const rec = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date: dateOnly() } }, include: { breaks: { orderBy: { startedAt: 'asc' } } } });
  res.json({ data: rec });
});

export const list = asyncHandler(async (req, res) => {
  const u = req.user!;
  const q = req.query as Record<string, string>;
  const and: Prisma.AttendanceWhereInput[] = [{ employee: employeeScope(u) }];
  if (q.employeeId) {
    if (!(await canAccessEmployee(u, q.employeeId))) throw forbidden();
    and.push({ employeeId: q.employeeId });
  } else if (q.mine === '1' || (!isHR(u) && u.role === 'EMPLOYEE')) {
    and.push({ employeeId: needEmployee(req) });
  }
  if (q.date) { parseOrThrow(dateStr, q.date); and.push({ date: parseDate(q.date) }); }
  else {
    const m = Number(q.month) || new Date().getMonth() + 1, y = Number(q.year) || new Date().getFullYear();
    const { start, end } = monthRange(m, y);
    and.push({ date: { gte: start, lte: end } });
  }
  if (q.status) and.push({ status: q.status as any });
  if (q.correction) and.push({ correctionStatus: q.correction as any });
  const rows = await prisma.attendance.findMany({
    where: { AND: and }, orderBy: [{ date: 'desc' }, { checkIn: 'asc' }], take: 2000,
    include: { breaks: true, employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } } } } },
  });
  const summary = rows.reduce((s: any, r) => {
    s[r.status] = (s[r.status] ?? 0) + 1; s.workedMinutes += r.workedMinutes; s.overtimeMinutes += r.overtimeMinutes; return s;
  }, { workedMinutes: 0, overtimeMinutes: 0 });
  res.json({ data: rows, summary });
});

export const requestCorrection = asyncHandler(async (req, res) => {
  const employeeId = needEmployee(req);
  const { date, reason } = parseOrThrow(correctionRequestSchema, req.body);
  const d = parseDate(date);
  if (d > dateOnly()) throw badRequest('You cannot request a correction for a future date');
  const rec = await prisma.attendance.upsert({
    where: { employeeId_date: { employeeId, date: d } },
    update: { correctionStatus: 'PENDING', correctionReason: reason },
    create: { employeeId, date: d, status: 'ABSENT', correctionStatus: 'PENDING', correctionReason: reason },
  });
  await notify(await hrUserIds(), { type: 'ATTENDANCE_ALERT', title: 'Attendance correction requested', message: `A correction was requested for ${date}.`, link: '/attendance' });
  audit(req, 'attendance.correction_request', 'Attendance', rec.id);
  res.status(201).json({ data: rec });
});

async function applyCorrection(req: any, id: string, b: ReturnType<typeof correctSchema.parse>, date?: string) {
  const rec = await prisma.attendance.findUnique({ where: { id } });
  if (!rec) throw notFound('Attendance record not found');
  const day = date ?? iso(rec.date);
  const data: Prisma.AttendanceUncheckedUpdateInput = { correctedById: req.user.employeeId, note: b.note ?? rec.note };
  if (!b.approve) {
    data.correctionStatus = 'REJECTED';
  } else {
    data.correctionStatus = 'APPROVED';
    const cin = b.checkInTime === undefined ? rec.checkIn : b.checkInTime ? combine(day, b.checkInTime) : null;
    const cout = b.checkOutTime === undefined ? rec.checkOut : b.checkOutTime ? combine(day, b.checkOutTime) : null;
    if (cin && cout && cout <= cin) throw badRequest('Check-out must be after check-in');
    data.checkIn = cin; data.checkOut = cout;
    if (cin && cout) {
      const t = await totals(id, cin, cout);
      data.workedMinutes = t.workedMinutes; data.overtimeMinutes = t.overtimeMinutes; data.isEarlyDeparture = t.isEarlyDeparture;
    }
    data.status = b.status ?? (cin ? (rec.isLate ? 'LATE' : 'PRESENT') : rec.status);
  }
  const updated = await prisma.attendance.update({ where: { id }, data });
  const uids = await userIdsOfEmployees([rec.employeeId]);
  await notify(uids, { type: 'ATTENDANCE_ALERT', title: `Attendance correction ${b.approve ? 'approved' : 'rejected'}`, message: `Your attendance for ${day} was ${b.approve ? 'corrected' : 'not changed'}.`, link: '/attendance' });
  audit(req, 'attendance.correct', 'Attendance', id, { approve: b.approve });
  return updated;
}

export const correct = asyncHandler(async (req, res) => {
  res.json({ data: await applyCorrection(req, req.params.id, parseOrThrow(correctSchema, req.body)) });
});

export const manual = asyncHandler(async (req, res) => {
  const b = parseOrThrow(manualAttendanceSchema, req.body);
  const rec = await prisma.attendance.upsert({
    where: { employeeId_date: { employeeId: b.employeeId, date: parseDate(b.date) } },
    update: {}, create: { employeeId: b.employeeId, date: parseDate(b.date), status: b.status ?? 'PRESENT' },
  });
  res.status(201).json({ data: await applyCorrection(req, rec.id, { ...b, approve: true }, b.date) });
});

export const markAbsent = asyncHandler(async (req, res) => {
  const date = parseOrThrow(dateStr, req.body.date);
  const d = parseDate(date);
  if (d > dateOnly()) throw badRequest('Cannot mark absences for a future date');
  if ([0, 6].includes(d.getUTCDay())) throw badRequest('That date is a weekend');
  if (await prisma.holiday.findUnique({ where: { date: d } })) throw badRequest('That date is a holiday');
  const active = await prisma.employee.findMany({
    where: { employmentStatus: 'ACTIVE', joiningDate: { lte: d }, attendance: { none: { date: d } }, leaveRequests: { none: { status: 'APPROVED', startDate: { lte: d }, endDate: { gte: d } } } },
    select: { id: true },
  });
  const r = await prisma.attendance.createMany({ data: active.map((e) => ({ employeeId: e.id, date: d, status: 'ABSENT' as const })), skipDuplicates: true });
  audit(req, 'attendance.mark_absent', 'Attendance', null, { date, count: r.count });
  res.json({ data: { marked: r.count } });
});
