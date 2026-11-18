import { prisma } from '../config/prisma';
import { parseOrThrow } from '../middleware/validate';
import { announcementSchema } from '../validators';
import { asyncHandler } from '../utils/asyncHandler';
import { audit } from '../utils/audit';
import { badRequest } from '../utils/httpError';
import { notify } from '../utils/notify';
import { isHR } from '../utils/scope';

const include = { department: { select: { name: true } }, publishedBy: { select: { employee: { select: { firstName: true, lastName: true } } } } };

export const list = asyncHandler(async (req, res) => {
  const u = req.user!;
  const now = new Date();
  const where = {
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      isHR(u) ? {} : { OR: [{ departmentId: null }, ...(u.departmentId ? [{ departmentId: u.departmentId }] : [])] },
    ],
  };
  res.json({ data: await prisma.announcement.findMany({ where, include, orderBy: [{ publishedAt: 'desc' }], take: 200 }) });
});

export const create = asyncHandler(async (req, res) => {
  const b = parseOrThrow(announcementSchema, req.body);
  const exp = b.expiresAt ? new Date(b.expiresAt) : null;
  if (exp && isNaN(exp.getTime())) throw badRequest('Invalid expiry date');
  const a = await prisma.announcement.create({ data: { title: b.title, body: b.body, type: b.type, departmentId: b.departmentId ?? null, expiresAt: exp, publishedById: req.user!.id } });
  const users = await prisma.user.findMany({
    where: { isActive: true, ...(b.departmentId ? { employee: { departmentId: b.departmentId } } : {}), NOT: { id: req.user!.id } }, select: { id: true },
  });
  await notify(users.map((x) => x.id), { type: 'ANNOUNCEMENT', title: b.type === 'IMPORTANT' ? `Important: ${b.title}` : b.title, message: b.body.slice(0, 120), link: '/announcements' });
  audit(req, 'announcement.create', 'Announcement', a.id);
  res.status(201).json({ data: a });
});

export const update = asyncHandler(async (req, res) => {
  const b = parseOrThrow(announcementSchema, req.body);
  const a = await prisma.announcement.update({ where: { id: req.params.id }, data: { title: b.title, body: b.body, type: b.type, departmentId: b.departmentId ?? null, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null } });
  audit(req, 'announcement.update', 'Announcement', a.id);
  res.json({ data: a });
});

export const remove = asyncHandler(async (req, res) => {
  await prisma.announcement.delete({ where: { id: req.params.id } });
  audit(req, 'announcement.delete', 'Announcement', req.params.id);
  res.json({ data: { message: 'Announcement deleted' } });
});
