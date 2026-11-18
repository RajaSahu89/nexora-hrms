import { prisma } from '../config/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { pageParams } from '../utils/scope';

export const list = asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const q = req.query as Record<string, string>;
  const { page, pageSize, skip, take } = pageParams(q);
  const where = { userId, ...(q.unread === '1' ? { isRead: false } : {}) };
  const [total, data, unread] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  res.json({ data, meta: { page, pageSize, total, unread } });
});

export const unreadCount = asyncHandler(async (req, res) => {
  res.json({ data: { unread: await prisma.notification.count({ where: { userId: req.user!.id, isRead: false } }) } });
});

export const markRead = asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user!.id }, data: { isRead: true, readAt: new Date() } });
  res.json({ data: { message: 'Marked as read' } });
});

export const markAllRead = asyncHandler(async (req, res) => {
  const r = await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true, readAt: new Date() } });
  res.json({ data: { updated: r.count } });
});
