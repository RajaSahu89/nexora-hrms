import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { parseOrThrow } from '../middleware/validate';
import { commentSchema, taskSchema, taskUpdateSchema } from '../validators';
import { asyncHandler } from '../utils/asyncHandler';
import { audit } from '../utils/audit';
import { parseDate } from '../utils/dates';
import { badRequest, forbidden, notFound } from '../utils/httpError';
import { notify, userIdsOfEmployees } from '../utils/notify';
import { canAccessEmployee, employeeScope, isHR } from '../utils/scope';
import { storage } from '../utils/storage';

const person = { select: { id: true, firstName: true, lastName: true, photoUrl: true } };

function taskWhere(u: NonNullable<Express.Request['user']>): Prisma.TaskWhereInput {
  if (isHR(u)) return {};
  if (u.role === 'MANAGER') return { OR: [{ assignee: employeeScope(u) }, { creatorId: u.employeeId ?? '__none__' }] };
  return { OR: [{ assigneeId: u.employeeId ?? '__none__' }, { creatorId: u.employeeId ?? '__none__' }] };
}

async function loadAccessible(u: NonNullable<Express.Request['user']>, id: string) {
  const t = await prisma.task.findFirst({ where: { AND: [{ id }, taskWhere(u)] } });
  if (!t) throw notFound('Task not found');
  return t;
}

export const list = asyncHandler(async (req, res) => {
  const u = req.user!;
  const and: Prisma.TaskWhereInput[] = [taskWhere(u)];
  if (req.query.scope === 'mine') and.push({ assigneeId: u.employeeId ?? '__none__' });
  const rows = await prisma.task.findMany({
    where: { AND: and }, orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }], take: 1000,
    include: { assignee: person, creator: person, _count: { select: { comments: true } } },
  });
  res.json({ data: rows });
});

export const getOne = asyncHandler(async (req, res) => {
  const t = await loadAccessible(req.user!, req.params.id);
  res.json({ data: await prisma.task.findUnique({ where: { id: t.id }, include: { assignee: person, creator: person, comments: { orderBy: { createdAt: 'asc' }, include: { author: person } } } }) });
});

export const create = asyncHandler(async (req, res) => {
  const u = req.user!;
  if (!u.employeeId) throw badRequest('No employee profile');
  const b = parseOrThrow(taskSchema, req.body);
  const assigneeId = b.assigneeId ?? u.employeeId;
  if (u.role === 'EMPLOYEE' && assigneeId !== u.employeeId) throw forbidden('Employees can only create tasks for themselves');
  if (!(await canAccessEmployee(u, assigneeId))) throw forbidden('You cannot assign tasks to that employee');
  const t = await prisma.task.create({ data: { ...b, assigneeId, creatorId: u.employeeId, dueDate: b.dueDate ? parseDate(b.dueDate) : null } });
  if (assigneeId !== u.employeeId) {
    await notify(await userIdsOfEmployees([assigneeId]), { type: 'TASK_ASSIGNED', title: 'New task assigned', message: t.title, link: '/tasks' });
  }
  audit(req, 'task.create', 'Task', t.id);
  res.status(201).json({ data: t });
});

export const update = asyncHandler(async (req, res) => {
  const u = req.user!;
  const t = await loadAccessible(u, req.params.id);
  const b = parseOrThrow(taskUpdateSchema, req.body);
  const isOwnerOrManager = isHR(u) || t.creatorId === u.employeeId || u.role === 'MANAGER';
  if (!isOwnerOrManager) {
    // assignee-only users may change progress/status, nothing else
    const allowed = ['status', 'progress'];
    if (Object.keys(b).some((k) => !allowed.includes(k))) throw forbidden('You can only update status and progress of tasks assigned to you');
  }
  if (b.assigneeId && b.assigneeId !== t.assigneeId && !(await canAccessEmployee(u, b.assigneeId))) throw forbidden('You cannot assign tasks to that employee');
  const data: Prisma.TaskUncheckedUpdateInput = { ...b, dueDate: b.dueDate === undefined ? undefined : b.dueDate ? parseDate(b.dueDate) : null };
  if (b.status === 'COMPLETED') data.progress = 100;
  const updated = await prisma.task.update({ where: { id: t.id }, data });
  if (b.assigneeId && b.assigneeId !== t.assigneeId) await notify(await userIdsOfEmployees([b.assigneeId]), { type: 'TASK_ASSIGNED', title: 'Task assigned to you', message: updated.title, link: '/tasks' });
  audit(req, 'task.update', 'Task', t.id, { status: b.status });
  res.json({ data: updated });
});

export const remove = asyncHandler(async (req, res) => {
  const u = req.user!;
  const t = await loadAccessible(u, req.params.id);
  if (!isHR(u) && t.creatorId !== u.employeeId) throw forbidden('Only the creator or HR can delete a task');
  t.attachments.forEach((a) => storage.remove(a));
  await prisma.task.delete({ where: { id: t.id } });
  audit(req, 'task.delete', 'Task', t.id);
  res.json({ data: { message: 'Task deleted' } });
});

export const addComment = asyncHandler(async (req, res) => {
  const u = req.user!;
  const t = await loadAccessible(u, req.params.id);
  const { body } = parseOrThrow(commentSchema, req.body);
  const c = await prisma.taskComment.create({ data: { taskId: t.id, authorId: u.employeeId!, body }, include: { author: person } });
  const others = [t.assigneeId, t.creatorId].filter((x): x is string => !!x && x !== u.employeeId);
  await notify(await userIdsOfEmployees(others), { type: 'SYSTEM', title: 'New task comment', message: `${c.author.firstName}: ${body.slice(0, 80)}`, link: '/tasks' });
  res.status(201).json({ data: c });
});

export const addAttachment = asyncHandler(async (req, res) => {
  const u = req.user!;
  if (!req.file) throw badRequest('Choose a file');
  try { const t = await loadAccessible(u, req.params.id);
    const rel = `tasks/${req.file.filename}`;
    await prisma.task.update({ where: { id: t.id }, data: { attachments: { push: rel } } });
    audit(req, 'task.attach', 'Task', t.id);
    res.status(201).json({ data: { path: rel, name: req.file.originalname } });
  } catch (e) { storage.remove(`tasks/${req.file.filename}`); throw e; }
});

export const downloadAttachment = asyncHandler(async (req, res) => {
  const t = await loadAccessible(req.user!, req.params.id);
  const rel = `tasks/${String(req.query.file).replace(/[^\w.\-]/g, '')}`;
  if (!t.attachments.includes(rel)) throw notFound('Attachment not found');
  res.download(storage.resolve(rel));
});
