import { useState } from 'react';
import { z } from 'zod';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Calculator, CheckCircle2, Download, Pencil, Wallet } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useApi, useLookups } from '../hooks/useApi';
import { api, download, errMsg } from '../services/api';
import { isHR } from '../types';
import { Badge, Button, Card, ConfirmModal, PageHeader, Tabs } from '../components/ui';
import DataTable from '../components/DataTable';
import FormModal from '../components/FormModal';
import { MONTHS, fullName, money } from '../utils/format';

const adjustSchema = z.object({ bonuses: z.coerce.number().min(0, 'Cannot be negative'), deductions: z.coerce.number().min(0, 'Cannot be negative') });
const salarySchema = z.object({ basic: z.coerce.number({ invalid_type_error: 'Enter a number' }).positive('Must be greater than 0'), allowances: z.coerce.number().min(0).optional().or(z.literal('')), fixedDeductions: z.coerce.number().min(0).optional().or(z.literal('')) });

const getPdf = (p: any, toast: any) => download(`/payroll/${p.id}/payslip.pdf`, {}, `payslip-${p.year}-${String(p.month).padStart(2, '0')}.pdf`).catch((e) => toast('error', errMsg(e)));

export default function Payroll() {
  const { user } = useAuth();
  const hr = isHR(user!.role);
  const [tab, setTab] = useState(hr ? 'run' : 'mine');
  const tabs = [...(hr ? [{ id: 'run', label: 'Payroll run' }, { id: 'structures', label: 'Salary structures' }, { id: 'summary', label: 'Summary' }] : []), { id: 'mine', label: hr ? 'My payslips' : 'Payslips' }];
  return (
    <>
      <PageHeader title={hr ? 'Payroll' : 'My Payroll'} subtitle={hr ? 'Estimates stay editable until you finalize them' : 'Your finalized payslips'} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'run' && <Run />}{tab === 'structures' && <Structures />}{tab === 'summary' && <Summary />}{tab === 'mine' && <Mine />}
    </>
  );
}

function Mine() {
  const { toast } = useToast();
  const { data, loading, error, reload } = useApi<any[]>('/payroll/my');
  return (
    <DataTable rows={data ?? []} loading={loading} error={error} onRetry={reload} emptyTitle="No payslips yet" emptyHint="Payslips appear here once HR finalizes payroll for a month."
      columns={[
        { key: 'p', header: 'Period', render: (p) => `${MONTHS[p.month - 1]} ${p.year}` },
        { key: 'g', header: 'Gross', render: (p) => money(p.grossPay) }, { key: 't', header: 'Tax', render: (p) => money(p.tax) }, { key: 'd', header: 'Deductions', render: (p) => money(p.deductions) },
        { key: 'n', header: 'Net pay', render: (p) => <b>{money(p.netPay)}</b> }, { key: 's', header: 'Status', render: (p) => <Badge value={p.status} /> },
        { key: 'a', header: '', render: (p) => <Button variant="ghost" onClick={() => getPdf(p, toast)}><Download className="w-4 h-4" />PDF</Button> },
      ]} />
  );
}

function Run() {
  const { toast } = useToast();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1); const [year, setYear] = useState(now.getFullYear());
  const { data, loading, error, reload } = useApi<any[]>('/payroll', { month, year });
  const [edit, setEdit] = useState<any>(null); const [fin, setFin] = useState<any>(null); const [finAll, setFinAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const est = (data ?? []).filter((p) => p.status === 'ESTIMATED').length;

  const generate = async () => {
    setBusy(true);
    try { const r = (await api.post('/payroll/generate', { month, year })).data; toast('success', `Estimates: ${r.created} created, ${r.skipped} skipped${r.noSalary ? `, ${r.noSalary} without salary structure` : ''}`); reload(); }
    catch (e) { toast('error', errMsg(e)); } finally { setBusy(false); }
  };
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast('success', ok); reload(); } catch (e) { toast('error', errMsg(e)); } };

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        <select className="input !w-auto" aria-label="Month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        <select className="input !w-auto" aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[-2, -1, 0, 1].map((d) => <option key={d}>{now.getFullYear() + d}</option>)}</select>
        <Button loading={busy} onClick={generate}><Calculator className="w-4 h-4" />Generate estimates</Button>
        <Button variant="ghost" disabled={!est} onClick={() => setFinAll(true)}><CheckCircle2 className="w-4 h-4" />Finalize all ({est})</Button>
      </div>
      <DataTable rows={data ?? []} loading={loading} error={error} onRetry={reload} emptyTitle={`No payroll for ${MONTHS[month - 1]} ${year}`} emptyHint="Set salary structures first, then generate estimates for this month."
        columns={[
          { key: 'e', header: 'Employee', render: (p) => <div><div className="font-semibold">{fullName(p.employee)}</div><div className="text-xs text-muted">{p.employee.employeeCode} - {p.employee.department?.name ?? 'No department'}</div></div> },
          { key: 'b', header: 'Basic', render: (p) => money(p.basicSalary) },
          { key: 'g', header: 'Gross', render: (p) => money(p.grossPay) },
          { key: 'x', header: 'Tax + deductions', render: (p) => money(Number(p.tax) + Number(p.deductions)) },
          { key: 'n', header: 'Net pay', render: (p) => <b>{money(p.netPay)}</b> },
          { key: 's', header: 'Status', render: (p) => <div><Badge value={p.status} />{p.status === 'ESTIMATED' && <div className="text-[10px] text-muted mt-0.5">Estimate - not final</div>}</div> },
          { key: 'a', header: '', render: (p) => (
            <div className="flex gap-1 justify-end flex-wrap">
              {p.status === 'ESTIMATED' && <><Button variant="ghost" className="!p-2" aria-label="Adjust" onClick={() => setEdit(p)}><Pencil className="w-4 h-4" /></Button><Button onClick={() => setFin(p)}>Finalize</Button></>}
              {p.status === 'FINALIZED' && <Button variant="ghost" onClick={() => act(() => api.post(`/payroll/${p.id}/mark-paid`), 'Marked as paid')}>Mark paid</Button>}
              {p.status !== 'ESTIMATED' && <Button variant="ghost" className="!p-2" aria-label="Download payslip" onClick={() => getPdf(p, toast)}><Download className="w-4 h-4" /></Button>}
            </div>) },
        ]} />
      <FormModal open={!!edit} title={`Adjust payroll - ${edit ? fullName(edit.employee) : ''}`} schema={adjustSchema} submitLabel="Recalculate" successMessage="Payroll updated"
        defaultValues={edit ? { bonuses: Number(edit.bonuses), deductions: Number(edit.deductions) } : {}}
        fields={[{ name: 'bonuses', label: 'Bonuses', type: 'number', half: true, step: '0.01' }, { name: 'deductions', label: 'Total deductions', type: 'number', half: true, step: '0.01' }]}
        onSubmit={async (v) => { await api.patch(`/payroll/${edit.id}`, v); reload(); }} onClose={() => setEdit(null)} />
      <ConfirmModal open={!!fin} title="Finalize payslip" message={`Finalize ${fin ? fullName(fin.employee) : ''}? Finalized payroll can no longer be edited and the employee is notified.`} confirmLabel="Finalize"
        onConfirm={() => act(() => api.post(`/payroll/${fin.id}/finalize`), 'Payroll finalized')} onClose={() => setFin(null)} />
      <ConfirmModal open={finAll} title="Finalize all estimates" message={`Finalize all ${est} estimated payslips for ${MONTHS[month - 1]} ${year}?`} confirmLabel="Finalize all"
        onConfirm={() => act(async () => { await api.post('/payroll/finalize-all', { month, year }); }, 'Payroll finalized')} onClose={() => setFinAll(false)} />
    </>
  );
}

function Structures() {
  const lk = useLookups(); const { toast } = useToast();
  const [form, setForm] = useState<any>(null);
  const open = async (e: any) => {
    try {
      const cur: any[] = (await api.get(`/payroll/salary/${e.id}`)).data.current;
      const sum = (f: (c: any) => boolean) => cur.filter(f).reduce((s, c) => s + Number(c.amount), 0);
      setForm({ emp: e, values: { basic: Number(cur.find((c) => c.name === 'Basic')?.amount ?? ''), allowances: sum((c) => c.type === 'EARNING' && c.name !== 'Basic' && c.name !== 'HRA') || '', fixedDeductions: sum((c) => c.type === 'DEDUCTION') || '' } });
    } catch (er) { toast('error', errMsg(er)); }
  };
  return (
    <>
      <DataTable rows={lk.employees} emptyTitle="No active employees" columns={[
        { key: 'e', header: 'Employee', render: (e) => fullName(e) }, { key: 'c', header: 'ID', render: (e) => e.employeeCode },
        { key: 'a', header: '', render: (e) => <Button variant="ghost" onClick={() => open(e)}><Wallet className="w-4 h-4" />Set salary</Button> },
      ]} />
      <FormModal open={!!form} title={`Salary structure - ${form ? fullName(form.emp) : ''}`} schema={salarySchema} submitLabel="Save structure" successMessage="Salary structure saved"
        defaultValues={form?.values}
        fields={[{ name: 'basic', label: 'Monthly basic salary', type: 'number', step: '0.01', hint: 'HRA, tax and overtime follow Settings > Payroll' }, { name: 'allowances', label: 'Fixed allowances', type: 'number', half: true, step: '0.01' }, { name: 'fixedDeductions', label: 'Fixed deductions', type: 'number', half: true, step: '0.01' }]}
        onSubmit={async (v) => { await api.put(`/payroll/salary/${form.emp.id}`, { basic: v.basic, allowances: v.allowances === '' ? undefined : v.allowances, fixedDeductions: v.fixedDeductions === '' ? undefined : v.fixedDeductions }); }}
        onClose={() => setForm(null)} />
    </>
  );
}

function Summary() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, loading } = useApi<any[]>('/payroll', { year });
  const rows = MONTHS.map((m, i) => {
    const list = (data ?? []).filter((p) => p.month === i + 1);
    const sum = (f: (p: any) => boolean) => Math.round(list.filter(f).reduce((s, p) => s + Number(p.netPay), 0));
    return { name: m.slice(0, 3), Finalized: sum((p) => p.status !== 'ESTIMATED'), Estimated: sum((p) => p.status === 'ESTIMATED') };
  });
  return (
    <Card>
      <div className="flex items-center justify-between mb-3"><h3 className="font-bold">Net payroll by month</h3><select className="input !w-auto" aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[-2, -1, 0, 1].map((d) => <option key={d}>{new Date().getFullYear() + d}</option>)}</select></div>
      <div className="h-72">{loading ? <div className="skeleton h-full" /> : (
        <ResponsiveContainer><BarChart data={rows}><CartesianGrid strokeDasharray="3 3" opacity={0.25} /><XAxis dataKey="name" /><YAxis /><Tooltip formatter={(v: any) => money(v)} /><Legend />
          <Bar dataKey="Finalized" stackId="a" fill="#9CC6E0" /><Bar dataKey="Estimated" stackId="a" fill="#E4002B" opacity={0.6} /></BarChart></ResponsiveContainer>)}</div>
      <p className="text-xs text-muted mt-2">Red bars are estimates that are not finalized yet.</p>
    </Card>
  );
}
