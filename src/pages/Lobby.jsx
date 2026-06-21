import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { playUiSound } from '../lib/sfx';
import { supabase } from '../lib/supabase';
import { devError } from '../lib/devLog';
import { getNameCosmeticClassName, getNameGradientStyle, getNameplateEmoji } from '../lib/display';
import { enterQueue, leaveLobby, startCountdown, advanceLobbyToActive } from '../lib/lobbyService';
import ChallengeReveal from '../components/battle/ChallengeReveal';
import Spinner from '../components/ui/Spinner';
import { Timer, Music, Users, Zap } from 'lucide-react';

function reconcileArray(prev, next, keyFn = (item) => item?.id ?? item?.user_id) {
  if (!next) return prev;
  if (!prev?.length) return next;
  const prevMap = new Map(prev.map(item => [keyFn(item), item]));
  let changed = false;
  const result = next.map(item => {
    const key = keyFn(item);
    const old = prevMap.get(key);
    if (!old) { changed = true; return item; }
    if (JSON.stringify(old) !== JSON.stringify(item)) { changed = true; return item; }
    return old;
  });
  if (result.length !== prev.length) changed = true;
  return changed ? result : prev;
}

function mergeObj(prev, next) {
  if (!next) return null;
  if (!prev) return next;
  let changed = false;
  const merged = { ...prev };
  for (const key of Object.keys(next)) {
    if (merged[key] !== next[key]) { merged[key] = next[key]; changed = true; }
  }
  return changed ? merged : prev;
}

export default function Lobby() {
  const { id } = useParams();
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const addToast = useUiStore((s) => s.addToast);
  const [lobby, setLobby] = useState(null);
  const [members, setMembers] = useState([]);
  const [countdown, setCountdown] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const selfLeaving = useRef(false);

  // ── Load lobby on mount ──────────────────────────────────────────────────
  useEffect(() => {
    if (!profile || !id) return;
    setLoading(true);
    Promise.all([
      supabase.from('ranked_lobbies').select('*').eq('id', id).maybeSingle(),
      supabase.from('ranked_lobby_members').select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)').eq('lobby_id', id).order('joined_at'),
    ]).then(([lobbyRes, membersRes]) => {
      if (lobbyRes.error || !lobbyRes.data) { setLoading(false); return; }
      setLobby(lobbyRes.data);
      setMembers(membersRes.data || []);
      setLoading(false);
    });
  }, [profile?.id, id]);

  // ── Realtime: lobby changes ──────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;

    async function fetchMembers() {
      try {
        const { data } = await supabase
          .from('ranked_lobby_members')
          .select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)')
          .eq('lobby_id', id)
          .order('joined_at');
        if (data) setMembers(prev => reconcileArray(prev, data));
      } catch {
        // Silently handle — 30s poll will catch up
      }
    }

    const channel = supabase
      .channel(`lobby-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ranked_lobbies', filter: `id=eq.${id}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setLobby(prev => prev ? { ...prev, status: 'closed' } : prev);
          return;
        }
        setLobby(prev => mergeObj(prev, payload.new));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ranked_lobby_members', filter: `lobby_id=eq.${id}` }, () => {
        fetchMembers();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [id]);

  // ── Auto-fill: detect when members reach max → transition to ready ──────
  useEffect(() => {
    if (!lobby || lobby.status !== 'matching' || !id) return;
    if (members.length >= lobby.max_players) {
      supabase.from('ranked_lobbies').update({ status: 'ready' }).eq('id', id).eq('status', 'matching');
    }
  }, [members.length, lobby?.status, lobby?.max_players, id]);

  // ── Auto-start: when lobby is full OR status is starting/ready → start countdown ──
  useEffect(() => {
    if (!lobby || lobby.countdown_started_at || !id) return;
    const full = members.length >= (lobby.max_players || 2);
    const shouldStart = full || lobby.status === 'starting' || lobby.status === 'ready';
    if (shouldStart) {
      startCountdown(id).catch((err) => devError('startCountdown failed:', err));
    }
  }, [members.length, lobby?.max_players, lobby?.countdown_started_at, lobby?.status, id]);

  // ── Countdown timer (always uses DB timestamp) ──────────────────────────────
  useEffect(() => {
    const target = lobby?.countdown_started_at ? new Date(lobby.countdown_started_at).getTime() + 5000 : null;
    if (!target) { setCountdown(null); return; }
    let raf;
    function tick() {
      const remaining = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setCountdown(remaining > 0 ? remaining : null);
      if (remaining > 0) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lobby?.countdown_started_at]);

  // ── Advance to active when countdown expires ────────────────────────────
  const advancing = useRef(false);
  useEffect(() => {
    if (!lobby?.countdown_started_at) return;
    if (advancing.current) return;

    const target = new Date(lobby.countdown_started_at).getTime() + 5000;
    const delay = Math.max(0, target - Date.now());
    if (delay > 0) {
      const timer = setTimeout(() => {
        advancing.current = true;
        advanceLobbyToActive(id).then(({ battleId }) => {
          // Cleanup lobby membership after transitioning to battle
          supabase.from('ranked_lobby_members').delete().eq('user_id', profile.id).eq('lobby_id', id);
          if (battleId) {
            navigate(`/battle/${battleId}`, { replace: true });
          } else {
            devError('advanceLobbyToActive returned no battleId');
            advancing.current = false;
          }
        }).catch((err) => {
          devError('advanceLobbyToActive failed:', err);
          advancing.current = false;
        });
      }, delay);
      return () => clearTimeout(timer);
    }
    // Already past expiry — advance immediately
    advancing.current = true;
    advanceLobbyToActive(id).then(({ battleId }) => {
      supabase.from('ranked_lobby_members').delete().eq('user_id', profile.id);
      if (battleId) {
        navigate(`/battle/${battleId}`, { replace: true });
      } else {
        advancing.current = false;
      }
    }).catch((err) => {
      devError('advanceLobbyToActive failed:', err);
      advancing.current = false;
    });
  }, [lobby?.countdown_started_at, id, navigate]);

  // ── Redirect when kicked ─────────────────────────────────────────────────
  const wasMember = useRef(false);
  useEffect(() => {
    if (loading) return;
    const nowMember = members.some((m) => m.user_id === profile?.id);
    if (!wasMember.current && nowMember) wasMember.current = true;
    if (wasMember.current && !nowMember && profile && !selfLeaving.current) {
      addToast('REMOVED FROM LOBBY');
      navigate('/', { replace: true });
    }
  }, [members, profile?.id, loading]);

  // ── beforeunload cleanup ─────────────────────────────────────────────────
  useEffect(() => {
    if (!profile || !lobby) return;
    if (lobby.status !== 'matching') return;
    const doLeave = () => {
      if (selfLeaving.current) return;
      selfLeaving.current = true;
      supabase.from('ranked_lobby_members').delete().eq('lobby_id', lobby.id).eq('user_id', profile.id);
    };
    window.addEventListener('beforeunload', doLeave);
    return () => window.removeEventListener('beforeunload', doLeave);
  }, [profile?.id, lobby?.id, lobby?.status]);

  // ── Fallback polling — 30s interval only if realtime seems dead ──────────
  useEffect(() => {
    if (!id) return;
    const poll = setInterval(async () => {
      const { data } = await supabase.from('ranked_lobby_members').select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)').eq('lobby_id', id).order('joined_at');
      if (data) setMembers(prev => reconcileArray(prev, data));
    }, 30000);
    return () => clearInterval(poll);
  }, [id]);

  async function handleLeave() {
    if (!profile || !lobby || leaving) return;
    setLeaving(true);
    selfLeaving.current = true;
    playUiSound('cancel');
    window.__clearReturnTo?.();
    try {
      await leaveLobby(lobby.id, profile.id);
      addToast('LEFT LOBBY');
      navigate('/', { replace: true });
    } catch {
      setLeaving(false);
    }
  }

  // ── Guards ───────────────────────────────────────────────────────────────
  if (!profile) return <Navigate to="/login" replace />;
  if (loading)  return <main className="rdb-container-admin grid min-h-[calc(100vh-88px)] place-items-center"><Spinner label="LOADING LOBBY" /></main>;
  if (!lobby)   return <main className="rdb-container-admin grid min-h-[calc(100vh-88px)] place-items-center"><Spinner label="LOBBY NOT FOUND" /></main>;
  if (lobby.status === 'closed') return <main className="rdb-container font-mono text-rdb-red">LOBBY CLOSED</main>;

  const isMatching = lobby.status === 'matching';
  const countdownActive = countdown !== null || lobby.countdown_started_at;

  return (
    <main className="rdb-container-admin grid min-h-[calc(100vh-88px)] place-items-center py-12">
      <div className="mx-auto w-full max-w-4xl space-y-5 lg:grid lg:grid-cols-[1fr_280px] lg:gap-5 lg:space-y-0">

        {/* ── Left column: lobby content ── */}
        <div className="space-y-5">
          {/* ── Header ── */}
          <div className="text-center">
            <h1 className="font-mono text-2xl font-bold uppercase text-rdb-text">
              RANKED MATCH
            </h1>
            <p className="mt-1 font-mono text-[11px] uppercase text-rdb-muted">
              {members.length}/{lobby.max_players} PLAYERS
              {isMatching && <span className="ml-2 text-rdb-orange blink">SEARCHING</span>}
              {countdownActive && !isMatching && <span className="ml-2 text-green-400">MATCH FOUND</span>}
            </p>
          </div>

          {/* ── Player list (names only) ── */}
          <div className="rdb-panel p-4">
            <h2 className="font-mono text-[11px] uppercase text-rdb-orange mb-3">IN LOBBY</h2>
            <div className="space-y-2">
              {members.map((m) => {
                const isSelf = m.user_id === profile?.id;
                return (
                  <div key={m.user_id} className="flex items-center gap-2">
                    <span
                      className="h-6 w-6 rounded-full bg-rdb-surface flex-shrink-0 flex items-center justify-center font-mono text-[10px] font-bold uppercase text-rdb-muted overflow-hidden border border-rdb-border"
                    >
                      {m.profiles?.avatar_url
                        ? <img loading="lazy" src={m.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                        : (m.profiles?.username || '?')[0]}
                    </span>
                    <span
                      className={`font-mono text-[12px] uppercase truncate ${getNameCosmeticClassName(m.profiles)}`}
                      style={getNameGradientStyle(m.profiles)}
                    >
                      {m.profiles?.nameplate_icon && <span className="mr-1 text-rdb-orange">{getNameplateEmoji(m.profiles.nameplate_icon)}</span>}
                      {m.profiles?.username || 'USER'}{isSelf && <span className="text-rdb-muted ml-1 text-[10px]">(YOU)</span>}
                    </span>
                  </div>
                );
              })}
              {members.length < lobby.max_players && isMatching && (
                <div className="font-mono text-[10px] uppercase text-rdb-muted italic">
                  WAITING FOR OPPONENT...
                </div>
              )}
            </div>
          </div>

          {/* ── Searching animation ── */}
          {isMatching && (
            <div className="rdb-panel p-8 text-center space-y-4">
              <div className="inline-flex items-center gap-3">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-rdb-orange border-t-transparent" />
                <span className="font-mono text-[12px] uppercase text-rdb-orange">FINDING OPPONENTS...</span>
              </div>
              <div className="flex justify-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-2 w-2 rounded-full bg-rdb-orange animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <p className="font-mono text-[10px] uppercase text-rdb-muted">
                {members.length}/{lobby.max_players} SLOTS FILLED
              </p>
            </div>
          )}

          {/* ── Countdown ── */}
          {countdownActive && !isMatching && (
            <ChallengeReveal
              challenge={lobby.challenge}
              endsAt={lobby.countdown_started_at ? new Date(new Date(lobby.countdown_started_at).getTime() + 5000).toISOString() : null}
              hideChallenge
            />
          )}

          {/* ── Leave ── */}
          <div className="text-center">
            <button
              className="rdb-button border-rdb-red text-rdb-red font-mono text-[12px] uppercase"
              disabled={leaving || (countdownActive && countdown !== null && countdown > 1)}
              onClick={handleLeave}
              type="button"
            >
              {leaving ? 'LEAVING...' : 'LEAVE'}
            </button>
          </div>
        </div>

        {/* ── Right column: match details ── */}
        <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <div className="rdb-panel p-4">
            <h2 className="font-mono text-[11px] uppercase text-rdb-orange mb-3">MATCH DETAILS</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-rdb-muted"><Music size={12} />Song Length</span>
                <span className="font-mono text-[11px] uppercase text-rdb-text">90s</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-rdb-muted"><Timer size={12} />Battle Time</span>
                <span className="font-mono text-[11px] uppercase text-rdb-text">15min</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-rdb-muted"><Zap size={12} />Voting</span>
                <span className="font-mono text-[11px] uppercase text-rdb-text">3min</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-rdb-muted"><Users size={12} />Players</span>
                <span className="font-mono text-[11px] uppercase text-rdb-text">{lobby.max_players}</span>
              </div>
            </div>
          </div>
          <div className="rdb-panel p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase text-rdb-muted">MODE</span>
              <span className="border border-rdb-orange px-1.5 py-0.5 font-mono text-[10px] uppercase text-rdb-orange">RANKED</span>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
