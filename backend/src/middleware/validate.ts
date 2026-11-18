import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';

type Source = 'body' | 'query' | 'params';

export const validate = (schema: ZodSchema, source: Source = 'body') => (req: Request, _res: Response, next: NextFunction) => {
  const r = schema.safeParse((req as any)[source]);
  if (!r.success) return next(r.error);
  (req as any)[source] = r.data;
  next();
};
export function parseOrThrow<T>(schema: ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}
