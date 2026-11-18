import dotenv from 'dotenv';
import path from 'path';

const root = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(root, '.env') });

const isProd = process.env.NODE_ENV === 'production';
const need = (k: string, dev: string) => {
  const v = process.env[k];
  if (!v) { if (isProd) throw new Error(`Missing required env var ${k}`); return dev; }
  return v;
};
const num = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && process.env[k] ? v : d; };

export const env = {
  root, isProd, nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  accessSecret: need('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
  accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
  refreshDays: num('JWT_REFRESH_DAYS', 7),
  refreshRememberDays: num('JWT_REFRESH_DAYS_REMEMBER', 30),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
  rateWindow: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000),
  rateMax: Number(process.env.RATE_LIMIT_MAX || 300),
  authRateMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
  allowRegistration: (process.env.ALLOW_REGISTRATION ?? 'true') !== 'false',
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || './uploads'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),
};
