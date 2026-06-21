import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import Spinner from '../ui/Spinner';

export default function PrivateRoute({ children }) {
  const user = useAuthStore((s) => s.user);
  const session = useAuthStore((s) => s.session);
  if (!user && !session) return <Navigate to="/landing" replace />;
  return children;
}
