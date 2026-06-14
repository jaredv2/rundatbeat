import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import MatchmakingModal from '../components/matchmaking/MatchmakingModal';
import QueueCard from '../components/matchmaking/QueueCard';
import { formatNumber } from '../lib/display';
import { playUiSound } from '../lib/sfx';
import { DEFAULT_ELO, tierFromElo, computeNewElos } from '../lib/elo';
import { isBattleClosing, markBattleLeaving, clearBattleLeaving } from '../hooks/useRoomStateMachine';
import { supabase } from '../lib/supabase';
import { devLog } from '../lib/devLog';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';

export default function Home() {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const navigate = useNavigate();
  const [playOpen, setPlayOpen] = useState(false);
  const [activePlayers, setActivePlayers] = useState(0);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [busy, setBusy] = useState(false);
  const [queueLobby, setQueueLobby] = useState(null);
  const queueChannelRef = useRef(null);

  useEffect(() => {
    if (!profile?.id) return;
    loadHomeStats();
    cleanupStaleData();
    const channel = supabase
      .channel('home-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `user_id=eq.${profile.id}` }, loadHomeStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ranked_lobby_members', filter: `user_id=eq.${profile.id}` }, () => {
        loadHomeStats();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id]);

  async function cleanupStaleData() {
    if (!profile?.id) return;
    try {
      // Remove stale ranked lobby memberships (old lobbies that are closed)
      const { data: staleLobbies } = await supabase
        .from('ranked_lobby_members')
        .select('lobby_id, ranked_lobbies(status)')
        .eq('user_id', profile.id);
      for (const row of staleLobbies || []) {
        if (row.ranked_lobbies?.status === 'closed' || !row.ranked_lobbies) {
          await supabase.from('ranked_lobby_members').delete().eq('lobby_id', row.lobby_id).eq('user_id', profile.id);
        }
      }
    } catch {
      // FK join may not exist — fallback to simple cleanup
      try {
        await supabase.from('ranked_lobby_members').delete().eq('user_id', profile.id);
      } catch { /* ignore */ }
    }
    try {
      // Remove stale room memberships (closed rooms)
      const { data: staleRooms } = await supabase
        .from('room_members')
        .select('room_id, rooms(status)')
        .eq('user_id', profile.id);
      for (const row of staleRooms || []) {
        if (row.rooms?.status === 'closed' || !row.rooms) {
          await supabase.from('room_members').delete().eq('room_id', row.room_id).eq('user_id', profile.id);
        }
      }
    } catch {
      // FK join may not exist — ignore
    }
  }

  async function loadHomeStats() {
    if (!supabase) return;
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const [players, ownRoom] = await Promise.all([
      supabase.from('user_presence').select('user_id', { count: 'exact' }).gte('last_seen_at', since),
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
    // Load current room data (separate query to avoid FK nesting issues)
    let foundRoom = null;
    if (ownRoom.data?.room_id) {
      const { data: roomRow } = await supabase
        .from('rooms')
        .select('id, name, mode, battle_id, status, battles(title)')
        .eq('id', ownRoom.data.room_id)
        .in('status', ['open', 'locked', 'voting', 'lobby'])
        .maybeSingle();
      foundRoom = roomRow || null;
      // If room doesn't exist or is closed, clean up stale membership
      if (!foundRoom) {
        await supabase.from('room_members').delete().eq('room_id', ownRoom.data.room_id).eq('user_id', profile.id);
      }
    }
    setCurrentRoom(foundRoom);
  }

  function handleQueueEnter(lobby) {
    setQueueLobby(lobby);
  }

  async function handleLeaveQueue() {
    if (!queueLobby || !profile) return;
    setBusy(true);
    try {
      await supabase.from('ranked_lobby_members').delete().eq('lobby_id', queueLobby.id).eq('user_id', profile.id);
      playUiSound('cancel');
      addToast('LEFT QUEUE');
      setQueueLobby(null);
      await loadHomeStats();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  // Listen for lobby match while in queue
  useEffect(() => {
    if (!queueLobby?.id || !profile?.id) {
      if (queueChannelRef.current) { supabase.removeChannel(queueChannelRef.current); queueChannelRef.current = null; }
      return;
    }
    const ch = supabase
      .channel(`queue-match-${queueLobby.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ranked_lobbies', filter: `id=eq.${queueLobby.id}` }, (payload) => {
        const lobby = payload.new;
        if (!lobby) return;
        // Navigate to lobby on countdown start, status transition, or battle link
        const shouldNavigate = lobby.countdown_started_at
          || lobby.status === 'starting'
          || lobby.status === 'ready'
          || lobby.battle_id;
        if (shouldNavigate) {
          setQueueLobby(null);
          navigate(`/lobby/${lobby.id}`, { replace: true });
        }
        if (lobby.status === 'closed') {
          setQueueLobby(null);
          addToast('LOBBY CLOSED', 'error');
          loadHomeStats();
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ranked_lobby_members', filter: `user_id=eq.${profile.id}` }, () => {
        setQueueLobby(null);
        addToast('REMOVED FROM QUEUE', 'error');
        loadHomeStats();
      })
      .subscribe();
    queueChannelRef.current = ch;
    return () => { supabase.removeChannel(ch); queueChannelRef.current = null; };
  }, [queueLobby?.id, profile?.id]);

  // ── Leave queue on unmount (navigate away) ──
  useEffect(() => {
    return () => {
      const { profile: p } = useAuthStore.getState();
      const lobby = queueLobby;
      if (lobby?.id && p?.id) {
        supabase.from('ranked_lobby_members').delete().eq('lobby_id', lobby.id).eq('user_id', p.id);
      }
    };
  }, [queueLobby?.id]);

  async function leaveCurrentRoom() {
    if (!currentRoom || !profile || busy) return;
    setBusy(true);
    window.__clearReturnTo?.();
    if (currentRoom.battle_id) markBattleLeaving(currentRoom.battle_id);
    try {
      const isRanked = currentRoom.mode === 'ranked';

      // Remove self from room + clean submissions/votes
      await Promise.all([
        supabase.from('room_members').delete().eq('room_id', currentRoom.id).eq('user_id', profile.id),
        isRanked && currentRoom.battle_id ? supabase.from('submissions').delete().eq('battle_id', currentRoom.battle_id).eq('user_id', profile.id) : null,
        isRanked && currentRoom.battle_id ? supabase.from('votes').delete().eq('battle_id', currentRoom.battle_id).eq('voter_id', profile.id) : null,
        // Cleanup ranked lobby membership
        supabase.from('ranked_lobby_members').delete().eq('user_id', profile.id),
      ]);

      // Check remaining players
      const { data: remaining } = await supabase
        .from('room_members')
        .select('user_id')
        .eq('room_id', currentRoom.id);

      if (isRanked && currentRoom.battle_id) {
        // Guard: if battle already closed by timer FSM, skip ELO
        if (isBattleClosing(currentRoom.battle_id)) {
          setCurrentRoom(null);
          await loadHomeStats();
          return;
        }
        const { data: currentBattle } = await supabase
          .from('battles')
          .select('status, winner_id')
          .eq('id', currentRoom.battle_id)
          .maybeSingle();
        if (currentBattle?.status === 'closed') {
          setCurrentRoom(null);
          await loadHomeStats();
          return;
        }

        const leaverId = profile.id;

        if (remaining?.length === 1) {
          // ── 1 opponent remains → they win ──
          const winnerId = remaining[0].user_id;

          // Get all original participants
          const { data: subs } = await supabase
            .from('submissions')
            .select('user_id')
            .eq('battle_id', currentRoom.battle_id);
          const allUserIds = [...new Set([winnerId, leaverId, ...(subs || []).map(s => s.user_id)])];

          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, elo, rank_tier, wins, battles_entered, ranked_wins, ranked_losses')
            .in('id', allUserIds);

          const players = (profiles || []).map(p => ({
            user_id: p.id,
            elo: p.elo ?? DEFAULT_ELO,
            rank_tier: p.rank_tier,
          }));

          const ranking = {};
          allUserIds.forEach(id => { ranking[id] = id === winnerId ? 1 : 2; });

          const eloUpdates = computeNewElos(players, ranking);

          devLog('[Home] FORFEIT ELO:', { battleId: currentRoom.battle_id, winnerId, leaverId, eloUpdates });

          // Write ELO BEFORE closing battle
          await Promise.all(eloUpdates.map(u => {
            const prof = (profiles || []).find(p => p.id === u.user_id);
            const isWinner = u.user_id === winnerId;
            return supabase.from('profiles').update({
              elo: u.newElo,
              rank_tier: tierFromElo(u.newElo),
              wins: (prof?.wins || 0) + (isWinner ? 1 : 0),
              battles_entered: (prof?.battles_entered || 0) + 1,
              ranked_wins: (prof?.ranked_wins || 0) + (isWinner ? 1 : 0),
              ranked_losses: (prof?.ranked_losses || 0) + (!isWinner ? 1 : 0),
            }).eq('id', u.user_id);
          }));

          // Grant XP to all participants
          const { computeXpGain, levelFromXp } = await import('../lib/xp');
          for (const sub of (subs || [])) {
            const isWinner = sub.user_id === winnerId;
            const xpGain = isWinner ? 100 : 5;
            const { data: prof } = await supabase.from('profiles').select('xp, level').eq('id', sub.user_id).maybeSingle();
            const oldXp = prof?.xp || 0;
            const newXp = oldXp + xpGain;
            const newLevel = levelFromXp(newXp);
            await supabase.from('profiles').update({ xp: newXp, level: newLevel }).eq('id', sub.user_id);
          }

          await supabase.from('battles').update({
            status: 'closed',
            early_closed: true,
            winner_id: winnerId,
          }).eq('id', currentRoom.battle_id).in('status', ['upcoming', 'active', 'voting']);

          await supabase.from('rooms').update({ status: 'closed' }).eq('id', currentRoom.id);

          addToast('LEFT MATCH — OPPONENT WINS');
        } else {
          // ── 0 remaining or 2+ remain → flat penalty ──
          const { data: leaverProfile } = await supabase
            .from('profiles')
            .select('elo, ranked_losses, battles_entered')
            .eq('id', leaverId).maybeSingle();
          const currentElo = leaverProfile?.elo ?? DEFAULT_ELO;
          const newElo = Math.max(0, currentElo - 3);

          devLog('[Home] LEAVE PENALTY:', { leaverId, oldElo: currentElo, newElo, delta: -3 });

          await supabase.from('profiles').update({
            elo: newElo,
            rank_tier: tierFromElo(newElo),
            ranked_losses: (leaverProfile?.ranked_losses || 0) + 1,
            battles_entered: (leaverProfile?.battles_entered || 0) + 1,
          }).eq('id', leaverId);

          if (!remaining?.length) {
            await Promise.all([
              supabase.from('rooms').update({ status: 'closed' }).eq('id', currentRoom.id),
              supabase.from('battles').update({ status: 'closed', early_closed: true })
                .eq('id', currentRoom.battle_id).in('status', ['upcoming', 'active', 'voting']),
            ]);
          }
          addToast(`LEFT MATCH -3 ELO`);
        }
      } else {
        // ── Non-ranked ──
        if (!remaining?.length) {
          await Promise.all([
            supabase.from('rooms').update({ status: 'closed' }).eq('id', currentRoom.id),
            currentRoom.battle_id ? supabase.from('battles').update({ status: 'closed', early_closed: false })
              .eq('id', currentRoom.battle_id).in('status', ['upcoming', 'active', 'voting']) : null,
          ]);
          addToast('ROOM CLOSED');
        } else {
          addToast('LEFT ROOM');
        }
      }

      setCurrentRoom(null);
      await loadHomeStats();
    } catch (error) {
      addToast(error.message || 'COULD NOT LEAVE ROOM', 'error');
    } finally {
      if (currentRoom?.battle_id) clearBattleLeaving(currentRoom.battle_id);
      setBusy(false);
    }
  }

  return (
    <main className="home-stage">

      {/* ── Queue card (top center) ── */}
      {queueLobby && <QueueCard onLeave={handleLeaveQueue} />}

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
            disabled={Boolean(queueLobby || currentRoom)}
            type="button"
            onClick={() => { playUiSound('click'); setPlayOpen(true); }}
          >
            <span>{queueLobby ? 'QUEUED' : currentRoom ? 'IN BATTLE' : 'PLAY'}</span>
            <small>{queueLobby ? 'IN QUEUE — LEAVE FIRST' : currentRoom ? 'ACTIVE MATCH — LEAVE FIRST' : 'SOLO + RANKED + ROOMS'}</small>
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

      <MatchmakingModal open={playOpen} onClose={() => setPlayOpen(false)} onQueue={handleQueueEnter} />
    </main>
  );
}