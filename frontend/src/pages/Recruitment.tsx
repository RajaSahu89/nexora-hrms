import { useState } from 'react';
import { z } from 'zod';
import { Briefcase, CalendarPlus, Download, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { useApi, useLookups } from '../hooks/useApi';
import { api, download, errMsg } from '../services/api';
import { Badge, Button, Card, ConfirmModal, ErrorBox, Modal, PageHeader, Skeleton, Tabs } from '../components/ui';
import DataTable from '../components/DataTable';
import FormModal from '../components/FormModal';
import Kanban from '../components/Kanban';
import { dateInput, fmtDate, fmtDateTime, label } from '../utils/format';

const STAGES = ['APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED', 'HIRED'];
const TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'];
const vacSchema = z.object({
  title: z.string().trim().min(3, 'Title is required'), description: z.string().trim().min(10, 'Add a short job description (10+ characters)'),
  requirements: z.string().optional(), departmentId: z.string().optional(), designationId: z.string().optional(), location: z.string().optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']), openings: z.coerce.number().int().min(1, 'At least 1'),
  status: z.enum(['DRAFT', 'OPEN', 'CLOSED']), closingDate: z.string().optional(),
});
const candSchema = z.object({
  fullName: z.string().trim().min(2, 'Name is required'), email: z.string().email('Enter a valid email'), phone: z.string().optional(), vacancyId: z.string().min(1, 'Select a vacancy'),
  skills: z.string().optional(), experienceYears: z.coerce.number().min(0).optional().or(z.literal('')), file: z.any().optional(),
});
const intSchema = z.object({ scheduledAt: z.string().min(1, 'Pick date and time'), interviewerId: z.string().optional(), mode: z.string().optional(), location: z.string().optional() });
const fbSchema = z.object({ status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']), rating: z.coerce.number().int().min(1).max(5).optional().or(z.literal('')), feedback: z.string().max(2000).optional() });

export default function Recruitment() {
  const { toast } = useToast(); const lk = useLookups();
  const [tab, setTab] = useState('board');
  const [vacancyId, setVacancyId] = useState('');
  const vac = useApi<any[]>('/recruitment/vacancies');
  const board = useApi<any[]>('/recruitment/board', vacancyId ? { vacancyId } : {});
  const [vForm, setVForm] = useState<any | null | false>(false);
  const [delVac, setDelVac] = useState<any>(null);
  const [cand, setCand] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const refresh = () => { vac.reload(); board.reload(); };
  const move = async (a: any, stage: string) => { try { await api.patch(`/recruitment/applications/${a.id}/stage`, { stage, position: 0 }); board.reload(); } catch (e) { toast('error', errMsg(e)); } };
  const selected = board.data?.find((a) => a.id === sel);
  const interviews = (board.data ?? []).flatMap((a) => a.interviews.map((i: any) => ({ ...i, candidate: a.candidate, vacancy: a.vacancy }))).sort((x, y) => +new Date(x.scheduledAt) - +new Date(y.scheduledAt));

  return (
    <>
      <PageHeader title="Recruitment" subtitle="Vacancies, candidates and the hiring pipeline"
        actions={<><Button variant="ghost" onClick={() => setVForm(null)}><Briefcase className="w-4 h-4" />New vacancy</Button><Button onClick={() => setCand(true)} disabled={!vac.data?.length}><UserPlus className="w-4 h-4" />Add candidate</Button></>} />
      <Tabs tabs={[{ id: 'board', label: 'Pipeline' }, { id: 'vacancies', label: 'Vacancies' }, { id: 'interviews', label: 'Interviews' }]} value={tab} onChange={setTab} />

      {tab === 'board' && <>
        <select className="input !w-auto mb-4" aria-label="Filter by vacancy" value={vacancyId} onChange={(e) => setVacancyId(e.target.value)}><option value="">All vacancies</option>{vac.data?.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}</select>
        {board.loading ? <div className="flex gap-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-64 w-64" />)}</div> : board.error ? <Card><ErrorBox message={board.error} retry={board.reload} /></Card> : (
          <Kanban columns={STAGES} items={board.data ?? []} getColumn={(a) => a.stage} getId={(a) => a.id} onMove={move}
            render={(a) => (
              <div>
                <button className="text-left font-semibold text-sm hover:underline" onClick={() => setSel(a.id)}>{a.candidate.fullName}</button>
                <div className="text-xs text-muted">{a.vacancy.title}</div>
                {a.candidate.experienceYears != null && <div className="text-xs text-muted">{Number(a.candidate.experienceYears)} yrs experience</div>}
                <select aria-label="Move to stage" className="mt-2 text-xs bg-transparent border border-black/10 dark:border-white/20 rounded-lg px-1 py-0.5 w-full" value={a.stage} onChange={(e) => move(a, e.target.value)}>{STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
              </div>
            )} />
        )}
      </>}

      {tab === 'vacancies' && (
        <DataTable rows={vac.data ?? []} loading={vac.loading} error={vac.error} onRetry={vac.reload} emptyTitle="No vacancies" emptyHint="Create a vacancy to start receiving candidates."
          columns={[
            { key: 't', header: 'Title', render: (v) => <div><div className="font-semibold">{v.title}</div><div className="text-xs text-muted">{v.department?.name ?? 'No department'} - {v.location || 'Location not set'}</div></div> },
            { key: 'o', header: 'Openings', render: (v) => v.openings }, { key: 'c', header: 'Applicants', render: (v) => v._count.applications },
            { key: 's', header: 'Status', render: (v) => <Badge value={v.status} /> }, { key: 'd', header: 'Closes', render: (v) => fmtDate(v.closingDate) },
            { key: 'a', header: '', render: (v) => <div className="flex gap-1 justify-end"><Button variant="ghost" className="!p-2" aria-label="Edit" onClick={() => setVForm(v)}><Pencil className="w-4 h-4" /></Button><Button variant="ghost" className="!p-2" aria-label="Delete" onClick={() => setDelVac(v)}><Trash2 className="w-4 h-4 text-accent" /></Button></div> },
          ]} />
      )}

      {tab === 'interviews' && (
        <DataTable rows={interviews} loading={board.loading} emptyTitle="No interviews scheduled" emptyHint="Open a candidate card to schedule one."
          columns={[
            { key: 'w', header: 'When', render: (i) => fmtDateTime(i.scheduledAt) }, { key: 'c', header: 'Candidate', render: (i) => i.candidate.fullName },
            { key: 'v', header: 'Vacancy', render: (i) => i.vacancy.title }, { key: 'm', header: 'Mode', render: (i) => `${i.mode || '-'}${i.location ? ` - ${i.location}` : ''}` },
            { key: 's', header: 'Status', render: (i) => <Badge value={i.status} /> }, { key: 'r', header: 'Rating', render: (i) => (i.rating ? `${i.rating}/5` : '-') },
          ]} />
      )}

      <FormModal open={vForm !== false} wide title={vForm ? 'Edit vacancy' : 'New vacancy'} schema={vacSchema} successMessage="Vacancy saved"
        defaultValues={vForm ? { ...vForm, requirements: vForm.requirements ?? '', departmentId: vForm.departmentId ?? '', designationId: vForm.designationId ?? '', location: vForm.location ?? '', closingDate: dateInput(vForm.closingDate) } : { title: '', description: '', requirements: '', departmentId: '', designationId: '', location: '', employmentType: 'FULL_TIME', openings: 1, status: 'OPEN', closingDate: '' }}
        fields={[
          { name: 'title', label: 'Job title' }, { name: 'description', label: 'Job description', type: 'textarea' }, { name: 'requirements', label: 'Requirements', type: 'textarea' },
          { name: 'departmentId', label: 'Department', type: 'select', half: true, options: lk.departments.map((d: any) => ({ value: d.id, label: d.name })) },
          { name: 'designationId', label: 'Designation', type: 'select', half: true, options: lk.designations.map((d: any) => ({ value: d.id, label: d.title })) },
          { name: 'location', label: 'Location', half: true }, { name: 'employmentType', label: 'Type', type: 'select', half: true, options: TYPES.map((t) => ({ value: t, label: label(t) })) },
          { name: 'openings', label: 'Openings', type: 'number', half: true }, { name: 'status', label: 'Status', type: 'select', half: true, options: ['DRAFT', 'OPEN', 'CLOSED'].map((t) => ({ value: t, label: label(t) })) },
          { name: 'closingDate', label: 'Closing date', type: 'date', half: true },
        ]}
        onSubmit={async (v) => {
          const body = { title: v.title, description: v.description, requirements: v.requirements, departmentId: v.departmentId, designationId: v.designationId, location: v.location, employmentType: v.employmentType, openings: v.openings, status: v.status, closingDate: v.closingDate };
          if (vForm) await api.put(`/recruitment/vacancies/${vForm.id}`, body); else await api.post('/recruitment/vacancies', body); refresh();
        }} onClose={() => setVForm(false)} />
      <ConfirmModal open={!!delVac} danger title="Delete vacancy" message={`Delete "${delVac?.title}" and all of its applications?`} confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/recruitment/vacancies/${delVac.id}`); toast('success', 'Vacancy deleted'); refresh(); } catch (e) { toast('error', errMsg(e)); } }} onClose={() => setDelVac(null)} />
      <FormModal open={cand} title="Add candidate" schema={candSchema} successMessage="Candidate added" submitLabel="Add"
        defaultValues={{ fullName: '', email: '', phone: '', vacancyId: vacancyId || '', skills: '', experienceYears: '' }}
        fields={[
          { name: 'fullName', label: 'Full name' }, { name: 'email', label: 'Email', type: 'email', half: true }, { name: 'phone', label: 'Phone', half: true },
          { name: 'vacancyId', label: 'Applying for', type: 'select', options: (vac.data ?? []).map((v) => ({ value: v.id, label: v.title })) },
          { name: 'skills', label: 'Skills (comma separated)', half: true }, { name: 'experienceYears', label: 'Experience (years)', type: 'number', half: true, step: '0.5' },
          { name: 'file', label: 'Resume (PDF or Word, optional)', type: 'file', accept: '.pdf,.doc,.docx' },
        ]}
        onSubmit={async (v) => {
          const fd = new FormData();
          (['fullName', 'email', 'phone', 'vacancyId', 'skills'] as const).forEach((k) => v[k] && fd.append(k, v[k]));
          if (v.experienceYears !== '' && v.experienceYears != null) fd.append('experienceYears', String(v.experienceYears));
          if (v.file?.length) fd.append('file', v.file[0]);
          await api.post('/recruitment/applications', fd); refresh();
        }} onClose={() => setCand(false)} />
      {selected && <Candidate app={selected} onClose={() => setSel(null)} onChanged={refresh} />}
    </>
  );
}

function Candidate({ app, onClose, onChanged }: { app: any; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast(); const lk = useLookups();
  const [sched, setSched] = useState(false); const [fb, setFb] = useState<any>(null); const [del, setDel] = useState(false);
  const c = app.candidate;
  return (
    <Modal open wide title={c.fullName} onClose={onClose}>
      <div className="text-sm space-y-1 mb-4">
        <div><Badge value={app.stage} /> <span className="text-muted ml-2">{app.vacancy.title}</span></div>
        <div>{c.email}{c.phone && ` - ${c.phone}`}</div>
        {c.experienceYears != null && <div>{Number(c.experienceYears)} years of experience</div>}
        {c.skills?.length > 0 && <div className="flex flex-wrap gap-1 pt-1">{c.skills.map((s: string) => <Badge key={s} value={s} tone="blue" />)}</div>}
      </div>
      <div className="flex flex-wrap gap-2 mb-5">
        {c.hasResume && <Button variant="ghost" onClick={() => download(`/recruitment/candidates/${c.id}/resume`, {}, `${c.fullName}-resume`).catch((e) => toast('error', errMsg(e)))}><Download className="w-4 h-4" />Resume</Button>}
        <Button onClick={() => setSched(true)}><CalendarPlus className="w-4 h-4" />Schedule interview</Button>
        <Button variant="ghost" onClick={() => setDel(true)}><Trash2 className="w-4 h-4 text-accent" />Remove application</Button>
      </div>
      <h3 className="font-bold text-sm mb-2">Interviews</h3>
      {app.interviews.length === 0 ? <p className="text-sm text-muted">None scheduled yet.</p> : (
        <div className="space-y-2">{app.interviews.map((i: any) => (
          <div key={i.id} className="glass !rounded-2xl p-3 text-sm flex flex-wrap items-center justify-between gap-2">
            <div><b>{fmtDateTime(i.scheduledAt)}</b> <Badge value={i.status} /><div className="text-xs text-muted">{i.mode || 'Mode not set'}{i.location ? ` - ${i.location}` : ''}{i.rating ? ` - Rating ${i.rating}/5` : ''}</div>{i.feedback && <div className="mt-1">{i.feedback}</div>}</div>
            <Button variant="ghost" onClick={() => setFb(i)}>Feedback</Button>
          </div>))}</div>
      )}
      <FormModal open={sched} title="Schedule interview" schema={intSchema} successMessage="Interview scheduled" defaultValues={{ scheduledAt: '', interviewerId: '', mode: 'Video', location: '' }}
        fields={[{ name: 'scheduledAt', label: 'Date and time', type: 'datetime-local' }, { name: 'interviewerId', label: 'Interviewer', type: 'select', options: lk.employees.map((e: any) => ({ value: e.id, label: `${e.firstName} ${e.lastName}` })) }, { name: 'mode', label: 'Mode', half: true }, { name: 'location', label: 'Location / link', half: true }]}
        onSubmit={async (v) => { await api.post('/recruitment/interviews', { applicationId: app.id, ...v, scheduledAt: new Date(v.scheduledAt).toISOString() }); onChanged(); }} onClose={() => setSched(false)} />
      <FormModal open={!!fb} title="Interview feedback" schema={fbSchema} successMessage="Feedback saved" defaultValues={fb ? { status: fb.status, rating: fb.rating ?? '', feedback: fb.feedback ?? '' } : {}}
        fields={[{ name: 'status', label: 'Status', type: 'select', half: true, options: ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((s) => ({ value: s, label: label(s) })) }, { name: 'rating', label: 'Rating (1-5)', type: 'number', half: true }, { name: 'feedback', label: 'Feedback', type: 'textarea' }]}
        onSubmit={async (v) => { await api.patch(`/recruitment/interviews/${fb.id}`, { status: v.status, rating: v.rating === '' ? undefined : v.rating, feedback: v.feedback }); onChanged(); }} onClose={() => setFb(null)} />
      <ConfirmModal open={del} danger title="Remove application" message={`Remove ${c.fullName}'s application for ${app.vacancy.title}?`} confirmLabel="Remove"
        onConfirm={async () => { try { await api.delete(`/recruitment/applications/${app.id}`); toast('success', 'Application removed'); onClose(); onChanged(); } catch (e) { toast('error', errMsg(e)); } }} onClose={() => setDel(false)} />
    </Modal>
  );
}
