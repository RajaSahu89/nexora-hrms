import { Router } from 'express';
import { prisma } from '../config/prisma';
import { asyncHandler } from '../utils/http';
import { requireRole } from '../middleware/auth';
import { isHR, scopeWhere } from '../utils/scope';
import { iso, lastMonths, monthKey, todayDate } from '../utils/dates';

const r = Router();
const annWhere = (a: any) => (isHR(a.role) ? {} : { OR: [{ departmentId: null }, { departmentId: a.departmentId ?? '__none__' }] });
const upcoming = (d: Date, from: Date, days: number) => {
  const next = new Date(Date.UTC(from.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (next < from) next.setUTCFullYear(next.getUTCFullYear() + 1);
  const diff = Math.round((next.getTime() - from.getTime()) / 864e5);
  return diff <= days ? { date: next, inDays: diff } : null;
};

r.get('/admin', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'), asyncHandler(async (req, res) => {
  const a = req.auth!;
  const where = scopeWhere(a);
  const today = todayDate();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const and = (x: any) => ({ AND: [where, x] });

  const [total, active, inactive, newCount, departments, onLeave, presentToday, pendingLeaves, emps, att, holidays, announcements, pending] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.count({ where: and({ employmentStatus: 'ACTIVE' }) }),
    prisma.employee.count({ where: and({ employmentStatus: { in: ['INACTIVE', 'TERMINATED', 'RESIGNED'] } }) }),
    prisma.employee.count({ where: and({ joiningDate: { gte: monthStart } }) }),
    prisma.department.count(),
    prisma.leaveRequest.count({ where: { status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today }, employee: where } }),
    prisma.attendance.count({ where: { date: today, status: { in: ['PRESENT', 'LATE', 'HALF_DAY'] }, employee: where } }),
    prisma.leaveRequest.count({ where: { status: 'PENDING', employee: where } }),
    prisma.employee.findMany({
      where, orderBy: { createdAt: 'desc' },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, photoUrl: true, joiningDate: true, dateOfBirth: true, gender: true, employmentStatus: true, createdAt: true, department: { select: { name: true } }, designation: { select: { title: true } } },
    }),
    prisma.attendance.findMany({ where: { employee: where, date: { gte: new Date(today.getTime() - 6 * 864e5), lte: today } }, select: { date: true, status: true } }),
    prisma.holiday.findMany({ where: { date: { gte: today } }, orderBy: { date: 'asc' }, take: 5 }),
    prisma.announcement.findMany({ where: annWhere(a), orderBy: { publishedAt: 'desc' }, take: 5, select: { id: true, title: true, type: true, publishedAt: true } }),
    prisma.leaveRequest.findMany({ where: { status: 'PENDING', employee: where }, orderBy: { createdAt: 'asc' }, take: 5, include: { employee: { select: { firstName: true, lastName: true } }, leaveType: { select: { name: true } } } }),
  ]);

  const months = lastMonths(12), last6 = months.slice(-6);
  const growth = months.map((m) => ({ month: m, employees: emps.filter((e) => monthKey(e.joiningDate) <= m).length }));
  const hiring = last6.map((m) => ({ month: m, hires: emps.filter((e) => monthKey(e.joiningDate) === m).length }));
  const count = (key: (e: any) => string) => Object.entries(emps.reduce((o: any, e) => { const k = key(e); o[k] = (o[k] ?? 0) + 1; return o; }, {})).map(([name, value]) => ({ name, value }));
  const attendanceOverview = Array.from({ length: 7 }, (_, i) => {
    const d = iso(new Date(today.getTime() - (6 - i) * 864e5));
    const day = att.filter((x) => iso(x.date) === d);
    const c = (s: string[]) => day.filter((x) => s.includes(x.status)).length;
    return { date: d.slice(5), present: c(['PRESENT', 'HALF_DAY']), late: c(['LATE']), absent: c(['ABSENT']), leave: c(['ON_LEAVE']) };
  });
  const gone = emps.filter((e) => ['TERMINATED', 'RESIGNED'].includes(e.employmentStatus)).length;

  let payroll: any[] = [], activities: any[] = [];
  if (isHR(a.role)) {
    const p = await prisma.payroll.findMany({ where: { OR: last6.map((m) => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5)) })) }, select: { year: true, month: true, netPay: true, status: true } });
    payroll = last6.map((m) => ({ month: m, total: Math.round(p.filter((x) => `${x.year}-${String(x.month).padStart(2, '0')}` === m).reduce((s, x) => s + Number(x.netPay), 0)) }));
    activities = (await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, action: true, entity: true, createdAt: true, user: { select: { email: true } } } }));
  }

  res.json({
    stats: { total, active, inactive, newThisMonth: newCount, departments, onLeave, presentToday, pendingLeaves },
    charts: { growth, hiring, departmentDistribution: count((e) => e.department?.name ?? 'Unassigned'), genderDistribution: count((e) => (e.gender ?? 'Unspecified').replace(/_/g, ' ')), attendanceOverview, payroll, turnoverRate: total ? Math.round((gone / total) * 1000) / 10 : 0 },
    widgets: {
      recentEmployees: emps.slice(0, 5),
      birthdays: emps.filter((e) => e.dateOfBirth).map((e) => ({ ...e, u: upcoming(e.dateOfBirth!, today, 30) })).filter((e) => e.u).sort((x, y) => x.u!.inDays - y.u!.inDays).slice(0, 5).map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, date: e.u!.date, inDays: e.u!.inDays })),
      anniversaries: emps.map((e) => ({ ...e, u: upcoming(e.joiningDate, today, 30) })).filter((e) => e.u && e.joiningDate.getUTCFullYear() < today.getUTCFullYear()).sort((x, y) => x.u!.inDays - y.u!.inDays).slice(0, 5).map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, date: e.u!.date, inDays: e.u!.inDays, years: today.getUTCFullYear() + (e.u!.date.getUTCFullYear() - today.getUTCFullYear()) - e.joiningDate.getUTCFullYear() })),
      activities, pendingApprovals: pending, holidays, announcements,
    },
  });
}));

r.get('/me', asyncHandler(async (req, res) => {
  const a = req.auth!;
  const me = a.employeeId ?? '__none__';
  const today = todayDate();
  const year = today.getUTCFullYear();
  const [attendance, balances, tasks, payslip, announcements, holidays, unread, pendingLeaves] = await Promise.all([
    prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: me, date: today } }, include: { breaks: true } }),
    prisma.leaveBalance.findMany({ where: { employeeId: me, year }, include: { leaveType: { select: { name: true, code: true } } } }),
    prisma.task.findMany({ where: { assigneeId: me, status: { not: 'COMPLETED' } }, orderBy: { dueDate: 'asc' }, take: 5, select: { id: true, title: true, status: true, priority: true, dueDate: true } }),
    prisma.payroll.findFirst({ where: { employeeId: me, status: { in: ['FINALIZED', 'PAID'] } }, orderBy: [{ year: 'desc' }, { month: 'desc' }], select: { id: true, month: true, year: true, netPay: true } }),
    prisma.announcement.findMany({ where: annWhere(a), orderBy: { publishedAt: 'desc' }, take: 4, select: { id: true, title: true, type: true, publishedAt: true } }),
    prisma.holiday.findMany({ where: { date: { gte: today } }, orderBy: { date: 'asc' }, take: 4 }),
    prisma.notification.count({ where: { userId: a.userId, isRead: false } }),
    prisma.leaveRequest.count({ where: { employeeId: me, status: 'PENDING' } }),
  ]);
  res.json({ attendance, balances, tasks, payslip, announcements, holidays, unread, pendingLeaves });
}));

export default r;
