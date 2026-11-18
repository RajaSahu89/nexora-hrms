import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Play } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useLookups } from '../hooks/useApi';
import { api, download, errMsg } from '../services/api';
import { isHR } from '../types';
import { Button, Card, Empty, ErrorBox, PageHeader, SkeletonRows } from '../components/ui';

const TYPES: [string, string, boolean][] = [
  ['employees', 'Employee report', false], ['attendance', 'Attendance report', false], ['leaves', 'Leave report', false], ['payroll', 'Payroll report', true],
  ['departments', 'Department report', false], ['recruitment', 'Recruitment report', true], ['performance', 'Performance report', false],
];

export default function Reports() {
  const { user } = useAuth(); const { toast } = useToast(); const lk = useLookups();
  const hr = isHR(user!.role);
  const [type, setType] = useState('employees'); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [dept, setDept] = useState('');
  const [rows, setRows] = useState<any[] | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const params = (format: string) => ({ format, ...(from && { from }), ...(to && { to }), ...(dept && { departmentId: dept }) });

  const run = async () => {
    setLoading(true); setError('');
    try { setRows((await api.get(`/reports/${type}`, { params: params('json') })).data.rows); } catch (e) { setError(errMsg(e)); setRows(null); } finally { setLoading(false); }
  };
  const dl = (format: 'csv' | 'pdf') => download(`/reports/${type}`, params(format), `${type}-report.${format}`).then(() => toast('success', `${format.toUpperCase()} downloaded`)).catch((e) => toast('error', errMsg(e)));
  const cols = rows?.length ? Object.keys(rows[0]) : [];

  return (
    <>
      <PageHeader title="Reports" subtitle="Run a report, then export it" />
      <Card className="mb-5">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div><label className="block text-xs font-semibold text-muted mb-1" htmlFor="rt">Report</label><select id="rt" className="input" value={type} onChange={(e) => { setType(e.target.value); setRows(null); }}>{TYPES.filter(([, , h]) => hr || !h).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="block text-xs font-semibold text-muted mb-1" htmlFor="rf">From</label><input id="rf" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="block text-xs font-semibold text-muted mb-1" htmlFor="rto">To</label><input id="rto" type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
          <div><label className="block text-xs font-semibold text-muted mb-1" htmlFor="rd">Department</label><select id="rd" className="input" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All</option>{lk.departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <Button onClick={run} loading={loading}><Play className="w-4 h-4" />Run report</Button>
        </div>
      </Card>
      <Card className="!p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-black/5 dark:border-white/10">
          <span className="text-sm text-muted">{rows ? `${rows.length} rows` : 'Run a report to preview it here'}</span>
          <div className="flex gap-2"><Button variant="ghost" disabled={!rows} onClick={() => dl('csv')}><FileSpreadsheet className="w-4 h-4" />CSV (Excel)</Button><Button variant="ghost" disabled={!rows} onClick={() => dl('pdf')}><FileText className="w-4 h-4" />PDF</Button></div>
        </div>
        {loading ? <SkeletonRows /> : error ? <ErrorBox message={error} retry={run} /> : rows === null ? <Empty title="No report yet" hint="Choose a report and filters, then press Run report." />
          : rows.length === 0 ? <Empty title="No data for these filters" hint="Try widening the date range or choosing all departments." /> : (
            <div className="overflow-x-auto max-h-[60vh]"><table className="w-full min-w-[640px]"><thead className="sticky top-0 bg-[var(--glass-strong)] backdrop-blur"><tr>{cols.map((c) => <th key={c} className="th">{c}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 500).map((r, i) => <tr key={i} className="hover:bg-primary/10">{cols.map((c) => <td key={c} className="td">{r[c] ?? '-'}</td>)}</tr>)}</tbody></table>
              {rows.length > 500 && <p className="p-3 text-xs text-muted"><Download className="w-3 h-3 inline mr-1" />Preview shows the first 500 rows - download for the full report.</p>}</div>
          )}
      </Card>
    </>
  );
}
