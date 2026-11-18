import { prisma } from '../config/prisma';
import { parseOrThrow } from '../middleware/validate';
import { departmentSchema, designationSchema, holidaySchema } from '../validators';
import { asyncHandler } from '../utils/asyncHandler';
import { audit } from '../utils/audit';
import { parseDate } from '../utils/dates';
import { notFound } from '../utils/httpError';

export const lookups = asyncHandler(async (_req, res) => {
  const [departments, designations, leaveTypes, people] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.designation.findMany({ select: { id: true, title: true }, orderBy: { level: 'desc' } }),
    prisma.leaveType.findMany({ orderBy: { name: 'asc' } }),
    prisma.employee.findMany({
      where: { employmentStatus: { in: ['ACTIVE', 'ON_LEAVE'] } },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, departmentId: true }, orderBy: { firstName: 'asc' },
    }),
  ]);
  res.json({ data: { departments, designations, leaveTypes, people } });
});
export const listDepartments = asyncHandler(async (_req, res) => {
  const rows = await prisma.department.findMany({
    include: { head: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { employees: true } } },
    orderBy: { name: 'asc' },
  });
  res.json({ data: rows });
});

export const getDepartment = asyncHandler(async (req, res) => {
  const d = await prisma.department.findUnique({
    where: { id: req.params.id },
    include: {
      head: { select: { id: true, firstName: true, lastName: true } },
      employees: { select: { id: true, employeeCode: true, firstName: true, lastName: true, photoUrl: true, employmentStatus: true, designation: { select: { title: true } } }, orderBy: { firstName: 'asc' } },
    },
  });
  if (!d) throw notFound('Department not found');
  const perf = await prisma.performanceReview.aggregate({
    where: { status: 'COMPLETED', employee: { departmentId: d.id } }, _avg: { rating: true }, _count: true,
  });
  res.json({ data: { ...d, performance: { avgRating: perf._avg.rating ? Number(perf._avg.rating) : null, reviews: perf._count } } });
});

export const createDepartment = asyncHandler(async (req, res) => {
  const d = await prisma.department.create({ data: parseOrThrow(departmentSchema, req.body) });
  audit(req, 'department.create', 'Department', d.id, { name: d.name });
  res.status(201).json({ data: d });
});
export const updateDepartment = asyncHandler(async (req, res) => {
  const d = await prisma.department.update({ where: { id: req.params.id }, data: parseOrThrow(departmentSchema, req.body) });
  audit(req, 'department.update', 'Department', d.id);
  res.json({ data: d });
});
export const deleteDepartment = asyncHandler(async (req, res) => {
  await prisma.department.delete({ where: { id: req.params.id } });
  audit(req, 'department.delete', 'Department', req.params.id);
  res.json({ data: { message: 'Department deleted. Its employees are now unassigned.' } });
});
export const listDesignations = asyncHandler(async (_req, res) => {
  res.json({ data: await prisma.designation.findMany({ include: { _count: { select: { employees: true } } }, orderBy: { level: 'desc' } }) });
});
export const createDesignation = asyncHandler(async (req, res) => {
  const d = await prisma.designation.create({ data: parseOrThrow(designationSchema, req.body) });
  audit(req, 'designation.create', 'Designation', d.id);
  res.status(201).json({ data: d });
});
export const deleteDesignation = asyncHandler(async (req, res) => {
  await prisma.designation.delete({ where: { id: req.params.id } });
  audit(req, 'designation.delete', 'Designation', req.params.id);
  res.json({ data: { message: 'Job title deleted' } });
});
export const listHolidays = asyncHandler(async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json({ data: await prisma.holiday.findMany({ where: { date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } }, orderBy: { date: 'asc' } }) });
});
export const createHoliday = asyncHandler(async (req, res) => {
  const b = parseOrThrow(holidaySchema, req.body);
  const h = await prisma.holiday.create({ data: { name: b.name, date: parseDate(b.date), isOptional: b.isOptional } });
  audit(req, 'holiday.create', 'Holiday', h.id);
  res.status(201).json({ data: h });
});
export const deleteHoliday = asyncHandler(async (req, res) => {
  await prisma.holiday.delete({ where: { id: req.params.id } });
  audit(req, 'holiday.delete', 'Holiday', req.params.id);
  res.json({ data: { message: 'Holiday removed' } });
});
