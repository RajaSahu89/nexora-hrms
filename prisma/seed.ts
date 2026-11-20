import { PrismaClient, RoleName, Gender, EmploymentType } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const DEV_PASSWORD = 'Password@123';

const PERMISSIONS: Record<RoleName, string[]> = {
  SUPER_ADMIN: ['*'],
  HR_ADMIN: [
    'employee:read', 'employee:write', 'department:write', 'attendance:manage',
    'leave:manage', 'payroll:manage', 'recruitment:manage', 'performance:manage',
    'document:manage', 'announcement:publish', 'report:read', 'settings:write',
  ],
  MANAGER: [
    'employee:read:team', 'attendance:read:team', 'leave:approve:team',
    'performance:manage:team', 'task:manage:team', 'report:read:team',
  ],
  EMPLOYEE: [
    'profile:read:self', 'profile:update:self', 'attendance:self', 'leave:apply',
    'payslip:read:self', 'document:read:self', 'task:read:self',
  ],
};

async function main() {
  const allKeys = [...new Set(Object.values(PERMISSIONS).flat())];
  for (const key of allKeys) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  const roles: Record<string, string> = {};
  for (const name of Object.keys(PERMISSIONS) as RoleName[]) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, description: name.replace('_', ' ') },
    });
    roles[name] = role.id;
    await prisma.role.update({
      where: { id: role.id },
      data: { permissions: { set: PERMISSIONS[name].map((key) => ({ key })) } },
    });
  }
  const deptNames = ['Engineering', 'Human Resources', 'Sales', 'Finance'];
  const depts: Record<string, string> = {};
  for (const name of deptNames) {
    const d = await prisma.department.upsert({
      where: { name }, update: {},
      create: { name, description: `${name} department`, budget: 500000 },
    });
    depts[name] = d.id;
  }
  const titles = ['CEO', 'HR Manager', 'Engineering Manager', 'Software Engineer', 'Sales Executive'];
  const desigs: Record<string, string> = {};
  for (const [i, title] of titles.entries()) {
    const d = await prisma.designation.upsert({
      where: { title }, update: {}, create: { title, level: titles.length - i },
    });
    desigs[title] = d.id;
  }
  const hash = await bcrypt.hash(DEV_PASSWORD, 12);
  const people = [
    { code: 'NX-0001', first: 'Sam', last: 'Admin', email: 'admin@nexora.test', role: 'SUPER_ADMIN', dept: 'Human Resources', title: 'CEO', gender: Gender.OTHER },
    { code: 'NX-0002', first: 'Hana', last: 'Rao', email: 'hr@nexora.test', role: 'HR_ADMIN', dept: 'Human Resources', title: 'HR Manager', gender: Gender.FEMALE },
    { code: 'NX-0003', first: 'Mike', last: 'Shah', email: 'manager@nexora.test', role: 'MANAGER', dept: 'Engineering', title: 'Engineering Manager', gender: Gender.MALE },
    { code: 'NX-0004', first: 'Eva', last: 'Patel', email: 'employee@nexora.test', role: 'EMPLOYEE', dept: 'Engineering', title: 'Software Engineer', gender: Gender.FEMALE },
    { code: 'NX-0005', first: 'Raj', last: 'Mehta', email: 'raj@nexora.test', role: 'EMPLOYEE', dept: 'Engineering', title: 'Software Engineer', gender: Gender.MALE },
    { code: 'NX-0006', first: 'Zoya', last: 'Khan', email: 'zoya@nexora.test', role: 'EMPLOYEE', dept: 'Sales', title: 'Sales Executive', gender: Gender.FEMALE },
  ];
  const empIds: Record<string, string> = {};
  for (const p of people) {
    const user = await prisma.user.upsert({
      where: { email: p.email }, update: {},
      create: { email: p.email, passwordHash: hash, roleId: roles[p.role] },
    });
    const emp = await prisma.employee.upsert({
      where: { employeeCode: p.code }, update: {},
      create: {
        employeeCode: p.code, userId: user.id, firstName: p.first, lastName: p.last,
        email: p.email, gender: p.gender, joiningDate: new Date('2024-01-15'),
        employmentType: EmploymentType.FULL_TIME, workLocation: 'Head Office',
        departmentId: depts[p.dept], designationId: desigs[p.title], skills: [],
      },
    });
    empIds[p.code] = emp.id;
  }
  for (const code of ['NX-0004', 'NX-0005']) {
    await prisma.employee.update({ where: { id: empIds[code] }, data: { managerId: empIds['NX-0003'] } });
  }
  await prisma.department.update({ where: { name: 'Engineering' }, data: { headId: empIds['NX-0003'] } });
  await prisma.department.update({ where: { name: 'Human Resources' }, data: { headId: empIds['NX-0002'] } });
  
  const salaries: Record<string, number> = { 'NX-0001': 90000, 'NX-0002': 60000, 'NX-0003': 80000, 'NX-0004': 50000, 'NX-0005': 45000, 'NX-0006': 40000 };
  for (const [code, basic] of Object.entries(salaries)) {
    const has = await prisma.salaryComponent.count({ where: { employeeId: empIds[code], name: 'Basic' } });
    if (!has) await prisma.salaryComponent.create({ data: { employeeId: empIds[code], name: 'Basic', type: 'EARNING', amount: basic, effectiveFrom: new Date('2024-01-15') } });
  }
  const leaveTypes = [
    { name: 'Casual Leave', code: 'CL', days: 12, paid: true },
    { name: 'Sick Leave', code: 'SL', days: 10, paid: true },
    { name: 'Paid Leave', code: 'PL', days: 15, paid: true },
    { name: 'Unpaid Leave', code: 'UL', days: 0, paid: false },
    { name: 'Emergency Leave', code: 'EL', days: 5, paid: true },
    { name: 'Maternity Leave', code: 'ML', days: 90, paid: true },
    { name: 'Paternity Leave', code: 'PTL', days: 10, paid: true },
  ];
  const year = new Date().getFullYear();
  for (const lt of leaveTypes) {
    const t = await prisma.leaveType.upsert({
      where: { code: lt.code }, update: {},
      create: { name: lt.name, code: lt.code, defaultDays: lt.days, isPaid: lt.paid },
    });
    for (const employeeId of Object.values(empIds)) {
      await prisma.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: t.id, year } },
        update: {}, create: { employeeId, leaveTypeId: t.id, year, allocated: lt.days },
      });
    }
  }
  for (const h of [
    { name: 'New Year', date: `${year}-01-01` },
    { name: 'Independence Day', date: `${year}-08-15` },
    { name: 'Christmas', date: `${year}-12-25` },
  ]) {
    await prisma.holiday.upsert({ where: { date: new Date(h.date) }, update: {}, create: { name: h.name, date: new Date(h.date) } });
  }
  const settings: Record<string, unknown> = {
    'company.profile': { name: 'Nexora Technologies', logoUrl: null, timezone: 'UTC', currency: 'INR', email: 'hr@nexora.test', phone: '', address: '' },
    'attendance.rules': { workStart: '09:00', workEnd: '18:00', graceMinutes: 10, halfDayHours: 4, fullDayHours: 8 },
    'payroll.config': { hraPercentOfBasic: 40, taxPercent: 10, overtimeMultiplier: 1.5, workingDaysPerMonth: 22 },
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.companySetting.upsert({ where: { key }, update: {}, create: { key, value: value as object } });
  }
  if ((await prisma.attendance.count()) === 0) {
    const now = new Date();
    for (let i = 1; i <= 14; i++) {
      const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - i));
      if ([0, 6].includes(d.getUTCDay())) continue;
      for (const employeeId of Object.values(empIds)) {
        const late = Math.random() < 0.15;
        const inMin = late ? 9 * 60 + 25 + Math.floor(Math.random() * 30) : 8 * 60 + 40 + Math.floor(Math.random() * 25);
        const worked = 470 + Math.floor(Math.random() * 60);
        const checkIn = new Date(d.getTime() + inMin * 60000);
        await prisma.attendance.create({
          data: { employeeId, date: d, checkIn, checkOut: new Date(checkIn.getTime() + (worked + 60) * 60000), status: late ? 'LATE' : 'PRESENT', isLate: late, workedMinutes: worked, overtimeMinutes: Math.max(0, worked - 480) },
        });
      }
    }
    const cl = await prisma.leaveType.findUniqueOrThrow({ where: { code: 'CL' } });
    const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 7));
    await prisma.leaveRequest.create({ data: { employeeId: empIds['NX-0004'], leaveTypeId: cl.id, startDate: start, endDate: start, days: 1, reason: 'Family function' } });
    await prisma.task.createMany({ data: [
      { title: 'Prepare Q4 onboarding checklist', description: 'Update the checklist for new joiners', status: 'IN_PROGRESS', priority: 'HIGH', progress: 40, assigneeId: empIds['NX-0004'], creatorId: empIds['NX-0003'], dueDate: new Date(Date.now() + 3 * 864e5) },
      { title: 'Fix attendance report export', status: 'TODO', priority: 'MEDIUM', assigneeId: empIds['NX-0005'], creatorId: empIds['NX-0003'], dueDate: new Date(Date.now() + 6 * 864e5) },
      { title: 'Review vendor contracts', status: 'UNDER_REVIEW', priority: 'LOW', progress: 80, assigneeId: empIds['NX-0002'], creatorId: empIds['NX-0001'] },
    ] });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@nexora.test' } });
    await prisma.announcement.create({ data: { title: 'Welcome to NEXORA HRMS', body: 'Your new HR platform is live. Check in daily, apply for leave and view payslips here.', type: 'IMPORTANT', publishedById: admin.id } });
    const vac = await prisma.jobVacancy.create({ data: { title: 'Frontend Developer', description: 'Build delightful interfaces with React and TypeScript.', requirements: '2+ years React', departmentId: depts['Engineering'], openings: 2, location: 'Remote' } });
    for (const [fullName, email, stage] of [['Aarav Singh', 'aarav@example.com', 'APPLIED'], ['Diya Nair', 'diya@example.com', 'SCREENING']] as const) {
      const c = await prisma.candidate.create({ data: { fullName, email, skills: ['React', 'TypeScript'] } });
      await prisma.application.create({ data: { candidateId: c.id, vacancyId: vac.id, stage } });
    }
    await prisma.employeeGoal.create({ data: { employeeId: empIds['NX-0004'], title: 'Ship 3 features this quarter', progress: 33, status: 'IN_PROGRESS', targetValue: 3, currentValue: 1 } });
  }

  console.log('Seed complete. Dev password for all users:', DEV_PASSWORD);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
