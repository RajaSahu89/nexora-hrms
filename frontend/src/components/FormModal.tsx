import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ZodTypeAny } from 'zod';
import { Button, Modal, cn } from './ui';
import { errMsg } from '../services/api';
import { useToast } from '../contexts/ToastContext';

export interface Field {
  name: string; label: string; type?: 'text' | 'email' | 'password' | 'number' | 'date' | 'datetime-local' | 'textarea' | 'select' | 'checkbox' | 'file';
  options?: { value: string; label: string }[]; placeholder?: string; half?: boolean; accept?: string; step?: string; hint?: string;
}
interface Props {
  open: boolean; title: string; fields: Field[]; schema: ZodTypeAny; defaultValues?: any; submitLabel?: string; wide?: boolean;
  onSubmit: (values: any) => Promise<any>; onClose: () => void; successMessage?: string;
}

/** Reusable validated form (react-hook-form + zod) used by every create/edit dialog. */
export default function FormModal({ open, title, fields, schema, defaultValues, submitLabel = 'Save', wide, onSubmit, onClose, successMessage }: Props) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<any>({ resolver: zodResolver(schema) as any, defaultValues });
  const [serverErr, setServerErr] = useState('');
  const { toast } = useToast();
  useEffect(() => { if (open) { reset(defaultValues); setServerErr(''); } }, [open]); // eslint-disable-line

  const submit = handleSubmit(async (v) => {
    setServerErr('');
    try { await onSubmit(v); if (successMessage) toast('success', successMessage); onClose(); }
    catch (e) { setServerErr(errMsg(e)); }
  });

  return (
    <Modal open={open} title={title} onClose={onClose} wide={wide}>
      <form onSubmit={submit} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((f) => {
          const err = errors[f.name]?.message as string | undefined;
          const common = { ...register(f.name), id: f.name, className: cn('input', err && 'err'), placeholder: f.placeholder };
          return (
            <div key={f.name} className={cn(!f.half && 'sm:col-span-2', f.type === 'checkbox' && 'flex items-center gap-2')}>
              {f.type === 'checkbox' ? (
                <><input type="checkbox" id={f.name} {...register(f.name)} className="w-4 h-4 accent-[#9CC6E0]" /><label htmlFor={f.name} className="text-sm">{f.label}</label></>
              ) : (
                <>
                  <label htmlFor={f.name} className="block text-xs font-semibold text-muted mb-1">{f.label}</label>
                  {f.type === 'textarea' ? <textarea rows={3} {...common} />
                    : f.type === 'select' ? (
                      <select {...common}><option value="">Select...</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                    ) : <input type={f.type ?? 'text'} accept={f.accept} step={f.step} {...common} />}
                  {f.hint && !err && <p className="text-xs text-muted mt-1">{f.hint}</p>}
                </>
              )}
              {err && <p className="text-xs text-accent mt-1">{err}</p>}
            </div>
          );
        })}
        {serverErr && <p className="sm:col-span-2 text-sm text-accent font-medium">{serverErr}</p>}
        <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}
