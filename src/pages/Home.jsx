import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import MatchmakingModal from '../components/matchmaking/MatchmakingModal';
import { formatNumber } from '../lib/display';
import { playUiSound } from '../lib/sfx';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';

export default function Home() {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const navigate = useNavigate();
  const [playOpen, setPlayOpen] = useState(false);
  const [activePlayers, setActivePlayers] = useState(0);
  const [activeQueue, setActiveQueue] = useState(null);
  // The room the user is currently a member of (if any)
  const [currentRoom, setCurrentRoom] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    loadHomeStats();
    const channel = supabase
      .channel('home-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `user_id=eq.${profile.id}` }, loadHomeStats)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id]);

  async function loadHomeStats() {
    if (!supabase) return;
    console.log('[Home] Loading home stats');
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const [players, ownQueue, ownRoom] = await Promise.all([
      supabase.from('user_presence').select('user_id', { count: 'exact', head: true }).gte('last_seen_at', since),
      profile?.id
        ? supabase.from('matchmaking_queue').select('*').eq('user_id', profile.id).eq('status', 'waiting').order('queued_at', { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null }),
      // Check if user is a member of any active room
      profile?.id
        ? supabase.from('room_members')
            .select('room_id')
            .eq('user_id', profile.id)
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setActivePlayers(players.count || 0);
    setActiveQueue(ownQueue.data || null);
    // Load current room data (separate query to avoid FK nesting issues)
    let foundRoom = null;
    if (ownRoom.data?.room_id) {
      const { data: roomRow } = await supabase
        .from('rooms')
        .select('id, name, battle_id, status, battles(title)')
        .eq('id', ownRoom.data.room_id)
        .in('status', ['open', 'locked', 'voting'])
        .maybeSingle();
      foundRoom = roomRow || null;
    }
    console.log('[Home] Current room:', foundRoom?.id, foundRoom?.status);
    setCurrentRoom(foundRoom);
  }

  async function cancelQueue() {
    if (!activeQueue || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('matchmaking_queue').update({ status: 'cancelled' }).eq('id', activeQueue.id);
      if (error) throw error;
      playUiSound('cancel');
      addToast('QUEUE CANCELLED');
      await loadHomeStats();
    } catch (error) {
      addToast(error.message || 'QUEUE CANCEL FAILED', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function leaveCurrentRoom() {
    if (!currentRoom || !profile || busy) return;
    setBusy(true);
    console.log('[Home] Leaving room:', currentRoom.id);
    try {
      await supabase.from('room_members').delete().eq('room_id', currentRoom.id).eq('user_id', profile.id);

      const { data: remaining } = await supabase
        .from('room_members')
        .select('id')
        .eq('room_id', currentRoom.id)
        .limit(1);
      if (!remaining?.length) {
        await Promise.all([
          supabase.from('rooms').update({ status: 'closed' }).eq('id', currentRoom.id),
          supabase.from('battles').update({ status: 'closed', early_closed: false }).eq('id', currentRoom.battle_id).in('status', ['upcoming', 'active', 'voting']),
        ]);
        addToast('ROOM CLOSED');
      } else {
        addToast('LEFT ROOM');
      }
      setCurrentRoom(null);
      await loadHomeStats();
    } catch (error) {
      addToast(error.message || 'COULD NOT LEAVE ROOM', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="home-stage">

      {/* ── Matchmaking status card ── */}
      {activeQueue && (
        <aside className="matchmaking-status-card">
          <div className="font-mono text-[10px] uppercase text-rdb-muted">Matchmaking</div>
          <div className="mt-1 font-mono text-sm uppercase text-rdb-text">
            {activeQueue.mode === 'ranked' ? 'Ranked Queue' : 'Casual Queue'}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px] uppercase text-rdb-muted">
            <span>Status <b>{activeQueue.status}</b></span>
            <span>TIER <b>{profile?.rank_tier?.toUpperCase() || 'BRONZE'}</b></span>
          </div>
          <button
            className="rdb-button mt-3 w-full"
            disabled={busy}
            type="button"
            onClick={cancelQueue}
          >
            Cancel Queue
          </button>
        </aside>
      )}

      {/* ── Active room reminder card ── */}
      {currentRoom && (
        <aside className="matchmaking-status-card mt-3">
          <div className="font-mono text-[10px] uppercase text-rdb-muted">Active Room</div>
          <div className="mt-1 font-mono text-sm uppercase text-rdb-text">
            {currentRoom.battles?.title || currentRoom.name || 'BATTLE ROOM'}
          </div>
          <div className="mt-2 font-mono text-[10px] uppercase text-rdb-muted">
            STATUS <b className={currentRoom.status === 'open' ? 'text-green-400' : 'text-yellow-400'}>
              {currentRoom.status?.toUpperCase()}
            </b>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="rdb-button rdb-button-primary"
              type="button"
              onClick={() => {
                console.log('[Home] Rejoining room battle:', currentRoom.battle_id);
                navigate(`/battle/${currentRoom.battle_id}`);
              }}
            >
              REJOIN
            </button>
            <button
              className="rdb-button"
              type="button"
              disabled={busy}
              onClick={leaveCurrentRoom}
            >
              LEAVE
            </button>
          </div>
        </aside>
      )}

      <section className="home-menu">
        <h1 className="flex flex-col items-center gap-3">
          <img src="/logo.png" alt="RUNDATBEAT" className="h-28 w-28 sm:h-36 sm:w-36" />
          <span className="font-mono text-2xl font-bold uppercase tracking-widest text-rdb-orange sm:text-3xl">RUNDATBEAT</span>
        </h1>
        <div className="home-actions">
          <button
            className="rdb-menu-button border-rdb-orange text-rdb-text"
            disabled={Boolean(activeQueue)}
            type="button"
            onClick={() => { playUiSound('click'); setPlayOpen(true); }}
          >
            <span>{activeQueue ? 'QUEUED' : 'PLAY'}</span>
            <small>{activeQueue ? 'CANCEL QUEUE TO CHANGE MODES' : 'SOLO + RANKED + ROOMS'}</small>
          </button>
          <Link className="rdb-menu-button" to="/shop">
            <span>SHOP</span>
            <small>CUSTOM THEMES + NAME COLORS</small>
          </Link>
          <Link className="rdb-menu-button" to="/leaderboard">
            <span>LEADERBOARD</span>
            <small>CLIMB THE TIERS TO THE TOP</small>
          </Link>
        </div>
      </section>



      <div className="fixed bottom-4 right-4 z-40 font-mono text-[11px] uppercase text-rdb-muted">
        Active players: <b className="text-rdb-orange">{formatNumber(activePlayers)}</b>
      </div>

      <MatchmakingModal open={playOpen} onClose={() => setPlayOpen(false)} onQueued={loadHomeStats} />
    </main>
  );
}