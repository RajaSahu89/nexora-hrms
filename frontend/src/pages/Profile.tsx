import { useAuth } from '../contexts/AuthContext';
import { Card, Empty } from '../components/ui';
import { EmployeeView } from './EmployeeDetail';

export default function Profile() {
  const { user } = useAuth();
  if (!user!.employeeId) return <Card><Empty title="No employee profile" hint="This account is not linked to an employee record." /></Card>;
  return <EmployeeView id={user!.employeeId} />;
}
