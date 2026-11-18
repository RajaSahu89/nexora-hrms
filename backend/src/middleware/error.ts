import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { env } from '../config/env';
import { AppError } from '../utils/http';
import { HttpError } from '../utils/httpError';

const send = (res: Response, status: number, msg: string, details?: unknown) => res.status(status).json({ error: msg, message: msg, details });
export const notFound = (_req: Request, res: Response) => send(res, 404, 'Route not found');

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const i = err.issues[0];
    return send(res, 400, i ? `${i.path.join('.') || 'input'}: ${i.message}` : 'Validation failed',
      err.issues.map((x) => ({ path: x.path.join('.'), message: x.message })));
  }
  if (err instanceof AppError || err instanceof HttpError) return send(res, err.status, err.message, (err as any).details);
  if (err instanceof multer.MulterError) return send(res, 400, err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${env.maxUploadMb} MB)` : err.message);
  if (err?.code === 'P2002') return send(res, 409, `Duplicate value for: ${(err.meta?.target || []).join?.(', ') || 'unique field'}`);
  if (err?.code === 'P2025') return send(res, 404, 'Record not found');
  if (err?.code === 'P2003') return send(res, 400, 'Related record is missing or still in use');
  console.error(err);
  send(res, 500, 'Something went wrong. Please try again.');
}
