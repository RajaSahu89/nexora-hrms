import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { Moon, Pencil, Plus, Sun, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useApi } from '../hooks/useApi';
import { api, errMsg } from '../services/api';
import { isHR } from '../types';
import { Badge, Button, Card, ConfirmModal, Empty, PageHeader, Skeleton, Tabs } from '../components/ui';
import DataTable from '../components/DataTable';
import FormModal from '../components/FormModal';
import { fmtDate, fullName, label, setCurrency } from '../utils/format';

type F = { name: string; label: string; type?: string; min?: number; max?: number; step?: string; options?: string[]; required?: boolean };

export default function Settings() {
  const { user } = useAuth();
  const hr = isHR(user!.role); const admin = user!.role === 'SUPER_ADMIN';
  const [tab, setTab] = useState('company');
  const tabs = [
    { id: 'company', label: 'Company' }, ...(hr ? [{ id: 'attendance', label: 'Working hours' }, { id: 'payroll', label: 'Payroll' }, { id: 'leave', label: 'Leave policies' }, { id: 'titles', label: 'Job titles' }, { id: 'holidays', label: 'Holidays' }] : []),
    ...(admin ? [{ id: 'users', label: 'Users & permissions' }] : []), { id: 'theme', label: 'Appearance' }, { id: 'notify', label: 'Notifications' }, { id: 'account', label: 'Account' },
  ];
  return (
    <>
      <PageHeader title="Settings" subtitle="Organization, policies and your preferences" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'company' && <Company canEdit={hr} />}
      {tab === 'attendance' && <KeyForm k="attendance.rules" title="Attendance rules & working hours" help="Used for late-arrival, half-day and overtime calculations."
        fields={[{ name: 'workStart', label: 'Work starts', type: 'time', required: true }, { name: 'workEnd', label: 'Work ends', type: 'time', required: true }, { name: 'graceMinutes', label: 'Late grace (minutes)', type: 'number', min: 0, max: 120 }, { name: 'halfDayHours', label: 'Half-day below (hours)', type: 'number', min: 0, max: 12, step: '0.5' }, { name: 'fullDayHours', label: 'Full day (hours)', type: 'number', min: 1, max: 16, step: '0.5' }]} />}
      {tab === 'payroll' && <KeyForm k="payroll.config" title="Payroll settings" help="Applies to newly generated estimates. Finalized payroll is never changed."
        fields={[{ name: 'hraPercentOfBasic', label: 'HRA (% of basic)', type: 'number', min: 0, max: 100, step: '0.5' }, { name: 'taxPercent', label: 'Tax (% of gross)', type: 'number', min: 0, max: 60, step: '0.5' }, { name: 'overtimeMultiplier', label: 'Overtime multiplier', type: 'number', min: 1, max: 5, step: '0.25' }, { name: 'workingDaysPerMonth', label: 'Working days / month', type: 'number', min: 1, max: 31 }]} />}
      {tab === 'leave' && <LeavePolicies />}{tab === 'titles' && <Titles />}{tab === 'holidays' && <Holidays />}{tab === 'users' && <Users />}
      {tab === 'theme' && <Theme />}{tab === 'notify' && <NotifyPrefs />}{tab === 'account' && <Account />}
    </>
  );
}

function KeyForm({ k, title, help, fields, canEdit = true, extra, afterSave }: { k: string; title: string; help?: string; fields: F[]; canEdit?: boolean; extra?: React.ReactNode; afterSave?: (v: any) => void }) {
  const { toast } = useToast();
  const { data, loading, reload } = useApi<any>('/settings');
  const cur = data?.[k] ?? {};
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<any>({ defaultValues: cur });
  useEffect(() => { reset(cur); }, [data]);
  const submit = handleSubmit(async (v) => {
    const value = { ...cur };
    fields.forEach((f) => { value[f.name] = f.type === 'number' ? Number(v[f.name]) : v[f.name]; });
    try { await api.put(`/settings/key/${k}`, { value }); toast('success', 'Settings saved'); afterSave?.(value); reload(); } catch (e) { toast('error', errMsg(e)); }
  });
  if (loading) return <Skeleton className="h-48" />;
  return (
    <Card>
      <h3 className="font-bold">{title}</h3>{help && <p className="text-sm text-muted mb-4">{help}</p>}
      {extra}
      <form onSubmit={submit} noValidate className="grid sm:grid-cols-2 gap-3 mt-3">
        {fields.map((f) => (
          <div key={f.name}>
            <label htmlFor={`${k}-${f.name}`} className="block text-xs font-semibold text-muted mb-1">{f.label}</label>
            {f.options ? <select id={`${k}-${f.name}`} className="input" disabled={!canEdit} {...register(f.name)}>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
              : <input id={`${k}-${f.name}`} type={f.type ?? 'text'} step={f.step} disabled={!canEdit} className={`input ${errors[f.name] ? 'err' : ''}`}
                {...register(f.name, { ...(f.required && { required: 'Required' }), ...(f.type === 'number' && { valueAsNumber: true, validate: (x: any) => (Number.isFinite(x) && (f.min == null || x >= f.min) && (f.max == null || x <= f.max)) || `Enter a number${f.min != null ? ` from ${f.min}` : ''}${f.max != null ? ` to ${f.max}` : ''}` }) })} />}
            {errors[f.name] && <p className="text-xs text-accent mt-1">{errors[f.name]?.message as string}</p>}
          </div>
        ))}
        {canEdit ? <div className="sm:col-span-2 flex justify-end"><Button type="submit" loading={isSubmitting}>Save changes</Button></div> : <p className="sm:col-span-2 text-xs text-muted">Only HR can change these settings.</p>}
      </form>
    </Card>
  );
}

function Company({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const { data, reload } = useApi<any>('/settings');
  const logo = data?.['company.profile']?.logoUrl;
  const upload = async (f?: File) => {
    if (!f) return; const fd = new FormData(); fd.append('file', f);
    try { await api.post('/settings/logo', fd); toast('success', 'Logo updated'); reload(); } catch (e) { toast('error', errMsg(e)); }
  };
  return (
    <KeyForm k="company.profile" title="Company profile" canEdit={canEdit} afterSave={(v) => setCurrency(v.currency)}
      fields={[{ name: 'name', label: 'Company name', required: true }, { name: 'industry', label: 'Industry' }, { name: 'email', label: 'Contact email', type: 'email' }, { name: 'phone', label: 'Phone' }, { name: 'website', label: 'Website' }, { name: 'address', label: 'Address' }, { name: 'timezone', label: 'Timezone' }, { name: 'currency', label: 'Currency', options: ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD'] }]}
      extra={<div className="flex items-center gap-4">{logo ? <img src={logo} alt="Company logo" className="h-14 w-14 rounded-2xl object-cover" /> : <div className="h-14 w-14 rounded-2xl bg-primary/50 grid place-items-center font-bold">N</div>}
        {canEdit && <label className="text-sm"><span className="block text-xs font-semibold text-muted mb-1">Company logo (PNG/JPG/WebP, max 2 MB)</span><input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(e) => upload(e.target.files?.[0])} /></label>}</div>} />
  );
}

function LeavePolicies() {
  const { data, loading, error, reload } = useApi<any>('/settings/lookups');
  const [form, setForm] = useState<any | null | false>(false);
  const addSchema = z.object({ name: z.string().trim().min(2, 'Name is required'), code: z.string().trim().min(1, 'Code is required').max(8), defaultDays: z.coerce.number().min(0).max(365), isPaid: z.boolean().optional(), description: z.string().optional() });
  const editSchema = z.object({ defaultDays: z.coerce.number().min(0).max(365), isPaid: z.boolean().optional(), carryForward: z.boolean().optional() });
  return (
    <>
      <div className="flex justify-end mb-3"><Button onClick={() => setForm(null)}><Plus className="w-4 h-4" />New leave type</Button></div>
      <DataTable rows={data?.leaveTypes ?? []} loading={loading} error={error} onRetry={reload} emptyTitle="No leave types" columns={[
        { key: 'n', header: 'Leave type', render: (t) => <b>{t.name}</b> }, { key: 'c', header: 'Code', render: (t) => t.code }, { key: 'd', header: 'Days / year', render: (t) => Number(t.defaultDays) },
        { key: 'p', header: 'Paid', render: (t) => (t.isPaid ? 'Yes' : 'No') }, { key: 'f', header: 'Carry forward', render: (t) => (t.carryForward ? 'Yes' : 'No') },
        { key: 'a', header: '', render: (t) => <Button variant="ghost" className="!p-2" aria-label="Edit" onClick={() => setForm(t)}><Pencil className="w-4 h-4" /></Button> },
      ]} />
      <p className="text-xs text-muted mt-2">Changing days per year affects balances created from now on; existing balances are not rewritten.</p>
      <FormModal open={form !== false} title={form ? `Edit ${form.name}` : 'New leave type'} schema={form ? editSchema : addSchema} successMessage="Leave policy saved"
        defaultValues={form ? { defaultDays: Number(form.defaultDays), isPaid: form.isPaid, carryForward: form.carryForward } : { name: '', code: '', defaultDays: 0, isPaid: true, description: '' }}
        fields={form ? [{ name: 'defaultDays', label: 'Days per year', type: 'number', step: '0.5' }, { name: 'isPaid', label: 'Paid leave', type: 'checkbox' }, { name: 'carryForward', label: 'Carry unused days forward', type: 'checkbox' }]
          : [{ name: 'name', label: 'Name' }, { name: 'code', label: 'Code (e.g. CL)', half: true }, { name: 'defaultDays', label: 'Days per year', type: 'number', half: true, step: '0.5' }, { name: 'description', label: 'Description' }, { name: 'isPaid', label: 'Paid leave', type: 'checkbox' }]}
        onSubmit={async (v) => { if (form) await api.put(`/settings/leave-types/${form.id}`, v); else await api.post('/settings/leave-types', v); reload(); }} onClose={() => setForm(false)} />
    </>
  );
}

function Titles() {
  const { toast } = useToast();
  const { data, loading, error, reload } = useApi<any>('/settings/lookups');
  const [add, setAdd] = useState(false); const [del, setDel] = useState<any>(null);
  const schema = z.object({ title: z.string().trim().min(2, 'Title is required').max(80), level: z.coerce.number().int().min(1).max(20) });
  return (
    <>
      <div className="flex flex-wrap justify-between gap-2 mb-3"><Link to="/departments" className="btn btn-ghost">Manage departments</Link><Button onClick={() => setAdd(true)}><Plus className="w-4 h-4" />New job title</Button></div>
      <DataTable rows={data?.designations ?? []} loading={loading} error={error} onRetry={reload} emptyTitle="No job titles" columns={[
        { key: 't', header: 'Job title', render: (d) => <b>{d.title}</b> },
        { key: 'a', header: '', render: (d) => <Button variant="ghost" className="!p-2" aria-label="Delete" onClick={() => setDel(d)}><Trash2 className="w-4 h-4 text-accent" /></Button> },
      ]} />
      <FormModal open={add} title="New job title" schema={schema} successMessage="Job title added" defaultValues={{ title: '', level: 1 }}
        fields={[{ name: 'title', label: 'Title' }, { name: 'level', label: 'Seniority level (1-20)', type: 'number', hint: 'Higher number = more senior' }]}
        onSubmit={async (v) => { await api.post('/settings/designations', v); reload(); }} onClose={() => setAdd(false)} />
      <ConfirmModal open={!!del} danger title="Delete job title" message={`Delete "${del?.title}"? Titles in use cannot be deleted.`} confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/settings/designations/${del.id}`); toast('success', 'Job title deleted'); reload(); } catch (e) { toast('error', errMsg(e)); } }} onClose={() => setDel(null)} />
    </>
  );
}

function Holidays() {
  const { toast } = useToast();
  const { data, loading, error, reload } = useApi<any[]>('/settings/holidays');
  const [add, setAdd] = useState(false); const [del, setDel] = useState<any>(null);
  const schema = z.object({ name: z.string().trim().min(2, 'Name is required').max(80), date: z.string().min(1, 'Pick a date'), isOptional: z.boolean().optional() });
  return (
    <>
      <div className="flex justify-end mb-3"><Button onClick={() => setAdd(true)}><Plus className="w-4 h-4" />Add holiday</Button></div>
      <DataTable rows={data ?? []} loading={loading} error={error} onRetry={reload} emptyTitle="No holidays yet" emptyHint="Holidays are skipped when leave days are counted." columns={[
        { key: 'd', header: 'Date', render: (h) => fmtDate(h.date) }, { key: 'n', header: 'Holiday', render: (h) => <b>{h.name}</b> }, { key: 'o', header: 'Optional', render: (h) => (h.isOptional ? 'Yes' : 'No') },
        { key: 'a', header: '', render: (h) => <Button variant="ghost" className="!p-2" aria-label="Delete" onClick={() => setDel(h)}><Trash2 className="w-4 h-4 text-accent" /></Button> },
      ]} />
      <FormModal open={add} title="Add holiday" schema={schema} successMessage="Holiday added" defaultValues={{ name: '', date: '', isOptional: false }}
        fields={[{ name: 'name', label: 'Name' }, { name: 'date', label: 'Date', type: 'date' }, { name: 'isOptional', label: 'Optional holiday', type: 'checkbox' }]}
        onSubmit={async (v) => { await api.post('/settings/holidays', v); reload(); }} onClose={() => setAdd(false)} />
      <ConfirmModal open={!!del} danger title="Delete holiday" message={`Delete "${del?.name}"?`} confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/settings/holidays/${del.id}`); toast('success', 'Holiday deleted'); reload(); } catch (e) { toast('error', errMsg(e)); } }} onClose={() => setDel(null)} />
    </>
  );
}

function Users() {
  const { user } = useAuth(); const { toast } = useToast();
  const users = useApi<any[]>('/settings/users'); const roles = useApi<any[]>('/settings/roles');
  const patch = async (id: string, body: any) => { try { await api.put(`/settings/users/${id}`, body); toast('success', 'User updated'); users.reload(); } catch (e) { toast('error', errMsg(e)); } };
  return (
    <>
      <DataTable rows={users.data ?? []} loading={users.loading} error={users.error} onRetry={users.reload} emptyTitle="No users" columns={[
        { key: 'u', header: 'User', render: (u) => <div><div className="font-semibold">{u.employee ? fullName(u.employee) : u.email}</div><div className="text-xs text-muted">{u.email}</div></div> },
        { key: 'r', header: 'Role', render: (u) => <select className="input !w-auto !py-1" aria-label="Role" value={u.role.name} disabled={u.id === user!.id} onChange={(e) => patch(u.id, { role: e.target.value })}>{['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE'].map((r) => <option key={r} value={r}>{label(r)}</option>)}</select> },
        { key: 'l', header: 'Last login', render: (u) => fmtDate(u.lastLoginAt) },
        { key: 's', header: 'Access', render: (u) => <Button variant="ghost" disabled={u.id === user!.id} onClick={() => patch(u.id, { isActive: !u.isActive })}>{u.isActive ? <Badge value="ACTIVE" /> : <Badge value="INACTIVE" />}<span>{u.isActive ? 'Disable' : 'Enable'}</span></Button> },
      ]} />
      <h3 className="font-bold mt-6 mb-2">Role permissions</h3>
      <div className="grid md:grid-cols-2 gap-4">
        {(roles.data ?? []).map((r) => <Card key={r.id}><h4 className="font-semibold mb-2">{label(r.name)}</h4><div className="flex flex-wrap gap-1">{r.permissions.length ? r.permissions.map((p: any) => <Badge key={p.key} value={p.key} tone="blue" />) : <span className="text-xs text-muted">None listed</span>}</div></Card>)}
      </div>
      <p className="text-xs text-muted mt-2">Access is enforced on the server by role. This list shows what each role is assigned.</p>
    </>
  );
}

function Theme() {
  const { dark, setDark } = useTheme();
  return (
    <Card><h3 className="font-bold mb-3">Appearance</h3>
      <div className="flex gap-3">
        <Button variant={dark ? 'ghost' : 'primary'} onClick={() => setDark(false)}><Sun className="w-4 h-4" />Light</Button>
        <Button variant={dark ? 'primary' : 'ghost'} onClick={() => setDark(true)}><Moon className="w-4 h-4" />Dark</Button>
      </div>
      <p className="text-xs text-muted mt-3">Saved on this device.</p>
    </Card>
  );
}

function NotifyPrefs() {
  const KEY = 'nexora-notify-prefs';
  const items: [string, string][] = [['leave', 'Leave approvals and rejections'], ['tasks', 'Task assignments and deadlines'], ['payroll', 'Payroll updates'], ['announcements', 'Company announcements'], ['documents', 'Document expiry reminders']];
  const [p, setP] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } });
  const set = (k: string, v: boolean) => { const n = { ...p, [k]: v }; setP(n); try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* ignore */ } };
  return (
    <Card><h3 className="font-bold mb-3">Notification preferences</h3>
      <div className="space-y-3">{items.map(([k, l]) => <label key={k} className="flex items-center gap-3 text-sm"><input type="checkbox" className="w-4 h-4 accent-[#9CC6E0]" checked={p[k] !== false} onChange={(e) => set(k, e.target.checked)} />{l}</label>)}</div>
      <p className="text-xs text-muted mt-4">These preferences are stored on this device only. The server currently sends all in-app notifications regardless of these switches.</p>
    </Card>
  );
}

const pwdSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z.string().min(8, 'Min 8 characters').regex(/[a-z]/, 'Needs a lowercase letter').regex(/[A-Z]/, 'Needs an uppercase letter').regex(/[0-9]/, 'Needs a number'),
  confirm: z.string(),
}).refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

function Account() {
  const { user } = useAuth(); const { toast } = useToast();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<any>({ resolver: zodResolver(pwdSchema) as any });
  const submit = handleSubmit(async (v) => {
    try { await api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword }); toast('success', 'Password changed'); reset(); } catch (e) { toast('error', errMsg(e)); }
  });
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card><h3 className="font-bold">Account</h3><p className="text-sm mt-2">{user!.name}</p><p className="text-sm text-muted">{user!.email}</p><div className="mt-2"><Badge value={user!.role} tone="blue" /></div>
        <Link to="/profile" className="btn btn-ghost mt-4">Edit my profile</Link></Card>
      <Card><h3 className="font-bold mb-3">Change password</h3>
        <form onSubmit={submit} noValidate className="space-y-3">
          {([['currentPassword', 'Current password'], ['newPassword', 'New password'], ['confirm', 'Confirm new password']] as const).map(([n, l]) => (
            <div key={n}><label htmlFor={n} className="block text-xs font-semibold text-muted mb-1">{l}</label><input id={n} type="password" autoComplete={n === 'currentPassword' ? 'current-password' : 'new-password'} className={`input ${errors[n] ? 'err' : ''}`} {...register(n)} />{errors[n] && <p className="text-xs text-accent mt-1">{errors[n]?.message as string}</p>}</div>
          ))}
          <Button type="submit" loading={isSubmitting}>Update password</Button>
        </form></Card>
    </div>
  );
}
