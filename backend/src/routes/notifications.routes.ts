import { Router } from 'express';
import { prisma } from '../config/prisma';
import { asyncHandler } from '../utils/http';

const r = Router();

r.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(50, Number(req.query.limit) || 20);
  const where = { userId: req.auth!.userId, ...(req.query.unread === '1' ? { isRead: false } : {}) };
  const [total, unread, data] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.auth!.userId, isRead: false } }),
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
  ]);
  res.json({ data, total, unread, page, limit });
}));
r.get('/unread-count', asyncHandler(async (req, res) => {
  res.json({ unread: await prisma.notification.count({ where: { userId: req.auth!.userId, isRead: false } }) });
}));
r.post('/read-all', asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.auth!.userId, isRead: false }, data: { isRead: true, readAt: new Date() } });
  res.json({ ok: true });
}));
r.post('/:id/read', asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.auth!.userId }, data: { isRead: true, readAt: new Date() } });
  res.json({ ok: true });
}));

export default r;
