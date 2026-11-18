import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Download, Eye, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useApi, useLookups } from '../hooks/useApi';
import { api, download, errMsg } from '../services/api';
import { isHR, Paged } from '../types';
import { Avatar, Badge, Button, ConfirmModal, PageHeader, Pagination } from '../components/ui';
import DataTable from '../components/DataTable';
import FormModal, { Field } from '../components/FormModal';
import { dateInput, fmtDate, label } from '../utils/format';

export const employeeSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'), lastName: z.string().trim().min(1, 'Last name is required'),
  email: z.string().email('Enter a valid email'), phone: z.string().regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone').optional().or(z.literal('')),
  dateOfBirth: z.string().optional(), gender: z.string().optional(), address: z.string().optional(),
  emergencyContactName: z.string().optional(), emergencyContactPhone: z.string().optional(), emergencyContactRel: z.string().optional(),
  departmentId: z.string().optional(), designationId: z.string().optional(), managerId: z.string().optional(),
  joiningDate: z.string().min(1, 'Joining date is required'), employmentType: z.string().min(1), employmentStatus: z.string().min(1), workLocation: z.string().optional(),
  education: z.string().optional(), experience: z.string().optional(), skills: z.string().optional(),
  password: z.string().optional().refine((v) => !v || (v.length >= 8 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v)), 'Min 8 chars with upper, lower and a number'),
  role: z.string().optional(),
});
const opt = (a: string[]) => a.map((v) => ({ value: v, label: label(v) }));

export const employeeFields = (lk: any, editing: boolean, superAdmin: boolean): Field[] => [
  { name: 'firstName', label: 'First name', half: true }, { name: 'lastName', label: 'Last name', half: true },
  { name: 'email', label: 'Email', type: 'email', half: true }, { name: 'phone', label: 'Phone', half: true },
  { name: 'dateOfBirth', label: 'Date of birth', type: 'date', half: true }, { name: 'gender', label: 'Gender', type: 'select', half: true, options: opt(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']) },
  { name: 'address', label: 'Address', type: 'textarea' },
  { name: 'emergencyContactName', label: 'Emergency contact name', half: true }, { name: 'emergencyContactPhone', label: 'Emergency contact phone', half: true },
  { name: 'departmentId', label: 'Department', type: 'select', half: true, options: lk.departments.map((d: any) => ({ value: d.id, label: d.name })) },
  { name: 'designationId', label: 'Designation', type: 'select', half: true, options: lk.designations.map((d: any) => ({ value: d.id, label: d.title })) },
  { name: 'managerId', label: 'Reporting manager', type: 'select', half: true, options: lk.employees.map((e: any) => ({ value: e.id, label: `${e.firstName} ${e.lastName}` })) },
  { name: 'joiningDate', label: 'Joining date', type: 'date', half: true },
  { name: 'employmentType', label: 'Employment type', type: 'select', half: true, options: opt(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']) },
  { name: 'employmentStatus', label: 'Status', type: 'select', half: true, options: opt(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED', 'RESIGNED']) },
  { name: 'workLocation', label: 'Work location', half: true }, { name: 'skills', label: 'Skills (comma separated)', half: true },
  { name: 'education', label: 'Education', type: 'textarea' }, { name: 'experience', label: 'Experience', type: 'textarea' },
  ...(editing ? [] : [
    { name: 'password', label: 'Login password (optional)', type: 'password' as const, half: true, hint: 'Leave empty to create a profile without a login' },
    { name: 'role', label: 'Login role', type: 'select' as const, half: true, options: opt(superAdmin ? ['EMPLOYEE', 'MANAGER', 'HR_ADMIN'] : ['EMPLOYEE', 'MANAGER']) },
  ]),
];

export const toForm = (e: any) => ({
  ...e, dateOfBirth: dateInput(e.dateOfBirth), joiningDate: dateInput(e.joiningDate), skills: (e.skills ?? []).join(', '),
  departmentId: e.departmentId ?? '', designationId: e.designationId ?? '', managerId: e.managerId ?? '', gender: e.gender ?? '',
  education: typeof e.education === 'string' ? e.education : '', experience: typeof e.experience === 'string' ? e.experience : '',
});

function parseCsv(text: string) {
  const rows: string[][] = []; let cur = ''; let row: string[] = []; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export default function Employees() {
  const { user } = useAuth(); const { toast } = useToast(); const lk = useLookups();
  const hr = isHR(user!.role);
  const [f, setF] = useState({ page: 1, limit: 10, search: '', departmentId: '', status: '', employmentType: '', sort: 'createdAt', order: 'desc' });
  const { data, loading, error, reload } = useApi<Paged<any>>('/employees', f);
  const [edit, setEdit] = useState<any | null | false>(false);
  const [del, setDel] = useState<any | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [bulk, setBulk] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 }));
  const rows = data?.data ?? [];
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const save = async (v: any) => {
    const body = { ...v, password: v.password || undefined, role: v.role || undefined };
    if (edit && edit.id) await api.put(`/employees/${edit.id}`, body); else await api.post('/employees', body);
    reload();
  };
  const runBulk = async () => {
    const r = await api.post('/employees/bulk', { ids: sel, action: bulk });
    toast('success', `${r.data.affected} updated${r.data.skipped ? `, ${r.data.skipped} skipped (linked records)` : ''}`); setSel([]); reload();
  };
  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = e.target.files?.[0]; e.target.value = '';
    if (!fl) return;
    try {
      const r = await api.post('/employees/import', { rows: parseCsv(await fl.text()) });
      toast(r.data.errors.length ? 'info' : 'success', `Imported ${r.data.created}. ${r.data.errors.length ? 'Failed rows: ' + r.data.errors.slice(0, 3).map((x: any) => `#${x.row} ${x.error}`).join('; ') : ''}`); reload();
    } catch (er) { toast('error', errMsg(er)); }
  };

  return (
    <>
      <PageHeader title="Employees" subtitle={`${data?.total ?? 0} people`} actions={hr && <>
        <input ref={file} type="file" accept=".csv" hidden onChange={onImport} />
        <Button variant="ghost" onClick={() => file.current?.click()}><Upload className="w-4 h-4" />Import CSV</Button>
        <Button variant="ghost" onClick={() => download('/employees/export.csv', {}, 'employees.csv').catch((e) => toast('error', errMsg(e)))}><Download className="w-4 h-4" />Export</Button>
        <Button onClick={() => setEdit(null)}><Plus className="w-4 h-4" />Add employee</Button></>} />
      <div className="glass p-3 mb-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
        <div className="relative lg:col-span-2"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input !pl-9" placeholder="Search name, email, ID" value={f.search} onChange={(e) => set('search', e.target.value)} aria-label="Search employees" /></div>
        <select className="input" value={f.departmentId} onChange={(e) => set('departmentId', e.target.value)} aria-label="Department"><option value="">All departments</option>{lk.departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status"><option value="">All statuses</option>{['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED', 'RESIGNED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select className="input" value={`${f.sort}:${f.order}`} onChange={(e) => { const [s, o] = e.target.value.split(':'); setF((x) => ({ ...x, sort: s, order: o })); }} aria-label="Sort">
          <option value="createdAt:desc">Newest</option><option value="firstName:asc">Name A-Z</option><option value="firstName:desc">Name Z-A</option><option value="joiningDate:asc">Joined (oldest)</option><option value="employeeCode:asc">Employee ID</option></select>
      </div>
      {hr && sel.length > 0 && <div className="glass p-3 mb-4 flex flex-wrap items-center gap-2"><b className="text-sm">{sel.length} selected</b><Button variant="ghost" onClick={() => setBulk('activate')}>Activate</Button><Button variant="ghost" onClick={() => setBulk('deactivate')}>Deactivate</Button><Button variant="accent" onClick={() => setBulk('delete')}>Delete</Button></div>}
      <DataTable rows={rows} loading={loading} error={error} onRetry={reload} emptyTitle="No employees found" emptyHint="Try different filters or add a new employee."
        columns={[
          ...(hr ? [{ key: 'sel', header: '', render: (e: any) => <input type="checkbox" aria-label="Select" checked={sel.includes(e.id)} onChange={() => toggle(e.id)} className="accent-[#9CC6E0]" /> }] : []),
          { key: 'name', header: 'Employee', render: (e: any) => <Link to={`/employees/${e.id}`} className="flex items-center gap-3"><Avatar name={`${e.firstName} ${e.lastName}`} src={e.photoUrl} /><div><div className="font-semibold">{e.firstName} {e.lastName}</div><div className="text-xs text-muted">{e.employeeCode} - {e.email}</div></div></Link> },
          { key: 'dept', header: 'Department', render: (e: any) => e.department?.name ?? '-' }, { key: 'des', header: 'Designation', render: (e: any) => e.designation?.title ?? '-' },
          { key: 'join', header: 'Joined', render: (e: any) => fmtDate(e.joiningDate) }, { key: 'st', header: 'Status', render: (e: any) => <Badge value={e.employmentStatus} /> },
          { key: 'act', header: '', render: (e: any) => <div className="flex gap-1"><Link to={`/employees/${e.id}`} className="btn btn-ghost !p-2" aria-label="View"><Eye className="w-4 h-4" /></Link>{hr && <><Button variant="ghost" className="!p-2" aria-label="Edit" onClick={() => setEdit(e)}><Pencil className="w-4 h-4" /></Button><Button variant="ghost" className="!p-2 text-accent" aria-label="Delete" onClick={() => setDel(e)}><Trash2 className="w-4 h-4" /></Button></>}</div> },
        ]}
        footer={data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={(p) => set('page', p)} />} />
      <FormModal open={edit !== false} wide title={edit ? 'Edit employee' : 'Add employee'} fields={employeeFields(lk, !!edit, user!.role === 'SUPER_ADMIN')} schema={employeeSchema}
        defaultValues={edit ? toForm(edit) : { employmentType: 'FULL_TIME', employmentStatus: 'ACTIVE', role: 'EMPLOYEE', joiningDate: dateInput(new Date()) }}
        onSubmit={save} onClose={() => setEdit(false)} successMessage={edit ? 'Employee updated' : 'Employee created'} />
      <ConfirmModal open={!!del} danger title="Delete employee" message={`Delete ${del?.firstName} ${del?.lastName}? This also removes their login and records. Consider deactivating instead.`} confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/employees/${del.id}`); toast('success', 'Employee deleted'); reload(); } catch (e) { toast('error', errMsg(e)); } }} onClose={() => setDel(null)} />
      <ConfirmModal open={!!bulk} danger={bulk === 'delete'} title="Bulk action" message={`Apply "${bulk}" to ${sel.length} employee(s)?`} confirmLabel="Apply"
        onConfirm={async () => { try { await runBulk(); } catch (e) { toast('error', errMsg(e)); } }} onClose={() => setBulk(null)} />
    </>
  );
}
