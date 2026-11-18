import { useState } from 'react';
import { z } from 'zod';
import { CalendarClock, MessageSquare, Paperclip, Plus, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useApi } from '../hooks/useApi';
import { usePeople } from '../hooks/usePeople';
import { api, download, errMsg } from '../services/api';
import { isHR } from '../types';
import { Avatar, Badge, Button, Card, ConfirmModal, ErrorBox, Modal, PageHeader, Skeleton } from '../components/ui';
import Kanban from '../components/Kanban';
import FormModal from '../components/FormModal';
import { dateInput, fmtDate, fmtDateTime, fullName, label } from '../utils/format';

const COLUMNS = ['TODO', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED'];
const schema = z.object({
  title: z.string().trim().min(2, 'Title is required').max(120), description: z.string().max(2000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']), dueDate: z.string().optional(), assigneeId: z.string().optional(),
});

export default function Tasks() {
  const { user } = useAuth(); const { toast } = useToast();
  const people = usePeople();
  const staff = user!.role !== 'EMPLOYEE';
  const { data, loading, error, reload } = useApi<any[]>('/tasks');
  const [edit, setEdit] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [del, setDel] = useState<any>(null);

  const move = async (t: any, status: string) => {
    try { await api.patch(`/tasks/${t.id}`, { status }); reload(); } catch (e) { toast('error', errMsg(e)); }
  };
  const open = data?.find((t) => t.id === openId);
  const overdue = (t: any) => t.dueDate && t.status !== 'COMPLETED' && new Date(t.dueDate) < new Date();

  return (
    <>
      <PageHeader title={staff ? 'Tasks' : 'My Tasks'} subtitle="Drag cards between columns, or use the status menu on a card"
        actions={<Button onClick={() => setEdit(true)}><Plus className="w-4 h-4" />New task</Button>} />
      {loading ? <div className="flex gap-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-64 w-64" />)}</div>
        : error ? <Card><ErrorBox message={error} retry={reload} /></Card> : (
          <Kanban columns={COLUMNS} items={data ?? []} getColumn={(t) => t.status} getId={(t) => t.id} onMove={move}
            render={(t) => (
              <div>
                <button className="text-left font-semibold text-sm hover:underline w-full" onClick={() => setOpenId(t.id)}>{t.title}</button>
                <div className="flex flex-wrap items-center gap-1.5 mt-2"><Badge value={t.priority} tone={t.priority === 'URGENT' ? 'red' : t.priority === 'HIGH' ? 'amber' : 'gray'} />
                  {t.dueDate && <span className={`text-xs flex items-center gap-1 ${overdue(t) ? 'text-accent font-semibold' : 'text-muted'}`}><CalendarClock className="w-3 h-3" />{fmtDate(t.dueDate)}</span>}
                  {t._count?.comments > 0 && <span className="text-xs text-muted flex items-center gap-1"><MessageSquare className="w-3 h-3" />{t._count.comments}</span>}</div>
                <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 mt-2 overflow-hidden"><div className="h-full bg-primary" style={{ width: `${t.progress}%` }} /></div>
                <div className="flex items-center justify-between mt-2 gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">{t.assignee ? <><Avatar name={fullName(t.assignee)} src={t.assignee.photoUrl} size={22} /><span className="text-xs text-muted truncate">{fullName(t.assignee)}</span></> : <span className="text-xs text-muted">Unassigned</span>}</div>
                  <select aria-label="Change status" className="text-xs bg-transparent border border-black/10 dark:border-white/20 rounded-lg px-1 py-0.5" value={t.status} onChange={(e) => move(t, e.target.value)}>{COLUMNS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select>
                </div>
              </div>
            )} />
        )}
      <FormModal open={edit} title="New task" schema={schema} successMessage="Task created" submitLabel="Create"
        defaultValues={{ title: '', description: '', priority: 'MEDIUM', dueDate: '', assigneeId: user!.employeeId ?? '' }}
        fields={[
          { name: 'title', label: 'Title' }, { name: 'description', label: 'Description', type: 'textarea' },
          { name: 'priority', label: 'Priority', type: 'select', half: true, options: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => ({ value: p, label: label(p) })) },
          { name: 'dueDate', label: 'Deadline', type: 'date', half: true },
          ...(staff ? [{ name: 'assigneeId', label: 'Assign to', type: 'select' as const, options: people.some((p: any) => p.value === user!.employeeId) || !user!.employeeId ? people : [{ value: user!.employeeId!, label: 'Me' }, ...people] }] : []),
        ]}
        onSubmit={async (v) => { await api.post('/tasks', v); reload(); }} onClose={() => setEdit(false)} />
      {open && <TaskDetail task={open} canManage={isHR(user!.role) || user!.role === 'MANAGER' || open.creator?.id === user!.employeeId} onClose={() => setOpenId(null)} onChanged={reload} onDelete={() => setDel(open)} />}
      <ConfirmModal open={!!del} danger title="Delete task" message={`Delete "${del?.title}"? Comments and attachments will be lost.`} confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/tasks/${del.id}`); toast('success', 'Task deleted'); setOpenId(null); reload(); } catch (e) { toast('error', errMsg(e)); } }} onClose={() => setDel(null)} />
    </>
  );
}

function TaskDetail({ task, canManage, onClose, onChanged, onDelete }: { task: any; canManage: boolean; onClose: () => void; onChanged: () => void; onDelete: () => void }) {
  const { toast } = useToast();
  const { data, loading, reload } = useApi<any>(`/tasks/${task.id}/comments`);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number>(task.progress);

  const run = async (fn: () => Promise<any>, ok?: string) => { setBusy(true); try { await fn(); if (ok) toast('success', ok); reload(); onChanged(); } catch (e) { toast('error', errMsg(e)); } finally { setBusy(false); } };
  return (
    <Modal open wide title={task.title} onClose={onClose}>
      <div className="flex flex-wrap gap-2 mb-3"><Badge value={task.status} /><Badge value={task.priority} tone={task.priority === 'URGENT' ? 'red' : 'gray'} />
        <span className="text-xs text-muted self-center">Due {task.dueDate ? fmtDate(task.dueDate) : 'not set'} - Assigned to {task.assignee ? fullName(task.assignee) : 'nobody'} - Created by {fullName(task.creator)}</span></div>
      {loading ? <Skeleton className="h-20" /> : <>
        {data?.description && <p className="text-sm whitespace-pre-wrap mb-4">{data.description}</p>}
        <label className="text-xs font-semibold text-muted">Progress: {progress}%</label>
        <input type="range" min={0} max={100} step={5} value={progress} className="w-full accent-[#9CC6E0]" onChange={(e) => setProgress(Number(e.target.value))}
          onMouseUp={() => run(() => api.patch(`/tasks/${task.id}`, { progress }))} onTouchEnd={() => run(() => api.patch(`/tasks/${task.id}`, { progress }))} onKeyUp={() => run(() => api.patch(`/tasks/${task.id}`, { progress }))} />
        <h3 className="font-bold text-sm mt-4 mb-2 flex items-center gap-2"><Paperclip className="w-4 h-4" />Attachments</h3>
        <div className="flex flex-wrap gap-2 mb-2">
          {data?.attachments?.length ? data.attachments.map((a: string) => <Button key={a} variant="ghost" className="!text-xs" onClick={() => download(`/tasks/${task.id}/attachments/${encodeURIComponent(a)}`, {}, a).catch((e) => toast('error', errMsg(e)))}>{a.slice(0, 14)}...{a.slice(a.lastIndexOf('.'))}</Button>) : <span className="text-xs text-muted">No attachments</span>}
        </div>
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" disabled={busy} className="text-xs" aria-label="Upload attachment"
          onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); run(() => api.post(`/tasks/${task.id}/attachments`, fd), 'File attached'); e.target.value = ''; }} />
        <h3 className="font-bold text-sm mt-5 mb-2 flex items-center gap-2"><MessageSquare className="w-4 h-4" />Comments</h3>
        <div className="space-y-2 max-h-52 overflow-y-auto mb-2">
          {data?.comments?.length ? data.comments.map((c: any) => <div key={c.id} className="glass !rounded-2xl p-2.5 text-sm"><b>{fullName(c.author)}</b> <span className="text-xs text-muted">{fmtDateTime(c.createdAt)}</span><div>{c.body}</div></div>) : <p className="text-xs text-muted">No comments yet</p>}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!body.trim()) return; run(async () => { await api.post(`/tasks/${task.id}/comments`, { body }); setBody(''); }); }}>
          <input className="input" placeholder="Write a comment..." value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} />
          <Button type="submit" loading={busy} aria-label="Send comment"><Send className="w-4 h-4" /></Button>
        </form>
      </>}
      {canManage && <div className="flex justify-end mt-5"><Button variant="ghost" onClick={onDelete}><Trash2 className="w-4 h-4 text-accent" />Delete task</Button></div>}
    </Modal>
  );
}
