import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, Pencil } from 'lucide-react';
import { z } from 'zod';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useApi, useLookups } from '../hooks/useApi';
import { api, download, errMsg } from '../services/api';
import { isHR } from '../types';
import { Avatar, Badge, Button, Card, Empty, ErrorBox, Skeleton, Tabs } from '../components/ui';
import FormModal from '../components/FormModal';
import MonthGrid, { DayInfo } from '../components/MonthGrid';
import { employeeFields, employeeSchema, toForm } from './Employees';
import { fmtDate, fmtDateTime, label, money, monthNow } from '../utils/format';

const Row = ({ k, v }: { k: string; v: any }) => <div className="flex justify-between gap-4 py-2 border-b border-[var(--line)] text-sm"><span className="text-muted">{k}</span><span className="font-medium text-right">{v || '-'}</span></div>;

const selfSchema = z.object({
  phone: z.string().regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone').optional().or(z.literal('')), address: z.string().optional(),
  emergencyContactName: z.string().optional(), emergencyContactPhone: z.string().optional(), emergencyContactRel: z.string().optional(),
  skills: z.string().optional(), education: z.string().optional(), experience: z.string().optional(),
});

function AttendanceTab({ id }: { id: string }) {
  const [month, setMonth] = useState(monthNow());
  const { data } = useApi<any>('/attendance/calendar', { month, employeeId: id });
  const days: Record<string, DayInfo> = {};
  const tone: any = { PRESENT: 'green', LATE: 'amber', HALF_DAY: 'amber', ABSENT: 'red', ON_LEAVE: 'blue', HOLIDAY: 'gray' };
  data?.records.forEach((r: any) => { days[r.date.slice(0, 10)] = { text: r.status[0], tone: tone[r.status] }; });
  data?.holidays.forEach((h: any) => { days[h.date.slice(0, 10)] = { text: 'H', tone: 'gray' }; });
  data?.leaves.forEach((l: any) => { for (let d = new Date(l.startDate); d <= new Date(l.endDate); d = new Date(d.getTime() + 864e5)) days[d.toISOString().slice(0, 10)] = { text: 'L', tone: 'blue' }; });
  return <MonthGrid month={month} onMonth={setMonth} days={days} />;
}

function LeaveTab({ id }: { id: string }) {
  const bal = useApi<any[]>('/leaves/balances', { employeeId: id });
  const list = useApi<any>('/leaves', { employeeId: id, limit: 10 });
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card><h3 className="font-bold mb-3">Balances</h3>{(bal.data ?? []).map((b) => <Row key={b.id} k={b.leaveType.name} v={`${Number(b.allocated) - Number(b.used)} of ${Number(b.allocated)} left`} />)}</Card>
      <Card><h3 className="font-bold mb-3">Recent requests</h3>{list.data?.data.length ? list.data.data.map((l: any) => <div key={l.id} className="flex justify-between items-center py-2 border-b border-[var(--line)] text-sm"><span>{l.leaveType.name} - {fmtDate(l.startDate)}</span><Badge value={l.status} /></div>) : <p className="text-sm text-muted">No leave requests</p>}</Card>
    </div>
  );
}

function DocsTab({ id }: { id: string }) {
  const { toast } = useToast();
  const { data } = useApi<any[]>('/documents', { employeeId: id });
  if (!data?.length) return <Card><Empty title="No documents" hint="Upload documents from the Documents page." /></Card>;
  return <Card>{data.map((d) => <div key={d.id} className="flex justify-between items-center py-2 border-b border-[var(--line)] text-sm"><span>{d.title} <span className="text-muted">({label(d.category)})</span></span><Button variant="ghost" onClick={() => download(`/documents/${d.id}/download`, {}, d.title).catch((e) => toast('error', errMsg(e)))}>Download</Button></div>)}</Card>;
}

function SalaryTab({ id }: { id: string }) {
  const { data } = useApi<any>(`/payroll/salary/${id}`);
  if (!data) return <Skeleton className="h-24" />;
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card><h3 className="font-bold mb-3">Current structure</h3>{data.current.length ? data.current.map((c: any) => <Row key={c.id} k={c.name} v={money(c.amount)} />) : <p className="text-sm text-muted">No salary structure set. Use Payroll to set one.</p>}</Card>
      <Card><h3 className="font-bold mb-3">Salary history</h3>{data.history.map((c: any) => <Row key={c.id} k={`${c.name} (${fmtDate(c.effectiveFrom)})`} v={money(c.amount)} />)}</Card>
    </div>
  );
}

export function EmployeeView({ id }: { id: string }) {
  const { user } = useAuth(); const { toast } = useToast(); const lk = useLookups();
  const { data: e, loading, error, reload } = useApi<any>(`/employees/${id}`);
  const [tab, setTab] = useState('personal'); const [edit, setEdit] = useState(false);
  const photo = useRef<HTMLInputElement>(null);
  const hr = isHR(user!.role); const self = id === user!.employeeId;
  if (loading) return <Skeleton className="h-64" />;
  if (error || !e) return <Card><ErrorBox message={error ?? 'Not found'} retry={reload} /></Card>;
  const name = `${e.firstName} ${e.lastName}`;
  const upload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0]; ev.target.value = ''; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { await api.post(`/employees/${id}/photo`, fd); toast('success', 'Photo updated'); reload(); } catch (er) { toast('error', errMsg(er)); }
  };
  const tabs = [{ id: 'personal', label: 'Personal' }, { id: 'professional', label: 'Professional' }, { id: 'additional', label: 'Additional' }, { id: 'attendance', label: 'Attendance' }, { id: 'leave', label: 'Leave' }, { id: 'docs', label: 'Documents' }, ...(hr ? [{ id: 'salary', label: 'Salary' }] : [])];
  return (
    <>
      <Card className="mb-5 flex flex-wrap items-center gap-5">
        <div className="relative"><Avatar name={name} src={e.photoUrl} size={88} />{(hr || self) && <><input ref={photo} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={upload} /><button onClick={() => photo.current?.click()} aria-label="Change photo" className="absolute -bottom-1 -right-1 bg-primary text-[#101820] rounded-full p-1.5"><Camera className="w-4 h-4" /></button></>}</div>
        <div className="flex-1 min-w-[200px]"><h1 className="text-2xl font-bold">{name}</h1><p className="text-muted text-sm">{e.designation?.title ?? 'No designation'} - {e.department?.name ?? 'No department'}</p><div className="mt-2 flex gap-2 items-center"><Badge value={e.employmentStatus} /><span className="text-xs text-muted">{e.employeeCode}</span></div></div>
        {(hr || self) && <Button variant="ghost" onClick={() => setEdit(true)}><Pencil className="w-4 h-4" />Edit</Button>}
      </Card>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'personal' && <Card><Row k="Email" v={e.email} /><Row k="Phone" v={e.phone} /><Row k="Date of birth" v={e.dateOfBirth && fmtDate(e.dateOfBirth)} /><Row k="Gender" v={e.gender && label(e.gender)} /><Row k="Address" v={e.address} /><Row k="Emergency contact" v={[e.emergencyContactName, e.emergencyContactPhone].filter(Boolean).join(' - ')} /></Card>}
      {tab === 'professional' && <Card><Row k="Department" v={e.department?.name} /><Row k="Designation" v={e.designation?.title} /><Row k="Joining date" v={fmtDate(e.joiningDate)} /><Row k="Employment type" v={label(e.employmentType)} /><Row k="Reporting manager" v={e.manager && `${e.manager.firstName} ${e.manager.lastName}`} /><Row k="Work location" v={e.workLocation} /><Row k="Status" v={label(e.employmentStatus)} /><Row k="Last login" v={e.user?.lastLoginAt && fmtDateTime(e.user.lastLoginAt)} /></Card>}
      {tab === 'additional' && <Card><Row k="Education" v={typeof e.education === 'string' ? e.education : ''} /><Row k="Experience" v={typeof e.experience === 'string' ? e.experience : ''} /><Row k="Skills" v={(e.skills ?? []).join(', ')} />{e.bankDetails !== undefined && <><Row k="Bank" v={e.bankDetails?.bankName} /><Row k="Account" v={e.bankDetails?.accountNumber && `****${String(e.bankDetails.accountNumber).slice(-4)}`} /></>}</Card>}
      {tab === 'attendance' && <AttendanceTab id={id} />}
      {tab === 'leave' && <LeaveTab id={id} />}
      {tab === 'docs' && <DocsTab id={id} />}
      {tab === 'salary' && hr && <SalaryTab id={id} />}
      <FormModal open={edit} wide title={hr ? 'Edit employee' : 'Update my details'} schema={hr ? employeeSchema : selfSchema}
        fields={hr ? employeeFields(lk, true, false) : [
          { name: 'phone', label: 'Phone', half: true }, { name: 'emergencyContactName', label: 'Emergency contact', half: true }, { name: 'emergencyContactPhone', label: 'Emergency phone', half: true }, { name: 'emergencyContactRel', label: 'Relationship', half: true },
          { name: 'address', label: 'Address', type: 'textarea' }, { name: 'skills', label: 'Skills (comma separated)' }, { name: 'education', label: 'Education', type: 'textarea' }, { name: 'experience', label: 'Experience', type: 'textarea' }]}
        defaultValues={toForm(e)} onSubmit={async (v) => { await api.put(`/employees/${id}`, v); reload(); }} onClose={() => setEdit(false)} successMessage="Profile updated" />
    </>
  );
}

export default function EmployeeDetail() {
  const { id } = useParams(); const { user } = useAuth(); const nav = useNavigate();
  if (user!.role === 'EMPLOYEE' && id !== user!.employeeId) { nav('/profile', { replace: true }); return null; }
  return <EmployeeView id={id!} />;
}
