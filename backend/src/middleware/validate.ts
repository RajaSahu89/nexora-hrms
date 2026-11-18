import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';

type Source = 'body' | 'query' | 'params';

/** Express middleware: validates req[source] (default body) and replaces it with the parsed value. */
export const validate = (schema: ZodSchema, source: Source = 'body') => (req: Request, _res: Response, next: NextFunction) => {
  const r = schema.safeParse((req as any)[source]);
  if (!r.success) return next(r.error);
  (req as any)[source] = r.data;
  next();
};
/** Inline helper: returns parsed data or throws a ZodError (handled by the error middleware). */
export function parseOrThrow<T>(schema: ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}
