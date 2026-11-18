import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError, asyncHandler } from '../utils/http';
import { validate } from '../middleware/validate';
import { HR, requireRole } from '../middleware/auth';
import { isHR } from '../utils/scope';
import { audit } from '../utils/audit';
import { getSetting } from '../utils/employees';
import { employeeUserId, notifyUsers } from '../utils/notify';
import { optNum } from '../validators/common';

const r = Router();
const CFG = { hraPercentOfBasic: 40, taxPercent: 10, overtimeMultiplier: 1.5, workingDaysPerMonth: 22 };
const round = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const periodSchema = z.object({ month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(2000).max(2100) });
const inc = { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } } }, payslip: true } as const;

const compute = (p: { basic: number; allowances: number; fixedDeductions: number; bonuses: number; overtimeMinutes: number }, cfg: typeof CFG) => {
  const hra = round(p.basic * cfg.hraPercentOfBasic / 100);
  const hourly = p.basic / (cfg.workingDaysPerMonth * 8);
  const overtimePay = round((p.overtimeMinutes / 60) * hourly * cfg.overtimeMultiplier);
  const grossPay = round(p.basic + hra + p.allowances + p.bonuses + overtimePay);
  const tax = round(grossPay * cfg.taxPercent / 100);
  return { hra, overtimePay, grossPay, tax, deductions: round(p.fixedDeductions), netPay: round(grossPay - tax - p.fixedDeductions) };
};

// ---- Salary structure (HR only; employees may read their own) ----
r.get('/salary/:employeeId', asyncHandler(async (req, res) => {
  if (!isHR(req.auth!.role) && req.params.employeeId !== req.auth!.employeeId) throw new AppError(403, 'Forbidden');
  const rows = await prisma.salaryComponent.findMany({ where: { employeeId: req.params.employeeId }, orderBy: { effectiveFrom: 'desc' } });
  res.json({ current: rows.filter((c) => !c.effectiveTo), history: rows });
}));

r.put('/salary/:employeeId', requireRole(...HR), validate(z.object({ basic: z.coerce.number().positive().max(1e9), allowances: optNum, fixedDeductions: optNum })), asyncHandler(async (req, res) => {
  const employeeId = req.params.employeeId;
  const now = new Date(); const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const defs = [['Basic', 'EARNING', req.body.basic], ['Allowances', 'EARNING', req.body.allowances ?? 0], ['Fixed Deductions', 'DEDUCTION', req.body.fixedDeductions ?? 0]] as const;
  await prisma.$transaction(async (tx) => {
    await tx.salaryComponent.updateMany({ where: { employeeId, effectiveTo: null }, data: { effectiveTo: today } });
    for (const [name, type, amount] of defs) await tx.salaryComponent.create({ data: { employeeId, name, type, amount, effectiveFrom: today } });
  });
  audit(req, 'salary.update', 'Employee', employeeId);
  res.json({ ok: true });
}));

// ---- Payroll runs ----
r.get('/', requireRole(...HR), asyncHandler(async (req, res) => {
  const q: any = req.query;
  res.json(await prisma.payroll.findMany({
    where: { ...(q.month ? { month: Number(q.month) } : {}), ...(q.year ? { year: Number(q.year) } : {}), ...(q.status ? { status: q.status } : {}), ...(q.departmentId ? { employee: { departmentId: q.departmentId } } : {}) },
    include: inc, orderBy: [{ year: 'desc' }, { month: 'desc' }, { employee: { firstName: 'asc' } }],
  }));
}));

r.get('/my', asyncHandler(async (req, res) => {
  if (!req.auth!.employeeId) return res.json([]);
  res.json(await prisma.payroll.findMany({ where: { employeeId: req.auth!.employeeId, status: { in: ['FINALIZED', 'PAID'] } }, include: inc, orderBy: [{ year: 'desc' }, { month: 'desc' }] }));
}));

r.post('/generate', requireRole(...HR), validate(periodSchema), asyncHandler(async (req, res) => {
  const { month, year } = req.body;
  const cfg = await getSetting('payroll.config', CFG);
  const from = new Date(Date.UTC(year, month - 1, 1)), to = new Date(Date.UTC(year, month, 0));
  const emps = await prisma.employee.findMany({
    where: { employmentStatus: 'ACTIVE' },
    select: { id: true, salaryComponents: { where: { effectiveTo: null } }, attendance: { where: { date: { gte: from, lte: to } }, select: { overtimeMinutes: true } } },
  });
  let created = 0, skipped = 0, noSalary = 0;
  for (const e of emps) {
    const amt = (n: string) => Number(e.salaryComponents.find((c) => c.name === n)?.amount ?? 0);
    if (!amt('Basic')) { noSalary++; continue; }
    const existing = await prisma.payroll.findUnique({ where: { employeeId_month_year: { employeeId: e.id, month, year } } });
    if (existing && existing.status !== 'ESTIMATED') { skipped++; continue; }
    const c = compute({ basic: amt('Basic'), allowances: amt('Allowances'), fixedDeductions: amt('Fixed Deductions'), bonuses: Number(existing?.bonuses ?? 0), overtimeMinutes: e.attendance.reduce((s, a) => s + a.overtimeMinutes, 0) }, cfg);
    const data = { basicSalary: amt('Basic'), allowances: amt('Allowances'), bonuses: Number(existing?.bonuses ?? 0), ...c };
    await prisma.payroll.upsert({ where: { employeeId_month_year: { employeeId: e.id, month, year } }, update: data, create: { employeeId: e.id, month, year, ...data } });
    created++;
  }
  audit(req, 'payroll.generate', 'Payroll', undefined, { month, year, created });
  res.json({ created, skipped, noSalary });
}));

r.patch('/:id', requireRole(...HR), validate(z.object({ bonuses: optNum, deductions: optNum })), asyncHandler(async (req, res) => {
  const p = await prisma.payroll.findUniqueOrThrow({ where: { id: req.params.id } });
  if (p.status !== 'ESTIMATED') throw new AppError(409, 'Finalized payroll cannot be edited');
  const bonuses = req.body.bonuses ?? Number(p.bonuses), deductions = req.body.deductions ?? Number(p.deductions);
  const gross = round(Number(p.basicSalary) + Number(p.hra) + Number(p.allowances) + bonuses + Number(p.overtimePay));
  const cfg = await getSetting('payroll.config', CFG);
  const tax = round(gross * cfg.taxPercent / 100);
  res.json(await prisma.payroll.update({ where: { id: p.id }, data: { bonuses, deductions, grossPay: gross, tax, netPay: round(gross - tax - deductions) } }));
}));

const finalizeOne = async (id: string, userId: string) => {
  const p = await prisma.payroll.update({ where: { id }, data: { status: 'FINALIZED', finalizedAt: new Date(), finalizedById: userId } });
  await prisma.payslip.upsert({ where: { payrollId: id }, update: {}, create: { payrollId: id } });
  const uid = await employeeUserId(p.employeeId);
  if (uid) await notifyUsers([uid], 'PAYROLL_UPDATE', 'Payslip available', `Your payslip for ${MONTHS[p.month - 1]} ${p.year} is ready.`, '/payroll');
};
r.post('/finalize-all', requireRole(...HR), validate(periodSchema), asyncHandler(async (req, res) => {
  const rows = await prisma.payroll.findMany({ where: { ...req.body, status: 'ESTIMATED' }, select: { id: true } });
  for (const p of rows) await finalizeOne(p.id, req.auth!.userId);
  audit(req, 'payroll.finalize_all', 'Payroll', undefined, { ...req.body, count: rows.length });
  res.json({ finalized: rows.length });
}));
r.post('/:id/finalize', requireRole(...HR), asyncHandler(async (req, res) => {
  const p = await prisma.payroll.findUniqueOrThrow({ where: { id: req.params.id } });
  if (p.status !== 'ESTIMATED') throw new AppError(409, 'Already finalized');
  await finalizeOne(p.id, req.auth!.userId);
  audit(req, 'payroll.finalize', 'Payroll', p.id);
  res.json({ ok: true });
}));
r.post('/:id/mark-paid', requireRole(...HR), asyncHandler(async (req, res) => {
  const p = await prisma.payroll.findUniqueOrThrow({ where: { id: req.params.id } });
  if (p.status !== 'FINALIZED') throw new AppError(409, 'Only finalized payroll can be marked paid');
  await prisma.payroll.update({ where: { id: p.id }, data: { status: 'PAID' } });
  res.json({ ok: true });
}));

r.get('/:id/payslip.pdf', asyncHandler(async (req, res) => {
  const p = await prisma.payroll.findUnique({ where: { id: req.params.id }, include: { employee: { include: { department: true, designation: true } } } });
  if (!p) throw new AppError(404, 'Payslip not found');
  const hr = isHR(req.auth!.role);
  if (!hr && p.employeeId !== req.auth!.employeeId) throw new AppError(403, 'Forbidden');
  if (!hr && p.status === 'ESTIMATED') throw new AppError(403, 'Payslip is not finalized yet');
  const company: any = await getSetting('company.profile', { name: 'Nexora', currency: 'INR' });
  const cur = company.currency ?? 'INR';
  const money = (n: any) => `${cur} ${Number(n).toFixed(2)}`;
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payslip-${p.employee.employeeCode}-${p.year}-${String(p.month).padStart(2, '0')}.pdf"`);
  doc.pipe(res);
  doc.fontSize(20).text(company.name ?? 'Nexora', { align: 'center' }).fontSize(12).fillColor('#555').text(`Payslip - ${MONTHS[p.month - 1]} ${p.year}`, { align: 'center' });
  if (p.status === 'ESTIMATED') doc.fillColor('#E4002B').fontSize(11).text('ESTIMATED - NOT FINAL', { align: 'center' });
  doc.moveDown().fillColor('#000').fontSize(11);
  doc.text(`Employee: ${p.employee.firstName} ${p.employee.lastName} (${p.employee.employeeCode})`);
  doc.text(`Department: ${p.employee.department?.name ?? '-'}    Designation: ${p.employee.designation?.title ?? '-'}`).moveDown();
  const row = (k: string, v: string, bold = false) => { const y = doc.y; doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(k, 50, y).text(v, 350, y, { width: 190, align: 'right' }); doc.moveDown(0.3); };
  doc.font('Helvetica-Bold').text('Earnings').moveDown(0.3);
  row('Basic salary', money(p.basicSalary)); row('HRA', money(p.hra)); row('Allowances', money(p.allowances)); row('Bonuses', money(p.bonuses)); row('Overtime', money(p.overtimePay));
  row('Gross pay', money(p.grossPay), true); doc.moveDown(0.5);
  doc.font('Helvetica-Bold').text('Deductions').moveDown(0.3);
  row('Tax', money(p.tax)); row('Other deductions', money(p.deductions)); doc.moveDown(0.5);
  row('NET PAY', money(p.netPay), true);
  doc.moveDown(2).font('Helvetica').fontSize(8).fillColor('#777').text('This is a system generated payslip.');
  doc.end();
  await prisma.payslip.updateMany({ where: { payrollId: p.id }, data: { generatedAt: new Date() } });
}));

export default r;
