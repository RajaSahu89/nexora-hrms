import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { parseOrThrow } from '../middleware/validate';
import { createEmployeeSchema, selfUpdateSchema, updateEmployeeSchema } from '../validators';
import { createEmployeeWithUser, deactivateEmployee, mapEmployeeInput } from '../services/employeeService';
import { asyncHandler } from '../utils/asyncHandler';
import { audit } from '../utils/audit';
import { badRequest, forbidden, notFound } from '../utils/httpError';
import { canAccessEmployee, employeeScope, isHR, pageParams } from '../utils/scope';
import { storage } from '../utils/storage';
import { tempPassword } from '../utils/tokens';

const listSelect = {
  id: true, employeeCode: true, firstName: true, lastName: true, email: true, phone: true, photoUrl: true, gender: true,
  joiningDate: true, employmentType: true, employmentStatus: true, workLocation: true, departmentId: true, designationId: true, managerId: true,
  department: { select: { id: true, name: true } }, designation: { select: { id: true, title: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
  user: { select: { role: { select: { name: true } } } },
} satisfies Prisma.EmployeeSelect;

const SORTABLE = ['firstName', 'lastName', 'joiningDate', 'employeeCode', 'employmentStatus', 'email'];

export const list = asyncHandler(async (req, res) => {
  const u = req.user!;
  const q = req.query as Record<string, string>;
  const { page, pageSize, skip, take } = pageParams(q);
  const and: Prisma.EmployeeWhereInput[] = [employeeScope(u)];
  if (q.search) {
    const s = q.search.trim();
    and.push({ OR: [
      { firstName: { contains: s, mode: 'insensitive' } }, { lastName: { contains: s, mode: 'insensitive' } },
      { email: { contains: s, mode: 'insensitive' } }, { employeeCode: { contains: s, mode: 'insensitive' } },
    ] });
  }
  if (q.departmentId) and.push({ departmentId: q.departmentId });
  if (q.designationId) and.push({ designationId: q.designationId });
  if (q.status) and.push({ employmentStatus: q.status as any });
  if (q.employmentType) and.push({ employmentType: q.employmentType as any });
  const where = { AND: and };
  const sortBy = SORTABLE.includes(q.sortBy) ? q.sortBy : 'firstName';
  const [total, data] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({ where, select: listSelect, orderBy: { [sortBy]: q.order === 'desc' ? 'desc' : 'asc' }, skip, take }),
  ]);
  res.json({ data, meta: { page, pageSize, total } });
});

export const getOne = asyncHandler(async (req, res) => {
  const u = req.user!;
  const id = req.params.id === 'me' ? u.employeeId : req.params.id;
  if (!id) throw notFound('Employee profile not found');
  if (!(await canAccessEmployee(u, id))) throw forbidden();
  const emp = await prisma.employee.findUnique({
    where: { id },
    include: {
      department: { select: { id: true, name: true } }, designation: { select: { id: true, title: true } },
      manager: { select: { id: true, firstName: true, lastName: true } },
      user: { select: { isActive: true, lastLoginAt: true, role: { select: { name: true } } } },
    },
  });
  if (!emp) throw notFound('Employee not found');
  const { bankDetails, ...rest } = emp;
  res.json({ data: isHR(u) || u.employeeId === id ? { ...rest, bankDetails } : rest });
});

export const create = asyncHandler(async (req, res) => {
  const u = req.user!;
  const body = parseOrThrow(createEmployeeSchema, req.body);
  if (body.role === 'SUPER_ADMIN' && u.role !== 'SUPER_ADMIN') throw forbidden('Only a Super Admin can create another Super Admin');
  const generated = !body.password;
  const password = body.password ?? tempPassword();
  const emp = await createEmployeeWithUser(body, body.role, password, generated);
  audit(req, 'employee.create', 'Employee', emp.id, { email: emp.email, role: body.role });
  res.status(201).json({ data: emp, ...(generated ? { temporaryPassword: password } : {}) });
});

export const update = asyncHandler(async (req, res) => {
  const u = req.user!;
  const id = req.params.id === 'me' ? u.employeeId! : req.params.id;
  let data: Record<string, any>;
  if (isHR(u)) data = parseOrThrow(updateEmployeeSchema, req.body);
  else if (u.employeeId === id) data = parseOrThrow(selfUpdateSchema, req.body);
  else throw forbidden();
  if (data.managerId && data.managerId === id) throw badRequest('An employee cannot report to themselves');
  const emp = await prisma.employee.update({ where: { id }, data: mapEmployeeInput(data) });
  if (emp.userId && isHR(u)) {
    const patch: Prisma.UserUpdateInput = {};
    if (data.email) patch.email = data.email;
    if (data.employmentStatus) patch.isActive = ['ACTIVE', 'ON_LEAVE'].includes(data.employmentStatus);
    if (Object.keys(patch).length) await prisma.user.update({ where: { id: emp.userId }, data: patch });
  }
  audit(req, 'employee.update', 'Employee', id, Object.keys(data).length ? { fields: Object.keys(data) } : undefined);
  res.json({ data: emp });
});

export const remove = asyncHandler(async (req, res) => {
  if (req.params.id === req.user!.employeeId) throw badRequest('You cannot remove your own account');
  await deactivateEmployee(req.params.id, 'TERMINATED');
  audit(req, 'employee.delete', 'Employee', req.params.id);
  res.json({ data: { message: 'Employee removed (marked as terminated and login disabled)' } });
});

export const photo = asyncHandler(async (req, res) => {
  const u = req.user!;
  const id = req.params.id === 'me' ? u.employeeId! : req.params.id;
  if (!isHR(u) && u.employeeId !== id) { storage.remove(req.file ? `employees/${req.file.filename}` : null); throw forbidden(); }
  if (!req.file) throw badRequest('Choose an image to upload');
  const old = await prisma.employee.findUnique({ where: { id }, select: { photoUrl: true } });
  const photoUrl = `/uploads/employees/${req.file.filename}`;
  await prisma.employee.update({ where: { id }, data: { photoUrl } });
  storage.remove(old?.photoUrl);
  audit(req, 'employee.photo', 'Employee', id);
  res.json({ data: { photoUrl } });
});

export const bulk = asyncHandler(async (req, res) => {
  const { action, ids } = req.body as { action: 'activate' | 'deactivate' | 'delete'; ids: string[] };
  const safeIds = ids.filter((i) => i !== req.user!.employeeId);
  for (const id of safeIds) {
    if (action === 'activate') {
      const e = await prisma.employee.update({ where: { id }, data: { employmentStatus: 'ACTIVE' } });
      if (e.userId) await prisma.user.update({ where: { id: e.userId }, data: { isActive: true } });
    } else {
      await deactivateEmployee(id, action === 'delete' ? 'TERMINATED' : 'INACTIVE');
    }
  }
  audit(req, `employee.bulk_${action}`, 'Employee', null, { count: safeIds.length });
  res.json({ data: { affected: safeIds.length } });
});

export const importRows = asyncHandler(async (req, res) => {
  const rows = req.body.rows as Record<string, string>[];
  const [depts, desigs] = await Promise.all([prisma.department.findMany(), prisma.designation.findMany()]);
  const findBy = <T extends Record<string, any>>(list: T[], key: string, v?: string) => list.find((x) => String(x[key]).toLowerCase() === (v ?? '').trim().toLowerCase());
  const created: { email: string; temporaryPassword: string }[] = [];
  const failed: { row: number; email?: string; error: string }[] = [];
  for (const [i, r] of rows.entries()) {
    try {
      const body = parseOrThrow(createEmployeeSchema, {
        firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone || null,
        gender: r.gender ? r.gender.toUpperCase() : null,
        joiningDate: r.joiningDate || new Date().toISOString().slice(0, 10),
        employmentType: r.employmentType ? r.employmentType.toUpperCase() : undefined,
        departmentId: findBy(depts, 'name', r.department)?.id ?? null,
        designationId: findBy(desigs, 'title', r.designation)?.id ?? null,
        role: 'EMPLOYEE',
      });
      const pw = tempPassword();
      await createEmployeeWithUser(body, 'EMPLOYEE', pw, true);
      created.push({ email: body.email, temporaryPassword: pw });
    } catch (e: any) {
      failed.push({ row: i + 1, email: r.email, error: e.message ?? 'Failed' });
    }
  }
  audit(req, 'employee.import', 'Employee', null, { created: created.length, failed: failed.length });
  res.json({ data: { created, failed } });
});
