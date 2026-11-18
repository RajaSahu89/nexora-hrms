import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { parseOrThrow } from '../middleware/validate';
import { payrollRunSchema, structureSchema } from '../validators';
import { streamPayslip } from '../services/pdfService';
import { computePayroll } from '../services/payrollService';
import { asyncHandler } from '../utils/asyncHandler';
import { audit } from '../utils/audit';
import { badRequest, forbidden, notFound } from '../utils/httpError';
import { notify, userIdsOfEmployees } from '../utils/notify';
import { isHR } from '../utils/scope';
import { getSetting } from '../utils/settings';

const empInclude = { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } }, designation: { select: { title: true } } } } };
const num = (p: any) => ({ ...p, basicSalary: Number(p.basicSalary), hra: Number(p.hra), allowances: Number(p.allowances), bonuses: Number(p.bonuses), overtimePay: Number(p.overtimePay), deductions: Number(p.deductions), tax: Number(p.tax), grossPay: Number(p.grossPay), netPay: Number(p.netPay) });

export const list = asyncHandler(async (req, res) => {
  const u = req.user!;
  const q = req.query as Record<string, string>;
  const where: Prisma.PayrollWhereInput = {};
  if (isHR(u)) {
    if (q.employeeId) where.employeeId = q.employeeId;
    if (q.status) where.status = q.status as any;
  } else {
    // Sensitive: everyone else sees only their own FINALIZED/PAID payroll, never estimates.
    where.employeeId = u.employeeId ?? '__none__';
    where.status = { in: ['FINALIZED', 'PAID'] };
  }
  if (q.month) where.month = Number(q.month);
  if (q.year) where.year = Number(q.year);
  const rows = await prisma.payroll.findMany({ where, include: empInclude, orderBy: [{ year: 'desc' }, { month: 'desc' }, { employee: { firstName: 'asc' } }], take: 1000 });
  res.json({ data: rows.map(num) });
});

export const getStructure = asyncHandler(async (req, res) => {
  const u = req.user!;
  const id = req.params.employeeId === 'me' ? u.employeeId : req.params.employeeId;
  if (!id || (!isHR(u) && id !== u.employeeId)) throw forbidden();
  const rows = await prisma.salaryComponent.findMany({ where: { employeeId: id }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  res.json({ data: rows.map((r) => ({ ...r, amount: Number(r.amount) })) });
});

export const saveStructure = asyncHandler(async (req, res) => {
  const { components } = parseOrThrow(structureSchema, req.body);
  const employeeId = req.params.employeeId;
  const names = components.map((c) => c.name.toLowerCase());
  if (new Set(names).size !== names.length) throw badRequest('Component names must be unique');
  if (components.length && !names.includes('basic')) throw badRequest('A component named "Basic" is required');
  await prisma.$transaction([
    prisma.salaryComponent.deleteMany({ where: { employeeId } }),
    prisma.salaryComponent.createMany({ data: components.map((c) => ({ ...c, employeeId, effectiveFrom: new Date(Date.UTC(2000, 0, 1)) })) }),
  ]);
  audit(req, 'payroll.structure_update', 'Employee', employeeId, { components: components.length });
  res.json({ data: { message: 'Salary structure saved' } });
});

export const generate = asyncHandler(async (req, res) => {
  const { month, year, employeeIds, bonuses } = parseOrThrow(payrollRunSchema, req.body);
  const emps = await prisma.employee.findMany({
    where: { employmentStatus: { in: ['ACTIVE', 'ON_LEAVE'] }, ...(employeeIds ? { id: { in: employeeIds } } : {}) }, select: { id: true },
  });
  let generated = 0, skippedFinal = 0, noStructure = 0;
  for (const e of emps) {
    const existing = await prisma.payroll.findUnique({ where: { employeeId_month_year: { employeeId: e.id, month, year } } });
    if (existing && existing.status !== 'ESTIMATED') { skippedFinal++; continue; }
    const bonus = bonuses?.[e.id] ?? (existing ? Number(existing.bonuses) : 0);
    const calc = await computePayroll(e.id, month, year, bonus);
    if (!calc) { noStructure++; continue; }
    await prisma.payroll.upsert({
      where: { employeeId_month_year: { employeeId: e.id, month, year } }, update: calc, create: { employeeId: e.id, month, year, status: 'ESTIMATED', ...calc },
    });
    generated++;
  }
  audit(req, 'payroll.generate', 'Payroll', null, { month, year, generated });
  res.json({ data: { generated, skippedFinal, noStructure } });
});

export const finalize = asyncHandler(async (req, res) => {
  const { month, year, employeeIds } = parseOrThrow(payrollRunSchema, req.body);
  const rows = await prisma.payroll.findMany({ where: { month, year, status: 'ESTIMATED', ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) } });
  if (!rows.length) throw badRequest('No estimated payroll found for that period. Generate it first.');
  await prisma.$transaction([
    prisma.payroll.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'FINALIZED', finalizedAt: new Date(), finalizedById: req.user!.id } }),
    ...rows.map((r) => prisma.payslip.upsert({ where: { payrollId: r.id }, update: {}, create: { payrollId: r.id } })),
  ]);
  await notify(await userIdsOfEmployees(rows.map((r) => r.employeeId)), { type: 'PAYROLL_UPDATE', title: 'Payslip available', message: `Your payslip for ${month}/${year} is ready.`, link: '/payroll' });
  audit(req, 'payroll.finalize', 'Payroll', null, { month, year, count: rows.length });
  res.json({ data: { finalized: rows.length } });
});

export const markPaid = asyncHandler(async (req, res) => {
  const { month, year } = parseOrThrow(payrollRunSchema, req.body);
  const r = await prisma.payroll.updateMany({ where: { month, year, status: 'FINALIZED' }, data: { status: 'PAID' } });
  audit(req, 'payroll.mark_paid', 'Payroll', null, { month, year, count: r.count });
  res.json({ data: { paid: r.count } });
});

export const payslipPdf = asyncHandler(async (req, res) => {
  const u = req.user!;
  const p = await prisma.payroll.findUnique({ where: { id: req.params.id }, include: { employee: { include: { department: true, designation: true } } } });
  if (!p) throw notFound('Payroll record not found');
  if (!isHR(u)) {
    if (p.employeeId !== u.employeeId) throw forbidden();
    if (p.status === 'ESTIMATED') throw forbidden('This payslip has not been finalized yet');
  }
  audit(req, 'payroll.payslip_download', 'Payroll', p.id);
  streamPayslip(res, num(p), p.employee, await getSetting('company.profile'));
});
