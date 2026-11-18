import { Router } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError, asyncHandler } from '../utils/http';
import { validate } from '../middleware/validate';
import { HR, requireRole } from '../middleware/auth';
import { isHR } from '../utils/scope';
import { audit } from '../utils/audit';
import { DOC_MIMES, makeUpload, removeFile, uploadPath, verifyUpload } from '../utils/upload';
import { employeeUserId, notifyUsers } from '../utils/notify';

const r = Router();
const inc = { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } } as const;
const CATS = ['OFFER_LETTER', 'APPOINTMENT_LETTER', 'EXPERIENCE_CERTIFICATE', 'IDENTITY', 'POLICY', 'OTHER'] as const;

const mineOrShared = (a: any) => ({ OR: [{ employeeId: a.employeeId ?? '__none__' }, { employeeId: null, visibility: 'ALL_EMPLOYEES' as const }, { visibility: 'ALL_EMPLOYEES' as const }] });
const canAccess = (a: any, d: any) => isHR(a.role) || d.employeeId === a.employeeId || d.visibility === 'ALL_EMPLOYEES';

r.get('/', asyncHandler(async (req, res) => {
  const q: any = req.query;
  const where: any = { AND: [isHR(req.auth!.role) ? {} : mineOrShared(req.auth), ...(q.category ? [{ category: q.category }] : []), ...(q.employeeId && isHR(req.auth!.role) ? [{ employeeId: q.employeeId }] : [])] };
  res.json(await prisma.document.findMany({ where, include: inc, orderBy: { createdAt: 'desc' }, take: 200 }));
}));

r.get('/expiring', requireRole(...HR), asyncHandler(async (_req, res) => {
  res.json(await prisma.document.findMany({ where: { expiresAt: { lte: new Date(Date.now() + 30 * 864e5) } }, include: inc, orderBy: { expiresAt: 'asc' } }));
}));

r.post('/', makeUpload('documents', DOC_MIMES), verifyUpload, asyncHandler(async (req, res) => {
  const f = req.file;
  if (!f) throw new AppError(400, 'No file uploaded');
  try {
    const b = z.object({
      title: z.string().trim().min(2).max(120), category: z.enum(CATS).default('OTHER'),
      employeeId: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
      visibility: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['PRIVATE_EMPLOYEE', 'HR_ONLY', 'ALL_EMPLOYEES']).optional()),
      expiresAt: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    }).parse(req.body);
    const hr = isHR(req.auth!.role);
    let employeeId = b.employeeId, visibility = b.visibility ?? 'PRIVATE_EMPLOYEE';
    if (!hr) { // employees can only upload their own non-policy files
      employeeId = req.auth!.employeeId; visibility = 'PRIVATE_EMPLOYEE';
      if (b.category === 'POLICY' || !employeeId) throw new AppError(403, 'Forbidden');
    }
    const d = await prisma.document.create({
      data: { title: b.title, category: b.category, filePath: f.filename, mimeType: f.mimetype, sizeBytes: f.size, visibility, employeeId: employeeId ?? null, uploadedById: req.auth!.employeeId ?? null, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null },
      include: inc,
    });
    if (hr && employeeId) { const uid = await employeeUserId(employeeId); if (uid) await notifyUsers([uid], 'SYSTEM', 'New document', d.title, '/documents'); }
    audit(req, 'document.upload', 'Document', d.id);
    res.status(201).json(d);
  } catch (e) { removeFile(f.path); throw e; }
}));

r.get('/:id/download', asyncHandler(async (req, res) => {
  const d = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!d || !canAccess(req.auth, d)) throw new AppError(404, 'Document not found');
  const p = uploadPath('documents', d.filePath);
  if (!fs.existsSync(p)) throw new AppError(404, 'File missing on server');
  audit(req, 'document.download', 'Document', d.id);
  res.download(p, `${d.title.replace(/[^\w.-]+/g, '_')}${d.filePath.slice(d.filePath.lastIndexOf('.'))}`);
}));

r.delete('/:id', asyncHandler(async (req, res) => {
  const d = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!d) throw new AppError(404, 'Document not found');
  const own = d.employeeId === req.auth!.employeeId && d.uploadedById === req.auth!.employeeId;
  if (!isHR(req.auth!.role) && !own) throw new AppError(403, 'Forbidden');
  await prisma.document.delete({ where: { id: d.id } });
  removeFile(uploadPath('documents', d.filePath));
  audit(req, 'document.delete', 'Document', d.id);
  res.json({ ok: true });
}));

export default r;
