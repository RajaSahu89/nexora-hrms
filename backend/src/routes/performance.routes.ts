import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError, asyncHandler } from '../utils/http';
import { validate } from '../middleware/validate';
import { isHR, scopeWhere } from '../utils/scope';
import { audit } from '../utils/audit';
import { employeeUserId, notifyUsers } from '../utils/notify';
import { dateStr, optNum, optStr } from '../validators/common';

const r = Router();
const empSel = { select: { id: true, firstName: true, lastName: true, employeeCode: true } } as const;
const inScope = async (req: any, employeeId: string) => !!(await prisma.employee.findFirst({ where: { AND: [{ id: employeeId }, scopeWhere(req.auth)] }, select: { id: true } }));
const isTeamLead = (req: any) => req.auth.role === 'MANAGER' || isHR(req.auth.role);

r.get('/goals', asyncHandler(async (req, res) => {
  const q: any = req.query;
  res.json(await prisma.employeeGoal.findMany({
    where: { employee: { AND: [scopeWhere(req.auth!), ...(q.employeeId ? [{ id: q.employeeId }] : [])] } },
    include: { employee: empSel }, orderBy: { createdAt: 'desc' }, take: 300,
  }));
}));
r.post('/goals', validate(z.object({ employeeId: optStr(40), title: z.string().trim().min(3).max(120), description: optStr(1000), targetValue: optNum, dueDate: optStr(10) })), asyncHandler(async (req, res) => {
  const employeeId = isTeamLead(req) && req.body.employeeId ? req.body.employeeId : req.auth!.employeeId;
  if (!employeeId || !(await inScope(req, employeeId))) throw new AppError(403, 'Not allowed');
  const g = await prisma.employeeGoal.create({ data: { employeeId, title: req.body.title, description: req.body.description, targetValue: req.body.targetValue, dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null } });
  res.status(201).json(g);
}));
r.patch('/goals/:id', validate(z.object({ progress: z.coerce.number().int().min(0).max(100).optional(), currentValue: optNum, status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional() })), asyncHandler(async (req, res) => {
  const g = await prisma.employeeGoal.findUnique({ where: { id: req.params.id } });
  if (!g || !(await inScope(req, g.employeeId))) throw new AppError(404, 'Goal not found');
  const data: any = { ...req.body };
  if (data.progress === 100) data.status = 'COMPLETED'; else if (data.progress > 0 && !data.status) data.status = 'IN_PROGRESS';
  res.json(await prisma.employeeGoal.update({ where: { id: g.id }, data }));
}));
r.delete('/goals/:id', asyncHandler(async (req, res) => {
  const g = await prisma.employeeGoal.findUnique({ where: { id: req.params.id } });
  if (!g || !(await inScope(req, g.employeeId))) throw new AppError(404, 'Goal not found');
  await prisma.employeeGoal.delete({ where: { id: g.id } });
  res.json({ ok: true });
}));

r.get('/reviews', asyncHandler(async (req, res) => {
  res.json(await prisma.performanceReview.findMany({
    where: { employee: scopeWhere(req.auth!) }, include: { employee: empSel, reviewer: { select: { firstName: true, lastName: true } } }, orderBy: { periodEnd: 'desc' }, take: 300,
  }));
}));
r.post('/reviews', validate(z.object({ employeeId: z.string(), periodStart: dateStr, periodEnd: dateStr })), asyncHandler(async (req, res) => {
  if (!isTeamLead(req)) throw new AppError(403, 'Forbidden');
  const b = req.body;
  if (b.employeeId === req.auth!.employeeId && req.auth!.role !== 'SUPER_ADMIN') throw new AppError(403, 'You cannot start your own review');
  if (!(await inScope(req, b.employeeId))) throw new AppError(403, 'Not allowed');
  if (b.periodEnd < b.periodStart) throw new AppError(400, 'Period end must be after start');
  const rv = await prisma.performanceReview.create({ data: { employeeId: b.employeeId, reviewerId: req.auth!.employeeId, periodStart: new Date(b.periodStart.slice(0, 10)), periodEnd: new Date(b.periodEnd.slice(0, 10)), status: 'SELF_ASSESSMENT' } });
  const uid = await employeeUserId(b.employeeId);
  if (uid) await notifyUsers([uid], 'SYSTEM', 'Performance review started', 'Please complete your self assessment.', '/performance');
  audit(req, 'review.create', 'PerformanceReview', rv.id);
  res.status(201).json(rv);
}));
r.patch('/reviews/:id', validate(z.object({
  selfAssessment: optStr(3000), managerFeedback: optStr(3000), rating: optNum.refine((v) => v === undefined || (v >= 1 && v <= 5), 'Rating must be 1-5'),
  improvementPlan: optStr(3000), kpiScores: z.record(z.coerce.number().min(0).max(100)).optional(), complete: z.boolean().optional(),
})), asyncHandler(async (req, res) => {
  const rv = await prisma.performanceReview.findUnique({ where: { id: req.params.id } });
  if (!rv || !(await inScope(req, rv.employeeId))) throw new AppError(404, 'Review not found');
  if (rv.status === 'COMPLETED') throw new AppError(409, 'Completed reviews are read-only');
  const { selfAssessment, managerFeedback, rating, improvementPlan, kpiScores, complete } = req.body;
  const own = rv.employeeId === req.auth!.employeeId;
  let data: any = {};
  if (own && !isHR(req.auth!.role)) { data = { selfAssessment, status: 'MANAGER_REVIEW' }; }
  else {
    if (!isTeamLead(req) || own) throw new AppError(403, 'Only the reviewer can complete this part');
    data = { managerFeedback, rating, improvementPlan, kpiScores, ...(complete ? { status: 'COMPLETED' } : { status: 'MANAGER_REVIEW' }) };
  }
  const u = await prisma.performanceReview.update({ where: { id: rv.id }, data });
  if (data.status === 'COMPLETED') { const uid = await employeeUserId(rv.employeeId); if (uid) await notifyUsers([uid], 'SYSTEM', 'Performance review completed', 'Your review is available.', '/performance'); }
  res.json(u);
}));

r.get('/analytics', asyncHandler(async (req, res) => {
  const reviews = await prisma.performanceReview.findMany({ where: { status: 'COMPLETED', employee: scopeWhere(req.auth!) }, select: { rating: true, employee: { select: { department: { select: { name: true } } } } } });
  const byDept: Record<string, number[]> = {}; const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  reviews.forEach((x) => { const n = x.employee.department?.name ?? 'Unassigned'; if (x.rating != null) { (byDept[n] ??= []).push(Number(x.rating)); dist[String(Math.round(Number(x.rating)))]++; } });
  const goals = await prisma.employeeGoal.groupBy({ by: ['status'], where: { employee: scopeWhere(req.auth!) }, _count: true });
  res.json({
    byDepartment: Object.entries(byDept).map(([name, v]) => ({ name, avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 })),
    distribution: Object.entries(dist).map(([rating, count]) => ({ rating, count })),
    goals: goals.map((g) => ({ status: g.status, count: g._count })),
  });
}));

export default r;
