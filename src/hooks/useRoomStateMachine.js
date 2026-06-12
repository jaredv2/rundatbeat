import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { computeNewElos, DEFAULT_ELO, tierFromElo } from '../lib/elo';
import { advanceLobbyToActive } from '../lib/roomService';
import { pushNotificationToMany } from '../lib/pushNotification';

const DEFAULT_VOTING_MINUTES = 3;
const LOBBY_COUNTDOWN_MS = 10000;
const TICK_INTERVAL_MS = 3000;
const _closingGuards = new Map();

export function isBattleClosing(battleId) {
  return Boolean(_closingGuards.get(battleId));
}

export function markBattleLeaving(battleId) {
  _closingGuards.set(battleId, 'leaving');
}

export function clearBattleLeaving(battleId) {
  if (_closingGuards.get(battleId) === 'leaving') {
    _closingGuards.delete(battleId);
  }
}

export function useRoomStateMachine({ battle, room, profile, onStateChange }) {
  const [phase, setPhase]           = useState(() => derivePhase(battle, room));
  const [phaseEndsAt, setPhaseEndsAt] = useState(() => phaseEndTimestamp(derivePhase(battle, room), battle, room));
  const [calculatingWinner, setCalculatingWinner] = useState(false);
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
      const b = battleRef.current;
      const r = roomRef.current;
      const currentPhase = derivePhase(b, r);

      if (!isSolo && r?.mode === 'ranked' && r?.owner_id && r.owner_id !== profile?.id) {
        const { data: ownerMember } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', r.id)
          .eq('user_id', r.owner_id)
          .maybeSingle();
        if (!ownerMember) {
          await supabase.from('rooms').update({ owner_id: null }).eq('id', r.id);
          return;
        }
      }

      const canDriveNow = isOwner || (r?.mode === 'ranked' && !r?.owner_id);
      if (!canDriveNow) return;

      // Auto-close ranked battle when only 1 player remains (not during voting — let it finish)
      if (!closingRef.current && !isSolo && r?.mode === 'ranked' && b?.id && ['active', 'upcoming'].includes(currentPhase)) {
        if (_closingGuards.get(b.id) === 'leaving') return;
        const { count } = await supabase.from('room_members').select('room_id', { count: 'exact' }).eq('room_id', r.id);
        if (count <= 1) {
          closingRef.current = true;
          try {
            await advanceToClosed(b.id, r.id);
          } finally {
            closingRef.current = false;
          }
          return;
        }
      }

      if (currentPhase === 'lobby') {
        if (r.countdown_started_at) {
          const countdownEnd = new Date(r.countdown_started_at).getTime() + LOBBY_COUNTDOWN_MS;
          if (now >= countdownEnd && !advancingLobby.current) {
            advancingLobby.current = true;
            try {
              await advanceLobbyToActive(r.id);
            } catch (err) {
              advancingLobby.current = false;
            }
          }
        }
      }

      if (currentPhase === 'upcoming' && b) {
        const startsAt = b.starts_at ? new Date(b.starts_at).getTime() : null;
        if (startsAt && now >= startsAt && (isSolo || r.status === 'locked')) {
          await advanceToActive(b.id, r.id, isSolo);
        }
      }

      if (currentPhase === 'active' && b) {
        const votingEndsAt = b.voting_ends_at ? new Date(b.voting_ends_at).getTime() : null;
        if (votingEndsAt && now >= votingEndsAt) {
          if (isSolo) {
            await advanceToClosed(b.id, r.id);
          } else {
            await advanceToVoting(b.id, r.id, r.voting_minutes);
          }
        }
      }

      if (currentPhase === 'voting' && b) {
        const closedAt = votingCloseTimestamp(b, r);
        const allStopped = await allPlayersStoppedVoting(r?.id);

        if (!closingRef.current && (allStopped || (closedAt && now >= closedAt))) {
          closingRef.current = true;
          setCalculatingWinner(true);
          try {
            await advanceToClosed(b.id, r.id, { closeRoom: allStopped });
          } finally {
            setCalculatingWinner(false);
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
        .order('rating_total', { ascending: false })
        .limit(1)
        .maybeSingle();

      await Promise.all([
        supabase.from('battles').update({
          status: 'closed',
          winner_id: top?.user_id || null,
          early_closed: true,
        }).eq('id', battle.id),
        supabase.from('rooms').update({ status: 'closed' }).eq('id', room.id)
          .in('status', ['locked', 'voting']),
      ]);
    } else {
      await advanceToClosed(battle.id, room.id, { closeRoom: true });
    }
  }, [isOwner, battle, room]);

  return { phase, phaseEndsAt, forceStart, forceClose, isOwner, isSolo, calculatingWinner };
}

function derivePhase(battle, room) {
  if (room?.status === 'lobby') return 'lobby';
  if (room?.status === 'matchmaking') return 'matchmaking';
  if (!battle) {
    if (room?.status === 'lobby') return 'lobby';
    // Battle deleted by cleanup (room has no battle_id) — stay closed
    if ((room?.status === 'locked' || room?.status === 'voting' || room?.status === 'closed') && !room?.battle_id) return 'closed';
    // Battle exists but hasn't loaded yet — treat as upcoming
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

async function advanceToClosed(battleId, roomId, { closeRoom = false } = {}) {
  if (_closingGuards.get(battleId)) return;
  _closingGuards.set(battleId, true);

  try {
  const { count: memberCount } = await supabase
    .from('room_members')
    .select('room_id', { count: 'exact' })
    .eq('room_id', roomId);

  const isAutoClose = (memberCount ?? 0) <= 1;

  const { data: battle } = await supabase
    .from('battles')
    .select('mode, early_closed, winner_id')
    .eq('id', battleId)
    .maybeSingle();

  // ── Compute ELO and record wins/losses BEFORE closing ──
  if (battle?.mode === 'ranked' && !battle.winner_id) {
    try {
      const { data: remaining } = await supabase
        .from('room_members')
        .select('user_id')
        .eq('room_id', roomId);

      if (remaining?.length === 1) {
        // ── FORFEIT: 1 player remains → they win by default ──
        const winnerId = remaining[0].user_id;
        const { data: subs } = await supabase
          .from('submissions')
          .select('user_id')
          .eq('battle_id', battleId);

        // Also include players from the ranked lobby (catches leavers with 0 submissions)
        const { data: lobby } = await supabase
          .from('ranked_lobbies')
          .select('id')
          .eq('battle_id', battleId)
          .maybeSingle();
        let lobbyUserIds = [];
        if (lobby) {
          const { data: lobbyMembers } = await supabase
            .from('ranked_lobby_members')
            .select('user_id')
            .eq('lobby_id', lobby.id);
          lobbyUserIds = (lobbyMembers || []).map(m => m.user_id);
        }

        const allUserIds = [...new Set([
          winnerId,
          ...(subs || []).map(s => s.user_id),
          ...lobbyUserIds,
        ])];

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

        console.log('[RoomFSM] FORFEIT ELO:', { battleId, winnerId, eloUpdates });

        await supabase.from('battles').update({ winner_id: winnerId, early_closed: true })
          .eq('id', battleId).is('winner_id', null);

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

        pushNotificationToMany(allUserIds.filter(id => id !== winnerId), {
          type: 'battle_lost', title: 'BATTLE LOST', body: 'Your opponent won by forfeit.',
          link: `/battle/${battleId}`,
        });
        pushNotificationToMany([winnerId], {
          type: 'battle_won', title: 'BATTLE WON', body: 'Your opponent left — you win!',
          link: `/battle/${battleId}`,
        });

      } else if (!battle.early_closed || remaining?.length >= 2) {
        // ── NORMAL CLOSE: vote-based ELO ──
        const { data: subs } = await supabase
          .from('submissions')
          .select('user_id, rating_total')
          .eq('battle_id', battleId)
          .order('rating_total', { ascending: false });

        if (subs?.length) {
          const ranking = {};
          subs.forEach((s, i) => { ranking[s.user_id] = i + 1; });
          const winnerId = subs[0].user_id;

          await supabase.from('battles').update({ winner_id: winnerId })
            .eq('id', battleId).is('winner_id', null);

          const userIds = subs.map(s => s.user_id);
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, elo, rank_tier, wins, battles_entered, ranked_wins, ranked_losses')
            .in('id', userIds);

          const players = (profiles || []).map(p => ({
            user_id: p.id,
            elo: p.elo ?? DEFAULT_ELO,
            rank_tier: p.rank_tier,
          }));

          let eloUpdates;
          if (players.length <= 1) {
            eloUpdates = players.map(p => ({
              user_id: p.user_id,
              newElo: (p.elo ?? DEFAULT_ELO) + 3,
              oldElo: p.elo ?? DEFAULT_ELO,
              delta: 3,
            }));
          } else {
            eloUpdates = computeNewElos(players, ranking);
          }

          console.log('[RoomFSM] NORMAL CLOSE ELO:', { battleId, winnerId, eloUpdates });

          await Promise.all(eloUpdates.map(u => {
            const prof = (profiles || []).find(p => p.id === u.user_id);
            const isFirst = ranking[u.user_id] === 1;
            return supabase.from('profiles').update({
              elo: u.newElo,
              rank_tier: tierFromElo(u.newElo),
              wins: (prof?.wins || 0) + (isFirst ? 1 : 0),
              battles_entered: (prof?.battles_entered || 0) + 1,
              ranked_wins: (prof?.ranked_wins || 0) + (isFirst ? 1 : 0),
              ranked_losses: (prof?.ranked_losses || 0) + (!isFirst ? 1 : 0),
            }).eq('id', u.user_id);
          }));

          const losers = userIds.filter(id => id !== winnerId);
          pushNotificationToMany(losers, {
            type: 'battle_lost', title: 'BATTLE LOST', body: `You lost to ${profiles?.find(p => p.id === winnerId)?.username || 'someone'}.`,
            link: `/battle/${battleId}`,
          });
          pushNotificationToMany([winnerId], {
            type: 'battle_won', title: 'BATTLE WON', body: 'Congratulations — you won!',
            link: `/battle/${battleId}`,
          });
        }
      }
    } catch (err) {
      console.error('[RoomFSM] ranked ELO update error:', err);
    }
  }

  // ── Close battle AFTER ELO is written ──
  const battleRes = await supabase
    .from('battles')
    .update({ status: 'closed', ...(isAutoClose ? { early_closed: true } : {}) })
    .eq('id', battleId)
    .in('status', ['upcoming', 'active', 'voting']);
  if (battleRes.error) throw new Error(`advanceToClosed battles: ${battleRes.error.message}`);

  // ── Close room only when all players locked voting ──
  if (closeRoom) {
    await supabase
      .from('rooms')
      .update({ status: 'closed' })
      .eq('id', roomId)
      .in('status', ['locked', 'voting']);
  }

  } finally {
    _closingGuards.delete(battleId);
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
