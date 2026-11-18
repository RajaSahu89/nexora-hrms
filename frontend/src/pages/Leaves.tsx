import { useState } from 'react';
import { z } from 'zod';
import { Check, Plus, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useApi, useLookups } from '../hooks/useApi';
import { api, errMsg } from '../services/api';
import { isStaff } from '../types';
import { Badge, Button, Card, ConfirmModal, Empty, Pagination, Skeleton, PageHeader, Tabs } from '../components/ui';
import DataTable from '../components/DataTable';
import FormModal from '../components/FormModal';
import MonthGrid, { DayInfo } from '../components/MonthGrid';
import { fmtDate, fullName, monthNow } from '../utils/format';

const applySchema = z.object({
  leaveTypeId: z.string().min(1, 'Select a leave type'), startDate: z.string().min(1, 'Start date is required'), endDate: z.string().min(1, 'End date is required'),
  reason: z.string().trim().min(3, 'Please give a short reason').max(500),
}).refine((v) => v.endDate >= v.startDate, { message: 'End date cannot be before start date', path: ['endDate'] });
const noteSchema = z.object({ note: z.string().max(300).optional() });

export default function Leaves() {
  const { user } = useAuth(); const { toast } = useToast(); const lk = useLookups();
  const staff = isStaff(user!.role);
  const [tab, setTab] = useState('mine');
  const [apply, setApply] = useState(false);
  const [page, setPage] = useState(1);
  const [cancel, setCancel] = useState<any>(null);
  const [reject, setReject] = useState<any>(null);
  const [month, setMonth] = useState(monthNow());

  const bal = useApi<any[]>(user!.employeeId ? '/leaves/balances' : null);
  const mine = useApi<any>(user!.employeeId ? '/leaves' : null, { employeeId: user!.employeeId, page, limit: 10 });
  const pend = useApi<any>(staff && tab === 'approvals' ? '/leaves' : null, { status: 'PENDING', limit: 50 });
  const cal = useApi<any>(tab === 'calendar' ? '/leaves' : null, { month, limit: 100 });
  const refresh = () => { bal.reload(); mine.reload(); pend.reload(); cal.reload(); };

  const decide = async (id: string, approve: boolean, note?: string) => {
    try { await api.post(`/leaves/${id}/${approve ? 'approve' : 'reject'}`, { note }); toast('success', approve ? 'Leave approved' : 'Leave rejected'); refresh(); }
    catch (e) { toast('error', errMsg(e)); throw e; }
  };

  const days: Record<string, DayInfo> = {};
  const byDay: Record<string, { names: string[]; approved: boolean }> = {};
  (cal.data?.data ?? []).filter((l: any) => l.status === 'APPROVED' || l.status === 'PENDING').forEach((l: any) => {
    for (let d = new Date(l.startDate); d <= new Date(l.endDate); d = new Date(d.getTime() + 864e5)) {
      const k = d.toISOString().slice(0, 10);
      if (!k.startsWith(month) || d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      (byDay[k] ??= { names: [], approved: false }).names.push(fullName(l.employee));
      if (l.status === 'APPROVED') byDay[k].approved = true;
    }
  });
  Object.entries(byDay).forEach(([k, v]) => { days[k] = { text: `${v.names.length} off`, tone: v.approved ? 'green' : 'amber' }; });

  const tabs = [{ id: 'mine', label: 'My leaves' }, ...(staff ? [{ id: 'approvals', label: 'Approvals' }] : []), { id: 'calendar', label: 'Calendar' }, { id: 'policies', label: 'Leave policies' }];
  return (
    <>
      <PageHeader title="Leave Management" subtitle="Balances, requests and approvals"
        actions={user!.employeeId && <Button onClick={() => setApply(true)}><Plus className="w-4 h-4" />Apply for leave</Button>} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'mine' && <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {bal.loading ? [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />) : (bal.data ?? []).filter((b) => Number(b.allocated) > 0 || Number(b.used) > 0).map((b) => (
            <Card key={b.id} className="!p-4"><div className="text-xs text-muted">{b.leaveType.name}</div><div className="text-2xl font-bold">{Number(b.allocated) - Number(b.used)}<span className="text-sm font-normal text-muted"> / {Number(b.allocated)} days</span></div></Card>
          ))}
        </div>
        <DataTable rows={mine.data?.data ?? []} loading={mine.loading} error={mine.error} onRetry={mine.reload} emptyTitle="No leave requests yet" emptyHint="Use 'Apply for leave' to submit your first request."
          footer={mine.data && <Pagination page={mine.data.page} limit={mine.data.limit} total={mine.data.total} onPage={setPage} />}
          columns={[
            { key: 'type', header: 'Type', render: (l) => l.leaveType.name },
            { key: 'dates', header: 'Dates', render: (l) => `${fmtDate(l.startDate)} - ${fmtDate(l.endDate)}` },
            { key: 'days', header: 'Days', render: (l) => Number(l.days) },
            { key: 'reason', header: 'Reason', render: (l) => <span className="line-clamp-1 max-w-[220px]">{l.reason}</span> },
            { key: 'status', header: 'Status', render: (l) => <div><Badge value={l.status} />{l.decisionNote && <div className="text-xs text-muted mt-1">{l.decisionNote}</div>}</div> },
            { key: 'a', header: '', render: (l) => (l.status === 'PENDING' || (l.status === 'APPROVED' && new Date(l.startDate) > new Date())) && <Button variant="ghost" onClick={() => setCancel(l)}>Cancel</Button> },
          ]} />
      </>}

      {tab === 'approvals' && (
        <DataTable rows={(pend.data?.data ?? []).filter((l: any) => l.employee.id !== user!.employeeId)} loading={pend.loading} error={pend.error} onRetry={pend.reload}
          emptyTitle="Nothing waiting for approval" emptyHint="Requests from your team will appear here."
          columns={[
            { key: 'emp', header: 'Employee', render: (l) => <div><div className="font-semibold">{fullName(l.employee)}</div><div className="text-xs text-muted">{l.employee.employeeCode}</div></div> },
            { key: 'type', header: 'Type', render: (l) => l.leaveType.name },
            { key: 'dates', header: 'Dates', render: (l) => `${fmtDate(l.startDate)} - ${fmtDate(l.endDate)} (${Number(l.days)}d)` },
            { key: 'reason', header: 'Reason', render: (l) => <span className="line-clamp-2 max-w-[240px]">{l.reason}</span> },
            { key: 'a', header: '', render: (l) => (
              <div className="flex gap-2 justify-end">
                <Button onClick={() => decide(l.id, true).catch(() => {})}><Check className="w-4 h-4" />Approve</Button>
                <Button variant="ghost" onClick={() => setReject(l)}><X className="w-4 h-4 text-accent" />Reject</Button>
              </div>) },
          ]} />
      )}

      {tab === 'calendar' && <div className="grid lg:grid-cols-2 gap-4">
        <MonthGrid month={month} onMonth={setMonth} days={days} />
        <Card><h3 className="font-bold mb-3">Who is off</h3>
          {Object.keys(byDay).length === 0 ? <Empty title="No leave this month" /> : <ul className="space-y-2 text-sm max-h-96 overflow-y-auto">
            {Object.entries(byDay).sort().map(([k, v]) => <li key={k}><b>{fmtDate(k)}</b> - {v.names.join(', ')} {!v.approved && <Badge value="PENDING" />}</li>)}</ul>}
          <p className="text-xs text-muted mt-3">Green = approved, amber = pending. Weekends are not counted.</p></Card>
      </div>}

      {tab === 'policies' && (
        <DataTable rows={lk.leaveTypes} emptyTitle="No leave types configured" columns={[
          { key: 'name', header: 'Leave type' }, { key: 'code', header: 'Code' },
          { key: 'defaultDays', header: 'Days per year', render: (t) => Number(t.defaultDays) },
          { key: 'isPaid', header: 'Paid', render: (t) => (t.isPaid ? 'Yes' : 'No') },
          { key: 'carryForward', header: 'Carry forward', render: (t) => (t.carryForward ? 'Yes' : 'No') },
        ]} />
      )}

      <FormModal open={apply} title="Apply for leave" schema={applySchema} submitLabel="Submit request" successMessage="Leave request submitted"
        defaultValues={{ leaveTypeId: '', startDate: '', endDate: '', reason: '' }}
        fields={[
          { name: 'leaveTypeId', label: 'Leave type', type: 'select', options: lk.leaveTypes.map((t: any) => ({ value: t.id, label: t.name })) },
          { name: 'startDate', label: 'From', type: 'date', half: true }, { name: 'endDate', label: 'To', type: 'date', half: true },
          { name: 'reason', label: 'Reason', type: 'textarea' },
        ]}
        onSubmit={async (v) => { await api.post('/leaves', v); refresh(); }} onClose={() => setApply(false)} />
      <FormModal open={!!reject} title={`Reject leave - ${reject ? fullName(reject.employee) : ''}`} schema={noteSchema} submitLabel="Reject request" defaultValues={{ note: '' }}
        fields={[{ name: 'note', label: 'Reason shown to the employee (optional)', type: 'textarea' }]}
        onSubmit={async (v) => { await decide(reject.id, false, v.note || undefined); }} onClose={() => setReject(null)} />
      <ConfirmModal open={!!cancel} title="Cancel leave request" message="Cancel this request? Any approved days will be returned to your balance." confirmLabel="Cancel request" danger
        onConfirm={async () => { try { await api.post(`/leaves/${cancel.id}/cancel`); toast('success', 'Leave cancelled'); refresh(); } catch (e) { toast('error', errMsg(e)); } }} onClose={() => setCancel(null)} />
    </>
  );
}
