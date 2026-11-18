import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { parseOrThrow } from '../middleware/validate';
import { goalSchema, managerReviewSchema, reviewCreateSchema, selfAssessSchema } from '../validators';
import { asyncHandler } from '../utils/asyncHandler';
import { audit } from '../utils/audit';
import { parseDate } from '../utils/dates';
import { badRequest, forbidden, HttpError, notFound } from '../utils/httpError';
import { notify, userIdsOfEmployees } from '../utils/notify';
import { canAccessEmployee, employeeScope, isHR } from '../utils/scope';

const who = { select: { id: true, employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } } } };

export const listGoals = asyncHandler(async (req, res) => {
  const u = req.user!;
  const q = req.query as Record<string, string>;
  const and: Prisma.EmployeeGoalWhereInput[] = [];
  if (q.employeeId) { if (!(await canAccessEmployee(u, q.employeeId))) throw forbidden(); and.push({ employeeId: q.employeeId }); }
  else if (q.scope === 'mine' || u.role === 'EMPLOYEE') and.push({ employeeId: u.employeeId ?? '__none__' });
  else and.push({ employee: employeeScope(u) });
  const rows = await prisma.employeeGoal.findMany({ where: { AND: and }, include: { employee: who }, orderBy: { createdAt: 'desc' }, take: 500 });
  res.json({ data: rows.map((g) => ({ ...g, targetValue: g.targetValue && Number(g.targetValue), currentValue: g.currentValue && Number(g.currentValue) })) });
});

export const createGoal = asyncHandler(async (req, res) => {
  const u = req.user!;
  const b = parseOrThrow(goalSchema, req.body);
  const employeeId = b.employeeId ?? u.employeeId;
  if (!employeeId || !(await canAccessEmployee(u, employeeId))) throw forbidden();
  const g = await prisma.employeeGoal.create({ data: { ...b, employeeId, dueDate: b.dueDate ? parseDate(b.dueDate) : null } });
  audit(req, 'goal.create', 'EmployeeGoal', g.id);
  res.status(201).json({ data: g });
});

export const updateGoal = asyncHandler(async (req, res) => {
  const u = req.user!;
  const goal = await prisma.employeeGoal.findUnique({ where: { id: req.params.id } });
  if (!goal) throw notFound();
  if (!(await canAccessEmployee(u, goal.employeeId))) throw forbidden();
  const b = parseOrThrow(goalSchema, req.body);
  const status = b.progress >= 100 ? 'COMPLETED' : b.status;
  const g = await prisma.employeeGoal.update({ where: { id: goal.id }, data: { ...b, status, employeeId: goal.employeeId, dueDate: b.dueDate ? parseDate(b.dueDate) : null } });
  audit(req, 'goal.update', 'EmployeeGoal', g.id);
  res.json({ data: g });
});

export const deleteGoal = asyncHandler(async (req, res) => {
  const goal = await prisma.employeeGoal.findUnique({ where: { id: req.params.id } });
  if (!goal) throw notFound();
  if (!(await canAccessEmployee(req.user!, goal.employeeId))) throw forbidden();
  await prisma.employeeGoal.delete({ where: { id: goal.id } });
  audit(req, 'goal.delete', 'EmployeeGoal', goal.id);
  res.json({ data: { message: 'Goal deleted' } });
});

export const listReviews = asyncHandler(async (req, res) => {
  const u = req.user!;
  const where: Prisma.PerformanceReviewWhereInput = u.role === 'EMPLOYEE' || req.query.scope === 'mine' ? { employeeId: u.employeeId ?? '__none__' } : { employee: employeeScope(u) };
  const rows = await prisma.performanceReview.findMany({
    where, orderBy: { periodEnd: 'desc' }, take: 500,
    include: { employee: who, reviewer: { select: { firstName: true, lastName: true } } },
  });
  res.json({ data: rows.map((r) => ({ ...r, rating: r.rating && Number(r.rating) })) });
});

export const createReview = asyncHandler(async (req, res) => {
  const u = req.user!;
  const b = parseOrThrow(reviewCreateSchema, req.body);
  if (!(await canAccessEmployee(u, b.employeeId))) throw forbidden();
  if (b.employeeId === u.employeeId) throw badRequest('You cannot start a review for yourself');
  if (parseDate(b.periodEnd) < parseDate(b.periodStart)) throw badRequest('Period end is before period start');
  const r = await prisma.performanceReview.create({ data: { employeeId: b.employeeId, reviewerId: u.employeeId, periodStart: parseDate(b.periodStart), periodEnd: parseDate(b.periodEnd), status: 'SELF_ASSESSMENT' } });
  await notify(await userIdsOfEmployees([b.employeeId]), { type: 'SYSTEM', title: 'Performance review started', message: 'Please complete your self assessment.', link: '/performance' });
  audit(req, 'review.create', 'PerformanceReview', r.id);
  res.status(201).json({ data: r });
});

export const selfAssess = asyncHandler(async (req, res) => {
  const { selfAssessment } = parseOrThrow(selfAssessSchema, req.body);
  const r = await prisma.performanceReview.findUnique({ where: { id: req.params.id } });
  if (!r) throw notFound();
  if (r.employeeId !== req.user!.employeeId) throw forbidden('You can only submit your own self assessment');
  if (r.status === 'COMPLETED') throw new HttpError(409, 'This review is already completed');
  res.json({ data: await prisma.performanceReview.update({ where: { id: r.id }, data: { selfAssessment, status: 'MANAGER_REVIEW' } }) });
});

export const managerReview = asyncHandler(async (req, res) => {
  const u = req.user!;
  const b = parseOrThrow(managerReviewSchema, req.body);
  const r = await prisma.performanceReview.findUnique({ where: { id: req.params.id } });
  if (!r) throw notFound();
  if (r.employeeId === u.employeeId) throw forbidden('You cannot review yourself');
  if (!isHR(u) && !(await canAccessEmployee(u, r.employeeId))) throw forbidden();
  const updated = await prisma.performanceReview.update({
    where: { id: r.id }, data: { managerFeedback: b.managerFeedback, rating: b.rating, kpiScores: b.kpiScores ?? undefined, improvementPlan: b.improvementPlan, status: 'COMPLETED', reviewerId: u.employeeId },
  });
  await notify(await userIdsOfEmployees([r.employeeId]), { type: 'SYSTEM', title: 'Performance review completed', message: 'Your manager has completed your review.', link: '/performance' });
  audit(req, 'review.complete', 'PerformanceReview', r.id);
  res.json({ data: updated });
});

export const analytics = asyncHandler(async (req, res) => {
  const u = req.user!;
  const reviews = await prisma.performanceReview.findMany({
    where: { status: 'COMPLETED', rating: { not: null }, employee: employeeScope(u) },
    select: { rating: true, periodEnd: true, employee: { select: { department: { select: { name: true } } } } },
  });
  const byDept: Record<string, number[]> = {}, dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }, byYear: Record<string, number[]> = {};
  for (const r of reviews) {
    const n = Number(r.rating);
    (byDept[r.employee.department?.name ?? 'Unassigned'] ??= []).push(n);
    dist[String(Math.min(5, Math.max(1, Math.round(n))))]++;
    (byYear[String(r.periodEnd.getUTCFullYear())] ??= []).push(n);
  }
  const avg = (a: number[]) => Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 100) / 100;
  const goals = await prisma.employeeGoal.groupBy({ by: ['status'], where: { employee: employeeScope(u) }, _count: true });
  res.json({ data: {
    averageRating: reviews.length ? avg(reviews.map((r) => Number(r.rating))) : null,
    byDepartment: Object.entries(byDept).map(([name, v]) => ({ name, rating: avg(v), reviews: v.length })),
    distribution: Object.entries(dist).map(([rating, count]) => ({ rating, count })),
    trend: Object.entries(byYear).sort().map(([year, v]) => ({ year, rating: avg(v) })),
    goals: goals.map((g) => ({ status: g.status, count: g._count })),
  } });
});
