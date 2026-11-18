import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export default function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { dark, toggle } = useTheme();
  return (
    <div className="min-h-screen grid place-items-center p-4">
      <button onClick={toggle} aria-label="Toggle theme" className="btn btn-ghost fixed top-4 right-4 !p-2.5">{dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass glass-strong w-full max-w-md p-7">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-10 h-10 rounded-2xl bg-accent text-white grid place-items-center font-black">N</div>
          <span className="text-xl font-extrabold tracking-wide">NEXORA <span className="text-accent">HRMS</span></span>
        </div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1 mb-5">{subtitle}</p>}
        {children}
      </motion.div>
    </div>
  );
}
