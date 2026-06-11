import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { playUiSound } from '../lib/sfx';
import { supabase } from '../lib/supabase';
import { formatNumber, getNameCosmeticClassName, getNameGradientStyle, getNameplateEmoji } from '../lib/display';
import { enterQueue, leaveLobby, toggleReady, startCountdown, advanceLobbyToActive } from '../lib/lobbyService';

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
  const [messages, setMessages] = useState([]);
  const [messageBody, setMessageBody] = useState('');
  const [countdown, setCountdown] = useState(null);
  const [localCountdownEnd, setLocalCountdownEnd] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const chatEndRef = useRef(null);
  const selfLeaving = useRef(false);

  const myMember = members.find((m) => m.user_id === profile?.id);
  const allReady = members.length >= 2 && members.every((m) => m.is_ready);

  // ── Load lobby on mount ──────────────────────────────────────────────────
  useEffect(() => {
    if (!profile || !id) return;
    setLoading(true);
    Promise.all([
      supabase.from('ranked_lobbies').select('*').eq('id', id).maybeSingle(),
      supabase.from('ranked_lobby_members').select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)').eq('lobby_id', id).order('joined_at'),
        supabase.from('lobby_messages').select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon)').eq('lobby_id', id).order('created_at'),
    ]).then(([lobbyRes, membersRes, messagesRes]) => {
      if (lobbyRes.error || !lobbyRes.data) { setLoading(false); return; }
      setLobby(lobbyRes.data);
      setMembers(membersRes.data || []);
      setMessages(messagesRes.data || []);
      setLoading(false);
    });
  }, [profile?.id, id]);

  // ── Realtime: lobby changes ──────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`lobby-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ranked_lobbies', filter: `id=eq.${id}` }, (payload) => {
        setLobby(prev => mergeObj(prev, payload.new));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ranked_lobby_members', filter: `lobby_id=eq.${id}` }, async () => {
        const { data } = await supabase.from('ranked_lobby_members').select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)').eq('lobby_id', id).order('joined_at');
        setMembers(prev => reconcileArray(prev, data || []));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lobby_messages', filter: `lobby_id=eq.${id}` }, (payload) => {
        if (payload.new) {
          supabase.from('lobby_messages').select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon)').eq('id', payload.new.id).maybeSingle().then(({ data }) => {
            if (data) {
              setMessages((prev) => {
                if (prev.some(m => m.id === data.id)) return prev;
                // Remove any matching optimistic message
                const cleaned = prev.filter(m => !(m.id.startsWith('opt-') && m.body === data.body && m.user_id === data.user_id));
                return [...cleaned, data];
              });
              requestAnimationFrame(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
            }
          });
        }
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

  // ── Auto-start: when all members ready → start countdown ──
  useEffect(() => {
    if (!lobby || lobby.countdown_started_at || localCountdownEnd || !id) return;
    if (allReady) {
      setLocalCountdownEnd(Date.now() + 5000);
      startCountdown(id);
    }
  }, [allReady, lobby?.countdown_started_at, localCountdownEnd, id]);

  // ── Countdown timer (local target + DB fallback) ─────────────────────────
  useEffect(() => {
    const targetMs = localCountdownEnd || (lobby?.countdown_started_at ? new Date(lobby.countdown_started_at).getTime() + 5000 : null);
    if (!targetMs) { setCountdown(null); return; }
    let raf;
    function tick() {
      const remaining = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
      setCountdown(remaining > 0 ? remaining : null);
      if (remaining > 0) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [localCountdownEnd, lobby?.countdown_started_at]);

  // ── Advance to active when countdown expires ────────────────────────────
  const advancing = useRef(false);
  useEffect(() => {
    const hasRealtimeTs = !!lobby?.countdown_started_at;
    const hasLocalTs = !!localCountdownEnd;
    if (!hasRealtimeTs && !hasLocalTs) return;
    if (countdown !== null) return;
    if (!advancing.current) {
      advancing.current = true;
      advanceLobbyToActive(id).then(({ battleId }) => {
        navigate(`/battle/${battleId}`, { replace: true });
      }).catch((err) => {
        console.error('[Lobby] advance failed:', err);
        advancing.current = false;
      });
    }
  }, [countdown, lobby?.countdown_started_at, localCountdownEnd, id, navigate]);

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

  // ── Poll members + messages every 2s as fallback ─────────────────────────
  useEffect(() => {
    if (!id) return;
    const poll = setInterval(async () => {
      const [membersRes, messagesRes] = await Promise.all([
        supabase.from('ranked_lobby_members').select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)').eq('lobby_id', id).order('joined_at'),
      supabase.from('lobby_messages').select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon)').eq('lobby_id', id).order('created_at'),
      ]);
      if (membersRes.data) setMembers(prev => reconcileArray(prev, membersRes.data));
      if (messagesRes.data) setMessages(prev => reconcileArray(prev, messagesRes.data));
    }, 2000);
    return () => clearInterval(poll);
  }, [id]);



  async function sendMessage() {
    if (!profile || !id || !messageBody.trim()) return;
    const body = messageBody.trim();
    setMessageBody('');
    const optimisticMsg = { id: `opt-${Date.now()}`, lobby_id: id, user_id: profile.id, body, created_at: new Date().toISOString(), profiles: { username: profile.username } };
    setMessages((prev) => [...prev, optimisticMsg]);
    try {
      const { error } = await supabase.from('lobby_messages').insert({ lobby_id: id, user_id: profile.id, body });
      if (error) throw error;
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
      addToast(err.message || 'MESSAGE FAILED', 'error');
    }
  }

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

  async function handleStartCountdown() {
    if (!id) return;
    playUiSound('click');
    await startCountdown(id);
    addToast('COUNTDOWN STARTED');
  }

  async function handleToggleReady() {
    if (!lobby || !profile || countdown !== null || lobby.countdown_started_at) return;
    playUiSound('click');
    const oldReady = myMember?.is_ready;
    const newReady = !oldReady;
    // Optimistic: flip instantly
    setMembers(prev => prev.map(m => m.user_id === profile.id ? { ...m, is_ready: newReady } : m));
    try {
      await toggleReady(lobby.id, profile.id);
      const nowAllReady = members.length >= 2 && members.every((m) => m.user_id === profile.id ? newReady : m.is_ready);
      if (nowAllReady) {
        setLocalCountdownEnd(Date.now() + 5000);
        await startCountdown(id);
      }
    } catch (err) {
      // Rollback on failure
      setMembers(prev => prev.map(m => m.user_id === profile.id ? { ...m, is_ready: oldReady } : m));
      console.error('startCountdown failed:', err);
    }
  }

  // ── Guards ───────────────────────────────────────────────────────────────
  if (!profile) return <Navigate to="/login" replace />;
  if (loading)  return <main className="rdb-container font-mono text-rdb-orange blink">LOADING...</main>;
  if (!lobby)   return <main className="rdb-container font-mono text-rdb-red">LOBBY NOT FOUND</main>;
  if (lobby.status === 'closed') return <main className="rdb-container font-mono text-rdb-red">LOBBY CLOSED</main>;

  const isMatching = lobby.status === 'matching';

  return (
    <main className="rdb-container-admin min-h-[calc(100vh-88px)] py-12">
      <div className="mx-auto w-full max-w-5xl">

        {/* ── Header ── */}
        <div className="text-center mb-6">
          <h1 className="font-mono text-2xl font-bold uppercase text-rdb-text">
            RANKED MATCH
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase text-rdb-muted">
            {members.length}/{lobby.max_players} PLAYERS
            {isMatching && <span className="ml-2 text-rdb-orange blink">SEARCHING</span>}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">

          {/* ══ LEFT: Player list + Controls ══ */}
          <div className="space-y-5">

            {/* ── Player list ── */}
            <div className="rdb-panel p-5">
              <h2 className="font-mono text-[12px] uppercase text-rdb-orange mb-3">
                PLAYERS <span className="ml-2 text-green-400">({members.filter((m) => m.is_ready).length}/{members.length} READY)</span>
              </h2>
              <div className="space-y-2">
                {members.map((member) => {
                  const isSelf = member.user_id === profile?.id;
                  return (
                    <div key={member.user_id} className="flex items-center justify-between gap-2 rounded border border-rdb-border bg-rdb-bg px-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${member.is_ready ? 'bg-green-400' : 'bg-rdb-orange/40'}`} />
                        <span className={`truncate font-mono text-[12px] uppercase ${getNameCosmeticClassName(member.profiles)}`} style={getNameGradientStyle(member.profiles)}>
                          {member.profiles?.nameplate_icon && <span className="mr-1 text-rdb-orange">{getNameplateEmoji(member.profiles.nameplate_icon)}</span>}
                          {member.profiles?.username || 'USER'}
                          {isSelf && <span className="ml-1.5 text-rdb-muted text-[10px]">(YOU)</span>}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isSelf ? (
                          <button
                            className={`font-mono text-[10px] uppercase font-bold px-2 py-1 rounded border ${member.is_ready ? 'border-rdb-orange text-rdb-orange bg-rdb-orange/10' : 'border-green-500 text-green-400 bg-green-500/10'}`}
                            disabled={countdown !== null}
                            onClick={handleToggleReady}
                            type="button"
                          >
                            {member.is_ready ? 'UNREADY' : 'READY UP'}
                          </button>
                        ) : (
                          <span className={`font-mono text-[10px] uppercase ${member.is_ready ? 'text-green-400' : 'text-rdb-muted'}`}>
                            {member.is_ready ? 'READY' : 'NOT READY'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!members.length && (
                  <div className="rounded border border-rdb-border bg-rdb-bg p-4 text-center font-mono text-[11px] uppercase text-rdb-muted">
                    Waiting for players...
                  </div>
                )}
              </div>
            </div>

            {/* ── Controls ── */}
            <div className="rdb-panel p-5 flex flex-col items-center gap-3">
              {countdown !== null && (
                <div className="flex flex-col items-center gap-2 w-full">
                  <div className="font-mono text-[12px] uppercase text-rdb-orange blink">
                    {countdown > 0 ? `GAME STARTING IN ${countdown}s` : 'STARTING...'}
                  </div>
                  <div className="h-1.5 w-full max-w-[240px] overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-rdb-orange transition-all duration-1000" style={{ width: `${((5 - countdown) / 5) * 100}%` }} />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 w-full">
                <button
                  className={`flex-1 h-11 font-mono text-[12px] uppercase font-bold ${myMember?.is_ready ? 'rdb-button border-rdb-orange text-rdb-orange' : 'rdb-button rdb-button-primary'}`}
                  disabled={countdown !== null || leaving}
                  onClick={handleToggleReady}
                  type="button"
                >
                  {myMember?.is_ready ? 'UNREADY' : 'READY UP'}
                </button>
                <button
                  className="h-11 px-6 rdb-button border-rdb-red text-rdb-red font-mono text-[12px] uppercase"
                  disabled={countdown !== null || leaving}
                  onClick={handleLeave}
                  type="button"
                >
                  {leaving ? 'LEAVING...' : 'LEAVE'}
                </button>
              </div>
              <p className="font-mono text-[10px] uppercase text-rdb-muted text-center">
                {lobby?.status === 'ready' ? 'LOBBY FULL — STARTING...' : `${members.length}/${lobby?.max_players || 10} PLAYERS — ${members.filter((m) => m.is_ready).length} READY`}
              </p>
            </div>
          </div>

          {/* ══ RIGHT: Chat ══ */}
          <div className="rdb-panel p-5 flex flex-col h-full min-h-[400px]">
            <h2 className="font-mono text-[12px] uppercase text-rdb-orange mb-3">CHAT</h2>
            <div className="flex-1 overflow-y-auto border-y border-rdb-border py-2 mb-3 min-h-0">
              {messages.map((message) => (
                <div key={message.id} className="mb-2 font-mono text-[11px] uppercase text-rdb-muted">
                  <span className={`${getNameCosmeticClassName(message.profiles)}`} style={getNameGradientStyle(message.profiles)}>
                    {message.profiles?.nameplate_icon && <span className="mr-1 text-rdb-orange">{getNameplateEmoji(message.profiles.nameplate_icon)}</span>}
                    {message.profiles?.username || 'USER'}:
                  </span>{' '}
                  {message.body}
                </div>
              ))}
              {!messages.length && (
                <div className="font-mono text-[11px] uppercase text-rdb-muted">No messages yet.</div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <input
                className="rdb-input flex-1"
                placeholder="TYPE A MESSAGE"
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
              />
              <button className="rdb-button rdb-button-primary" type="button" onClick={sendMessage}>SEND</button>
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
