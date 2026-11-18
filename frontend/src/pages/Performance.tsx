import { useState } from 'react';
import { z } from 'zod';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ClipboardList, Plus, Target } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useApi } from '../hooks/useApi';
import { usePeople } from '../hooks/usePeople';
import { api, errMsg } from '../services/api';
import { isStaff } from '../types';
import { Badge, Button, Card, Empty, Modal, PageHeader, Skeleton, Tabs } from '../components/ui';
import DataTable from '../components/DataTable';
import FormModal from '../components/FormModal';
import { fmtDate, fullName, label } from '../utils/format';

const goalSchema = z.object({ employeeId: z.string().optional(), title: z.string().trim().min(3, 'Title needs 3+ characters').max(120), description: z.string().optional(), targetValue: z.coerce.number().min(0).optional().or(z.literal('')), dueDate: z.string().optional() });
const reviewSchema = z.object({ employeeId: z.string().min(1, 'Select an employee'), periodStart: z.string().min(1, 'Required'), periodEnd: z.string().min(1, 'Required') }).refine((v) => v.periodEnd >= v.periodStart, { message: 'End must be after start', path: ['periodEnd'] });
const selfSchema = z.object({ selfAssessment: z.string().trim().min(5, 'Please write a few words about your period') });
const mgrSchema = z.object({ managerFeedback: z.string().trim().min(3, 'Feedback is required'), rating: z.coerce.number({ invalid_type_error: 'Enter 1-5' }).min(1, 'Min 1').max(5, 'Max 5'), improvementPlan: z.string().optional(), complete: z.boolean().optional() });
const COLORS = ['#9CC6E0', '#E4002B', '#687078', '#7BB89A'];

export default function Performance() {
  const { user } = useAuth();
  const staff = isStaff(user!.role);
  const [tab, setTab] = useState('goals');
  const tabs = [{ id: 'goals', label: 'Goals & KPIs' }, { id: 'reviews', label: 'Reviews' }, ...(staff ? [{ id: 'analytics', label: 'Analytics' }] : [])];
  return (
    <>
      <PageHeader title={staff ? 'Performance' : 'My Performance'} subtitle="Goals, reviews, feedback and ratings" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'goals' && <Goals staff={staff} />}{tab === 'reviews' && <Reviews staff={staff} />}{tab === 'analytics' && <Analytics />}
    </>
  );
}

function Goals({ staff }: { staff: boolean }) {
  const { toast } = useToast(); const people = usePeople();
  const { data, loading, error, reload } = useApi<any[]>('/performance/goals');
  const [add, setAdd] = useState(false); const [upd, setUpd] = useState<any>(null); const [val, setVal] = useState(0);
  const save = async () => { try { await api.patch(`/performance/goals/${upd.id}`, { progress: val }); toast('success', 'Progress updated'); setUpd(null); reload(); } catch (e) { toast('error', errMsg(e)); } };
  return (
    <>
      <div className="flex justify-end mb-3"><Button onClick={() => setAdd(true)}><Plus className="w-4 h-4" />New goal</Button></div>
      <DataTable rows={data ?? []} loading={loading} error={error} onRetry={reload} emptyTitle="No goals yet" emptyHint="Set a goal to start tracking progress."
        columns={[
          { key: 't', header: 'Goal', render: (g) => <div><div className="font-semibold flex items-center gap-2"><Target className="w-4 h-4 text-muted" />{g.title}</div>{g.description && <div className="text-xs text-muted">{g.description}</div>}</div> },
          ...(staff ? [{ key: 'e', header: 'Employee', render: (g: any) => fullName(g.employee) }] : []),
          { key: 'p', header: 'Progress', render: (g) => <div className="w-32"><div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden"><div className="h-full bg-primary" style={{ width: `${g.progress}%` }} /></div><span className="text-xs text-muted">{g.progress}%</span></div> },
          { key: 'd', header: 'Due', render: (g) => fmtDate(g.dueDate) }, { key: 's', header: 'Status', render: (g) => <Badge value={g.status} /> },
          { key: 'a', header: '', render: (g) => <Button variant="ghost" onClick={() => { setUpd(g); setVal(g.progress); }}>Update</Button> },
        ]} />
      <FormModal open={add} title="New goal" schema={goalSchema} successMessage="Goal created" defaultValues={{ employeeId: '', title: '', description: '', targetValue: '', dueDate: '' }}
        fields={[{ name: 'title', label: 'Goal' }, { name: 'description', label: 'Description / KPI definition', type: 'textarea' },
          ...(staff ? [{ name: 'employeeId', label: 'For employee', type: 'select' as const, hint: 'Empty = yourself', options: people }] : []),
          { name: 'targetValue', label: 'Target value (optional)', type: 'number', half: true, step: '0.01' }, { name: 'dueDate', label: 'Due date', type: 'date', half: true }]}
        onSubmit={async (v) => { await api.post('/performance/goals', { ...v, targetValue: v.targetValue === '' ? undefined : v.targetValue }); reload(); }} onClose={() => setAdd(false)} />
      <Modal open={!!upd} title="Update progress" onClose={() => setUpd(null)}>
        <p className="font-semibold mb-2">{upd?.title}</p>
        <input type="range" min={0} max={100} step={5} value={val} className="w-full accent-[#9CC6E0]" aria-label="Progress" onChange={(e) => setVal(Number(e.target.value))} />
        <div className="text-center text-2xl font-bold my-2">{val}%</div>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setUpd(null)}>Cancel</Button><Button onClick={save}>Save</Button></div>
      </Modal>
    </>
  );
}

function Reviews({ staff }: { staff: boolean }) {
  const { user } = useAuth(); const people = usePeople();
  const { data, loading, error, reload } = useApi<any[]>('/performance/reviews');
  const [add, setAdd] = useState(false); const [open, setOpen] = useState<string | null>(null);
  const [self, setSelf] = useState(false); const [mgr, setMgr] = useState(false);
  const rv = data?.find((r) => r.id === open);
  const own = rv && rv.employeeId === user!.employeeId;
  return (
    <>
      {staff && <div className="flex justify-end mb-3"><Button onClick={() => setAdd(true)}><Plus className="w-4 h-4" />Start review</Button></div>}
      <DataTable rows={data ?? []} loading={loading} error={error} onRetry={reload} emptyTitle="No reviews yet" emptyHint={staff ? 'Start a review for someone on your team.' : 'Your manager will start a review cycle.'}
        columns={[
          { key: 'e', header: 'Employee', render: (r) => fullName(r.employee) }, { key: 'p', header: 'Period', render: (r) => `${fmtDate(r.periodStart)} - ${fmtDate(r.periodEnd)}` },
          { key: 's', header: 'Status', render: (r) => <Badge value={r.status} /> }, { key: 'r', header: 'Rating', render: (r) => (r.rating ? `${Number(r.rating)}/5` : '-') },
          { key: 'a', header: '', render: (r) => <Button variant="ghost" onClick={() => setOpen(r.id)}><ClipboardList className="w-4 h-4" />Open</Button> },
        ]} />
      <FormModal open={add} title="Start performance review" schema={reviewSchema} successMessage="Review started" defaultValues={{ employeeId: '', periodStart: '', periodEnd: '' }}
        fields={[{ name: 'employeeId', label: 'Employee', type: 'select', options: people.filter((p: any) => p.value !== user!.employeeId) }, { name: 'periodStart', label: 'Period start', type: 'date', half: true }, { name: 'periodEnd', label: 'Period end', type: 'date', half: true }]}
        onSubmit={async (v) => { await api.post('/performance/reviews', v); reload(); }} onClose={() => setAdd(false)} />
      {rv && <Modal open wide title={`Review - ${fullName(rv.employee)}`} onClose={() => setOpen(null)}>
        <div className="flex flex-wrap gap-2 items-center mb-4"><Badge value={rv.status} /><span className="text-sm text-muted">{fmtDate(rv.periodStart)} - {fmtDate(rv.periodEnd)}{rv.reviewer && ` - Reviewer: ${fullName(rv.reviewer)}`}</span></div>
        <Section title="Self assessment" text={rv.selfAssessment} empty="Not submitted yet" />
        <Section title="Manager feedback" text={rv.managerFeedback} empty="Not provided yet" />
        {rv.rating && <p className="text-sm mb-3"><b>Rating:</b> {Number(rv.rating)} / 5</p>}
        <Section title="Improvement plan" text={rv.improvementPlan} empty="None" />
        {rv.status !== 'COMPLETED' && <div className="flex justify-end gap-2 mt-4">
          {own && <Button onClick={() => setSelf(true)}>Write self assessment</Button>}
          {staff && !own && <Button onClick={() => setMgr(true)}>Give feedback & rating</Button>}
        </div>}
        <FormModal open={self} title="Self assessment" schema={selfSchema} successMessage="Self assessment submitted" defaultValues={{ selfAssessment: rv.selfAssessment ?? '' }}
          fields={[{ name: 'selfAssessment', label: 'How did this period go?', type: 'textarea' }]} onSubmit={async (v) => { await api.patch(`/performance/reviews/${rv.id}`, v); reload(); }} onClose={() => setSelf(false)} />
        <FormModal open={mgr} title="Manager feedback" schema={mgrSchema} successMessage="Feedback saved" defaultValues={{ managerFeedback: rv.managerFeedback ?? '', rating: rv.rating ? Number(rv.rating) : '', improvementPlan: rv.improvementPlan ?? '', complete: false }}
          fields={[{ name: 'managerFeedback', label: 'Feedback', type: 'textarea' }, { name: 'rating', label: 'Rating (1-5)', type: 'number', half: true, step: '0.5' }, { name: 'improvementPlan', label: 'Improvement plan (optional)', type: 'textarea' }, { name: 'complete', label: 'Mark review as completed (employee can no longer edit)', type: 'checkbox' }]}
          onSubmit={async (v) => { await api.patch(`/performance/reviews/${rv.id}`, v); reload(); }} onClose={() => setMgr(false)} />
      </Modal>}
    </>
  );
}
const Section = ({ title, text, empty }: { title: string; text?: string | null; empty: string }) => <div className="mb-3"><h4 className="text-xs font-bold uppercase text-muted mb-1">{title}</h4><p className="text-sm whitespace-pre-wrap">{text || <span className="text-muted">{empty}</span>}</p></div>;

function Analytics() {
  const { data, loading } = useApi<any>('/performance/analytics');
  if (loading) return <Skeleton className="h-72" />;
  if (!data) return <Card><Empty title="No analytics yet" /></Card>;
  const none = !data.byDepartment.length && !data.goals.length;
  if (none) return <Card><Empty title="No data yet" hint="Complete a review or add goals to see analytics." /></Card>;
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card><h3 className="font-bold mb-3">Average rating by department</h3><div className="h-64">{data.byDepartment.length ? <ResponsiveContainer><BarChart data={data.byDepartment}><CartesianGrid strokeDasharray="3 3" opacity={0.25} /><XAxis dataKey="name" /><YAxis domain={[0, 5]} /><Tooltip /><Bar dataKey="avg" fill="#9CC6E0" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer> : <Empty title="No completed reviews" />}</div></Card>
      <Card><h3 className="font-bold mb-3">Rating distribution</h3><div className="h-64"><ResponsiveContainer><BarChart data={data.distribution}><CartesianGrid strokeDasharray="3 3" opacity={0.25} /><XAxis dataKey="rating" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#E4002B" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
      <Card className="lg:col-span-2"><h3 className="font-bold mb-3">Goal status</h3><div className="h-64">{data.goals.length ? <ResponsiveContainer><PieChart><Pie data={data.goals.map((g: any) => ({ name: label(g.status), value: g.count }))} dataKey="value" nameKey="name" outerRadius={90} label>{data.goals.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer> : <Empty title="No goals" />}</div></Card>
    </div>
  );
}
