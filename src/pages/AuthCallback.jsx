import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Spinner from '../components/ui/Spinner';

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      subscription.unsubscribe();
      navigate(session ? '/' : '/login', { replace: true });
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        subscription.unsubscribe();
        navigate('/', { replace: true });
      }
    }).catch(() => {
      subscription.unsubscribe();
      navigate('/login', { replace: true });
    });

    const timeout = setTimeout(() => navigate('/login', { replace: true }), 10000);
    return () => { clearTimeout(timeout); subscription.unsubscribe(); };
  }, [navigate]);

  return <main className="grid min-h-screen place-items-center"><Spinner label="AUTHENTICATING" /></main>;
}
