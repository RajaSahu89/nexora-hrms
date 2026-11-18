import bcrypt from 'bcrypt';
import type { CookieOptions, Request, Response } from 'express';
import { env, isProd, toMs } from '../config/env';
import { prisma } from '../config/prisma';
import { createEmployeeWithUser } from '../services/employeeService';
import { asyncHandler } from '../utils/asyncHandler';
import { audit } from '../utils/audit';
import { iso } from '../utils/dates';
import { HttpError } from '../utils/httpError';
import { hashToken, randomToken, signAccess } from '../utils/tokens';

const COOKIE = 'nx_refresh';
const cookieBase: CookieOptions = { httpOnly: true, sameSite: 'strict', secure: isProd, path: '/api/auth' };

async function userPayload(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      role: { include: { permissions: { select: { key: true } } } },
      employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, photoUrl: true, departmentId: true, designation: { select: { title: true } } } },
    },
  });
  return {
    id: u.id, email: u.email, role: u.role.name, mustChangePassword: u.mustChangePassword,
    permissions: u.role.permissions.map((p) => p.key), employee: u.employee,
  };
}

async function startSession(req: Request, res: Response, userId: string, remember: boolean) {
  const token = randomToken();
  const ttl = toMs(remember ? env.JWT_REFRESH_EXPIRES_REMEMBER : env.JWT_REFRESH_EXPIRES);
  const expiresAt = new Date(Date.now() + ttl);
  await prisma.session.create({
    data: { userId, refreshTokenHash: hashToken(token), expiresAt, ip: req.ip, userAgent: (req.headers['user-agent'] ?? '').toString().slice(0, 250) },
  });
  res.cookie(COOKIE, token, remember ? { ...cookieBase, maxAge: ttl } : cookieBase);
}

export const register = asyncHandler(async (req, res) => {
  if (env.ALLOW_REGISTRATION === 'false') throw new HttpError(403, 'Self-registration is disabled. Ask HR to create your account.');
  const { firstName, lastName, email, password } = req.body;
  const emp = await createEmployeeWithUser(
    { firstName, lastName, email, joiningDate: iso(new Date()), employmentType: 'FULL_TIME', employmentStatus: 'ACTIVE', skills: [] },
    'EMPLOYEE', password,
  );
  req.user = { id: emp.userId!, email, role: 'EMPLOYEE', employeeId: emp.id, departmentId: null };
  audit(req, 'auth.register', 'User', emp.userId);
  res.status(201).json({ data: { message: 'Account created. You can sign in now.' } });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password, remember } = req.body;
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  const fail = new HttpError(401, 'Invalid email or password');
  if (!user || !user.isActive) throw fail;
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new HttpError(423, 'Account temporarily locked after too many failed attempts. Try again in a few minutes.');
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    const attempts = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: attempts, lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60000) : null },
    });
    throw fail;
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await startSession(req, res, user.id, !!remember);
  req.user = { id: user.id, email, role: user.role.name, employeeId: null, departmentId: null };
  audit(req, 'auth.login', 'User', user.id);
  res.json({ data: { accessToken: signAccess(user.id, user.role.name), user: await userPayload(user.id) } });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (!token) throw new HttpError(401, 'No session');
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hashToken(token) }, include: { user: { include: { role: true } } } });
  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
    res.clearCookie(COOKIE, cookieBase);
    throw new HttpError(401, 'Session expired');
  }
  const next = randomToken();
  await prisma.session.update({ where: { id: session.id }, data: { refreshTokenHash: hashToken(next) } });
  const persistent = session.expiresAt.getTime() - session.createdAt.getTime() > toMs(env.JWT_REFRESH_EXPIRES) + 1000;
  res.cookie(COOKIE, next, persistent ? { ...cookieBase, maxAge: session.expiresAt.getTime() - Date.now() } : cookieBase);
  res.json({ data: { accessToken: signAccess(session.userId, session.user.role.name), user: await userPayload(session.userId) } });
});

export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (token) await prisma.session.updateMany({ where: { refreshTokenHash: hashToken(token) }, data: { revokedAt: new Date() } });
  res.clearCookie(COOKIE, cookieBase);
  res.json({ data: { message: 'Signed out' } });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ data: await userPayload(req.user!.id) });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { email: req.body.email } });
  const out: Record<string, unknown> = { message: 'If that email exists, a reset link has been generated.' };
  if (user && user.isActive) {
    const token = randomToken();
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60000) } });
    const link = `${env.CLIENT_URL}/forgot-password?token=${token}`;
    // No email provider is configured (keeps the project free). In development the link is
    // printed to the server console and returned so you can test the flow.
    console.log(`[password reset] ${user.email}: ${link}`);
    if (!isProd) out.devResetLink = link;
  }
  res.json({ data: out });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const rec = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(req.body.token) } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw new HttpError(400, 'Reset link is invalid or has expired');
  const passwordHash = await bcrypt.hash(req.body.password, env.BCRYPT_ROUNDS);
  await prisma.$transaction([
    prisma.user.update({ where: { id: rec.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null, mustChangePassword: false } }),
    prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    prisma.session.updateMany({ where: { userId: rec.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  res.json({ data: { message: 'Password updated. Please sign in.' } });
});

export const changePassword = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) throw new HttpError(400, 'Current password is incorrect');
  const passwordHash = await bcrypt.hash(req.body.newPassword, env.BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
  const token = req.cookies?.[COOKIE];
  await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null, ...(token ? { NOT: { refreshTokenHash: hashToken(token) } } : {}) },
    data: { revokedAt: new Date() },
  });
  audit(req, 'auth.change_password', 'User', user.id);
  res.json({ data: { message: 'Password changed' } });
});
