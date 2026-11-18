import { useState } from 'react';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useApi, useLookups } from '../hooks/useApi';
import { api, errMsg } from '../services/api';
import { isHR, Paged } from '../types';
import { Badge, Button, Card, PageHeader, Pagination, Tabs } from '../components/ui';
import DataTable from '../components/DataTable';
import CheckInCard from '../components/CheckInCard';
import FormModal from '../components/FormModal';
import MonthGrid, { DayInfo } from '../components/MonthGrid';
import { fmtDate, fmtTime, hours, label, monthNow, todayStr } from '../utils/format';

const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY'];
const tone: any = { PRESENT: 'green', LATE: 'amber', HALF_DAY: 'amber', ABSENT: 'red', ON_LEAVE: 'blue', HOLIDAY: 'gray' };
const manualSchema = z.object({ employeeId: z.string().min(1, 'Select an employee'), date: z.string().min(1, 'Date required'), status: z.string().min(1), checkIn: z.string().optional(), checkOut: z.string().optional(), note: z.string().optional() });
const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Please explain (min 5 characters)') });
const decideSchema = z.object({ status: z.string().optional(), checkIn: z.string().optional(), checkOut: z.string().optional(), note: z.string().optional() });

export default function Attendance() {
  const { user } = useAuth(); const { toast } = useToast(); const lk = useLookups();
  const hr = isHR(user!.role); const staff = user!.role !== 'EMPLOYEE';
  const [tab, setTab] = useState(staff ? 'records' : 'today');
  const [month, setMonth] = useState(monthNow());
  const [f, setF] = useState({ page: 1, limit: 12, from: '', to: '', status: '', departmentId: '', correction: '' });
  const today = useApi<any>(!staff ? '/attendance/today' : null);
  const list = useApi<Paged<any>>('/attendance', f);
  const cal = useApi<any>(!staff ? '/attendance/calendar' : null, { month });
  const sum = useApi<any[]>(staff && tab === 'summary' ? '/attendance/summary' : null, { month, departmentId: f.departmentId || undefined });
  const [manual, setManual] = useState(false);
  const [corr, setCorr] = useState<any>(null);
  const [decide, setDecide] = useState<any>(null);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 1 }));

  const days: Record<string, DayInfo> = {};
  cal.data?.records.forEach((r: any) => { days[r.date.slice(0, 10)] = { text: r.status === 'HALF_DAY' ? 'HD' : r.status[0], tone: tone[r.status] }; });
  cal.data?.holidays.forEach((h: any) => { days[h.date.slice(0, 10)] = { text: 'H', tone: 'gray' }; });
  cal.data?.leaves.forEach((l: any) => { for (let d = new Date(l.startDate); d <= new Date(l.endDate); d = new Date(d.getTime() + 864e5)) days[d.toISOString().slice(0, 10)] = { text: 'L', tone: 'blue' }; });

  const tabs = staff ? [{ id: 'records', label: 'Records' }, { id: 'summary', label: 'Monthly summary' }] : [{ id: 'today', label: 'Today' }, { id: 'calendar', label: 'Calendar' }, { id: 'history', label: 'History' }];
  const showTable = staff ? tab === 'records' : tab === 'history';
  const local = (d: string) => (d ? new Date(d).toISOString().slice(0, 16) : '');
  return (
    <>
      <PageHeader title={staff ? 'Attendance' : 'My Attendance'} subtitle="Check in, track hours and manage corrections" actions={hr && <Button onClick={() => setManual(true)}><Plus className="w-4 h-4" />Manual entry</Button>} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {!staff && tab === 'today' && <div className="max-w-xl"><CheckInCard att={today.data} onChange={() => { today.reload(); list.reload(); }} /></div>}
      {!staff && tab === 'calendar' && <div className="max-w-xl"><MonthGrid month={month} onMonth={setMonth} days={days} /><p className="text-xs text-muted mt-2">P present, L (green/amber) late, A absent, HD half day, H holiday, L (blue) leave</p></div>}
      {showTable && <>
        <div className="glass p-3 mb-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <input type="date" className="input" value={f.from} max={todayStr()} onChange={(e) => set('from', e.target.value)} aria-label="From" />
          <input type="date" className="input" value={f.to} max={todayStr()} onChange={(e) => set('to', e.target.value)} aria-label="To" />
          <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
          {staff && <select className="input" value={f.departmentId} onChange={(e) => set('departmentId', e.target.value)} aria-label="Department"><option value="">All departments</option>{lk.departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
          {hr && <select className="input" value={f.correction} onChange={(e) => set('correction', e.target.value)} aria-label="Correction"><option value="">Any correction state</option><option value="PENDING">Pending corrections</option></select>}
        </div>
        <DataTable rows={list.data?.data ?? []} loading={list.loading} error={list.error} onRetry={list.reload} emptyTitle="No attendance records" emptyHint="Records appear after check-ins."
          columns={[
            { key: 'date', header: 'Date', render: (a: any) => fmtDate(a.date) },
            ...(staff ? [{ key: 'emp', header: 'Employee', render: (a: any) => `${a.employee.firstName} ${a.employee.lastName}` }] : []),
            { key: 'in', header: 'In', render: (a: any) => fmtTime(a.checkIn) }, { key: 'out', header: 'Out', render: (a: any) => fmtTime(a.checkOut) },
            { key: 'w', header: 'Worked', render: (a: any) => (a.checkOut ? hours(a.workedMinutes) : '-') }, { key: 'ot', header: 'Overtime', render: (a: any) => (a.overtimeMinutes ? hours(a.overtimeMinutes) : '-') },
            { key: 'st', header: 'Status', render: (a: any) => <div className="flex gap-1 flex-wrap"><Badge value={a.status} />{a.isEarlyDeparture && <Badge value="Early out" tone="amber" />}</div> },
            { key: 'cr', header: 'Correction', render: (a: any) => (a.correctionStatus !== 'NONE' ? <Badge value={a.correctionStatus} /> : '-') },
            { key: 'act', header: '', render: (a: any) => <div className="flex gap-1">{!staff && a.correctionStatus !== 'PENDING' && <Button variant="ghost" onClick={() => setCorr(a)}>Request fix</Button>}{hr && <Button variant="ghost" onClick={() => setDecide(a)}>{a.correctionStatus === 'PENDING' ? 'Review' : 'Edit'}</Button>}</div> },
          ]}
          footer={list.data && <Pagination page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={(p) => set('page', p)} />} />
      </>}
      {staff && tab === 'summary' && <>
        <div className="mb-3"><input type="month" className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" /></div>
        <DataTable rows={sum.data ?? []} loading={sum.loading} error={sum.error} onRetry={sum.reload} emptyTitle="No data for this month"
          columns={[{ key: 'name', header: 'Employee', render: (r: any) => <span>{r.name} <span className="text-xs text-muted">{r.code}</span></span> }, { key: 'present', header: 'Present' }, { key: 'late', header: 'Late' }, { key: 'halfDay', header: 'Half day' }, { key: 'absent', header: 'Absent' }, { key: 'onLeave', header: 'Leave' }, { key: 'hours', header: 'Hours' }, { key: 'overtimeHours', header: 'Overtime (h)' }]} />
      </>}
      {hr && <FormModal open={manual} title="Manual attendance entry" schema={manualSchema} defaultValues={{ status: 'PRESENT', date: todayStr() }}
        fields={[{ name: 'employeeId', label: 'Employee', type: 'select', options: lk.employees.map((e: any) => ({ value: e.id, label: `${e.firstName} ${e.lastName} (${e.employeeCode})` })) }, { name: 'date', label: 'Date', type: 'date', half: true }, { name: 'status', label: 'Status', type: 'select', half: true, options: STATUSES.map((s) => ({ value: s, label: label(s) })) }, { name: 'checkIn', label: 'Check in', type: 'datetime-local', half: true }, { name: 'checkOut', label: 'Check out', type: 'datetime-local', half: true }, { name: 'note', label: 'Note', type: 'textarea' }]}
        onSubmit={async (v) => { await api.post('/attendance/manual', { ...v, checkIn: v.checkIn ? new Date(v.checkIn).toISOString() : '', checkOut: v.checkOut ? new Date(v.checkOut).toISOString() : '' }); list.reload(); }} onClose={() => setManual(false)} successMessage="Attendance saved" />}
      <FormModal open={!!corr} title="Request attendance correction" schema={reasonSchema} fields={[{ name: 'reason', label: 'What needs correcting?', type: 'textarea' }]} defaultValues={{}}
        onSubmit={async (v) => { await api.post(`/attendance/${corr.id}/correction`, v); list.reload(); }} onClose={() => setCorr(null)} successMessage="Request sent to HR" />
      <Modal2 decide={decide} close={() => setDecide(null)} reload={list.reload} local={local} toast={toast} />
    </>
  );
}

import { Modal } from '../components/ui';
function Modal2({ decide, close, reload, local, toast }: any) {
  if (!decide) return null;
  const submit = async (approve: boolean, v: any) => {
    try {
      await api.post(`/attendance/${decide.id}/decide`, { approve, status: v.status || undefined, checkIn: v.checkIn ? new Date(v.checkIn).toISOString() : '', checkOut: v.checkOut ? new Date(v.checkOut).toISOString() : '', note: v.note });
      toast('success', approve ? 'Attendance updated' : 'Request rejected'); reload(); close();
    } catch (e) { toast('error', errMsg(e)); }
  };
  return <DecideForm decide={decide} close={close} submit={submit} local={local} />;
}
function DecideForm({ decide, close, submit, local }: any) {
  const [v, setV] = useState<any>({ status: decide.status, checkIn: local(decide.checkIn), checkOut: local(decide.checkOut), note: decide.note ?? '' });
  const k = (n: string) => ({ value: v[n], onChange: (e: any) => setV({ ...v, [n]: e.target.value }), className: 'input' });
  return (
    <Modal open title="Review / edit attendance" onClose={close}>
      {decide.correctionReason && <p className="text-sm mb-3 p-3 rounded-xl bg-amber-500/15"><b>Employee reason:</b> {decide.correctionReason}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="block text-xs font-semibold text-muted mb-1">Status</label><select {...k('status')}>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div className="hidden sm:block" />
        <div><label className="block text-xs font-semibold text-muted mb-1">Check in</label><input type="datetime-local" {...k('checkIn')} /></div>
        <div><label className="block text-xs font-semibold text-muted mb-1">Check out</label><input type="datetime-local" {...k('checkOut')} /></div>
        <div className="sm:col-span-2"><label className="block text-xs font-semibold text-muted mb-1">Note</label><textarea rows={2} {...k('note')} /></div>
      </div>
      <div className="flex justify-end gap-2 mt-4">{decide.correctionStatus === 'PENDING' && <Button variant="accent" onClick={() => submit(false, v)}>Reject</Button>}<Button onClick={() => submit(true, v)}>{decide.correctionStatus === 'PENDING' ? 'Approve' : 'Save changes'}</Button></div>
    </Modal>
  );
}
