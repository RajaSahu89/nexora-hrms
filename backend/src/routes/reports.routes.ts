import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError, asyncHandler } from '../utils/http';
import { validate } from '../middleware/validate';
import { requireRole } from '../middleware/auth';
import { isHR, scopeWhere } from '../utils/scope';
import { dateOnly, iso } from '../utils/dates';
import { sendPdfTable, toCsv } from '../utils/csv';
import { audit } from '../utils/audit';

const r = Router();
const HR_ONLY = ['payroll', 'recruitment'];
const nm = (e: any) => (e ? `${e.firstName} ${e.lastName}` : '');

r.get('/:type', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'),
  validate(z.object({ format: z.enum(['json', 'csv', 'pdf']).default('json'), from: z.string().optional(), to: z.string().optional(), departmentId: z.string().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const type = req.params.type; const q: any = req.query;
    if (HR_ONLY.includes(type) && !isHR(req.auth!.role)) throw new AppError(403, 'HR access required for this report');
    const empWhere = { AND: [scopeWhere(req.auth!), ...(q.departmentId ? [{ departmentId: q.departmentId }] : [])] };
    const from = q.from ? dateOnly(q.from) : undefined, to = q.to ? dateOnly(q.to) : undefined;
    const range = (f: string) => (from || to ? { [f]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {});
    let rows: Record<string, any>[] = [];

    if (type === 'employees') {
      rows = (await prisma.employee.findMany({ where: { AND: [empWhere, range('joiningDate')] }, include: { department: true, designation: true, manager: true }, orderBy: { employeeCode: 'asc' } }))
        .map((e) => ({ 'Employee ID': e.employeeCode, Name: nm(e), Email: e.email, Department: e.department?.name, Designation: e.designation?.title, Manager: nm(e.manager), Joined: iso(e.joiningDate), Type: e.employmentType, Status: e.employmentStatus }));
    } else if (type === 'attendance') {
      rows = (await prisma.attendance.findMany({ where: { employee: empWhere, ...range('date') }, include: { employee: { include: { department: true } } }, orderBy: { date: 'desc' }, take: 5000 }))
        .map((a) => ({ Date: iso(a.date), Employee: nm(a.employee), Department: a.employee.department?.name, Status: a.status, 'Check in': a.checkIn?.toISOString().slice(11, 16), 'Check out': a.checkOut?.toISOString().slice(11, 16), 'Hours': Math.round(a.workedMinutes / 6) / 10, 'Overtime (h)': Math.round(a.overtimeMinutes / 6) / 10 }));
    } else if (type === 'leaves') {
      rows = (await prisma.leaveRequest.findMany({ where: { employee: empWhere, ...(from || to ? { startDate: { ...(to ? { lte: to } : {}) }, endDate: { ...(from ? { gte: from } : {}) } } : {}) }, include: { employee: { include: { department: true } }, leaveType: true }, orderBy: { startDate: 'desc' }, take: 5000 }))
        .map((l) => ({ Employee: nm(l.employee), Department: l.employee.department?.name, Type: l.leaveType.name, From: iso(l.startDate), To: iso(l.endDate), Days: Number(l.days), Status: l.status }));
    } else if (type === 'payroll') {
      const fy = from ? from.getUTCFullYear() * 12 + from.getUTCMonth() : -Infinity, ty = to ? to.getUTCFullYear() * 12 + to.getUTCMonth() : Infinity;
      rows = (await prisma.payroll.findMany({ where: { employee: empWhere }, include: { employee: { include: { department: true } } }, orderBy: [{ year: 'desc' }, { month: 'desc' }] }))
        .filter((p) => { const k = p.year * 12 + p.month - 1; return k >= fy && k <= ty; })
        .map((p) => ({ Period: `${p.year}-${String(p.month).padStart(2, '0')}`, Employee: nm(p.employee), Department: p.employee.department?.name, Basic: Number(p.basicSalary), Gross: Number(p.grossPay), Tax: Number(p.tax), Deductions: Number(p.deductions), Net: Number(p.netPay), Status: p.status }));
    } else if (type === 'departments') {
      const ds = await prisma.department.findMany({ where: q.departmentId ? { id: q.departmentId } : {}, include: { head: true, _count: { select: { employees: true } } } });
      rows = await Promise.all(ds.map(async (d) => {
        const avg = await prisma.performanceReview.aggregate({ where: { status: 'COMPLETED', employee: { departmentId: d.id } }, _avg: { rating: true } });
        return { Department: d.name, Head: nm(d.head), Employees: d._count.employees, Budget: isHR(req.auth!.role) ? Number(d.budget ?? 0) : '', 'Avg rating': avg._avg.rating ? Number(avg._avg.rating) : '' };
      }));
    } else if (type === 'recruitment') {
      rows = (await prisma.application.findMany({ where: { ...range('appliedAt'), ...(q.departmentId ? { vacancy: { departmentId: q.departmentId } } : {}) }, include: { candidate: true, vacancy: true }, orderBy: { appliedAt: 'desc' } }))
        .map((a) => ({ Vacancy: a.vacancy.title, Candidate: a.candidate.fullName, Email: a.candidate.email, Stage: a.stage, Applied: iso(a.appliedAt) }));
    } else if (type === 'performance') {
      rows = (await prisma.performanceReview.findMany({ where: { employee: empWhere, ...range('periodEnd') }, include: { employee: { include: { department: true } } }, orderBy: { periodEnd: 'desc' } }))
        .map((p) => ({ Employee: nm(p.employee), Department: p.employee.department?.name, 'Period start': iso(p.periodStart), 'Period end': iso(p.periodEnd), Status: p.status, Rating: p.rating ? Number(p.rating) : '' }));
    } else throw new AppError(404, 'Unknown report');

    audit(req, 'report.run', 'Report', type, { format: q.format, rows: rows.length });
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-report.csv"`);
      return res.send(toCsv(rows));
    }
    if (q.format === 'pdf') return sendPdfTable(res, `${type[0].toUpperCase() + type.slice(1)} Report`, rows);
    res.json({ rows });
  }));

export default r;
