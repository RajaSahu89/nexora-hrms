import { useState } from 'react';
import { z } from 'zod';
import { Pencil, Plus, Star, Trash2, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useApi, useLookups } from '../hooks/useApi';
import { api, errMsg } from '../services/api';
import { isHR } from '../types';
import { Avatar, Button, Card, ConfirmModal, Empty, ErrorBox, Modal, PageHeader, Skeleton } from '../components/ui';
import FormModal from '../components/FormModal';
import { money } from '../utils/format';
import { Link } from 'react-router-dom';

const schema = z.object({ name: z.string().trim().min(2, 'Name is required'), description: z.string().optional(), budget: z.coerce.number().min(0, 'Must be positive').optional().or(z.literal('')), headId: z.string().optional() });

export default function Departments() {
  const { user } = useAuth(); const { toast } = useToast(); const lk = useLookups();
  const hr = isHR(user!.role);
  const { data, loading, error, reload } = useApi<any[]>('/departments');
  const [edit, setEdit] = useState<any | null | false>(false);
  const [del, setDel] = useState<any>(null);
  const [view, setView] = useState<string | null>(null);
  const detail = useApi<any>(view ? `/departments/${view}` : null);
  return (
    <>
      <PageHeader title="Departments" subtitle="Teams and structure" actions={hr && <Button onClick={() => setEdit(null)}><Plus className="w-4 h-4" />New department</Button>} />
      {loading ? <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div> : error ? <Card><ErrorBox message={error} retry={reload} /></Card> : !data?.length ? <Card><Empty title="No departments" hint="Create your first department." /></Card> : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.map((d) => (
            <Card key={d.id}>
              <div className="flex justify-between items-start"><h3 className="text-lg font-bold">{d.name}</h3>{hr && <div className="flex gap-1"><Button variant="ghost" className="!p-2" aria-label="Edit" onClick={() => setEdit(d)}><Pencil className="w-4 h-4" /></Button><Button variant="ghost" className="!p-2 text-accent" aria-label="Delete" onClick={() => setDel(d)}><Trash2 className="w-4 h-4" /></Button></div>}</div>
              <p className="text-sm text-muted mt-1 line-clamp-2 min-h-[2.5rem]">{d.description || 'No description'}</p>
              <div className="flex items-center gap-2 mt-3 text-sm"><Users className="w-4 h-4" />{d._count.employees} employees</div>
              <div className="text-sm text-muted mt-1">Head: {d.head ? `${d.head.firstName} ${d.head.lastName}` : 'Not assigned'}</div>
              {d.budget != null && <div className="text-sm text-muted">Budget: {money(d.budget)}</div>}
              <Button variant="ghost" className="mt-4 w-full" onClick={() => setView(d.id)}>View employees</Button>
            </Card>
          ))}
        </div>
      )}
      <FormModal open={edit !== false} title={edit ? 'Edit department' : 'New department'} schema={schema} submitLabel="Save"
        fields={[{ name: 'name', label: 'Name' }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'budget', label: 'Annual budget', type: 'number', half: true, step: '0.01' }, { name: 'headId', label: 'Department head', type: 'select', half: true, options: lk.employees.map((e: any) => ({ value: e.id, label: `${e.firstName} ${e.lastName}` })) }]}
        defaultValues={edit ? { ...edit, budget: edit.budget ?? '', headId: edit.headId ?? '' } : {}}
        onSubmit={async (v) => { const body = { ...v, budget: v.budget === '' ? undefined : v.budget }; if (edit) await api.put(`/departments/${edit.id}`, body); else await api.post('/departments', body); reload(); }}
        onClose={() => setEdit(false)} successMessage="Department saved" />
      <ConfirmModal open={!!del} danger title="Delete department" message={`Delete ${del?.name}? Departments with employees cannot be deleted.`} confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/departments/${del.id}`); toast('success', 'Department deleted'); reload(); } catch (e) { toast('error', errMsg(e)); } }} onClose={() => setDel(null)} />
      <Modal open={!!view} wide title={detail.data?.name ?? 'Department'} onClose={() => setView(null)}>
        {detail.loading ? <Skeleton className="h-32" /> : detail.data && <>
          <div className="flex items-center gap-2 text-sm mb-3"><Star className="w-4 h-4 text-amber-500" />Avg rating: <b>{detail.data.performance.avgRating ? Number(detail.data.performance.avgRating).toFixed(1) : 'n/a'}</b> <span className="text-muted">({detail.data.performance.reviews} completed reviews)</span></div>
          {detail.data.employees.length === 0 ? <Empty title="No employees in this department" /> : <div className="space-y-2">{detail.data.employees.map((e: any) => <Link key={e.id} to={`/employees/${e.id}`} className="flex items-center gap-3 p-2 rounded-xl hover:bg-primary/20"><Avatar name={`${e.firstName} ${e.lastName}`} src={e.photoUrl} /><div><div className="text-sm font-semibold">{e.firstName} {e.lastName}</div><div className="text-xs text-muted">{e.designation?.title ?? e.employeeCode}</div></div></Link>)}</div>}
        </>}
      </Modal>
    </>
  );
}
