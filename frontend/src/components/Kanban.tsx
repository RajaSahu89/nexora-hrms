import { ReactNode, useState } from 'react';
import { label } from '../utils/format';
import { cn } from './ui';

interface Props<T> {
  columns: string[]; items: T[]; getColumn: (i: T) => string; getId: (i: T) => string;
  render: (i: T) => ReactNode; onMove: (item: T, column: string) => void;
}
/** Drag & drop board (desktop). Cards also include a select (see renderers) so it works on touch screens. */
export default function Kanban<T>({ columns, items, getColumn, getId, render, onMove }: Props<T>) {
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="flex gap-4 overflow-x-auto pb-3">
      {columns.map((col) => {
        const list = items.filter((i) => getColumn(i) === col);
        return (
          <div key={col} onDragOver={(e) => { e.preventDefault(); setOver(col); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); const it = items.find((x) => getId(x) === id); if (it && getColumn(it) !== col) onMove(it, col); }}
            className={cn('glass min-w-[260px] w-[260px] shrink-0 p-3 transition', over === col && '!border-primary ring-2 ring-primary/50')}>
            <div className="flex items-center justify-between mb-3 px-1"><h3 className="text-sm font-bold">{label(col)}</h3><span className="text-xs text-muted">{list.length}</span></div>
            <div className="space-y-2 min-h-[60px]">
              {list.map((i) => (
                <div key={getId(i)} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', getId(i))} className="glass glass-strong !rounded-2xl p-3 cursor-grab active:cursor-grabbing">{render(i)}</div>
              ))}
              {list.length === 0 && <p className="text-xs text-muted text-center py-4">Drop here</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
