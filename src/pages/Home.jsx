import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import MatchmakingModal from '../components/matchmaking/MatchmakingModal';
import { formatNumber } from '../lib/display';
import { playUiSound } from '../lib/sfx';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';

export default function Home() {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const [playOpen, setPlayOpen] = useState(false);
  const [activePlayers, setActivePlayers] = useState(0);
  const [activeQueues, setActiveQueues] = useState(0);
  const [activeRooms, setActiveRooms] = useState(0);
  const [activeQueue, setActiveQueue] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadHomeStats();
    const timer = window.setInterval(loadHomeStats, 30000);
    return () => window.clearInterval(timer);
  }, [profile?.id]);

  async function loadHomeStats() {
    if (!supabase) return;
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const [players, queues, rooms, ownQueue] = await Promise.all([
      supabase.from('user_presence').select('user_id', { count: 'exact', head: true }).gte('last_seen_at', since),
      supabase.from('matchmaking_queue').select('id', { count: 'exact', head: true }).eq('status', 'waiting'),
      supabase.from('rooms').select('id', { count: 'exact', head: true }).in('status', ['open', 'locked']),
      profile?.id
        ? supabase
          .from('matchmaking_queue')
          .select('*')
          .eq('user_id', profile.id)
          .eq('status', 'waiting')
          .order('queued_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setActivePlayers(players.count || 0);
    setActiveQueues(queues.count || 0);
    setActiveRooms(rooms.count || 0);
    setActiveQueue(ownQueue.data || null);
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

  return (
    <main className="home-stage">
      {activeQueue && (
        <aside className="matchmaking-status-card">
          <div className="font-mono text-[10px] uppercase text-rdb-muted">Matchmaking</div>
          <div className="mt-1 font-mono text-sm uppercase text-rdb-text">{activeQueue.mode === 'ranked' ? 'Ranked Queue' : 'Casual Queue'}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px] uppercase text-rdb-muted">
            <span>Status <b>{activeQueue.status}</b></span>
            <span>ELO <b>{formatNumber(activeQueue.elo || 1000)}</b></span>
          </div>
          <button className="rdb-button mt-3 w-full" disabled={busy} type="button" onClick={cancelQueue}>Cancel Queue</button>
        </aside>
      )}
      <section className="home-menu">
        <h1>RUNDATBEAT</h1>
        <div className="home-actions">
          <button className="rdb-menu-button border-rdb-orange text-rdb-text" disabled={Boolean(activeQueue)} type="button" onClick={() => { playUiSound('click'); setPlayOpen(true); }}>
            <span>{activeQueue ? 'QUEUED' : 'PLAY'}</span>
            <small>{activeQueue ? 'CANCEL QUEUE TO CHANGE MODES' : 'CASUAL + RANKED + ROOMS'}</small>
          </button>
          <Link className="rdb-menu-button" to="/shop">
            <span>SHOP</span>
            <small>CUSTOM THEMES + NAME COLORS</small>
          </Link>
          <Link className="rdb-menu-button" to="/leaderboard">
            <span>LEADERBOARD</span>
            <small>CLIMB THE TIERS</small>
          </Link>
        </div>
      </section>

      <div className="home-active-count">
        <span>Active players: <b>{formatNumber(activePlayers)}</b></span>
        <span>Active queues: <b>{formatNumber(activeQueues)}</b></span>
        <span>Active rooms: <b>{formatNumber(activeRooms)}</b></span><i />
      </div>

      <MatchmakingModal open={playOpen} onClose={() => setPlayOpen(false)} onQueued={loadHomeStats} />
    </main>
  );
}
