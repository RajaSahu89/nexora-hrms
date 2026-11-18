import { useState } from 'react';
import { z } from 'zod';
import { Download, FileText, Plus, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useApi } from '../hooks/useApi';
import { usePeople } from '../hooks/usePeople';
import { api, download, errMsg } from '../services/api';
import { isHR } from '../types';
import { Badge, Button, ConfirmModal, PageHeader } from '../components/ui';
import DataTable from '../components/DataTable';
import FormModal from '../components/FormModal';
import { fmtDate, fullName, label } from '../utils/format';

const CATS = ['OFFER_LETTER', 'APPOINTMENT_LETTER', 'EXPERIENCE_CERTIFICATE', 'IDENTITY', 'POLICY', 'OTHER'];
const schema = z.object({
  title: z.string().trim().min(2, 'Title is required').max(120),
  category: z.enum(['OFFER_LETTER', 'APPOINTMENT_LETTER', 'EXPERIENCE_CERTIFICATE', 'IDENTITY', 'POLICY', 'OTHER']),
  employeeId: z.string().optional(), visibility: z.string().optional(), expiresAt: z.string().optional(),
  file: z.any().refine((f) => f && f.length > 0, 'Choose a file'),
});
const soon = (d?: string) => !!d && new Date(d).getTime() < Date.now() + 30 * 864e5;

export default function Documents() {
  const { user } = useAuth(); const { toast } = useToast();
  const hr = isHR(user!.role);
  const people = usePeople();
  const [cat, setCat] = useState('');
  const { data, loading, error, reload } = useApi<any[]>('/documents', cat ? { category: cat } : {});
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<any>(null);

  const get = async (d: any) => { try { await download(`/documents/${d.id}/download`, {}, d.title); } catch (e) { toast('error', errMsg(e)); } };
  const canDelete = (d: any) => hr || d.employeeId === user!.employeeId;

  return (
    <>
      <PageHeader title={hr ? 'Documents' : 'My Documents'} subtitle="Letters, certificates, identity files and company policies"
        actions={<>
          <select className="input !w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter by category"><option value="">All categories</option>{CATS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select>
          <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4" />Upload</Button>
        </>} />
      <DataTable rows={data ?? []} loading={loading} error={error} onRetry={reload} emptyTitle="No documents" emptyHint="Uploaded files appear here. PDF, Word and image files up to 10 MB are accepted."
        emptyAction={<Button onClick={() => setOpen(true)}><Upload className="w-4 h-4" />Upload a document</Button>}
        columns={[
          { key: 'title', header: 'Document', render: (d) => <div className="flex items-center gap-2 font-semibold"><FileText className="w-4 h-4 text-muted shrink-0" />{d.title}</div> },
          { key: 'category', header: 'Category', render: (d) => <Badge value={d.category} tone="blue" /> },
          ...(hr ? [{ key: 'employee', header: 'Employee', render: (d: any) => (d.employee ? fullName(d.employee) : 'Company-wide') }] : []),
          { key: 'createdAt', header: 'Uploaded', render: (d) => fmtDate(d.createdAt) },
          { key: 'expiresAt', header: 'Expires', render: (d) => (d.expiresAt ? <span className={soon(d.expiresAt) ? 'text-accent font-semibold' : ''}>{fmtDate(d.expiresAt)}{soon(d.expiresAt) && ' - soon'}</span> : '-') },
          { key: 'a', header: '', render: (d) => (
            <div className="flex gap-1 justify-end">
              <Button variant="ghost" className="!p-2" aria-label="Download" onClick={() => get(d)}><Download className="w-4 h-4" /></Button>
              {canDelete(d) && <Button variant="ghost" className="!p-2" aria-label="Delete" onClick={() => setDel(d)}><Trash2 className="w-4 h-4 text-accent" /></Button>}
            </div>) },
        ]} />
      <FormModal open={open} title="Upload document" schema={schema} submitLabel="Upload" successMessage="Document uploaded"
        defaultValues={{ title: '', category: 'OTHER', employeeId: '', visibility: '', expiresAt: '' }}
        fields={[
          { name: 'title', label: 'Title' },
          { name: 'category', label: 'Category', type: 'select', half: true, options: CATS.map((c) => ({ value: c, label: label(c) })) },
          { name: 'expiresAt', label: 'Expiry date (optional)', type: 'date', half: true },
          ...(hr ? [
            { name: 'employeeId', label: 'Belongs to', type: 'select' as const, half: true, hint: 'Empty = company-wide', options: people },
            { name: 'visibility', label: 'Visible to', type: 'select' as const, half: true, options: [{ value: 'PRIVATE_EMPLOYEE', label: 'The employee' }, { value: 'HR_ONLY', label: 'HR only' }, { value: 'ALL_EMPLOYEES', label: 'All employees' }] },
          ] : []),
          { name: 'file', label: 'File', type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.doc,.docx' },
        ]}
        onSubmit={async (v) => {
          const fd = new FormData();
          fd.append('title', v.title); fd.append('category', v.category);
          if (v.employeeId) fd.append('employeeId', v.employeeId);
          if (v.visibility) fd.append('visibility', v.visibility);
          if (v.expiresAt) fd.append('expiresAt', v.expiresAt);
          fd.append('file', v.file[0]);
          await api.post('/documents', fd); reload();
        }} onClose={() => setOpen(false)} />
      <ConfirmModal open={!!del} danger title="Delete document" message={`Permanently delete "${del?.title}"?`} confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/documents/${del.id}`); toast('success', 'Document deleted'); reload(); } catch (e) { toast('error', errMsg(e)); } }} onClose={() => setDel(null)} />
    </>
  );
}
