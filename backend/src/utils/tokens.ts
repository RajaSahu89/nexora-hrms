import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export const signAccess = (userId: string, role: string) =>
  jwt.sign({ role }, env.accessSecret, { subject: userId, expiresIn: env.accessExpires as any });
export const randomToken = () => crypto.randomBytes(48).toString('hex');
export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
export const ms = (s: string) => {
  const m = /^(\d+)([smhd])$/.exec(s);
  if (!m) return 7 * 864e5;
  return Number(m[1]) * ({ s: 1e3, m: 6e4, h: 36e5, d: 864e5 } as any)[m[2]];
};
