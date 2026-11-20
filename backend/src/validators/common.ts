import { z } from 'zod';

export const pwd = z.string().min(8, 'Min 8 characters').max(72)
  .regex(/[a-z]/, 'Needs a lowercase letter').regex(/[A-Z]/, 'Needs an uppercase letter').regex(/[0-9]/, 'Needs a number');

export const optStr = (max = 300) => z.preprocess((v) => (v === '' ? null : v), z.string().max(max).nullable().optional());
export const optNum = z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().optional());
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Invalid date');
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
