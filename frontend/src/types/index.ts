export type Role = 'SUPER_ADMIN' | 'HR_ADMIN' | 'MANAGER' | 'EMPLOYEE';
export interface User {
  id: string; email: string; role: Role; employeeId: string | null; departmentId: string | null;
  name: string; photoUrl: string | null; mustChangePassword: boolean;
}
export interface Paged<T> { data: T[]; total: number; page: number; limit: number }
export const isHR = (r?: Role) => r === 'SUPER_ADMIN' || r === 'HR_ADMIN';
export const isStaff = (r?: Role) => r !== 'EMPLOYEE';
