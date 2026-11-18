import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { asyncHandler } from '../utils/http';
import { validate } from '../middleware/validate';
import { HR, requireRole } from '../middleware/auth';
import { isHR } from '../utils/scope';
import { audit } from '../utils/audit';
import { notifyUsers } from '../utils/notify';
import { optStr } from '../validators/common';

const r = Router();
const inc = { department: { select: { name: true } }, publishedBy: { select: { email: true, employee: { select: { firstName: true, lastName: true } } } } } as const;

r.get('/', asyncHandler(async (req, res) => {
  const a = req.auth!;
  const where = isHR(a.role) ? {} : { OR: [{ departmentId: null }, { departmentId: a.departmentId ?? '__none__' }] };
  res.json(await prisma.announcement.findMany({ where, include: inc, orderBy: { publishedAt: 'desc' }, take: 100 }));
}));

r.post('/', requireRole(...HR), validate(z.object({
  title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(4000),
  type: z.enum(['GENERAL', 'IMPORTANT', 'HOLIDAY', 'EVENT']).default('GENERAL'), departmentId: optStr(40),
})), asyncHandler(async (req, res) => {
  const b = req.body;
  const a = await prisma.announcement.create({ data: { ...b, publishedById: req.auth!.userId }, include: inc });
  const users = await prisma.user.findMany({ where: { isActive: true, ...(b.departmentId ? { employee: { departmentId: b.departmentId } } : {}) }, select: { id: true } });
  await notifyUsers(users.map((u) => u.id).filter((id) => id !== req.auth!.userId), 'ANNOUNCEMENT', `${b.type === 'IMPORTANT' ? 'Important: ' : ''}${b.title}`, b.body.slice(0, 120), '/announcements');
  audit(req, 'announcement.create', 'Announcement', a.id);
  res.status(201).json(a);
}));

r.delete('/:id', requireRole(...HR), asyncHandler(async (req, res) => {
  await prisma.announcement.delete({ where: { id: req.params.id } });
  audit(req, 'announcement.delete', 'Announcement', req.params.id);
  res.json({ ok: true });
}));

export default r;
