import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import AuthLayout from '../layouts/AuthLayout';
import { Button } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { errMsg } from '../services/api';

const schema = z.object({ email: z.string().min(1, 'Email is required').email('Enter a valid email'), password: z.string().min(1, 'Password is required'), remember: z.boolean().optional() });

export default function Login() {
  const { login } = useAuth();
  const [err, setErr] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting }, setValue } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const demo = (email: string) => { setValue('email', email); setValue('password', 'Password@123'); };
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your workspace">
      <form onSubmit={handleSubmit(async (v) => { setErr(''); try { await login(v.email, v.password, !!v.remember); } catch (e) { setErr(errMsg(e)); } })} className="space-y-3" noValidate>
        <div><label className="block text-xs font-semibold text-muted mb-1" htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" className={`input ${errors.email ? 'err' : ''}`} {...register('email')} />{errors.email && <p className="text-xs text-accent mt-1">{errors.email.message}</p>}</div>
        <div><label className="block text-xs font-semibold text-muted mb-1" htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" className={`input ${errors.password ? 'err' : ''}`} {...register('password')} />{errors.password && <p className="text-xs text-accent mt-1">{errors.password.message}</p>}</div>
        <div className="flex items-center justify-between text-sm"><label className="flex items-center gap-2"><input type="checkbox" className="accent-[#9CC6E0]" {...register('remember')} />Remember me</label><Link to="/forgot-password" className="font-semibold text-sky-700 dark:text-sky-300">Forgot password?</Link></div>
        {err && <p className="text-sm text-accent font-medium">{err}</p>}
        <Button type="submit" loading={isSubmitting} className="w-full">Sign in</Button>
      </form>
      <p className="text-sm text-muted mt-4 text-center">New here? <Link to="/register" className="font-semibold text-sky-700 dark:text-sky-300">Create an account</Link></p>
      <div className="mt-5 pt-4 border-t border-[var(--line)]">
        <p className="text-xs text-muted mb-2">Development logins (password: Password@123)</p>
        <div className="flex flex-wrap gap-2">{[['Admin', 'admin@nexora.test'], ['HR', 'hr@nexora.test'], ['Manager', 'manager@nexora.test'], ['Employee', 'employee@nexora.test']].map(([l, e]) => <button key={e} type="button" onClick={() => demo(e)} className="btn btn-ghost !py-1 !px-3 !text-xs">{l}</button>)}</div>
      </div>
    </AuthLayout>
  );
}
