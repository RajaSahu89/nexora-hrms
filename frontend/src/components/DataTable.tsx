import { ReactNode } from 'react';
import { Card, Empty, ErrorBox, SkeletonRows } from './ui';

export interface Column<T> { key: string; header: ReactNode; render?: (row: T) => ReactNode; className?: string }
interface Props<T> {
  columns: Column<T>[]; rows: T[]; loading?: boolean; error?: string | null; onRetry?: () => void;
  emptyTitle?: string; emptyHint?: string; emptyAction?: ReactNode; footer?: ReactNode; rowKey?: (r: T) => string;
}
export default function DataTable<T extends Record<string, any>>({ columns, rows, loading, error, onRetry, emptyTitle, emptyHint, emptyAction, footer, rowKey }: Props<T>) {
  return (
    <Card className="!p-0 overflow-hidden">
      {loading ? <SkeletonRows /> : error ? <ErrorBox message={error} retry={onRetry} /> : rows.length === 0 ? <Empty title={emptyTitle} hint={emptyHint} action={emptyAction} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead><tr>{columns.map((c) => <th key={c.key} className="th">{c.header}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={rowKey ? rowKey(r) : r.id ?? i} className="hover:bg-primary/10 transition-colors">
                {columns.map((c) => <td key={c.key} className={`td ${c.className ?? ''}`}>{c.render ? c.render(r) : (r as any)[c.key] ?? '-'}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {footer}
    </Card>
  );
}
