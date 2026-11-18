import { Request } from 'express';
import { prisma } from '../config/prisma';
export function audit(req: Request, action: string, entity: string, entityId?: string, metadata?: any) {
  prisma.auditLog
    .create({ data: { userId: req.user?.id, action, entity, entityId, metadata, ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 200) } })
    .catch(() => {});
}
