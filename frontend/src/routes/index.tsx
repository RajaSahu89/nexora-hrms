import { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Role } from '../types';
import AppLayout from '../layouts/AppLayout';
import Login from '../pages/Login';
import { Register, ForgotPassword, ResetPassword } from '../pages/AuthPages';
import Dashboard from '../pages/Dashboard';
import Employees from '../pages/Employees';
import EmployeeDetail from '../pages/EmployeeDetail';
import Departments from '../pages/Departments';
import Attendance from '../pages/Attendance';
import Leaves from '../pages/Leaves';
import Payroll from '../pages/Payroll';
import Recruitment from '../pages/Recruitment';
import Performance from '../pages/Performance';
import Tasks from '../pages/Tasks';
import Documents from '../pages/Documents';
import Announcements from '../pages/Announcements';
import Reports from '../pages/Reports';
import Notifications from '../pages/Notifications';
import Settings from '../pages/Settings';
import Profile from '../pages/Profile';

const Splash = () => <div className="min-h-screen grid place-items-center"><div className="skeleton w-48 h-8" /></div>;

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}
function Guest({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}
function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  return roles.includes(user!.role) ? <>{children}</> : <Navigate to="/" replace />;
}
const STAFF: Role[] = ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'];
const HRR: Role[] = ['SUPER_ADMIN', 'HR_ADMIN'];

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Guest><Login /></Guest>} />
      <Route path="/register" element={<Guest><Register /></Guest>} />
      <Route path="/forgot-password" element={<Guest><ForgotPassword /></Guest>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Protected><AppLayout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="profile" element={<Profile />} />
        <Route path="employees" element={<RoleGate roles={STAFF}><Employees /></RoleGate>} />
        <Route path="employees/:id" element={<EmployeeDetail />} />
        <Route path="departments" element={<RoleGate roles={STAFF}><Departments /></RoleGate>} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="leaves" element={<Leaves />} />
        <Route path="payroll" element={<Payroll />} />
        <Route path="recruitment" element={<RoleGate roles={HRR}><Recruitment /></RoleGate>} />
        <Route path="performance" element={<Performance />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="documents" element={<Documents />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="reports" element={<RoleGate roles={STAFF}><Reports /></RoleGate>} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
