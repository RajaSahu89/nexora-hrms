import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError, asyncHandler } from '../utils/http';
import { validate } from '../middleware/validate';
import { HR, requireRole } from '../middleware/auth';
import { audit } from '../utils/audit';
import { dateStr, optStr } from '../validators/common';
import { IMAGE_MIMES, makeUpload, verifyUpload } from '../utils/upload';
import { isHR } from '../utils/scope';

const r = Router();
const KEYS = ['company.profile', 'attendance.rules', 'payroll.config'];

r.get('/lookups', asyncHandler(async (req, res) => {
  const [departments, designations, leaveTypes, managers] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.designation.findMany({ select: { id: true, title: true }, orderBy: { level: 'desc' } }),
    prisma.leaveType.findMany({ orderBy: { name: 'asc' } }),
    isHR(req.auth!.role) ? prisma.employee.findMany({ where: { employmentStatus: 'ACTIVE' }, select: { id: true, firstName: true, lastName: true, employeeCode: true }, orderBy: { firstName: 'asc' } }) : Promise.resolve([]),
  ]);
  res.json({ departments, designations, leaveTypes, employees: managers });
}));

r.get('/public', asyncHandler(async (_req, res) => {
  const s = await prisma.companySetting.findUnique({ where: { key: 'company.profile' } });
  res.json((s?.value as any) ?? { name: 'Nexora', currency: 'INR' });
}));

r.get('/', asyncHandler(async (req, res) => {
  const rows = await prisma.companySetting.findMany();
  const all = Object.fromEntries(rows.map((s) => [s.key, s.value]));
  if (isHR(req.auth!.role)) return res.json(all);
  res.json({ 'company.profile': all['company.profile'], 'attendance.rules': all['attendance.rules'] });
}));

r.put('/key/:key', requireRole(...HR), validate(z.object({ value: z.record(z.any()) })), asyncHandler(async (req, res) => {
  if (!KEYS.includes(req.params.key)) throw new AppError(400, 'Unknown setting');
  const s = await prisma.companySetting.upsert({ where: { key: req.params.key }, update: { value: req.body.value }, create: { key: req.params.key, value: req.body.value } });
  audit(req, 'settings.update', 'CompanySetting', req.params.key);
  res.json(s);
}));

r.post('/logo', requireRole(...HR), makeUpload('company', IMAGE_MIMES, 2), verifyUpload, asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, 'No file uploaded');
  const cur = ((await prisma.companySetting.findUnique({ where: { key: 'company.profile' } }))?.value as any) ?? {};
  const value = { ...cur, logoUrl: `/uploads/company/${req.file.filename}` };
  await prisma.companySetting.upsert({ where: { key: 'company.profile' }, update: { value }, create: { key: 'company.profile', value } });
  res.json({ logoUrl: value.logoUrl });
}));

r.get('/holidays', asyncHandler(async (_req, res) => res.json(await prisma.holiday.findMany({ orderBy: { date: 'asc' } }))));
r.post('/holidays', requireRole(...HR), validate(z.object({ name: z.string().trim().min(2).max(80), date: dateStr, isOptional: z.boolean().optional() })), asyncHandler(async (req, res) => {
  const h = await prisma.holiday.create({ data: { name: req.body.name, date: new Date(req.body.date.slice(0, 10)), isOptional: !!req.body.isOptional } });
  audit(req, 'holiday.create', 'Holiday', h.id);
  res.status(201).json(h);
}));
r.delete('/holidays/:id', requireRole(...HR), asyncHandler(async (req, res) => { await prisma.holiday.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }));

r.post('/designations', requireRole(...HR), validate(z.object({ title: z.string().trim().min(2).max(80), level: z.coerce.number().int().min(1).max(20).default(1) })), asyncHandler(async (req, res) => {
  res.status(201).json(await prisma.designation.create({ data: req.body }));
}));
r.delete('/designations/:id', requireRole(...HR), asyncHandler(async (req, res) => {
  const n = await prisma.employee.count({ where: { designationId: req.params.id } });
  if (n) throw new AppError(409, 'This job title is in use');
  await prisma.designation.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

r.post('/leave-types', requireRole(...HR), validate(z.object({ name: z.string().trim().min(2).max(60), code: z.string().trim().min(1).max(8).toUpperCase(), defaultDays: z.coerce.number().min(0).max(365), isPaid: z.boolean().default(true), description: optStr(200) })), asyncHandler(async (req, res) => {
  res.status(201).json(await prisma.leaveType.create({ data: req.body }));
}));
r.put('/leave-types/:id', requireRole(...HR), validate(z.object({ defaultDays: z.coerce.number().min(0).max(365), isPaid: z.boolean().optional(), carryForward: z.boolean().optional() })), asyncHandler(async (req, res) => {
  const t = await prisma.leaveType.update({ where: { id: req.params.id }, data: req.body });
  audit(req, 'leavetype.update', 'LeaveType', t.id);
  res.json(t);
}));

r.get('/users', requireRole('SUPER_ADMIN'), asyncHandler(async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, isActive: true, lastLoginAt: true, role: { select: { name: true } }, employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(users);
}));
r.put('/users/:id', requireRole('SUPER_ADMIN'), validate(z.object({ role: z.enum(['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE']).optional(), isActive: z.boolean().optional() })), asyncHandler(async (req, res) => {
  if (req.params.id === req.auth!.userId) throw new AppError(400, 'You cannot change your own role or status');
  const { role, isActive } = req.body;
  const u = await prisma.user.update({
    where: { id: req.params.id },
    data: { ...(isActive !== undefined ? { isActive } : {}), ...(role ? { role: { connect: { name: role } } } : {}) },
  });
  if (role || isActive === false) await prisma.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
  audit(req, 'user.update', 'User', u.id, { role, isActive });
  res.json({ ok: true });
}));
r.get('/roles', requireRole('SUPER_ADMIN'), asyncHandler(async (_req, res) => {
  res.json(await prisma.role.findMany({ include: { permissions: { select: { key: true } } } }));
}));

export default r;
