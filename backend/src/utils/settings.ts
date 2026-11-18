import { prisma } from '../config/prisma';

export const DEFAULTS = {
  'company.profile': { name: 'Nexora Technologies', logoUrl: null as string | null, address: '', email: '', phone: '', website: '', industry: '', currency: 'INR' },
  'attendance.rules': { workStart: '09:00', workEnd: '18:00', graceMinutes: 10, halfDayHours: 4, fullDayHours: 8 },
  'payroll.config': { hraPercentOfBasic: 40, taxPercent: 10, overtimeMultiplier: 1.5, workingDaysPerMonth: 22, workingHoursPerDay: 8 },
} as const;

export type SettingKey = keyof typeof DEFAULTS;
export const SETTING_KEYS = Object.keys(DEFAULTS) as SettingKey[];

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const row = await prisma.companySetting.findUnique({ where: { key } });
  return { ...DEFAULTS[key], ...((row?.value as object) ?? {}) } as (typeof DEFAULTS)[K];
}
