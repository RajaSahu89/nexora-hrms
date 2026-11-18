import { useState } from 'react';
import { z } from 'zod';
import { Megaphone, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useApi, useLookups } from '../hooks/useApi';
import { api, errMsg } from '../services/api';
import { isHR } from '../types';
import { Badge, Button, Card, ConfirmModal, Empty, ErrorBox, PageHeader, Skeleton } from '../components/ui';
import FormModal from '../components/FormModal';
import { fmtDateTime } from '../utils/format';

const schema = z.object({
  title: z.string().trim().min(3, 'Title needs at least 3 characters').max(120),
  body: z.string().trim().min(3, 'Message needs at least 3 characters').max(4000),
  type: z.enum(['GENERAL', 'IMPORTANT', 'HOLIDAY', 'EVENT']),
  departmentId: z.string().optional(),
});
const TYPE_TONE: Record<string, string> = { GENERAL: 'gray', IMPORTANT: 'red', HOLIDAY: 'blue', EVENT: 'green' };

export default function Announcements() {
  const { user } = useAuth(); const { toast } = useToast(); const lk = useLookups();
  const hr = isHR(user!.role);
  const { data, loading, error, reload } = useApi<any[]>('/announcements');
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<any>(null);

  return (
    <>
      <PageHeader title="Announcements" subtitle="Company and department news"
        actions={hr && <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4" />New announcement</Button>} />
      {loading ? <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        : error ? <Card><ErrorBox message={error} retry={reload} /></Card>
        : !data?.length ? <Card><Empty title="No announcements yet" hint={hr ? 'Publish one to notify your team.' : 'Check back later.'} /></Card> : (
          <div className="space-y-4">
            {data.map((a) => (
              <Card key={a.id} className={a.type === 'IMPORTANT' ? '!border-accent/60' : ''}>
                <div className="flex items-start gap-3">
                  <Megaphone className={`w-5 h-5 mt-1 shrink-0 ${a.type === 'IMPORTANT' ? 'text-accent' : 'text-muted'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{a.title}</h3><Badge value={a.type} tone={TYPE_TONE[a.type]} />{a.department && <Badge value={a.department.name} tone="blue" />}</div>
                    <p className="text-sm mt-2 whitespace-pre-wrap">{a.body}</p>
                    <p className="text-xs text-muted mt-3">{a.publishedBy?.employee ? `${a.publishedBy.employee.firstName} ${a.publishedBy.employee.lastName}` : a.publishedBy?.email} - {fmtDateTime(a.publishedAt)}</p>
                  </div>
                  {hr && <Button variant="ghost" className="!p-2" aria-label="Delete announcement" onClick={() => setDel(a)}><Trash2 className="w-4 h-4 text-accent" /></Button>}
                </div>
              </Card>
            ))}
          </div>
        )}
      <FormModal open={open} title="New announcement" schema={schema} submitLabel="Publish" successMessage="Announcement published"
        defaultValues={{ title: '', body: '', type: 'GENERAL', departmentId: '' }}
        fields={[
          { name: 'title', label: 'Title' }, { name: 'body', label: 'Message', type: 'textarea' },
          { name: 'type', label: 'Type', type: 'select', half: true, options: [['GENERAL', 'General'], ['IMPORTANT', 'Important notice'], ['HOLIDAY', 'Holiday'], ['EVENT', 'Event']].map(([value, label]) => ({ value, label })) },
          { name: 'departmentId', label: 'Audience', type: 'select', half: true, hint: 'Leave empty to notify everyone', options: lk.departments.map((d: any) => ({ value: d.id, label: d.name })) },
        ]}
        onSubmit={async (v) => { await api.post('/announcements', v); reload(); }} onClose={() => setOpen(false)} />
      <ConfirmModal open={!!del} danger title="Delete announcement" message={`Delete "${del?.title}"?`} confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/announcements/${del.id}`); toast('success', 'Announcement deleted'); reload(); } catch (e) { toast('error', errMsg(e)); } }} onClose={() => setDel(null)} />
    </>
  );
}
