import { NotificationType } from '@prisma/client';
import { prisma } from '../config/prisma';

export const notifyUsers = async (userIds: string[], type: NotificationType, title: string, message: string, link?: string) => {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  await prisma.notification.createMany({ data: ids.map((userId) => ({ userId, type, title, message, link })) });
};
export const hrUserIds = async () =>
  (await prisma.user.findMany({ where: { isActive: true, role: { name: { in: ['SUPER_ADMIN', 'HR_ADMIN'] } } }, select: { id: true } })).map((u) => u.id);
export const employeeUserId = async (employeeId: string) =>
  (await prisma.employee.findUnique({ where: { id: employeeId }, select: { userId: true } }))?.userId ?? null;
