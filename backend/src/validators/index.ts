import { z } from 'zod';

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const text = (max = 200) => z.string().trim().max(max);
const optText = (max = 200) => text(max).nullish();
const id = z.string().min(1);
const password = z.string().min(8, 'Min 8 characters').max(72)
  .regex(/[a-z]/, 'Needs a lowercase letter').regex(/[A-Z]/, 'Needs an uppercase letter').regex(/\d/, 'Needs a number');

// ---------- auth ----------
export const registerSchema = z.object({
  firstName: text(60).min(1), lastName: text(60).min(1),
  email: z.string().trim().toLowerCase().email(), password,
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(), password: z.string().min(1), remember: z.boolean().optional(),
});
export const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetSchema = z.object({ token: z.string().min(10), password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

// ---------- employees ----------
const genderEnum = z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']);
const empBase = z.object({
  firstName: text(60).min(1), lastName: text(60).min(1),
  email: z.string().trim().toLowerCase().email(),
  phone: optText(30), dateOfBirth: dateStr.nullish(), gender: genderEnum.nullish(),
  address: optText(300), emergencyContactName: optText(80), emergencyContactPhone: optText(30), emergencyContactRel: optText(40),
  departmentId: id.nullish(), designationId: id.nullish(), managerId: id.nullish(),
  joiningDate: dateStr,
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']),
  employmentStatus: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED', 'RESIGNED']),
  workLocation: optText(100),
  education: z.array(z.object({ degree: text(100), institution: text(120), year: text(10) })).max(20).nullish(),
  skills: z.array(text(40)).max(40).optional(),
  experience: z.array(z.object({ company: text(120), role: text(100), years: text(10) })).max(20).nullish(),
  bankDetails: z.object({ bankName: text(80), accountNumber: text(40), ifsc: text(20) }).partial().nullish(),
});
export const createEmployeeSchema = empBase.partial({ employmentType: true, employmentStatus: true }).extend({
  role: z.enum(['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE']).default('EMPLOYEE'),
  password: password.optional(),
}).transform((v) => ({ ...v, employmentType: v.employmentType ?? 'FULL_TIME', employmentStatus: v.employmentStatus ?? 'ACTIVE' }));
export const updateEmployeeSchema = empBase.partial();
export const selfUpdateSchema = empBase.pick({
  phone: true, address: true, emergencyContactName: true, emergencyContactPhone: true, emergencyContactRel: true,
  skills: true, education: true, experience: true, bankDetails: true,
}).partial();
export const bulkSchema = z.object({ action: z.enum(['activate', 'deactivate', 'delete']), ids: z.array(id).min(1).max(200) });
export const importSchema = z.object({ rows: z.array(z.record(z.string())).min(1).max(500) });

// ---------- org ----------
export const departmentSchema = z.object({
  name: text(80).min(1), description: optText(500), budget: z.coerce.number().min(0).nullish(), headId: id.nullish(),
});
export const designationSchema = z.object({ title: text(80).min(1), level: z.coerce.number().int().min(1).max(20).default(1) });

// ---------- attendance ----------
export const correctionRequestSchema = z.object({ date: dateStr, reason: text(300).min(3) });
export const correctSchema = z.object({
  approve: z.boolean().default(true),
  checkInTime: hhmm.nullish(), checkOutTime: hhmm.nullish(),
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY']).optional(),
  note: optText(300),
});
export const manualAttendanceSchema = correctSchema.extend({ employeeId: id, date: dateStr });

// ---------- leave ----------
export const leaveApplySchema = z.object({
  leaveTypeId: id, startDate: dateStr, endDate: dateStr, reason: text(500).min(3),
});
export const leaveDecisionSchema = z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: optText(300) });
export const leaveTypeSchema = z.object({
  name: text(60).min(1), code: text(10).min(1).transform((s) => s.toUpperCase()),
  defaultDays: z.coerce.number().min(0).max(365), isPaid: z.boolean().default(true), carryForward: z.boolean().default(false),
  description: optText(300),
});

// ---------- payroll ----------
export const structureSchema = z.object({
  components: z.array(z.object({
    name: text(60).min(1), type: z.enum(['EARNING', 'DEDUCTION']),
    amountType: z.enum(['FIXED', 'PERCENT']), amount: z.coerce.number().min(0),
  })).max(30),
});
export const payrollRunSchema = z.object({
  month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(2000).max(2100),
  employeeIds: z.array(id).optional(), bonuses: z.record(z.coerce.number().min(0)).optional(),
});

// ---------- recruitment ----------
export const vacancySchema = z.object({
  title: text(120).min(1), description: text(5000).min(1), requirements: optText(3000),
  departmentId: id.nullish(), designationId: id.nullish(), location: optText(100),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).default('FULL_TIME'),
  openings: z.coerce.number().int().min(1).max(500).default(1),
  status: z.enum(['DRAFT', 'OPEN', 'CLOSED']).default('OPEN'), closingDate: dateStr.nullish(),
});
export const stageSchema = z.object({
  stage: z.enum(['APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED', 'HIRED']),
});
export const interviewSchema = z.object({
  scheduledAt: z.string().min(10), mode: optText(30), location: optText(150), interviewerId: id.nullish(),
});
export const interviewUpdateSchema = z.object({
  status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
  rating: z.coerce.number().int().min(1).max(5).nullish(), feedback: optText(2000),
});

// ---------- performance ----------
export const goalSchema = z.object({
  employeeId: id.optional(), title: text(150).min(1), description: optText(500),
  targetValue: z.coerce.number().nullish(), currentValue: z.coerce.number().nullish(),
  progress: z.coerce.number().int().min(0).max(100).default(0),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('NOT_STARTED'), dueDate: dateStr.nullish(),
});
export const reviewCreateSchema = z.object({ employeeId: id, periodStart: dateStr, periodEnd: dateStr });
export const selfAssessSchema = z.object({ selfAssessment: text(3000).min(3) });
export const managerReviewSchema = z.object({
  managerFeedback: text(3000).min(3), rating: z.coerce.number().min(1).max(5),
  kpiScores: z.array(z.object({ name: text(60), score: z.coerce.number().min(0).max(100) })).max(15).optional(),
  improvementPlan: optText(2000),
});

// ---------- tasks ----------
export const taskSchema = z.object({
  title: text(150).min(1), description: optText(3000), assigneeId: id.nullish(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'), dueDate: dateStr.nullish(),
});
export const taskUpdateSchema = taskSchema.partial().extend({
  status: z.enum(['TODO', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED']).optional(),
  progress: z.coerce.number().int().min(0).max(100).optional(),
});
export const commentSchema = z.object({ body: text(1000).min(1) });

// ---------- documents / announcements / settings ----------
export const documentMetaSchema = z.object({
  title: text(150).min(1),
  category: z.enum(['OFFER_LETTER', 'APPOINTMENT_LETTER', 'EXPERIENCE_CERTIFICATE', 'IDENTITY', 'POLICY', 'OTHER']).default('OTHER'),
  employeeId: id.optional().or(z.literal('')).transform((v) => v || undefined),
  visibility: z.enum(['PRIVATE_EMPLOYEE', 'HR_ONLY', 'ALL_EMPLOYEES']).default('PRIVATE_EMPLOYEE'),
  expiresAt: dateStr.optional().or(z.literal('')).transform((v) => v || undefined),
});
export const announcementSchema = z.object({
  title: text(150).min(1), body: text(5000).min(1),
  type: z.enum(['GENERAL', 'IMPORTANT', 'HOLIDAY', 'EVENT']).default('GENERAL'),
  departmentId: id.nullish(), expiresAt: z.string().nullish(),
});
export const holidaySchema = z.object({ name: text(80).min(1), date: dateStr, isOptional: z.boolean().default(false) });
export const settingValueSchema = z.record(z.any());
