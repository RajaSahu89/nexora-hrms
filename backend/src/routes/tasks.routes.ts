import { Router } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError, asyncHandler } from '../utils/http';
import { validate } from '../middleware/validate';
import { isHR, scopeWhere } from '../utils/scope';
import { audit } from '../utils/audit';
import { employeeUserId, notifyUsers } from '../utils/notify';
import { optStr } from '../validators/common';
import { DOC_MIMES, makeUpload, uploadPath, verifyUpload } from '../utils/upload';

const r = Router();
const STATUS = z.enum(['TODO', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED']);
const PRIORITY = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const inc = { assignee: { select: { id: true, firstName: true, lastName: true, photoUrl: true } }, creator: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { comments: true } } } as const;

const visible = (a: any): Prisma.TaskWhereInput => {
  if (isHR(a.role)) return {};
  const me = a.employeeId ?? '__none__';
  if (a.role === 'MANAGER') return { OR: [{ assigneeId: me }, { creatorId: me }, { assignee: scopeWhere(a) }] };
  return { OR: [{ assigneeId: me }, { creatorId: me }] };
};
const load = async (req: any) => {
  const t = await prisma.task.findFirst({ where: { AND: [{ id: req.params.id }, visible(req.auth)] }, include: inc });
  if (!t) throw new AppError(404, 'Task not found');
  return t;
};
const canManage = (req: any, t: any) => isHR(req.auth.role) || t.creatorId === req.auth.employeeId || req.auth.role === 'MANAGER';
const checkAssignee = async (req: any, assigneeId?: string | null) => {
  if (!assigneeId) return;
  if (req.auth.role === 'EMPLOYEE' && assigneeId !== req.auth.employeeId) throw new AppError(403, 'You can only assign tasks to yourself');
  if (req.auth.role === 'MANAGER' && !(await prisma.employee.findFirst({ where: { AND: [{ id: assigneeId }, scopeWhere(req.auth)] } }))) throw new AppError(403, 'You can only assign tasks to your team');
};

r.get('/', asyncHandler(async (req, res) => {
  const q: any = req.query;
  res.json(await prisma.task.findMany({
    where: { AND: [visible(req.auth), ...(q.status ? [{ status: q.status }] : []), ...(q.assigneeId ? [{ assigneeId: q.assigneeId }] : []), ...(q.mine === '1' ? [{ assigneeId: req.auth!.employeeId ?? '__none__' }] : [])] },
    include: inc, orderBy: [{ position: 'asc' }, { createdAt: 'desc' }], take: 300,
  }));
}));

const createSchema = z.object({ title: z.string().trim().min(2).max(120), description: optStr(2000), priority: PRIORITY.default('MEDIUM'), dueDate: optStr(30), assigneeId: optStr(40) });
r.post('/', validate(createSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  await checkAssignee(req, b.assigneeId);
  if (!req.auth!.employeeId) throw new AppError(400, 'No employee profile linked');
  const t = await prisma.task.create({ data: { title: b.title, description: b.description, priority: b.priority, dueDate: b.dueDate ? new Date(b.dueDate) : null, assigneeId: b.assigneeId, creatorId: req.auth!.employeeId }, include: inc });
  if (b.assigneeId && b.assigneeId !== req.auth!.employeeId) {
    const uid = await employeeUserId(b.assigneeId);
    if (uid) await notifyUsers([uid], 'TASK_ASSIGNED', 'New task assigned', t.title, '/tasks');
  }
  audit(req, 'task.create', 'Task', t.id);
  res.status(201).json(t);
}));

r.patch('/:id', validate(createSchema.partial().extend({ status: STATUS.optional(), progress: z.coerce.number().int().min(0).max(100).optional() })), asyncHandler(async (req, res) => {
  const t = await load(req);
  const isAssignee = t.assigneeId === req.auth!.employeeId;
  const b = { ...req.body };
  if (!canManage(req, t)) {
    if (!isAssignee) throw new AppError(403, 'Forbidden');
    for (const k of Object.keys(b)) if (!['status', 'progress'].includes(k)) delete b[k]; // assignees update progress only
  } else if (b.assigneeId !== undefined) await checkAssignee(req, b.assigneeId);
  if (b.status === 'COMPLETED') b.progress = 100;
  if (b.dueDate !== undefined) b.dueDate = b.dueDate ? new Date(b.dueDate) : null;
  const u = await prisma.task.update({ where: { id: t.id }, data: b, include: inc });
  if (b.assigneeId && b.assigneeId !== t.assigneeId && b.assigneeId !== req.auth!.employeeId) {
    const uid = await employeeUserId(b.assigneeId);
    if (uid) await notifyUsers([uid], 'TASK_ASSIGNED', 'New task assigned', u.title, '/tasks');
  }
  res.json(u);
}));

r.delete('/:id', asyncHandler(async (req, res) => {
  const t = await load(req);
  if (!isHR(req.auth!.role) && t.creatorId !== req.auth!.employeeId) throw new AppError(403, 'Only the creator or HR can delete a task');
  await prisma.task.delete({ where: { id: t.id } });
  audit(req, 'task.delete', 'Task', t.id);
  res.json({ ok: true });
}));

r.get('/:id/comments', asyncHandler(async (req, res) => {
  const t = await load(req);
  const [comments, full] = await Promise.all([
    prisma.taskComment.findMany({ where: { taskId: t.id }, include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.task.findUniqueOrThrow({ where: { id: t.id }, select: { attachments: true, description: true } }),
  ]);
  res.json({ comments, attachments: full.attachments, description: full.description });
}));
r.post('/:id/comments', validate(z.object({ body: z.string().trim().min(1).max(1000) })), asyncHandler(async (req, res) => {
  const t = await load(req);
  if (!req.auth!.employeeId) throw new AppError(400, 'No employee profile linked');
  const c = await prisma.taskComment.create({ data: { taskId: t.id, authorId: req.auth!.employeeId, body: req.body.body }, include: { author: { select: { firstName: true, lastName: true } } } });
  const others = await Promise.all([t.assigneeId, t.creatorId].filter((x) => x && x !== req.auth!.employeeId).map((x) => employeeUserId(x!)));
  await notifyUsers(others.filter(Boolean) as string[], 'TASK_ASSIGNED', 'New task comment', `${c.author.firstName}: ${c.body.slice(0, 80)}`, '/tasks');
  res.status(201).json(c);
}));

r.post('/:id/attachments', async (req, res, next) => { try { await load(req); next(); } catch (e) { next(e); } },
  makeUpload('documents', DOC_MIMES), verifyUpload, asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError(400, 'No file uploaded');
    const t = await prisma.task.findUniqueOrThrow({ where: { id: req.params.id } });
    if (t.attachments.length >= 10) throw new AppError(400, 'Attachment limit reached');
    await prisma.task.update({ where: { id: t.id }, data: { attachments: { push: req.file.filename } } });
    res.status(201).json({ name: req.file.filename });
  }));
r.get('/:id/attachments/:name', asyncHandler(async (req, res) => {
  const t = await prisma.task.findFirst({ where: { AND: [{ id: req.params.id }, visible(req.auth)] }, select: { attachments: true } });
  if (!t || !t.attachments.includes(req.params.name)) throw new AppError(404, 'File not found');
  const p = uploadPath('documents', req.params.name);
  if (!fs.existsSync(p)) throw new AppError(404, 'File missing');
  res.download(p);
}));

export default r;
