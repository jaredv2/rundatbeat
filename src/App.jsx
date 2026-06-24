import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Footer from './components/layout/Footer';
import Navbar from './components/layout/Navbar';
import FriendsDock from './components/social/FriendsDock';
import { devError } from './lib/devLog';

import ToastNotification from './components/ui/ToastNotification';
import Spinner from './components/ui/Spinner';

import { useNotifications } from './hooks/useNotifications';
import { grantDailyLogin } from './lib/tokenHelpers';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { fetchDiscordProfile, buildDiscordPatch } from './lib/discord';
import { useAuthStore } from './store/authStore';
import { useUiStore } from './store/uiStore';
import { playUiSound } from './lib/sfx';
import { requestNotificationPermission } from './lib/notifications';
import './lib/debug';

async function cleanupStaleRooms(userId) {
  if (!supabase) return;
  const { data: memberships } = await supabase
    .from('room_members')
    .select('room_id')
    .eq('user_id', userId);
  if (!memberships?.length) return;
  const { data: rooms } = await supabase
    .from('rooms')
    .select('id')
    .in('id', memberships.map(m => m.room_id))
    .eq('status', 'closed');
  if (rooms?.length) {
    await supabase
      .from('room_members')
      .delete()
      .in('room_id', rooms.map(r => r.id))
      .eq('user_id', userId);
  }
}

// Route → title map. Dynamic routes (/battle/:id, /profile/:username) handled separately below.
const ROUTE_TITLES = {
  '/':            'SAMPLE BATTLE — HOME',
  '/landing':     'SAMPLE BATTLE — WELCOME',
  '/login':       'SAMPLE BATTLE — LOGIN',
  '/setup':       'SAMPLE BATTLE — SETUP',
  '/shop':        'SAMPLE BATTLE — THE SHOP',
  '/cosmetics':   'SAMPLE BATTLE — COSMETICS',
  '/host':        'SAMPLE BATTLE — HOST A BATTLE',
  '/leaderboard': 'SAMPLE BATTLE — LEADERBOARD',
  '/settings':    'SAMPLE BATTLE — SETTINGS',
  '/admin':       'SAMPLE BATTLE — ADMIN',
};

// Called inside App so it has access to the Router context (useLocation)
function usePageTitle() {
  const location = useLocation();
  useEffect(() => {
    const path = location.pathname;

    // Exact match
    if (ROUTE_TITLES[path]) {
      document.title = ROUTE_TITLES[path];
      return;
    }

    // /profile/:userId — show generic profile title
    if (path.startsWith('/profile/')) {
      document.title = 'SAMPLE BATTLE — PROFILE';
      return;
    }

    // /battle/:id — generic battle title (Battle page loads the real name async)
    if (path.startsWith('/battle/')) {
      document.title = 'SAMPLE BATTLE — BATTLE';
      return;
    }

    // Fallback
    document.title = 'SAMPLE BATTLE';
  }, [location.pathname]);
}

function MissingConfig() {
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="rdb-panel max-w-xl p-6">
        <h1 className="font-mono text-3xl text-rdb-orange">SAMPLE BATTLE</h1>
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
        <button className="rdb-button mt-5" type="button" onClick={() => { playUiSound('cancel'); onLogout(); }}>Logout</button>
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
  const lastSessionRef = useRef(null);
  const [authReady, setAuthReady] = useState(false);

  // Updates document.title on every route change
  usePageTitle();

  useNotifications();

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return undefined; }

    const initialSessionResolved = { current: false };

    async function hydrate(session, fromInitialSession = false) {
      const sessionKey = session?.access_token || session?.user?.id || null;
      if (sessionKey === lastSessionRef.current) return;
      if (!sessionKey && lastSessionRef.current) return;
      lastSessionRef.current = sessionKey;
      try {
        setSession(session);
        if (session?.user) {
          const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
          setProfile(profile);
          if (profile) {
            cleanupStaleRooms(profile.id);
            if (['/landing', '/login', '/setup'].includes(location.pathname)) {
              navigate('/', { replace: true });
            }
            const shouldCheckDaily = !dailyLoginCheckedRef.current && !['/landing', '/login'].includes(location.pathname);
            dailyLoginCheckedRef.current = true;
            const granted = shouldCheckDaily ? await grantDailyLogin(profile) : false;
            if (granted) addToast('+3 RDB DAILY LOGIN');
            if (!profile.discord_id || !profile.avatar_url) {
              const isDiscordUser = session?.user?.app_metadata?.provider === 'discord' || session?.user?.app_metadata?.providers?.includes('discord');
              if (isDiscordUser) {
                fetchDiscordProfile().then((discord) => {
                  if (discord) {
                    const patch = buildDiscordPatch(session.user.id, discord, profile);
                    if (patch && Object.keys(patch).length) {
                      supabase.from('profiles').update(patch).eq('id', profile.id);
                    }
                  }
                }).catch(() => {});
              }
            }
            requestNotificationPermission().catch(() => {});
          } else if (location.pathname !== '/setup') {
            navigate('/setup');
          }
        } else {
          setProfile(null);
        }
      } catch (err) {
        devError('[App] hydrate error:', err);
      } finally {
        if (fromInitialSession) initialSessionResolved.current = true;
        setAuthReady(true);
      }
    }

    supabase.auth.getSession().then(({ data }) => hydrate(data.session, true)).catch(() => setAuthReady(true));

    const fallbackTimer = setTimeout(() => {
      if (!initialSessionResolved.current) {
        initialSessionResolved.current = true;
        setAuthReady(true);
      }
    }, 8000);

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!initialSessionResolved.current) return;
      hydrate(session);
    });

    return () => {
      clearTimeout(fallbackTimer);
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !profile?.id) return undefined;
    async function ping() {
      await supabase.from('user_presence').upsert({
        user_id: profile.id,
        last_seen_at: new Date().toISOString(),
      });
      const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from('user_presence')
        .select('user_id', { count: 'exact' })
        .gte('last_seen_at', since);
      if (count > 0) {
        const { data: peak } = await supabase
          .from('site_stats')
          .select('value')
          .eq('metric', 'peak_online')
          .maybeSingle();
        if (!peak || count > peak.value) {
          await supabase.from('site_stats').upsert({ metric: 'peak_online', value: count, updated_at: new Date().toISOString() });
        }
      }
    }
    ping();
    const timer = window.setInterval(ping, 45000);
    return () => window.clearInterval(timer);
  }, [profile?.id]);

  useEffect(() => {
    if (!supabase || !profile?.id) return;
    supabase.rpc('increment_counter', { metric_name: 'page_visits' });
  }, [location.pathname, profile?.id]);

  if (!isSupabaseConfigured) return <MissingConfig />;
  if (!authReady) return <main className="grid min-h-screen place-items-center"><Spinner label="AUTHENTICATING" /></main>;
  if (profile?.banned_until && new Date(profile.banned_until).getTime() > Date.now()) {
    return <BannedAccount profile={profile} onLogout={async () => { await useAuthStore.getState().logout(); navigate('/login', { replace: true }); }} />;
  }

  const hideNav = location.pathname.startsWith('/lobby/') || location.pathname.startsWith('/battle/');

  return (
    <div className="app-shell bg-rdb-bg text-rdb-text">
      {!hideNav && <Navbar />}
      <div className="app-content">
        <Outlet />
      </div>

      {user && !hideNav && <FriendsDock />}
      {!hideNav && <Footer />}
      <ToastNotification />
    </div>
  );
}