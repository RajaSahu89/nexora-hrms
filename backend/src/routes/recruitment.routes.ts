import { Router } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError, asyncHandler } from '../utils/http';
import { validate } from '../middleware/validate';
import { audit } from '../utils/audit';
import { RESUME_MIMES, makeUpload, removeFile, uploadPath, verifyUpload } from '../utils/upload';
import { optNum, optStr } from '../validators/common';

const r = Router(); // mounted behind HR-only guard in app.ts
const STAGES = ['APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED', 'HIRED'] as const;

r.get('/vacancies', asyncHandler(async (_req, res) => {
  res.json(await prisma.jobVacancy.findMany({ include: { department: { select: { name: true } }, designation: { select: { title: true } }, _count: { select: { applications: true } } }, orderBy: { createdAt: 'desc' } }));
}));
const vac = z.object({
  title: z.string().trim().min(3).max(100), description: z.string().trim().min(10).max(5000), requirements: optStr(3000),
  departmentId: optStr(40), designationId: optStr(40), location: optStr(80), employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).default('FULL_TIME'),
  openings: z.coerce.number().int().min(1).max(500).default(1), status: z.enum(['DRAFT', 'OPEN', 'CLOSED']).default('OPEN'), closingDate: optStr(10),
});
const vdata = (b: any) => ({ ...b, ...(b.closingDate !== undefined ? { closingDate: b.closingDate ? new Date(b.closingDate) : null } : {}) });
r.post('/vacancies', validate(vac), asyncHandler(async (req, res) => { const v = await prisma.jobVacancy.create({ data: vdata(req.body) }); audit(req, 'vacancy.create', 'JobVacancy', v.id); res.status(201).json(v); }));
r.put('/vacancies/:id', validate(vac.partial()), asyncHandler(async (req, res) => res.json(await prisma.jobVacancy.update({ where: { id: req.params.id }, data: vdata(req.body) }))));
r.delete('/vacancies/:id', asyncHandler(async (req, res) => { await prisma.jobVacancy.delete({ where: { id: req.params.id } }); audit(req, 'vacancy.delete', 'JobVacancy', req.params.id); res.json({ ok: true }); }));

r.get('/board', asyncHandler(async (req, res) => {
  const vacancyId = req.query.vacancyId as string | undefined;
  const apps = await prisma.application.findMany({
    where: vacancyId ? { vacancyId } : {},
    include: { candidate: { select: { id: true, fullName: true, email: true, phone: true, skills: true, resumePath: true, experienceYears: true } }, vacancy: { select: { id: true, title: true } }, interviews: { orderBy: { scheduledAt: 'asc' } } },
    orderBy: [{ position: 'asc' }, { appliedAt: 'desc' }],
  });
  res.json(apps.map((a) => ({ ...a, candidate: { ...a.candidate, hasResume: !!a.candidate.resumePath, resumePath: undefined } })));
}));

r.post('/applications', makeUpload('resumes', RESUME_MIMES), verifyUpload, asyncHandler(async (req, res) => {
  try {
    const b = z.object({
      fullName: z.string().trim().min(2).max(100), email: z.string().email().toLowerCase(), phone: optStr(20), vacancyId: z.string().min(1),
      skills: z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []), z.array(z.string().max(40)).max(30)),
      experienceYears: optNum, coverNote: optStr(1000),
    }).parse(req.body);
    const cand = await prisma.candidate.upsert({
      where: { email: b.email },
      update: { fullName: b.fullName, phone: b.phone, skills: b.skills, experienceYears: b.experienceYears, ...(req.file ? { resumePath: req.file.filename } : {}) },
      create: { fullName: b.fullName, email: b.email, phone: b.phone, skills: b.skills, experienceYears: b.experienceYears, resumePath: req.file?.filename },
    });
    const app = await prisma.application.create({ data: { candidateId: cand.id, vacancyId: b.vacancyId, coverNote: b.coverNote } });
    audit(req, 'application.create', 'Application', app.id);
    res.status(201).json(app);
  } catch (e) { removeFile(req.file?.path); throw e; }
}));

r.patch('/applications/:id/stage', validate(z.object({ stage: z.enum(STAGES), position: z.coerce.number().int().min(0).default(0) })), asyncHandler(async (req, res) => {
  const a = await prisma.application.update({ where: { id: req.params.id }, data: req.body });
  audit(req, 'application.stage', 'Application', a.id, { stage: a.stage });
  res.json(a);
}));
r.delete('/applications/:id', asyncHandler(async (req, res) => { await prisma.application.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }));

r.post('/interviews', validate(z.object({ applicationId: z.string(), scheduledAt: z.string().min(10), interviewerId: optStr(40), mode: optStr(30), location: optStr(120) })), asyncHandler(async (req, res) => {
  const when = new Date(req.body.scheduledAt);
  if (isNaN(+when) || when < new Date()) throw new AppError(400, 'Interview must be scheduled in the future');
  const i = await prisma.interview.create({ data: { ...req.body, scheduledAt: when } });
  await prisma.application.update({ where: { id: req.body.applicationId }, data: { stage: 'INTERVIEW' } });
  audit(req, 'interview.schedule', 'Interview', i.id);
  res.status(201).json(i);
}));
r.patch('/interviews/:id', validate(z.object({ status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(), rating: z.coerce.number().int().min(1).max(5).optional(), feedback: optStr(2000) })), asyncHandler(async (req, res) => {
  res.json(await prisma.interview.update({ where: { id: req.params.id }, data: req.body }));
}));

r.get('/candidates/:id/resume', asyncHandler(async (req, res) => {
  const c = await prisma.candidate.findUnique({ where: { id: req.params.id } });
  if (!c?.resumePath) throw new AppError(404, 'No resume uploaded');
  const p = uploadPath('resumes', c.resumePath);
  if (!fs.existsSync(p)) throw new AppError(404, 'File missing');
  res.download(p, `${c.fullName.replace(/\W+/g, '_')}-resume${c.resumePath.slice(c.resumePath.lastIndexOf('.'))}`);
}));

export default r;
