import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { env } from './config/env';
import { authenticate, HR, requireRole } from './middleware/auth';
import { errorHandler, notFound } from './middleware/error';
import { uploadPath } from './utils/upload';
import authRoutes from './routes/auth.routes';
import employeeRoutes from './routes/employees.routes';
import departmentRoutes from './routes/departments.routes';
import settingsRoutes from './routes/settings.routes';
import attendanceRoutes from './routes/attendance.routes';
import leaveRoutes from './routes/leaves.routes';
import payrollRoutes from './routes/payroll.routes';
import taskRoutes from './routes/tasks.routes';
import announcementRoutes from './routes/announcements.routes';
import notificationRoutes from './routes/notifications.routes';
import documentRoutes from './routes/documents.routes';
import recruitmentRoutes from './routes/recruitment.routes';
import performanceRoutes from './routes/performance.routes';
import dashboardRoutes from './routes/dashboard.routes';
import reportRoutes from './routes/reports.routes';

const app = express();
['employees', 'documents', 'resumes', 'company'].forEach((d) => fs.mkdirSync(uploadPath(d), { recursive: true }));

app.disable('x-powered-by');
if (env.isProd) app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: env.clientUrl, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: env.rateWindow, max: env.rateMax, standardHeaders: true, legacyHeaders: false }));

app.use('/uploads/employees', express.static(uploadPath('employees'), { index: false, dotfiles: 'deny' }));
app.use('/uploads/company', express.static(uploadPath('company'), { index: false, dotfiles: 'deny' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/employees', authenticate, employeeRoutes);
app.use('/api/departments', authenticate, departmentRoutes);
app.use('/api/settings', authenticate, settingsRoutes);
app.use('/api/attendance', authenticate, attendanceRoutes);
app.use('/api/leaves', authenticate, leaveRoutes);
app.use('/api/payroll', authenticate, payrollRoutes);
app.use('/api/tasks', authenticate, taskRoutes);
app.use('/api/announcements', authenticate, announcementRoutes);
app.use('/api/notifications', authenticate, notificationRoutes);
app.use('/api/documents', authenticate, documentRoutes);
app.use('/api/recruitment', authenticate, requireRole(...HR), recruitmentRoutes);
app.use('/api/performance', authenticate, performanceRoutes);
app.use('/api/dashboard', authenticate, dashboardRoutes);
app.use('/api/reports', authenticate, reportRoutes);

// One-server deployment: if the frontend has been built, serve it (and its client-side routes) from here.
const webDist = path.resolve(env.root, 'frontend/dist');
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use(notFound);
app.use(errorHandler);
export default app;
