import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import AuthLayout from '../layouts/AuthLayout';
import { Button } from '../components/ui';
import { api, errMsg } from '../services/api';
import { useToast } from '../contexts/ToastContext';

const pwd = z.string().min(8, 'At least 8 characters').regex(/[a-z]/, 'Add a lowercase letter').regex(/[A-Z]/, 'Add an uppercase letter').regex(/[0-9]/, 'Add a number');
const Err = ({ m }: { m?: string }) => (m ? <p className="text-xs text-accent mt-1">{m}</p> : null);
const Lbl = ({ id, t }: { id: string; t: string }) => <label htmlFor={id} className="block text-xs font-semibold text-muted mb-1">{t}</label>;

export function Register() {
  const nav = useNavigate(); const { toast } = useToast(); const [err, setErr] = useState('');
  const schema = z.object({ firstName: z.string().trim().min(1, 'Required'), lastName: z.string().trim().min(1, 'Required'), email: z.string().email('Enter a valid email'), password: pwd, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <AuthLayout title="Create account" subtitle="Join your company workspace">
      <form noValidate className="space-y-3" onSubmit={handleSubmit(async (v) => { setErr(''); try { await api.post('/auth/register', { firstName: v.firstName, lastName: v.lastName, email: v.email, password: v.password }); toast('success', 'Account created. Please sign in.'); nav('/login'); } catch (e) { setErr(errMsg(e)); } })}>
        <div className="grid grid-cols-2 gap-3"><div><Lbl id="fn" t="First name" /><input id="fn" className="input" {...register('firstName')} /><Err m={errors.firstName?.message} /></div><div><Lbl id="ln" t="Last name" /><input id="ln" className="input" {...register('lastName')} /><Err m={errors.lastName?.message} /></div></div>
        <div><Lbl id="em" t="Email" /><input id="em" type="email" className="input" {...register('email')} /><Err m={errors.email?.message} /></div>
        <div><Lbl id="pw" t="Password" /><input id="pw" type="password" autoComplete="new-password" className="input" {...register('password')} /><Err m={errors.password?.message} /></div>
        <div><Lbl id="cf" t="Confirm password" /><input id="cf" type="password" autoComplete="new-password" className="input" {...register('confirm')} /><Err m={errors.confirm?.message} /></div>
        {err && <p className="text-sm text-accent font-medium">{err}</p>}
        <Button type="submit" loading={isSubmitting} className="w-full">Create account</Button>
      </form>
      <p className="text-sm text-muted mt-4 text-center">Already have an account? <Link to="/login" className="font-semibold text-sky-700 dark:text-sky-300">Sign in</Link></p>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  const [done, setDone] = useState(false); const [err, setErr] = useState('');
  const schema = z.object({ email: z.string().email('Enter a valid email') });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <AuthLayout title="Forgot password" subtitle="We will generate a reset link for your account">
      {done ? <div className="text-sm space-y-3"><p>If that email exists, a reset link has been generated.</p><p className="text-muted">No email service is configured (free setup): the link is printed in the API terminal window. Open it in your browser.</p><Link to="/login" className="btn btn-ghost w-full">Back to sign in</Link></div> : (
        <form noValidate className="space-y-3" onSubmit={handleSubmit(async (v) => { setErr(''); try { await api.post('/auth/forgot-password', v); setDone(true); } catch (e) { setErr(errMsg(e)); } })}>
          <div><Lbl id="em" t="Email" /><input id="em" type="email" className="input" {...register('email')} /><Err m={errors.email?.message} /></div>
          {err && <p className="text-sm text-accent">{err}</p>}
          <Button type="submit" loading={isSubmitting} className="w-full">Send reset link</Button>
          <Link to="/login" className="block text-center text-sm font-semibold text-sky-700 dark:text-sky-300">Back to sign in</Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPassword() {
  const [sp] = useSearchParams(); const nav = useNavigate(); const { toast } = useToast(); const [err, setErr] = useState('');
  const schema = z.object({ password: pwd, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <AuthLayout title="Reset password" subtitle="Choose a new password">
      <form noValidate className="space-y-3" onSubmit={handleSubmit(async (v) => { setErr(''); try { await api.post('/auth/reset-password', { token: sp.get('token'), password: v.password }); toast('success', 'Password updated. Please sign in.'); nav('/login'); } catch (e) { setErr(errMsg(e)); } })}>
        <div><Lbl id="pw" t="New password" /><input id="pw" type="password" autoComplete="new-password" className="input" {...register('password')} /><Err m={errors.password?.message} /></div>
        <div><Lbl id="cf" t="Confirm password" /><input id="cf" type="password" autoComplete="new-password" className="input" {...register('confirm')} /><Err m={errors.confirm?.message} /></div>
        {err && <p className="text-sm text-accent font-medium">{err}</p>}
        <Button type="submit" loading={isSubmitting} className="w-full">Update password</Button>
      </form>
    </AuthLayout>
  );
}
