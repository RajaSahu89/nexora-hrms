import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { parseOrThrow } from '../middleware/validate';
import { documentMetaSchema } from '../validators';
import { asyncHandler } from '../utils/asyncHandler';
import { audit } from '../utils/audit';
import { parseDate } from '../utils/dates';
import { badRequest, forbidden, notFound } from '../utils/httpError';
import { isHR } from '../utils/scope';
import { storage } from '../utils/storage';

type U = NonNullable<Express.Request['user']>;
const visibleTo = (u: U): Prisma.DocumentWhereInput => {
  if (isHR(u)) return {};
  return { OR: [{ employeeId: u.employeeId ?? '__none__', visibility: { not: 'HR_ONLY' } }, { visibility: 'ALL_EMPLOYEES' }] };
};

export const list = asyncHandler(async (req, res) => {
  const u = req.user!;
  const q = req.query as Record<string, string>;
  const and: Prisma.DocumentWhereInput[] = [visibleTo(u)];
  if (q.employeeId) and.push({ employeeId: q.employeeId });
  if (q.company === '1') and.push({ employeeId: null });
  if (q.category) and.push({ category: q.category as any });
  const rows = await prisma.document.findMany({
    where: { AND: and }, orderBy: { createdAt: 'desc' }, take: 500,
    include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } },
  });
  res.json({ data: rows.map(({ filePath, ...d }) => d) });
});

export const upload = asyncHandler(async (req, res) => {
  const u = req.user!;
  const rel = req.file ? `documents/${req.file.filename}` : null;
  try {
    if (!req.file) throw badRequest('Choose a file to upload');
    const b = parseOrThrow(documentMetaSchema, req.body);
    let employeeId = b.employeeId ?? null;
    if (!isHR(u)) {
      // Non-HR users can only upload personal documents for themselves.
      if (!u.employeeId || (employeeId && employeeId !== u.employeeId)) throw forbidden();
      if (!['IDENTITY', 'OTHER'].includes(b.category)) throw forbidden('You can only upload identity or other personal documents');
      employeeId = u.employeeId;
    }
    const doc = await prisma.document.create({
      data: {
        title: b.title, category: b.category, filePath: rel!, mimeType: req.file.mimetype, sizeBytes: req.file.size, employeeId,
        visibility: !employeeId && b.category === 'POLICY' ? 'ALL_EMPLOYEES' : isHR(u) ? b.visibility : 'PRIVATE_EMPLOYEE',
        uploadedById: u.employeeId, expiresAt: b.expiresAt ? parseDate(b.expiresAt) : null,
      },
    });
    audit(req, 'document.upload', 'Document', doc.id, { category: b.category });
    res.status(201).json({ data: { ...doc, filePath: undefined } });
  } catch (e) { storage.remove(rel); throw e; }
});

export const download = asyncHandler(async (req, res) => {
  const doc = await prisma.document.findFirst({ where: { AND: [{ id: req.params.id }, visibleTo(req.user!)] } });
  if (!doc) throw notFound('Document not found');
  audit(req, 'document.download', 'Document', doc.id);
  res.download(storage.resolve(doc.filePath), `${doc.title.replace(/[^\w\- ]+/g, '_')}${doc.filePath.slice(doc.filePath.lastIndexOf('.'))}`);
});

export const remove = asyncHandler(async (req, res) => {
  const u = req.user!;
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc) throw notFound('Document not found');
  if (!isHR(u) && !(doc.uploadedById === u.employeeId && doc.employeeId === u.employeeId)) throw forbidden();
  await prisma.document.delete({ where: { id: doc.id } });
  storage.remove(doc.filePath);
  audit(req, 'document.delete', 'Document', doc.id);
  res.json({ data: { message: 'Document deleted' } });
});
