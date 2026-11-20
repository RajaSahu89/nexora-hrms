import { prisma } from './config/prisma';
import { employeeUserId, hrUserIds, notifyUsers } from './utils/notify';

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

async function run() {
  try {
    const soon = new Date(Date.now() + 24 * 3600e3);
    const tasks = await prisma.task.findMany({ where: { status: { not: 'COMPLETED' }, assigneeId: { not: null }, dueDate: { lte: soon } } });
    for (const t of tasks) {
      const uid = await employeeUserId(t.assigneeId!);
      if (!uid) continue;
      const sent = await prisma.notification.findFirst({ where: { userId: uid, type: 'TASK_DEADLINE', link: `/tasks#${t.id}`, createdAt: { gte: startOfToday() } } });
      if (!sent) await notifyUsers([uid], 'TASK_DEADLINE', t.dueDate! < new Date() ? 'Task overdue' : 'Task due soon', t.title, `/tasks#${t.id}`);
    }
    const docs = await prisma.document.findMany({ where: { expiresAt: { lte: new Date(Date.now() + 30 * 864e5) } }, include: { employee: { select: { firstName: true, lastName: true } } } });
    const hrs = await hrUserIds();
    for (const d of docs) {
      const link = `/documents#${d.id}`;
      const targets = [...hrs, ...(d.employeeId ? [await employeeUserId(d.employeeId)] : [])].filter((x): x is string => !!x);
      for (const uid of targets) {
        const sent = await prisma.notification.findFirst({ where: { userId: uid, type: 'DOCUMENT_EXPIRY', link, createdAt: { gte: startOfToday() } } });
        if (!sent) await notifyUsers([uid], 'DOCUMENT_EXPIRY', 'Document expiring', `${d.title}${d.employee ? ' (' + d.employee.firstName + ' ' + d.employee.lastName + ')' : ''} expires ${d.expiresAt!.toISOString().slice(0, 10)}`, link);
      }
    }
  } catch (e: any) { console.error('[jobs]', e.message); }
}
export const startJobs = () => { setTimeout(run, 5000); setInterval(run, 3600e3); };
