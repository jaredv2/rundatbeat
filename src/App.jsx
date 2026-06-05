import { useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Footer from './components/layout/Footer';
import Navbar from './components/layout/Navbar';
import FriendsDock from './components/social/FriendsDock';
import ToastNotification from './components/ui/ToastNotification';
import { grantDailyLogin } from './lib/tokenHelpers';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import Admin from './pages/Admin';
import Battle from './pages/Battle';
import Cosmetics from './pages/Cosmetics';
import Home from './pages/Home';
import Landing from './pages/Landing';
import Host from './pages/Host';
import Leaderboard from './pages/Leaderboard';
import Login from './pages/Login';
import Profile from './pages/Profile';
import Setup from './pages/Setup';
import Settings from './pages/Settings';
import Shop from './pages/Shop';
import { useAuthStore } from './store/authStore';
import { useUiStore } from './store/uiStore';

function MissingConfig() {
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="rdb-panel max-w-xl p-6">
        <h1 className="font-mono text-3xl text-rdb-orange">RUNDATBEAT</h1>
        <p className="mt-4 text-rdb-muted">Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.</p>
      </div>
    </main>
  );
}

function BannedAccount({ profile, onLogout }) {
  const until = profile?.banned_until ? new Date(profile.banned_until).toLocaleString() : 'until reviewed';
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="rdb-panel max-w-md p-6 text-center">
        <h1 className="font-mono text-2xl uppercase text-rdb-red">Account banned</h1>
        <p className="mt-3 font-mono text-[12px] uppercase text-rdb-muted">Access is disabled {until}.</p>
        {profile?.ban_reason && <p className="mt-2 text-sm text-rdb-muted">{profile.ban_reason}</p>}
        <button className="rdb-button mt-5" type="button" onClick={onLogout}>Logout</button>
      </div>
    </main>
  );
}

export default function App() {
  const { setSession, setProfile, user, profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const navigate = useNavigate();
  const location = useLocation();
  const dailyLoginCheckedRef = useRef(false);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!supabase) return undefined;
    async function hydrate(session) {
      setSession(session);
      if (session?.user) {
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
        setProfile(profile);
        if (profile) {
          if (['/landing', '/login', '/setup'].includes(location.pathname)) {
            navigate('/', { replace: true });
          }
          const shouldCheckDaily = !dailyLoginCheckedRef.current && !['/landing', '/login'].includes(location.pathname);
          dailyLoginCheckedRef.current = true;
          const granted = shouldCheckDaily ? await grantDailyLogin(profile) : false;
          if (granted) addToast('+3 RDB DAILY LOGIN');
        } else if (location.pathname !== '/setup') {
          navigate('/setup');
        }
      } else {
        setProfile(null);
      }
      setAuthReady(true);
    }
    supabase.auth.getSession().then(({ data }) => hydrate(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => hydrate(session));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !profile?.id) return undefined;
    async function ping() {
      await supabase.from('user_presence').upsert({
        user_id: profile.id,
        last_seen_at: new Date().toISOString(),
      });
    }
    ping();
    const timer = window.setInterval(ping, 45000);
    return () => window.clearInterval(timer);
  }, [profile?.id]);

  if (!isSupabaseConfigured) return <MissingConfig />;
  if (!authReady) return <main className="grid min-h-screen place-items-center font-mono text-rdb-orange">LOADING...</main>;
  if (profile?.banned_until && new Date(profile.banned_until).getTime() > Date.now()) {
    return <BannedAccount profile={profile} onLogout={async () => { await useAuthStore.getState().logout(); navigate('/login', { replace: true }); }} />;
  }

  return (
    <div className="app-shell bg-rdb-bg text-rdb-text">
      <Navbar />
      <div className="app-content">
        <Routes>
          <Route path="/" element={user ? <Home /> : <Landing />} />
          <Route path="/landing" element={user ? <Navigate to="/" replace /> : <Landing />} />
          <Route path="/battle/:id" element={<Battle />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/cosmetics" element={<Cosmetics />} />
          <Route path="/host" element={<Host />} />
          <Route path="/profile/:username" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </div>
      {user && <FriendsDock />}
      <Footer />
      <ToastNotification />
    </div>
  );
}
