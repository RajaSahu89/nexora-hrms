import { prisma } from '../config/prisma';
import { countWorkingDays, iso, monthRange } from '../utils/dates';
import { getSetting } from '../utils/settings';

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function computePayroll(employeeId: string, month: number, year: number, bonuses = 0) {
  const { start, end } = monthRange(month, year);
  const comps = await prisma.salaryComponent.findMany({
    where: { employeeId, effectiveFrom: { lte: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }] },
  });
  const basicC = comps.find((c) => c.name.toLowerCase() === 'basic');
  if (!basicC) return null;
  const cfg = await getSetting('payroll.config');
  const basic = Number(basicC.amount);
  const val = (c: (typeof comps)[number]) => (c.amountType === 'PERCENT' ? (basic * Number(c.amount)) / 100 : Number(c.amount));
  const hraC = comps.find((c) => c.name.toLowerCase() === 'hra');
  const hra = hraC ? val(hraC) : (basic * cfg.hraPercentOfBasic) / 100;
  const allowances = comps.filter((c) => c.type === 'EARNING' && !['basic', 'hra'].includes(c.name.toLowerCase())).reduce((s, c) => s + val(c), 0);
  const componentDeductions = comps.filter((c) => c.type === 'DEDUCTION').reduce((s, c) => s + val(c), 0);

  const [ot, absent, half, unpaid, holidays] = await Promise.all([
    prisma.attendance.aggregate({ where: { employeeId, date: { gte: start, lte: end } }, _sum: { overtimeMinutes: true } }),
    prisma.attendance.count({ where: { employeeId, date: { gte: start, lte: end }, status: 'ABSENT' } }),
    prisma.attendance.count({ where: { employeeId, date: { gte: start, lte: end }, status: 'HALF_DAY' } }),
    prisma.leaveRequest.findMany({ where: { employeeId, status: 'APPROVED', leaveType: { isPaid: false }, startDate: { lte: end }, endDate: { gte: start } } }),
    prisma.holiday.findMany({ where: { date: { gte: start, lte: end } } }),
  ]);
  const hset = new Set(holidays.map((h) => iso(h.date)));
  const unpaidDays = unpaid.reduce((s, l) => s + countWorkingDays(l.startDate < start ? start : l.startDate, l.endDate > end ? end : l.endDate, hset), 0);
  const perDay = basic / cfg.workingDaysPerMonth;
  const lossOfPay = (absent + half * 0.5 + unpaidDays) * perDay;
  const overtimePay = ((ot._sum.overtimeMinutes ?? 0) / 60) * (perDay / cfg.workingHoursPerDay) * cfg.overtimeMultiplier;
  const gross = basic + hra + allowances + bonuses + overtimePay;
  const deductions = componentDeductions + lossOfPay;
  const tax = (gross * cfg.taxPercent) / 100;
  return {
    basicSalary: r2(basic), hra: r2(hra), allowances: r2(allowances), bonuses: r2(bonuses), overtimePay: r2(overtimePay),
    deductions: r2(deductions), tax: r2(tax), grossPay: r2(gross), netPay: r2(Math.max(0, gross - deductions - tax)),
  };
}
