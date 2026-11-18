import jwt from 'jsonwebtoken';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { AppError, asyncHandler } from '../utils/http';

export const HR = ['SUPER_ADMIN', 'HR_ADMIN'];
export const HR_MGR = ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'];

export const authenticate = asyncHandler(async (req, _res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw new AppError(401, 'Authentication required');
  let payload: any;
  try { payload = jwt.verify(h.slice(7), env.accessSecret); } catch { throw new AppError(401, 'Invalid or expired token'); }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { role: true, employee: { select: { id: true, departmentId: true } } },
  });
  if (!user || !user.isActive) throw new AppError(401, 'Account disabled or not found');
  const info = {
    email: user.email, role: user.role.name as any,
    employeeId: user.employee?.id ?? null, departmentId: user.employee?.departmentId ?? null,
  };
  req.auth = { userId: user.id, ...info };
  req.user = { id: user.id, ...info };
  next();
});

export const requireRole = (...roles: string[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(new AppError(401, 'Authentication required'));
  if (!roles.includes(req.auth.role)) return next(new AppError(403, 'You do not have permission to do this'));
  next();
};
export const authorize = requireRole;
