export interface AuthInfo {
  userId: string; email: string;
  role: 'SUPER_ADMIN' | 'HR_ADMIN' | 'MANAGER' | 'EMPLOYEE';
  employeeId: string | null; departmentId: string | null;
}
declare global {
  namespace Express {
    interface Request {
      auth?: AuthInfo;
      user?: { id: string; email: string; role: AuthInfo['role']; employeeId: string | null; departmentId: string | null };
    }
  }
}
