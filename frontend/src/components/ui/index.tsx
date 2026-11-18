import { ButtonHTMLAttributes, ReactNode, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Inbox, Loader2, X } from 'lucide-react';
import { initials, label } from '../../utils/format';

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const Card = ({ children, className, ...p }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) =>
  <div className={cn('glass p-5', className)} {...p}>{children}</div>;

export const Button = ({ variant = 'primary', loading, children, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'accent' | 'ghost'; loading?: boolean }) => (
  <button className={cn('btn', `btn-${variant}`, className)} disabled={p.disabled || loading} {...p}>
    {loading && <Loader2 className="w-4 h-4 animate-spin" />}{children}
  </button>
);

const TONES: Record<string, string> = {
  green: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', red: 'bg-accent/15 text-accent', amber: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  blue: 'bg-primary/40 text-sky-900 dark:text-sky-200', gray: 'bg-slate-500/15 text-muted',
};
const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'green', PRESENT: 'green', APPROVED: 'green', COMPLETED: 'green', FINALIZED: 'green', PAID: 'green', HIRED: 'green', SELECTED: 'green', OPEN: 'green',
  PENDING: 'amber', ESTIMATED: 'amber', LATE: 'amber', HALF_DAY: 'amber', ON_LEAVE: 'blue', IN_PROGRESS: 'blue', UNDER_REVIEW: 'amber', SCREENING: 'blue', INTERVIEW: 'blue', SHORTLISTED: 'blue',
  REJECTED: 'red', ABSENT: 'red', INACTIVE: 'gray', TERMINATED: 'red', RESIGNED: 'gray', CANCELLED: 'gray', URGENT: 'red', HIGH: 'amber', CLOSED: 'gray', DRAFT: 'gray', TODO: 'gray', APPLIED: 'gray', HOLIDAY: 'blue',
};
export const Badge = ({ value, tone }: { value: string; tone?: string }) =>
  <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold', TONES[tone ?? STATUS_TONE[value] ?? 'gray'])}>{label(value)}</span>;

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('skeleton h-5', className)} />;
export const SkeletonRows = ({ rows = 5 }: { rows?: number }) => <div className="space-y-3 p-4">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>;

export const Empty = ({ title = 'Nothing here yet', hint, action }: { title?: string; hint?: string; action?: ReactNode }) => (
  <div className="flex flex-col items-center text-center py-12 px-4 text-muted">
    <Inbox className="w-10 h-10 mb-3 opacity-60" /><p className="font-semibold text-ink">{title}</p>
    {hint && <p className="text-sm mt-1 max-w-sm">{hint}</p>}{action && <div className="mt-4">{action}</div>}
  </div>
);

export const ErrorBox = ({ message, retry }: { message: string; retry?: () => void }) => (
  <div className="p-6 text-center text-sm"><p className="text-accent font-semibold mb-2">{message}</p>{retry && <Button variant="ghost" onClick={retry}>Try again</Button>}</div>
);

export const PageHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) => (
  <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
    <div><h1 className="text-2xl font-bold">{title}</h1>{subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}</div>
    <div className="flex flex-wrap gap-2">{actions}</div>
  </div>
);

export const StatCard = ({ icon: Icon, label: l, value, tone = 'blue' }: { icon: any; label: string; value: ReactNode; tone?: 'blue' | 'red' }) => (
  <Card className="flex items-center gap-4 !p-4">
    <div className={cn('w-11 h-11 rounded-2xl grid place-items-center shrink-0', tone === 'red' ? 'bg-accent/15 text-accent' : 'bg-primary/50 text-sky-900 dark:text-sky-200')}><Icon className="w-5 h-5" /></div>
    <div className="min-w-0"><div className="text-2xl font-bold leading-tight">{value}</div><div className="text-xs text-muted truncate">{l}</div></div>
  </Card>
);

export const Avatar = ({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) =>
  src ? <img src={src} alt={name} style={{ width: size, height: size }} className="rounded-full object-cover shrink-0" />
    : <div style={{ width: size, height: size, fontSize: size * 0.38 }} className="rounded-full bg-primary/60 text-sky-900 dark:text-sky-100 grid place-items-center font-bold shrink-0">{initials(name)}</div>;

export const Tabs = ({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) => (
  <div className="flex gap-1 overflow-x-auto glass !rounded-2xl p-1 mb-5 w-fit max-w-full">
    {tabs.map((t) => (
      <button key={t.id} onClick={() => onChange(t.id)} className={cn('px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition', value === t.id ? 'bg-primary text-[#101820]' : 'text-muted hover:text-ink')}>{t.label}</button>
    ))}
  </div>
);

export const Pagination = ({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) => {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return null;
  return (
    <div className="flex items-center justify-between p-3 text-sm text-muted">
      <span>{(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total}</span>
      <div className="flex gap-2"><Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</Button><Button variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button></div>
    </div>
  );
};

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-3 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div initial={{ y: 24, opacity: 0, scale: .97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 24, opacity: 0 }} className={cn('glass glass-strong w-full max-h-[92vh] overflow-y-auto p-5', wide ? 'max-w-3xl' : 'max-w-lg')} role="dialog" aria-modal="true">
            <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">{title}</h2><button onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-black/10"><X className="w-5 h-5" /></button></div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }: { open: boolean; title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <p className="text-sm text-muted mb-5">{message}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'accent' : 'primary'} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}
