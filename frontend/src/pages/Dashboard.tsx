import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Building2, CalendarCheck, CalendarClock, Cake, Megaphone, PartyPopper, UserCheck, UserMinus, UserPlus, Users, UserX, Wallet, Activity, CheckSquare } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApi } from '../hooks/useApi';
import { Avatar, Badge, Card, Empty, ErrorBox, PageHeader, Skeleton, StatCard } from '../components/ui';
import CheckInCard from '../components/CheckInCard';
import { fmtDate, label, money } from '../utils/format';
import { isHR } from '../types';

const COLORS = ['#9CC6E0', '#E4002B', '#6FA8C9', '#F59E0B', '#10B981', '#8B5CF6'];
const tip = { contentStyle: { background: 'var(--glass-strong)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--text)' } };
const axis = { stroke: 'var(--muted)', fontSize: 11 };

const ChartCard = ({ title, children }: { title: string; children: any }) => (
  <Card><h3 className="font-bold mb-3">{title}</h3><div className="h-60">{children}</div></Card>
);
const List = ({ title, icon: I, children, empty }: { title: string; icon: any; children: any; empty: string }) => (
  <Card><h3 className="font-bold mb-3 flex items-center gap-2"><I className="w-4 h-4" />{title}</h3>{children?.length === 0 ? <p className="text-sm text-muted py-3">{empty}</p> : <div className="space-y-2.5">{children}</div>}</Card>
);

function AdminDashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi<any>('/dashboard/admin');
  if (error) return <Card><ErrorBox message={error} retry={reload} /></Card>;
  if (loading || !data) return <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>;
  const { stats: s, charts: c, widgets: w } = data;
  const hr = isHR(user!.role);
  return (
    <>
      <PageHeader title={`Hello, ${user!.name.split(' ')[0]}`} subtitle={hr ? 'Company overview' : 'Overview of your team'} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard icon={Users} label="Total employees" value={s.total} />
        <StatCard icon={UserCheck} label="Active" value={s.active} />
        <StatCard icon={UserMinus} label="Inactive" value={s.inactive} tone="red" />
        <StatCard icon={UserPlus} label="New this month" value={s.newThisMonth} />
        <StatCard icon={Building2} label="Departments" value={s.departments} />
        <StatCard icon={UserX} label="On leave today" value={s.onLeave} />
        <StatCard icon={CalendarCheck} label="Present today" value={s.presentToday} />
        <StatCard icon={CalendarClock} label="Pending leave requests" value={s.pendingLeaves} tone="red" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <ChartCard title="Employee growth"><ResponsiveContainer><LineChart data={c.growth}><CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis dataKey="month" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} /><Line type="monotone" dataKey="employees" stroke="#E4002B" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Attendance overview (7 days)"><ResponsiveContainer><BarChart data={c.attendanceOverview}><CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis dataKey="date" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} /><Legend /><Bar dataKey="present" stackId="a" fill="#9CC6E0" /><Bar dataKey="late" stackId="a" fill="#F59E0B" /><Bar dataKey="absent" stackId="a" fill="#E4002B" /><Bar dataKey="leave" stackId="a" fill="#8B5CF6" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Department distribution"><ResponsiveContainer><PieChart><Pie data={c.departmentDistribution} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={3}>{c.departmentDistribution.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip {...tip} /><Legend /></PieChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Gender distribution"><ResponsiveContainer><PieChart><Pie data={c.genderDistribution} dataKey="value" nameKey="name" outerRadius={85}>{c.genderDistribution.map((_: any, i: number) => <Cell key={i} fill={COLORS[(i + 1) % COLORS.length]} />)}</Pie><Tooltip {...tip} /><Legend /></PieChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Monthly hiring"><ResponsiveContainer><BarChart data={c.hiring}><CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis dataKey="month" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} /><Bar dataKey="hires" fill="#9CC6E0" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
        {hr ? <ChartCard title={`Payroll overview (net, ${c.turnoverRate}% turnover)`}><ResponsiveContainer><BarChart data={c.payroll}><CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis dataKey="month" {...axis} /><YAxis {...axis} /><Tooltip {...tip} formatter={(v: any) => money(v)} /><Bar dataKey="total" fill="#E4002B" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
          : <Card><h3 className="font-bold mb-2">Employee turnover</h3><div className="text-4xl font-bold">{c.turnoverRate}%</div><p className="text-sm text-muted mt-1">Of your team has left the company.</p></Card>}
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <List title="Recent employees" icon={Users} empty="No employees yet">{w.recentEmployees.map((e: any) => <Link key={e.id} to={`/employees/${e.id}`} className="flex items-center gap-3"><Avatar name={`${e.firstName} ${e.lastName}`} src={e.photoUrl} /><div className="min-w-0"><div className="text-sm font-semibold truncate">{e.firstName} {e.lastName}</div><div className="text-xs text-muted">{e.designation?.title ?? 'No title'} - {fmtDate(e.joiningDate)}</div></div></Link>)}</List>
        <List title="Pending approvals" icon={CalendarClock} empty="Nothing waiting for approval">{w.pendingApprovals.map((p: any) => <Link key={p.id} to="/leaves" className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{p.employee.firstName} {p.employee.lastName} - {p.leaveType.name}</span><span className="text-xs text-muted whitespace-nowrap">{fmtDate(p.startDate)}</span></Link>)}</List>
        <List title="Upcoming birthdays" icon={Cake} empty="No birthdays in the next 30 days">{w.birthdays.map((b: any) => <div key={b.id} className="flex justify-between text-sm"><span>{b.name}</span><span className="text-xs text-muted">{b.inDays === 0 ? 'Today' : fmtDate(b.date)}</span></div>)}</List>
        <List title="Work anniversaries" icon={PartyPopper} empty="No anniversaries in the next 30 days">{w.anniversaries.map((b: any) => <div key={b.id} className="flex justify-between text-sm"><span>{b.name} ({b.years}y)</span><span className="text-xs text-muted">{b.inDays === 0 ? 'Today' : fmtDate(b.date)}</span></div>)}</List>
        <List title="Upcoming holidays" icon={CalendarCheck} empty="No upcoming holidays">{w.holidays.map((h: any) => <div key={h.id} className="flex justify-between text-sm"><span>{h.name}</span><span className="text-xs text-muted">{fmtDate(h.date)}</span></div>)}</List>
        <List title="Announcements" icon={Megaphone} empty="No announcements">{w.announcements.map((a: any) => <Link key={a.id} to="/announcements" className="flex justify-between gap-2 text-sm"><span className="truncate">{a.title}</span><Badge value={a.type} /></Link>)}</List>
        {hr && <List title="Recent activities" icon={Activity} empty="No activity yet">{w.activities.map((a: any) => <div key={a.id} className="text-sm"><b>{a.action}</b> <span className="text-muted">by {a.user?.email ?? 'system'} - {fmtDate(a.createdAt)}</span></div>)}</List>}
      </div>
    </>
  );
}

function EmployeeDashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi<any>('/dashboard/me');
  if (error) return <Card><ErrorBox message={error} retry={reload} /></Card>;
  if (loading || !data) return <div className="grid md:grid-cols-2 gap-4"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  return (
    <>
      <PageHeader title={`Hello, ${user!.name.split(' ')[0]}`} subtitle="Your day at a glance" />
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <CheckInCard att={data.attendance} onChange={reload} />
        <Card><h3 className="font-bold mb-3">Leave balance</h3>{data.balances.length === 0 ? <p className="text-sm text-muted">No balances yet</p> : <div className="space-y-2">{data.balances.map((b: any) => <div key={b.id} className="flex justify-between text-sm"><span>{b.leaveType.name}</span><b>{Number(b.allocated) - Number(b.used)} / {Number(b.allocated)}</b></div>)}</div>}<Link to="/leaves" className="btn btn-ghost mt-4 w-full">Apply for leave</Link></Card>
        <Card><h3 className="font-bold mb-3 flex gap-2 items-center"><Wallet className="w-4 h-4" />Latest payslip</h3>{data.payslip ? <><div className="text-3xl font-bold">{money(data.payslip.netPay)}</div><p className="text-sm text-muted">Net pay for {data.payslip.month}/{data.payslip.year}</p></> : <p className="text-sm text-muted">No finalized payslip yet</p>}<Link to="/payroll" className="btn btn-ghost mt-4 w-full">View payroll</Link></Card>
        <List title="My open tasks" icon={CheckSquare} empty="No open tasks">{data.tasks.map((t: any) => <Link key={t.id} to="/tasks" className="flex justify-between gap-2 text-sm"><span className="truncate">{t.title}</span><Badge value={t.priority} /></Link>)}</List>
        <List title="Announcements" icon={Megaphone} empty="No announcements">{data.announcements.map((a: any) => <Link key={a.id} to="/announcements" className="flex justify-between gap-2 text-sm"><span className="truncate">{a.title}</span><span className="text-xs text-muted">{fmtDate(a.publishedAt)}</span></Link>)}</List>
        <List title="Upcoming holidays" icon={CalendarCheck} empty="No upcoming holidays">{data.holidays.map((h: any) => <div key={h.id} className="flex justify-between text-sm"><span>{h.name}</span><span className="text-xs text-muted">{fmtDate(h.date)}</span></div>)}</List>
      </div>
      <p className="text-sm text-muted mt-4">{data.pendingLeaves} pending leave request(s) - {data.unread} unread notification(s) - {label(user!.role)}</p>
    </>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  return user!.role === 'EMPLOYEE' ? <EmployeeDashboard /> : <AdminDashboard />;
}
