let currency = 'INR';
export const setCurrency = (c: string) => { currency = c || 'INR'; };
export const money = (n: any) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(n) || 0); }
  catch { return `${currency} ${Number(n || 0).toFixed(2)}`; }
};
export const fmtDate = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
export const fmtTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '-');
export const fmtDateTime = (d?: string | Date | null) => (d ? `${fmtDate(d)} ${fmtTime(d)}` : '-');
export const dateInput = (d?: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');
export const hours = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
export const fullName = (e?: { firstName: string; lastName: string } | null) => (e ? `${e.firstName} ${e.lastName}` : '-');
export const initials = (n: string) => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
export const label = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w|\s\w/g, (c) => c.toUpperCase());
export const monthNow = () => new Date().toISOString().slice(0, 7);
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
