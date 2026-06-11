import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';

const HIDE_PATHS = ['/lobby/', '/battle/', '/host'];

export default function SessionBar() {
  const profile = useAuthStore((s) => s.profile);
  const addToast = useUiStore((s) => s.addToast);
  const location = useLocation();
  const [session, setSession] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const pollRef = useRef(null);

  const hidden = HIDE_PATHS.some((p) => location.pathname.startsWith(p));

  const loadSession = useCallback(async () => {
    if (!profile) { setSession(null); return; }

    const { data: rlm } = await supabase
      .from('ranked_lobby_members')
      .select('*, ranked_lobbies!inner(id, status, max_players, countdown_started_at)')
      .eq('user_id', profile.id)
      .in('ranked_lobbies.status', ['matching', 'ready'])
      .maybeSingle();

    if (rlm) {
      setSession({ type: 'lobby', lobby: rlm.ranked_lobbies, member: rlm });
      return;
    }

    const { data: rm } = await supabase
      .from('room_members')
      .select('*, rooms!inner(id, battle_id, status, mode, name, current_players, max_players, min_rank_tier, challenge)')
      .eq('user_id', profile.id)
      .in('rooms.status', ['lobby', 'locked', 'upcoming', 'active', 'voting'])
      .maybeSingle();

    if (rm) {
      setSession({ type: rm.rooms.mode === 'solo' ? 'solo' : 'room', room: rm.rooms, member: rm });
      return;
    }

    setSession(null);
  }, [profile]);

  useEffect(() => {
    loadSession();
    pollRef.current = setInterval(loadSession, 10000);
    return () => clearInterval(pollRef.current);
  }, [loadSession]);

  async function handleLeave() {
    if (!session || leaving) return;
    setLeaving(true);
    window.__clearReturnTo?.();
    try {
      if (session.type === 'lobby') {
        await supabase.from('ranked_lobby_members').delete().eq('lobby_id', session.lobby.id).eq('user_id', profile.id);
      } else {
        await supabase.from('room_members').delete().eq('room_id', session.room.id).eq('user_id', profile.id);
        const { count } = await supabase.from('room_members').select('room_id', { count: 'exact', head: true }).eq('room_id', session.room.id);
        if (count <= 0) await supabase.from('rooms').update({ status: 'closed' }).eq('id', session.room.id);
      }
      addToast('LEFT SESSION');
      setSession(null);
    } catch (err) {
      addToast(err.message || 'COULD NOT LEAVE', 'error');
    } finally {
      setLeaving(false);
    }
  }

  if (!profile || !session || hidden) return null;

  const isLobby = session.type === 'lobby';
  const isSolo = session.type === 'solo';
  const entity = isLobby ? session.lobby : session.room;
  const statusLabel = isLobby ? (session.lobby.status === 'ready' ? 'READY' : 'MATCHING') : session.room.status.toUpperCase();
  const rejoinUrl = isLobby ? `/lobby/${session.lobby.id}` : `/battle/${session.room.battle_id}`;

  return (
    <div className="fixed top-14 left-2 z-50 max-w-xs">
      <div className="rdb-panel p-2.5 flex items-center gap-3 font-mono text-[10px] uppercase leading-tight">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${isLobby ? (session.lobby.status === 'ready' ? 'bg-green-400' : 'bg-rdb-orange') : isSolo ? 'bg-blue-400' : 'bg-rdb-orange'}`} />
            <span className="truncate font-bold text-rdb-text">
              {isLobby ? 'RANKED' : isSolo ? 'SOLO' : 'ROOM'}
            </span>
            <span className="text-rdb-muted">{statusLabel}</span>
          </div>
          <div className="text-rdb-muted mt-0.5">
            {isLobby
              ? `${session.lobby.max_players || 4} PLAYERS`
              : `${session.room.current_players || 0}/${session.room.max_players || 4}`}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Link
            to={rejoinUrl}
            className="rdb-button px-2 py-1 text-[9px]"
            type="button"
          >
            REJOIN
          </Link>
          <button
            className="rdb-button border-rdb-red text-rdb-red px-2 py-1 text-[9px]"
            disabled={leaving}
            onClick={handleLeave}
            type="button"
          >
            {leaving ? '...' : 'LEAVE'}
          </button>
        </div>
      </div>
    </div>
  );
}
