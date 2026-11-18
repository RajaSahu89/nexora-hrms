import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError, asyncHandler } from '../utils/http';
import { validate } from '../middleware/validate';
import { HR, requireRole } from '../middleware/auth';
import { audit } from '../utils/audit';
import { isHR } from '../utils/scope';
import { optNum, optStr } from '../validators/common';

const r = Router();
const schema = z.object({ name: z.string().trim().min(2).max(80), description: optStr(500), budget: optNum, headId: optStr(40) });
const data = (b: any) => ({ ...b, budget: b.budget ?? null });

r.get('/', asyncHandler(async (req, res) => {
  const rows = await prisma.department.findMany({
    orderBy: { name: 'asc' },
    include: { head: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { employees: true } } },
  });
  // budget is financial data: HR only
  res.json(rows.map((d) => (isHR(req.auth!.role) ? d : { ...d, budget: null })));
}));

r.get('/:id', asyncHandler(async (req, res) => {
  const d = await prisma.department.findUnique({
    where: { id: req.params.id },
    include: {
      head: { select: { id: true, firstName: true, lastName: true } },
      employees: { select: { id: true, employeeCode: true, firstName: true, lastName: true, photoUrl: true, designation: { select: { title: true } }, employmentStatus: true }, orderBy: { firstName: 'asc' } },
    },
  });
  if (!d) throw new AppError(404, 'Department not found');
  const ratings = await prisma.performanceReview.aggregate({ where: { status: 'COMPLETED', employee: { departmentId: d.id } }, _avg: { rating: true }, _count: true });
  res.json({ ...d, budget: isHR(req.auth!.role) ? d.budget : null, performance: { avgRating: ratings._avg.rating, reviews: ratings._count } });
}));

r.post('/', requireRole(...HR), validate(schema), asyncHandler(async (req, res) => {
  const d = await prisma.department.create({ data: data(req.body) });
  audit(req, 'department.create', 'Department', d.id);
  res.status(201).json(d);
}));
r.put('/:id', requireRole(...HR), validate(schema.partial()), asyncHandler(async (req, res) => {
  const d = await prisma.department.update({ where: { id: req.params.id }, data: req.body });
  audit(req, 'department.update', 'Department', d.id);
  res.json(d);
}));
r.delete('/:id', requireRole(...HR), asyncHandler(async (req, res) => {
  const n = await prisma.employee.count({ where: { departmentId: req.params.id } });
  if (n > 0) throw new AppError(409, `Move or remove the ${n} employee(s) in this department first`);
  await prisma.department.delete({ where: { id: req.params.id } });
  audit(req, 'department.delete', 'Department', req.params.id);
  res.json({ ok: true });
}));

export default r;
