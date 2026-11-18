import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, CheckCheck } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api, errMsg } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button, Card, Empty, ErrorBox, PageHeader, Pagination, SkeletonRows, cn } from '../components/ui';
import { fmtDateTime } from '../utils/format';

export default function Notifications() {
  const [page, setPage] = useState(1);
  const nav = useNavigate();
  const { toast } = useToast();
  const { data, loading, error, reload } = useApi<any>('/notifications', { page, limit: 20 });
  const changed = () => { reload(); window.dispatchEvent(new Event('notifications:changed')); };

  const open = async (n: any) => {
    if (!n.isRead) { try { await api.post(`/notifications/${n.id}/read`); changed(); } catch (e) { toast('error', errMsg(e)); } }
    if (n.link) nav(n.link.split('#')[0]);
  };
  const readAll = async () => { try { await api.post('/notifications/read-all'); toast('success', 'All notifications marked as read'); changed(); } catch (e) { toast('error', errMsg(e)); } };

  return (
    <>
      <PageHeader title="Notifications" subtitle={data ? `${data.unread} unread` : undefined}
        actions={<Button variant="ghost" onClick={readAll} disabled={!data?.unread}><CheckCheck className="w-4 h-4" />Mark all as read</Button>} />
      <Card className="!p-0 overflow-hidden">
        {loading ? <SkeletonRows /> : error ? <ErrorBox message={error} retry={reload} /> : !data?.data.length ? <Empty title="You're all caught up" hint="New alerts about leave, tasks, payroll and announcements will appear here." /> : (
          <ul>
            {data.data.map((n: any) => (
              <li key={n.id}>
                <button onClick={() => open(n)} className={cn('w-full text-left flex gap-3 p-4 border-b border-black/5 dark:border-white/10 hover:bg-primary/10 transition', !n.isRead && 'bg-primary/15')}>
                  <BellRing className={cn('w-5 h-5 mt-0.5 shrink-0', n.isRead ? 'text-muted' : 'text-accent')} />
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-sm', !n.isRead && 'font-bold')}>{n.title}</div>
                    <div className="text-sm text-muted">{n.message}</div>
                    <div className="text-xs text-muted mt-1">{fmtDateTime(n.createdAt)}</div>
                  </div>
                  {!n.isRead && <span className="w-2.5 h-2.5 rounded-full bg-accent mt-1.5 shrink-0" aria-label="Unread" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
