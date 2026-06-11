import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { computeNewElos, DEFAULT_ELO, getPlayerKFactor, tierFromElo } from '../lib/elo';
import { advanceLobbyToActive } from '../lib/roomService';

const DEFAULT_VOTING_MINUTES = 3;
const LOBBY_COUNTDOWN_MS = 5000;
const TICK_INTERVAL_MS = 3000;

export function useRoomStateMachine({ battle, room, profile, onStateChange }) {
  const [phase, setPhase]           = useState(() => derivePhase(battle, room));
  const [phaseEndsAt, setPhaseEndsAt] = useState(() => phaseEndTimestamp(derivePhase(battle, room), battle, room));
  const timerRef = useRef(null);
  const advancingLobby = useRef(false);
  const closingRef = useRef(false);
  const battleRef = useRef(battle);
  const roomRef = useRef(room);
  battleRef.current = battle;
  roomRef.current = room;

  const isOwner = Boolean(profile?.id && (room?.owner_id === profile.id || room?.host_id === profile.id));
  const isSolo  = room?.mode === 'solo';

  useEffect(() => {
    const nextPhase = derivePhase(battle, room);
    setPhase(nextPhase);
    setPhaseEndsAt(phaseEndTimestamp(nextPhase, battle, room));
    onStateChange?.(nextPhase, battle, room);
  }, [battle?.status, room?.status, battle?.starts_at, battle?.voting_ends_at, room?.voting_minutes, room?.countdown_started_at]);

  useEffect(() => {
    if (!room) return;
    clearInterval(timerRef.current);

    timerRef.current = setInterval(async () => {
      const now = Date.now();
      const currentPhase = derivePhase(battle, room);

      if (!isSolo && room?.mode === 'ranked' && room?.owner_id && room.owner_id !== profile?.id) {
        const { data: ownerMember } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', room.id)
          .eq('user_id', room.owner_id)
          .maybeSingle();
        if (!ownerMember) {
          await supabase.from('rooms').update({ owner_id: null }).eq('id', room.id);
          return;
        }
      }

      const canDriveNow = isOwner || (room?.mode === 'ranked' && !room?.owner_id);
      if (!canDriveNow) return;

      // Auto-close ranked battle when only 1 player remains
      if (!closingRef.current && !isSolo && room?.mode === 'ranked' && battle?.id && ['active', 'voting', 'upcoming'].includes(currentPhase)) {
        const { count } = await supabase.from('room_members').select('room_id', { count: 'exact', head: true }).eq('room_id', room.id);
        if (count <= 1) {
          closingRef.current = true;
          try {
            await advanceToClosed(battle.id, room.id);
          } finally {
            closingRef.current = false;
          }
          return;
        }
      }

      if (currentPhase === 'lobby') {
        if (room.countdown_started_at) {
          const countdownEnd = new Date(room.countdown_started_at).getTime() + LOBBY_COUNTDOWN_MS;
          if (now >= countdownEnd && !advancingLobby.current) {
            advancingLobby.current = true;
            try {
              await advanceLobbyToActive(room.id);
            } catch (err) {
              console.error('[RoomFSM] lobby → active failed:', err);
              advancingLobby.current = false;
            }
          }
        }
      }

      if (currentPhase === 'upcoming' && battle) {
        const startsAt = battle.starts_at ? new Date(battle.starts_at).getTime() : null;
        if (!isSolo && startsAt && now >= startsAt && room.status === 'locked') {
          await advanceToActive(battle.id, room.id, isSolo);
        }
      }

      if (currentPhase === 'active' && battle) {
        const votingEndsAt = battle.voting_ends_at ? new Date(battle.voting_ends_at).getTime() : null;
        if (votingEndsAt && now >= votingEndsAt) {
          if (isSolo) {
            await advanceToClosed(battle.id, room.id);
          } else {
            await advanceToVoting(battle.id, room.id, room.voting_minutes);
          }
        }
      }

      if (currentPhase === 'voting' && battle) {
        const closedAt = votingCloseTimestamp(battle, room);
        const allStopped = await allPlayersStoppedVoting(room?.id);

        if (!closingRef.current && (allStopped || (closedAt && now >= closedAt))) {
          closingRef.current = true;
          try {
            await advanceToClosed(battle.id, room.id);
          } finally {
            closingRef.current = false;
          }
        }
      }
    }, TICK_INTERVAL_MS);

    return () => clearInterval(timerRef.current);
  }, [
    isOwner, isSolo, battle?.id, battle?.status, battle?.starts_at,
    battle?.voting_ends_at, room?.id, room?.status, room?.voting_minutes,
    room?.mode, room?.owner_id, room?.host_id, room?.countdown_started_at,
  ]);

  useEffect(() => {
    if (!room?.id || !supabase) return;

    const channel = supabase
      .channel(`room-fsm-${room.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` },
        (payload) => {
          const b = battleRef.current;
          const rs = payload.new?.status;
          let nextPhase;
          if (rs === 'closed') nextPhase = 'closed';
          else if (rs === 'voting') nextPhase = 'voting';
          else if (rs === 'lobby') nextPhase = 'lobby';
          else if (rs === 'matchmaking') nextPhase = 'matchmaking';
          else nextPhase = derivePhase(b, payload.new);
          setPhase(nextPhase);
          setPhaseEndsAt(phaseEndTimestamp(nextPhase, b, payload.new));
          onStateChange?.(nextPhase, b, payload.new);
        },
      );

    if (battle?.id) {
      channel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'battles', filter: `id=eq.${battle.id}` },
        (payload) => {
          const r = roomRef.current;
          const nextPhase = derivePhase(payload.new, r);
          setPhase(nextPhase);
          setPhaseEndsAt(phaseEndTimestamp(nextPhase, payload.new, r));
          onStateChange?.(nextPhase, payload.new, r);
        },
      );
    }

    channel.subscribe();

    return () => supabase.removeChannel(channel);
  }, [battle?.id, room?.id]);

  const forceStart = useCallback(async () => {
    if (!isOwner || !room) return;
    if (derivePhase(battle, room) !== 'upcoming') return;
    if (battle) await advanceToActive(battle.id, room.id, isSolo);
  }, [isOwner, isSolo, battle, room]);

  const forceClose = useCallback(async () => {
    if (!isOwner || !battle || !room) return;

    if (room.mode !== 'ranked') {
      const { data: top } = await supabase
        .from('submissions')
        .select('id, user_id')
        .eq('battle_id', battle.id)
        .order('vote_count', { ascending: false })
        .limit(1)
        .maybeSingle();

      await Promise.all([
        supabase.from('battles').update({
          status: 'closed',
          winner_id: top?.user_id || null,
          early_closed: true,
        }).eq('id', battle.id),
        supabase.from('rooms').update({ status: 'closed' }).eq('id', room.id),
      ]);
    } else {
      await advanceToClosed(battle.id, room.id);
    }
  }, [isOwner, battle, room]);

  return { phase, phaseEndsAt, forceStart, forceClose, isOwner, isSolo };
}

function derivePhase(battle, room) {
  if (room?.status === 'lobby') return 'lobby';
  if (room?.status === 'matchmaking') return 'matchmaking';
  if (!battle) {
    if (room?.status === 'lobby') return 'lobby';
    return 'upcoming';
  }
  const status = battle.status;
  if (status === 'closed')  return 'closed';
  if (status === 'voting')  return 'voting';
  if (status === 'active')  return 'active';
  return 'upcoming';
}

function phaseEndTimestamp(phase, battle, room) {
  if (phase === 'lobby' && room?.countdown_started_at) {
    return new Date(room.countdown_started_at).getTime() + LOBBY_COUNTDOWN_MS;
  }
  if (!battle) return null;
  if (phase === 'upcoming') return battle.starts_at     ? new Date(battle.starts_at).getTime()     : null;
  if (phase === 'active')   return battle.voting_ends_at ? new Date(battle.voting_ends_at).getTime() : null;
  if (phase === 'voting')   return votingCloseTimestamp(battle, room);
  return null;
}

function votingCloseTimestamp(battle, room) {
  if (!battle?.voting_ends_at) return null;
  const votingMinutes = room?.voting_minutes || DEFAULT_VOTING_MINUTES;
  return new Date(battle.voting_ends_at).getTime() + votingMinutes * 60 * 1000;
}

async function advanceToActive(battleId, roomId, isSolo = false) {
  const [battleRes, roomRes] = await Promise.all([
    supabase
      .from('battles')
      .update({ status: 'active' })
      .eq('id', battleId)
      .eq('status', 'upcoming'),
    supabase
      .from('rooms')
      .update({ status: 'locked' })
      .eq('id', roomId)
      .in('status', ['lobby', 'open', 'locked']),
  ]);
  if (battleRes.error) throw new Error(`advanceToActive battles: ${battleRes.error.message}`);
  if (roomRes.error) throw new Error(`advanceToActive rooms: ${roomRes.error.message}`);
}

async function advanceToVoting(battleId, roomId, votingMinutes = DEFAULT_VOTING_MINUTES) {
  const mins = votingMinutes || DEFAULT_VOTING_MINUTES;
  const votingEndsAt = new Date(Date.now() + mins * 60 * 1000).toISOString();
  const [battleRes, roomRes] = await Promise.all([
    supabase
      .from('battles')
      .update({ status: 'voting', voting_ends_at: votingEndsAt })
      .eq('id', battleId)
      .eq('status', 'active'),
    supabase
      .from('rooms')
      .update({ status: 'voting' })
      .eq('id', roomId)
      .in('status', ['locked']),
  ]);
  if (battleRes.error) throw new Error(`advanceToVoting battles: ${battleRes.error.message}`);
  if (roomRes.error) throw new Error(`advanceToVoting rooms: ${roomRes.error.message}`);
}

async function advanceToClosed(battleId, roomId) {
  const { data: memberCount } = await supabase
    .from('room_members')
    .select('room_id', { count: 'exact', head: true })
    .eq('room_id', roomId);

  const isAutoClose = (memberCount ?? 0) <= 1;

  const [battleRes, roomRes] = await Promise.all([
    supabase
      .from('battles')
      .update({ status: 'closed', ...(isAutoClose ? { early_closed: true } : {}) })
      .eq('id', battleId)
      .in('status', ['upcoming', 'active', 'voting'])
      .select('id'),
    supabase
      .from('rooms')
      .update({ status: 'closed' })
      .eq('id', roomId)
      .in('status', ['locked', 'voting']),
  ]);
  if (battleRes.error) throw new Error(`advanceToClosed battles: ${battleRes.error.message}`);
  if (roomRes.error) throw new Error(`advanceToClosed rooms: ${roomRes.error.message}`);

  if (!battleRes.error && battleRes.data?.length) {
    try {
      const { data: battle } = await supabase
        .from('battles')
        .select('mode, early_closed')
        .eq('id', battleId)
        .maybeSingle();
      if (battle?.mode === 'ranked' && !battle.early_closed) {
        const { data: subs } = await supabase
          .from('submissions')
          .select('user_id, rating_total')
          .eq('battle_id', battleId)
          .order('rating_total', { ascending: false });
        if (subs?.length) {
          const ranking = {};
          subs.forEach((s, i) => { ranking[s.user_id] = i + 1; });
          const winnerId = subs[0].user_id;
          await supabase.from('battles').update({ winner_id: winnerId }).eq('id', battleId).is('winner_id', null);
          const userIds = subs.map((s) => s.user_id);
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, elo, rank_tier, wins, battles_entered, ranked_wins, ranked_losses')
            .in('id', userIds);
          const players = (profiles || []).map((p) => ({ user_id: p.id, elo: p.elo ?? DEFAULT_ELO, rank_tier: p.rank_tier }));

          let eloUpdates;
          if (players.length <= 1) {
            eloUpdates = players.map((p) => {
              const K = getPlayerKFactor(p.elo ?? DEFAULT_ELO, p.elo ?? DEFAULT_ELO);
              const gain = Math.round(K * 0.5);
              return {
                user_id: p.user_id,
                newElo: (p.elo ?? DEFAULT_ELO) + gain,
                oldElo: p.elo ?? DEFAULT_ELO,
                kFactor: K,
                expected: 0.5,
                actual: 1.0,
              };
            });
          } else {
            eloUpdates = computeNewElos(players, ranking);
          }

          await Promise.all(eloUpdates.map((u) => {
            const profile = (profiles || []).find((p) => p.id === u.user_id);
            const isFirst = ranking[u.user_id] === 1;
            return supabase.from('profiles').update({
              elo: u.newElo,
              rank_tier: tierFromElo(u.newElo),
              wins: (profile?.wins || 0) + (isFirst ? 1 : 0),
              battles_entered: (profile?.battles_entered || 0) + 1,
              ranked_wins: (profile?.ranked_wins || 0) + (isFirst ? 1 : 0),
              ranked_losses: (profile?.ranked_losses || 0) + (!isFirst ? 1 : 0),
            }).eq('id', u.user_id);
          }));
        }
      }
    } catch (err) {
      console.error('[RoomFSM] ranked ELO update error:', err);
    }
  }
}

async function allPlayersStoppedVoting(roomId) {
  if (!roomId) return false;
  const { data: members, error } = await supabase
    .from('room_members')
    .select('voting_stopped')
    .eq('room_id', roomId);
  if (error || !members?.length || members.length < 2) return false;
  return members.every((m) => m.voting_stopped);
}

// ── Debug: manually move battle to any state ──────────────────────────────
// Usage from console:
//   await window.moveToState(battleId, 'active')
//   await window.moveToState(battleId, 'voting')
//   await window.moveToState(battleId, 'closed')
//   await window.moveToState(battleId, 'upcoming')
//   await window.moveToState(null, 'closed', roomId)   // force room closed only
//   await window.moveToState(battleId, 'active', roomId) // set both
if (typeof window !== 'undefined') {
  window.moveToState = async (battleId, targetBattle, roomId) => {
    const BATTLE_TRANSITIONS = {
      upcoming: { status: 'upcoming' },
      active:   { status: 'active',   starts_at: new Date().toISOString() },
      voting:   { status: 'voting',   voting_ends_at: new Date(Date.now() + 3 * 60 * 1000).toISOString() },
      closed:   { status: 'closed' },
    };

    const ROOM_TRANSITIONS = {
      upcoming: { status: 'locked' },
      active:   { status: 'locked' },
      voting:   { status: 'voting' },
      closed:   { status: 'closed' },
    };

    const results = {};

    if (battleId) {
      const battleUpdate = BATTLE_TRANSITIONS[targetBattle];
      if (!battleUpdate) throw new Error(`Unknown battle state: ${targetBattle}. Use: upcoming, active, voting, closed`);
      const { data, error } = await supabase
        .from('battles')
        .update(battleUpdate)
        .eq('id', battleId)
        .select('id, status')
        .single();
      if (error) throw error;
      results.battle = data;
      console.log(`[moveToState] battle ${battleId} → ${targetBattle}`, data);
    }

    if (roomId) {
      const roomUpdate = ROOM_TRANSITIONS[targetBattle];
      if (roomUpdate) {
        const { data, error } = await supabase
          .from('rooms')
          .update(roomUpdate)
          .eq('id', roomId)
          .select('id, status')
          .single();
        if (error) throw error;
        results.room = data;
        console.log(`[moveToState] room ${roomId} → ${roomUpdate.status}`, data);
      }
    }

    if (!battleId && !roomId) {
      throw new Error('Provide at least a battleId or roomId');
    }

    return results;
  };

  console.log('[debug] window.moveToState(battleId, state, roomId?) available');
  console.log('[debug] states: upcoming, active, voting, closed');
}
