import { useState } from 'react';
import { Clock, Coffee, LogIn, LogOut } from 'lucide-react';
import { Badge, Button, Card } from './ui';
import { api, errMsg } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { fmtTime, hours } from '../utils/format';

export default function CheckInCard({ att, onChange }: { att: any; onChange: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const run = async (key: string, path: string, msg: string) => {
    setBusy(key);
    try { await api.post(`/attendance/${path}`); toast('success', msg); onChange(); } catch (e) { toast('error', errMsg(e)); } finally { setBusy(''); }
  };
  const onBreak = att?.breaks?.some((b: any) => !b.endedAt);
  const done = !!att?.checkOut;
  return (
    <Card>
      <div className="flex items-center justify-between mb-3"><h3 className="font-bold flex gap-2 items-center"><Clock className="w-4 h-4" />Today</h3>{att && <Badge value={att.status} />}</div>
      <div className="grid grid-cols-3 gap-2 text-center mb-4">
        <div><div className="text-xs text-muted">Check in</div><div className="font-bold">{fmtTime(att?.checkIn)}</div></div>
        <div><div className="text-xs text-muted">Check out</div><div className="font-bold">{fmtTime(att?.checkOut)}</div></div>
        <div><div className="text-xs text-muted">Worked</div><div className="font-bold">{att?.checkOut ? hours(att.workedMinutes) : '-'}</div></div>
      </div>
      <div className="flex flex-wrap gap-2">
        {!att?.checkIn && <Button loading={busy === 'in'} onClick={() => run('in', 'check-in', 'Checked in')}><LogIn className="w-4 h-4" />Check in</Button>}
        {att?.checkIn && !done && <Button variant="accent" loading={busy === 'out'} onClick={() => run('out', 'check-out', 'Checked out')}><LogOut className="w-4 h-4" />Check out</Button>}
        {att?.checkIn && !done && (onBreak
          ? <Button variant="ghost" loading={busy === 'be'} onClick={() => run('be', 'break/end', 'Break ended')}><Coffee className="w-4 h-4" />End break</Button>
          : <Button variant="ghost" loading={busy === 'bs'} onClick={() => run('bs', 'break/start', 'Break started')}><Coffee className="w-4 h-4" />Start break</Button>)}
        {done && <p className="text-sm text-muted">You are done for today.</p>}
      </div>
    </Card>
  );
}
