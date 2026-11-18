import { Request, Response, Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { AppError, asyncHandler } from '../utils/http';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import { audit } from '../utils/audit';
import { pwd } from '../validators/common';
import { ensureLeaveBalances, nextEmployeeCode } from '../utils/employees';

const r = Router();
const limiter = rateLimit({ windowMs: env.rateWindow, max: env.authRateMax, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please try again later.' } });
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10); // constant-time-ish login for unknown emails
const COOKIE = 'refresh_token';
const include = { role: true, employee: { select: { id: true, firstName: true, lastName: true, photoUrl: true, departmentId: true } } } as const;

const publicUser = (u: any) => ({
  id: u.id, email: u.email, role: u.role.name, employeeId: u.employee?.id ?? null, departmentId: u.employee?.departmentId ?? null,
  name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : u.email, photoUrl: u.employee?.photoUrl ?? null,
  mustChangePassword: u.mustChangePassword,
});
const signAccess = (u: any) => jwt.sign({ sub: u.id, role: u.role.name }, env.accessSecret, { expiresIn: env.accessExpires as any });

async function startSession(req: Request, res: Response, user: any, remember: boolean) {
  const raw = crypto.randomBytes(48).toString('hex');
  const days = remember ? env.refreshRememberDays : env.refreshDays;
  await prisma.session.create({
    data: { userId: user.id, refreshTokenHash: sha(raw), userAgent: req.get('user-agent')?.slice(0, 200), ip: req.ip, expiresAt: new Date(Date.now() + days * 864e5) },
  });
  res.cookie(COOKIE, raw, { httpOnly: true, sameSite: 'lax', secure: env.nodeEnv === 'production', path: '/api/auth', ...(remember ? { maxAge: days * 864e5 } : {}) });
}

r.post('/login', limiter,
  validate(z.object({ email: z.string().email(), password: z.string().min(1), remember: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const { email, password, remember } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include });
    if (!user) { await bcrypt.compare(password, DUMMY_HASH); throw new AppError(401, 'Invalid email or password'); }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new AppError(423, 'Account temporarily locked. Try again in a few minutes.');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const n = user.failedLogins + 1;
      await prisma.user.update({ where: { id: user.id }, data: n >= 5 ? { failedLogins: 0, lockedUntil: new Date(Date.now() + 15 * 60000) } : { failedLogins: n } });
      throw new AppError(401, 'Invalid email or password');
    }
    if (!user.isActive) throw new AppError(401, 'Invalid email or password');
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await startSession(req, res, user, !!remember);
    audit(req, 'auth.login', 'User', user.id, undefined, user.id);
    res.json({ accessToken: signAccess(user), user: publicUser(user) });
  }));

r.post('/register', limiter,
  validate(z.object({ firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60), email: z.string().email().toLowerCase(), password: pwd })),
  asyncHandler(async (req, res) => {
    if (!env.allowRegistration) throw new AppError(403, 'Self registration is disabled. Ask HR to create your account.');
    const { firstName, lastName, email, password } = req.body;
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
    const code = await nextEmployeeCode();
    const user = await prisma.user.create({
      data: {
        email, passwordHash: await bcrypt.hash(password, env.bcryptRounds), roleId: role.id,
        employee: { create: { employeeCode: code, firstName, lastName, email, joiningDate: new Date(), skills: [] } },
      },
      include: { employee: true },
    });
    await ensureLeaveBalances(user.employee!.id);
    audit(req, 'auth.register', 'User', user.id, undefined, user.id);
    res.status(201).json({ message: 'Account created. You can sign in now.' });
  }));

r.post('/refresh', asyncHandler(async (req, res) => {
  const raw = req.cookies?.[COOKIE];
  if (!raw) throw new AppError(401, 'No session');
  const s = await prisma.session.findUnique({ where: { refreshTokenHash: sha(raw) }, include: { user: { include } } });
  if (!s || s.revokedAt || s.expiresAt < new Date() || !s.user.isActive) throw new AppError(401, 'Session expired');
  await prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
  const remember = s.expiresAt.getTime() - s.createdAt.getTime() > env.refreshDays * 864e5 * 1.5;
  await startSession(req, res, s.user, remember);
  res.json({ accessToken: signAccess(s.user), user: publicUser(s.user) });
}));

r.post('/logout', asyncHandler(async (req, res) => {
  const raw = req.cookies?.[COOKIE];
  if (raw) await prisma.session.updateMany({ where: { refreshTokenHash: sha(raw), revokedAt: null }, data: { revokedAt: new Date() } });
  res.clearCookie(COOKIE, { path: '/api/auth' });
  res.json({ ok: true });
}));

r.post('/forgot-password', limiter, validate(z.object({ email: z.string().email() })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } });
    if (user && user.isActive) {
      const raw = crypto.randomBytes(32).toString('hex');
      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha(raw), expiresAt: new Date(Date.now() + 3600e3) } });
      // No paid email service: in development the link is printed in the API terminal.
      console.log(`\n[NEXORA] Password reset link for ${user.email}:\n${env.clientUrl}/reset-password?token=${raw}\n`);
    }
    res.json({ message: 'If that email exists, a reset link has been generated.' });
  }));

r.post('/reset-password', limiter, validate(z.object({ token: z.string().min(10), password: pwd })),
  asyncHandler(async (req, res) => {
    const t = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha(req.body.token) } });
    if (!t || t.usedAt || t.expiresAt < new Date()) throw new AppError(400, 'Reset link is invalid or expired');
    await prisma.$transaction([
      prisma.user.update({ where: { id: t.userId }, data: { passwordHash: await bcrypt.hash(req.body.password, env.bcryptRounds), failedLogins: 0, lockedUntil: null } }),
      prisma.passwordResetToken.update({ where: { id: t.id }, data: { usedAt: new Date() } }),
      prisma.session.updateMany({ where: { userId: t.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    audit(req, 'auth.reset_password', 'User', t.userId, undefined, t.userId);
    res.json({ message: 'Password updated. Please sign in.' });
  }));

r.post('/change-password', authenticate, validate(z.object({ currentPassword: z.string().min(1), newPassword: pwd })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, include });
    if (!(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) throw new AppError(400, 'Current password is incorrect');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(req.body.newPassword, env.bcryptRounds), mustChangePassword: false } });
    await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await startSession(req, res, user, false);
    audit(req, 'auth.change_password', 'User', user.id);
    res.json({ message: 'Password changed' });
  }));

r.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, include });
  res.json({ user: publicUser(user) });
}));

export default r;
