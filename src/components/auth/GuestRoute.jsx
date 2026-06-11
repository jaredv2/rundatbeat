import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

export default function GuestRoute({ children }) {
  const user = useAuthStore((s) => s.user);
  if (user) return <Navigate to="/" replace />;
  return children;
}
