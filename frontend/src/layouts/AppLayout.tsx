import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, Briefcase, Building2, CalendarCheck, CalendarDays, ChevronLeft, FileText, FolderOpen, LayoutDashboard, LogOut, Megaphone, Menu, Moon,
  Search, Settings, Sun, Target, UserCircle, Users, Wallet, BarChart3, CheckSquare, X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../services/api';
import { Avatar, cn } from '../components/ui';
import { Role } from '../types';
import { fmtDateTime } from '../utils/format';

interface Item { to: string; label: string; selfLabel?: string; icon: any; roles?: Role[] }
const HRR: Role[] = ['SUPER_ADMIN', 'HR_ADMIN'];
const STAFF: Role[] = ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'];
const NAV: Item[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/profile', label: 'My Profile', icon: UserCircle, roles: ['EMPLOYEE'] },
  { to: '/employees', label: 'Employees', icon: Users, roles: STAFF },
  { to: '/departments', label: 'Departments', icon: Building2, roles: STAFF },
  { to: '/attendance', label: 'Attendance', selfLabel: 'My Attendance', icon: CalendarCheck },
  { to: '/leaves', label: 'Leave Management', selfLabel: 'My Leaves', icon: CalendarDays },
  { to: '/payroll', label: 'Payroll', selfLabel: 'My Payroll', icon: Wallet, roles: ['SUPER_ADMIN', 'HR_ADMIN', 'EMPLOYEE', 'MANAGER'] },
  { to: '/recruitment', label: 'Recruitment', icon: Briefcase, roles: HRR },
  { to: '/performance', label: 'Performance', icon: Target },
  { to: '/tasks', label: 'Tasks', selfLabel: 'My Tasks', icon: CheckSquare },
  { to: '/documents', label: 'Documents', selfLabel: 'My Documents', icon: FolderOpen },
  { to: '/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: STAFF },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { user } = useAuth();
  const self = user!.role === 'EMPLOYEE';
  const items = NAV.filter((n) => !n.roles || n.roles.includes(user!.role));
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={onNavigate} title={collapsed ? n.label : undefined}
          className={({ isActive }) => cn('flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition', isActive ? 'bg-primary text-[#101820] shadow' : 'text-muted hover:bg-primary/25 hover:text-ink')}>
          <n.icon className="w-5 h-5 shrink-0" />{!collapsed && <span className="truncate">{self && n.selfLabel ? n.selfLabel : n.label}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

function useOutside(close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [close]);
  return ref;
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<any[]>([]);
  const nav = useNavigate();
  const ref = useOutside(() => setOpen(false));
  const poll = () => api.get('/notifications/unread-count').then((r) => setUnread(r.data.unread)).catch(() => {});
  useEffect(() => { poll(); const t = setInterval(poll, 30000); return () => clearInterval(t); }, []);
  const toggle = async () => {
    setOpen((o) => !o);
    if (!open) { const r = await api.get('/notifications', { params: { limit: 6 } }); setItems(r.data.data); setUnread(r.data.unread); }
  };
  const readAll = async () => { await api.post('/notifications/read-all'); setItems((x) => x.map((i) => ({ ...i, isRead: true }))); setUnread(0); };
  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} aria-label="Notifications" className="btn btn-ghost !p-2.5 relative">
        <Bell className="w-4 h-4" />{unread > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold grid place-items-center">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="glass glass-strong absolute right-0 mt-2 w-[min(92vw,22rem)] z-40 overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-[var(--line)]"><b className="text-sm">Notifications</b><button onClick={readAll} className="text-xs text-sky-700 dark:text-sky-300 font-semibold">Mark all read</button></div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? <p className="p-6 text-center text-sm text-muted">You are all caught up</p> : items.map((n) => (
              <button key={n.id} onClick={async () => { await api.post(`/notifications/${n.id}/read`); setOpen(false); poll(); nav(n.link?.split('#')[0] || '/notifications'); }} className={cn('w-full text-left p-3 border-b border-[var(--line)] hover:bg-primary/15', !n.isRead && 'bg-primary/15')}>
                <div className="text-sm font-semibold">{n.title}</div><div className="text-xs text-muted line-clamp-2">{n.message}</div><div className="text-[10px] text-muted mt-1">{fmtDateTime(n.createdAt)}</div>
              </button>
            ))}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block text-center text-sm font-semibold p-2.5">View all</Link>
        </div>
      )}
    </div>
  );
}

function GlobalSearch() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [emps, setEmps] = useState<any[]>([]);
  const ref = useOutside(() => setQ(''));
  const pages = NAV.filter((n) => (!n.roles || n.roles.includes(user!.role)) && q && n.label.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => {
    if (q.length < 2 || user!.role === 'EMPLOYEE') { setEmps([]); return; }
    const t = setTimeout(() => api.get('/employees', { params: { search: q, limit: 5 } }).then((r) => setEmps(r.data.data)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q, user]);
  const go = (to: string) => { setQ(''); nav(to); };
  return (
    <div className="relative flex-1 max-w-md" ref={ref}>
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={user!.role === 'EMPLOYEE' ? 'Search pages...' : 'Search employees or pages...'} className="input !pl-9" aria-label="Search" />
      {q && (pages.length > 0 || emps.length > 0) && (
        <div className="glass glass-strong absolute left-0 right-0 mt-2 z-40 max-h-80 overflow-y-auto">
          {pages.map((p) => <button key={p.to} onClick={() => go(p.to)} className="w-full text-left px-3 py-2 text-sm hover:bg-primary/20 flex gap-2 items-center"><p.icon className="w-4 h-4" />{p.label}</button>)}
          {emps.map((e) => <button key={e.id} onClick={() => go(`/employees/${e.id}`)} className="w-full text-left px-3 py-2 text-sm hover:bg-primary/20 flex gap-2 items-center"><Avatar name={`${e.firstName} ${e.lastName}`} src={e.photoUrl} size={24} />{e.firstName} {e.lastName}<span className="text-xs text-muted ml-auto">{e.employeeCode}</span></button>)}
        </div>
      )}
    </div>
  );
}

function ProfileMenu() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useOutside(() => setOpen(false));
  const nav = useNavigate();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-2xl p-1 hover:bg-primary/20" aria-label="Profile menu">
        <Avatar name={user!.name} src={user!.photoUrl} size={34} />
        <div className="hidden md:block text-left leading-tight pr-2"><div className="text-sm font-semibold">{user!.name}</div><div className="text-[11px] text-muted">{user!.role.replace('_', ' ')}</div></div>
      </button>
      {open && (
        <div className="glass glass-strong absolute right-0 mt-2 w-56 z-40 p-2">
          <button onClick={() => { setOpen(false); nav('/profile'); }} className="w-full flex gap-2 items-center px-3 py-2 rounded-xl text-sm hover:bg-primary/20"><UserCircle className="w-4 h-4" />My profile</button>
          <button onClick={() => { setOpen(false); nav('/settings'); }} className="w-full flex gap-2 items-center px-3 py-2 rounded-xl text-sm hover:bg-primary/20"><Settings className="w-4 h-4" />Settings</button>
          <button onClick={toggle} className="w-full flex gap-2 items-center px-3 py-2 rounded-xl text-sm hover:bg-primary/20">{dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}{dark ? 'Light mode' : 'Dark mode'}</button>
          <button onClick={logout} className="w-full flex gap-2 items-center px-3 py-2 rounded-xl text-sm text-accent hover:bg-accent/10"><LogOut className="w-4 h-4" />Sign out</button>
        </div>
      )}
    </div>
  );
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('nexora-collapsed') === '1');
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  useEffect(() => { setDrawer(false); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => { try { localStorage.setItem('nexora-collapsed', collapsed ? '1' : '0'); } catch { /* ignore */ } }, [collapsed]);
  const Brand = ({ small }: { small?: boolean }) => (
    <div className="flex items-center gap-2 px-4 py-4"><div className="w-9 h-9 rounded-xl bg-accent text-white grid place-items-center font-black shrink-0">N</div>{!small && <span className="font-extrabold tracking-wide">NEXORA</span>}</div>
  );
  return (
    <div className="min-h-screen flex">
      <aside className={cn('glass !rounded-none !rounded-r-3xl hidden lg:flex flex-col sticky top-0 h-screen shrink-0 transition-all duration-300', collapsed ? 'w-[76px]' : 'w-64')}>
        <Brand small={collapsed} /><NavList collapsed={collapsed} />
        <button onClick={() => setCollapsed((c) => !c)} className="m-3 btn btn-ghost" aria-label="Collapse sidebar"><ChevronLeft className={cn('w-4 h-4 transition', collapsed && 'rotate-180')} />{!collapsed && 'Collapse'}</button>
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden bg-black/40" onClick={() => setDrawer(false)}>
          <aside className="glass glass-strong !rounded-none h-full w-72 flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pr-3"><Brand /><button onClick={() => setDrawer(false)} aria-label="Close menu"><X className="w-5 h-5" /></button></div>
            <NavList collapsed={false} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="glass !rounded-none !rounded-b-3xl sticky top-0 z-30 flex items-center gap-3 px-4 py-3">
          <button className="lg:hidden btn btn-ghost !p-2.5" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu className="w-4 h-4" /></button>
          <GlobalSearch /><div className="flex-1" /><NotificationBell /><ProfileMenu />
        </header>
        <main className="flex-1 p-4 md:p-6 max-w-[1400px] w-full mx-auto"><Outlet /></main>
      </div>
    </div>
  );
}
