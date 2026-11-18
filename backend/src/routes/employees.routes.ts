import { Router } from 'express';
import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { AppError, asyncHandler } from '../utils/http';
import { validate } from '../middleware/validate';
import { HR, requireRole } from '../middleware/auth';
import { isHR, scopeWhere } from '../utils/scope';
import { audit } from '../utils/audit';
import { ensureLeaveBalances, nextEmployeeCode } from '../utils/employees';
import { IMAGE_MIMES, makeUpload, verifyUpload } from '../utils/upload';
import { optStr, pageQuery, pwd } from '../validators/common';
import { toCsv } from '../utils/csv';

const r = Router();
const GENDER = z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']);
const ETYPE = z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']);
const ESTATUS = z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED', 'RESIGNED']);

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60),
  email: z.string().email().toLowerCase(),
  phone: optStr(20), dateOfBirth: optStr(10), gender: z.preprocess((v) => (v === '' ? null : v), GENDER.nullable().optional()),
  address: optStr(300), emergencyContactName: optStr(80), emergencyContactPhone: optStr(20), emergencyContactRel: optStr(40),
  departmentId: optStr(40), designationId: optStr(40), managerId: optStr(40),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Joining date required'),
  employmentType: ETYPE.default('FULL_TIME'), employmentStatus: ESTATUS.default('ACTIVE'), workLocation: optStr(80),
  education: optStr(2000), experience: optStr(2000),
  skills: z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(z.string().max(40)).max(30).default([])),
  bankDetails: z.object({ bankName: z.string().max(80).optional(), accountNumber: z.string().max(34).optional(), ifsc: z.string().max(20).optional() }).nullable().optional(),
  password: z.preprocess((v) => (v === '' ? undefined : v), pwd.optional()),
  role: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['HR_ADMIN', 'MANAGER', 'EMPLOYEE']).optional()),
});

const SELF_FIELDS = ['phone', 'address', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRel', 'skills', 'education', 'experience'];
const json = (v: any) => (v === null ? Prisma.DbNull : v === undefined ? undefined : v);

const toData = (b: any) => {
  const { password, role, bankDetails, education, experience, joiningDate, dateOfBirth, ...rest } = b;
  return {
    ...rest,
    ...(joiningDate ? { joiningDate: new Date(joiningDate.slice(0, 10)) } : {}),
    ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth.slice(0, 10)) : null } : {}),
    ...(education !== undefined ? { education: json(education) } : {}),
    ...(experience !== undefined ? { experience: json(experience) } : {}),
    ...(bankDetails !== undefined ? { bankDetails: json(bankDetails) } : {}),
  };
};
const inc = {
  department: { select: { id: true, name: true } }, designation: { select: { id: true, title: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
} as const;
const shape = (e: any, auth: any) => {
  if (!isHR(auth.role) && e.id !== auth.employeeId) { const { bankDetails, ...rest } = e; return rest; }
  return e;
};

r.get('/', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'),
  validate(pageQuery.extend({
    search: z.string().max(80).optional(), departmentId: z.string().optional(), status: z.string().optional(), employmentType: z.string().optional(),
    sort: z.enum(['createdAt', 'firstName', 'lastName', 'employeeCode', 'joiningDate']).default('createdAt'), order: z.enum(['asc', 'desc']).default('desc'),
  }), 'query'),
  asyncHandler(async (req, res) => {
    const q: any = req.query;
    const and: Prisma.EmployeeWhereInput[] = [scopeWhere(req.auth!)];
    if (q.search) and.push({ OR: ['firstName', 'lastName', 'email', 'employeeCode'].map((f) => ({ [f]: { contains: q.search, mode: 'insensitive' } })) as any });
    if (q.departmentId) and.push({ departmentId: q.departmentId });
    if (q.status) and.push({ employmentStatus: q.status });
    if (q.employmentType) and.push({ employmentType: q.employmentType });
    const where = { AND: and };
    const [total, rows] = await Promise.all([
      prisma.employee.count({ where }),
      prisma.employee.findMany({ where, include: inc, orderBy: { [q.sort]: q.order }, skip: (q.page - 1) * q.limit, take: q.limit }),
    ]);
    res.json({ data: rows.map((e) => shape(e, req.auth)), total, page: q.page, limit: q.limit });
  }));

r.get('/export.csv', requireRole(...HR), asyncHandler(async (req, res) => {
  const rows = await prisma.employee.findMany({ include: inc, orderBy: { employeeCode: 'asc' } });
  const csv = toCsv(rows.map((e) => ({
    EmployeeID: e.employeeCode, FirstName: e.firstName, LastName: e.lastName, Email: e.email, Phone: e.phone, Department: e.department?.name,
    Designation: e.designation?.title, JoiningDate: e.joiningDate.toISOString().slice(0, 10), Type: e.employmentType, Status: e.employmentStatus, Location: e.workLocation,
  })));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
  res.send(csv);
}));

r.post('/import', requireRole(...HR), validate(z.object({ rows: z.array(z.record(z.any())).min(1).max(500) })),
  asyncHandler(async (req, res) => {
    const depts = await prisma.department.findMany();
    const desigs = await prisma.designation.findMany();
    let created = 0;
    const errors: { row: number; error: string }[] = [];
    for (const [i, raw] of (req.body.rows as any[]).entries()) {
      try {
        const p = profileSchema.parse({
          firstName: raw.firstName ?? raw.FirstName, lastName: raw.lastName ?? raw.LastName, email: raw.email ?? raw.Email,
          phone: raw.phone ?? raw.Phone, joiningDate: raw.joiningDate ?? raw.JoiningDate,
          employmentType: raw.employmentType || raw.Type || undefined, workLocation: raw.workLocation ?? raw.Location,
        });
        const dept = depts.find((d) => d.name.toLowerCase() === String(raw.department ?? raw.Department ?? '').toLowerCase());
        const des = desigs.find((d) => d.title.toLowerCase() === String(raw.designation ?? raw.Designation ?? '').toLowerCase());
        const emp = await prisma.employee.create({ data: { ...toData(p), employeeCode: await nextEmployeeCode(), departmentId: dept?.id, designationId: des?.id } as any });
        await ensureLeaveBalances(emp.id);
        created++;
      } catch (e: any) {
        errors.push({ row: i + 1, error: e.code === 'P2002' ? 'Duplicate email' : e.issues?.[0]?.message ?? e.message });
      }
    }
    audit(req, 'employee.import', 'Employee', undefined, { created, failed: errors.length });
    res.json({ created, errors });
  }));

r.post('/bulk', requireRole(...HR), validate(z.object({ ids: z.array(z.string()).min(1).max(200), action: z.enum(['activate', 'deactivate', 'delete']) })),
  asyncHandler(async (req, res) => {
    const { ids, action } = req.body;
    if (ids.includes(req.auth!.employeeId)) throw new AppError(400, 'You cannot run bulk actions on your own account');
    if (action === 'delete') {
      let deleted = 0;
      for (const id of ids) {
        try {
          const e = await prisma.employee.findUnique({ where: { id } });
          if (!e) continue;
          await prisma.$transaction([prisma.employee.delete({ where: { id } }), ...(e.userId ? [prisma.user.delete({ where: { id: e.userId } })] : [])]);
          deleted++;
        } catch { /* linked records: skipped */ }
      }
      audit(req, 'employee.bulk_delete', 'Employee', undefined, { deleted, requested: ids.length });
      return res.json({ affected: deleted, skipped: ids.length - deleted });
    }
    const status = action === 'activate' ? 'ACTIVE' : 'INACTIVE';
    const r1 = await prisma.employee.updateMany({ where: { id: { in: ids } }, data: { employmentStatus: status } });
    await prisma.user.updateMany({ where: { employee: { id: { in: ids } } }, data: { isActive: action === 'activate' } });
    audit(req, `employee.bulk_${action}`, 'Employee', undefined, { count: r1.count });
    res.json({ affected: r1.count, skipped: 0 });
  }));

r.get('/:id', asyncHandler(async (req, res) => {
  const e = await prisma.employee.findFirst({
    where: { AND: [{ id: req.params.id }, scopeWhere(req.auth!)] },
    include: { ...inc, user: { select: { email: true, isActive: true, lastLoginAt: true, role: { select: { name: true } } } }, reports: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!e) throw new AppError(404, 'Employee not found');
  res.json(shape(e, req.auth));
}));

r.post('/', requireRole(...HR), validate(profileSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.role === 'HR_ADMIN' && req.auth!.role !== 'SUPER_ADMIN') throw new AppError(403, 'Only a Super Admin can create HR Admin accounts');
  const code = await nextEmployeeCode();
  const emp = await prisma.$transaction(async (tx) => {
    let userId: string | undefined;
    if (b.password) {
      const role = await tx.role.findUniqueOrThrow({ where: { name: b.role ?? 'EMPLOYEE' } });
      userId = (await tx.user.create({ data: { email: b.email, passwordHash: await bcrypt.hash(b.password, env.bcryptRounds), roleId: role.id, mustChangePassword: true } })).id;
    }
    return tx.employee.create({ data: { ...toData(b), employeeCode: code, userId } as any, include: inc });
  });
  await ensureLeaveBalances(emp.id);
  audit(req, 'employee.create', 'Employee', emp.id, { code });
  res.status(201).json(emp);
}));

r.put('/:id', validate(profileSchema.partial()), asyncHandler(async (req, res) => {
  const id = req.params.id;
  const hr = isHR(req.auth!.role);
  if (!hr && id !== req.auth!.employeeId) throw new AppError(403, 'You can only edit your own profile');
  let data: any = toData(req.body);
  if (!hr) data = Object.fromEntries(Object.entries(data).filter(([k]) => SELF_FIELDS.includes(k)));
  if (hr && data.managerId === id) throw new AppError(400, 'An employee cannot report to themselves');
  const emp = await prisma.employee.update({ where: { id }, data, include: inc });
  if (hr && req.body.email) await prisma.user.updateMany({ where: { employee: { id } }, data: { email: req.body.email } });
  if (hr && req.body.employmentStatus) {
    await prisma.user.updateMany({ where: { employee: { id } }, data: { isActive: ['ACTIVE', 'ON_LEAVE'].includes(req.body.employmentStatus) } });
  }
  audit(req, 'employee.update', 'Employee', id);
  res.json(shape(emp, req.auth));
}));

r.delete('/:id', requireRole(...HR), asyncHandler(async (req, res) => {
  const e = await prisma.employee.findUnique({ where: { id: req.params.id } });
  if (!e) throw new AppError(404, 'Employee not found');
  if (e.id === req.auth!.employeeId) throw new AppError(400, 'You cannot delete your own account');
  await prisma.$transaction([prisma.employee.delete({ where: { id: e.id } }), ...(e.userId ? [prisma.user.delete({ where: { id: e.userId } })] : [])]);
  audit(req, 'employee.delete', 'Employee', e.id, { code: e.employeeCode });
  res.json({ ok: true });
}));

r.post('/:id/photo', (req, res, next) => {
  if (!isHR(req.auth!.role) && req.params.id !== req.auth!.employeeId) return next(new AppError(403, 'Forbidden'));
  next();
}, makeUpload('employees', IMAGE_MIMES, 2), verifyUpload, asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, 'No file uploaded');
  const e = await prisma.employee.update({ where: { id: req.params.id }, data: { photoUrl: `/uploads/employees/${req.file.filename}` } });
  res.json({ photoUrl: e.photoUrl });
}));

export default r;
