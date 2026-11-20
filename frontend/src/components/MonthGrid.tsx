import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Card, cn } from './ui';
import { MONTHS } from '../utils/format';

export interface DayInfo { text?: string; tone?: 'green' | 'red' | 'amber' | 'blue' | 'gray' }
const TONE = { green: 'bg-emerald-500/20', red: 'bg-accent/20', amber: 'bg-amber-500/25', blue: 'bg-primary/50', gray: 'bg-slate-500/15' };

export default function MonthGrid({ month, onMonth, days }: { month: string; onMonth: (m: string) => void; days: Record<string, DayInfo> }) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); onMonth(d.toISOString().slice(0, 7)); };
  const cells = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <Button variant="ghost" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></Button>
        <h3 className="font-bold">{MONTHS[m - 1]} {y}</h3>
        <Button variant="ghost" onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="w-4 h-4" /></Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted mb-1">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const key = `${month}-${String(d).padStart(2, '0')}`;
          const info = days[key];
          return (
            <div key={i} title={info?.text} className={cn('aspect-square rounded-xl text-xs p-1 flex flex-col items-center justify-between border border-transparent', info?.tone ? TONE[info.tone] : 'bg-black/5 dark:bg-white/5', key === today && '!border-accent')}>
              <span className="font-semibold">{d}</span>
              {info?.text && <span className="text-[9px] leading-none truncate max-w-full">{info.text}</span>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
