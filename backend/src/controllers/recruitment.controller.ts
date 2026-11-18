import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { parseOrThrow } from '../middleware/validate';
import { interviewSchema, interviewUpdateSchema, stageSchema, vacancySchema } from '../validators';
import { asyncHandler } from '../utils/asyncHandler';
import { audit } from '../utils/audit';
import { parseDate } from '../utils/dates';
import { badRequest, notFound } from '../utils/httpError';
import { storage } from '../utils/storage';
import { z } from 'zod';

const vacData = (b: z.infer<typeof vacancySchema>) => ({ ...b, closingDate: b.closingDate ? parseDate(b.closingDate) : null });

export const listVacancies = asyncHandler(async (_req, res) => {
  res.json({ data: await prisma.jobVacancy.findMany({ include: { department: { select: { name: true } }, designation: { select: { title: true } }, _count: { select: { applications: true } } }, orderBy: { createdAt: 'desc' } }) });
});
export const createVacancy = asyncHandler(async (req, res) => {
  const v = await prisma.jobVacancy.create({ data: vacData(parseOrThrow(vacancySchema, req.body)) });
  audit(req, 'vacancy.create', 'JobVacancy', v.id);
  res.status(201).json({ data: v });
});
export const updateVacancy = asyncHandler(async (req, res) => {
  const v = await prisma.jobVacancy.update({ where: { id: req.params.id }, data: vacData(parseOrThrow(vacancySchema, req.body)) });
  audit(req, 'vacancy.update', 'JobVacancy', v.id);
  res.json({ data: v });
});
export const deleteVacancy = asyncHandler(async (req, res) => {
  const apps = await prisma.application.findMany({ where: { vacancyId: req.params.id }, include: { candidate: true } });
  await prisma.jobVacancy.delete({ where: { id: req.params.id } });
  audit(req, 'vacancy.delete', 'JobVacancy', req.params.id);
  res.json({ data: { message: `Vacancy deleted (${apps.length} application(s) removed)` } });
});

export const board = asyncHandler(async (req, res) => {
  const where: Prisma.ApplicationWhereInput = req.query.vacancyId ? { vacancyId: String(req.query.vacancyId) } : {};
  const rows = await prisma.application.findMany({
    where, orderBy: [{ position: 'asc' }, { appliedAt: 'desc' }],
    include: {
      candidate: { select: { id: true, fullName: true, email: true, phone: true, skills: true, experienceYears: true, resumePath: true } },
      vacancy: { select: { id: true, title: true } },
      interviews: { orderBy: { scheduledAt: 'desc' }, include: { interviewer: { select: { firstName: true, lastName: true } } } },
    },
  });
  res.json({ data: rows.map(({ candidate: { resumePath, ...c }, ...a }) => ({ ...a, candidate: { ...c, hasResume: !!resumePath } })) });
});

const appBody = z.object({
  vacancyId: z.string().min(1), fullName: z.string().trim().min(1).max(100), email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(30).optional(), skills: z.string().optional(), experienceYears: z.coerce.number().min(0).max(60).optional(), coverNote: z.string().max(1500).optional(),
});

export const addApplication = asyncHandler(async (req, res) => {
  const b = (() => { try { return appBody.parse(req.body); } catch (e: any) { storage.remove(req.file ? `resumes/${req.file.filename}` : null); throw badRequest(e.errors?.[0]?.message ?? 'Invalid data'); } })();
  const vacancy = await prisma.jobVacancy.findUnique({ where: { id: b.vacancyId } });
  if (!vacancy) { storage.remove(req.file ? `resumes/${req.file.filename}` : null); throw notFound('Vacancy not found'); }
  const skills = (b.skills ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30);
  const existing = await prisma.candidate.findUnique({ where: { email: b.email } });
  if (existing && req.file) storage.remove(existing.resumePath);
  const candidate = await prisma.candidate.upsert({
    where: { email: b.email },
    update: { fullName: b.fullName, phone: b.phone, skills, experienceYears: b.experienceYears, ...(req.file ? { resumePath: `resumes/${req.file.filename}` } : {}) },
    create: { fullName: b.fullName, email: b.email, phone: b.phone, skills, experienceYears: b.experienceYears, resumePath: req.file ? `resumes/${req.file.filename}` : null },
  });
  if (await prisma.application.count({ where: { candidateId: candidate.id, vacancyId: b.vacancyId } })) throw badRequest('This candidate already applied for this vacancy');
  const app = await prisma.application.create({ data: { candidateId: candidate.id, vacancyId: b.vacancyId, coverNote: b.coverNote } });
  audit(req, 'application.create', 'Application', app.id);
  res.status(201).json({ data: app });
});

export const moveStage = asyncHandler(async (req, res) => {
  const { stage } = parseOrThrow(stageSchema, req.body);
  const app = await prisma.application.update({ where: { id: req.params.id }, data: { stage, position: 0 } });
  audit(req, 'application.stage', 'Application', app.id, { stage });
  res.json({ data: app });
});

export const resume = asyncHandler(async (req, res) => {
  const c = await prisma.candidate.findUnique({ where: { id: req.params.id } });
  if (!c?.resumePath) throw notFound('No resume uploaded');
  audit(req, 'candidate.resume_download', 'Candidate', c.id);
  res.download(storage.resolve(c.resumePath), `${c.fullName.replace(/[^\w]+/g, '_')}-resume${c.resumePath.slice(c.resumePath.lastIndexOf('.'))}`);
});

export const scheduleInterview = asyncHandler(async (req, res) => {
  const b = parseOrThrow(interviewSchema, req.body);
  const when = new Date(b.scheduledAt);
  if (isNaN(when.getTime())) throw badRequest('Invalid interview date/time');
  const iv = await prisma.interview.create({ data: { applicationId: req.params.id, scheduledAt: when, mode: b.mode, location: b.location, interviewerId: b.interviewerId ?? null } });
  await prisma.application.updateMany({ where: { id: req.params.id, stage: { in: ['APPLIED', 'SCREENING', 'SHORTLISTED'] } }, data: { stage: 'INTERVIEW' } });
  audit(req, 'interview.schedule', 'Interview', iv.id);
  res.status(201).json({ data: iv });
});

export const updateInterview = asyncHandler(async (req, res) => {
  const iv = await prisma.interview.update({ where: { id: req.params.id }, data: parseOrThrow(interviewUpdateSchema, req.body) });
  audit(req, 'interview.update', 'Interview', iv.id);
  res.json({ data: iv });
});
