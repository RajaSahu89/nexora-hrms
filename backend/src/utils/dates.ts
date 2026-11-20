export const dateOnly = (d: Date | string) => new Date(new Date(d).toISOString().slice(0, 10) + 'T00:00:00.000Z');
export const todayDate = () => dateOnly(new Date());
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
export const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

export const monthRange = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0)) };
};
export const lastMonths = (n: number) => {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1)).toISOString().slice(0, 7));
};
export const countWorkingDays = (start: Date, end: Date, holidays: Set<string>) => {
  let n = 0;
  for (let d = dateOnly(start); d <= dateOnly(end); d = new Date(d.getTime() + 864e5)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !holidays.has(iso(d))) n++;
  }
  return n;
};
