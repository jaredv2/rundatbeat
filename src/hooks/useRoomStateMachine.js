import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { computeNewElos, DEFAULT_ELO, tierFromElo } from '../lib/elo';
import { computeXpGain, levelFromXp, xpForLevel } from '../lib/xp';
import { advanceLobbyToActive } from '../lib/roomService';
import { pushNotificationToMany } from '../lib/pushNotification';
import { devLog, devError } from '../lib/devLog';

function log(tag, ...args) {
  devLog(`%c[${new Date().toISOString().slice(11, 23)}] [FSM] ${tag}`, 'color:#3b82f6', ...args);
}

const DEFAULT_VOTING_MINUTES = 3;
const LOBBY_COUNTDOWN_MS = 5000;
const TICK_INTERVAL_MS = 3000;

const POST_BATTLE_CLOSE_DELAY_MS = 5 * 60 * 1000; // 5 minutes after battle closes before room is deleted
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

export function useRoomStateMachine({ battle, room, profile, members, submissions, onStateChange }) {
  const [phase, setPhase]           = useState(() => derivePhase(battle, room, !!battle));
  const [phaseEndsAt, setPhaseEndsAt] = useState(() => phaseEndTimestamp(derivePhase(battle, room, !!battle), battle, room));
  const [calculatingWinner, setCalculatingWinner] = useState(false);
  const timerRef = useRef(null);
  const advancingLobby = useRef(false);
  const closingRef = useRef(false);
  const battleClosedAtRef = useRef(null);
  const battleRef = useRef(battle);
  const roomRef = useRef(room);
  const battleWasLoadedRef = useRef(!!battle);
  battleRef.current = battle;
  roomRef.current = room;
  const membersRef = useRef(members);
  const submissionsRef = useRef(submissions);
  membersRef.current = members;
  submissionsRef.current = submissions;
  if (battle) battleWasLoadedRef.current = true;

  const isOwner = Boolean(profile?.id && (room?.owner_id === profile.id || room?.host_id === profile.id));
  const isSolo  = room?.mode === 'solo';

  useEffect(() => {
    const nextPhase = derivePhase(battle, room, battleWasLoadedRef.current);
    log('PHASE', '→', nextPhase, '| battle:', battle?.status, '| room:', room?.status, '| countdown:', room?.countdown_started_at ? 'yes' : 'no');
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
      const currentPhase = derivePhase(b, r, battleWasLoadedRef.current);

      if (!isSolo && r?.mode === 'ranked' && r?.owner_id && r.owner_id !== profile?.id) {
        const { data: ownerMember } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', r.id)
          .eq('user_id', r.owner_id)
          .maybeSingle();
        if (!ownerMember) {
          await supabase.from('rooms').update({ owner_id: null }).eq('id', r.id);
        }
      }

      const canDriveNow = isOwner || (r?.mode === 'ranked' && !r?.owner_id);
      if (!canDriveNow) return;

      // Auto-close ranked battle when only 1 player remains — only during upcoming phase
      if (!closingRef.current && !isSolo && r?.mode === 'ranked' && b?.id && currentPhase === 'upcoming') {
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
            log('TICK', 'lobby countdown expired → advanceLobbyToActive');
            try {
              await advanceLobbyToActive(r.id);
            } catch (err) {
              log('TICK', 'advanceLobbyToActive ERROR:', err.message);
              advancingLobby.current = false;
            }
          }
        }
      }

      if (currentPhase === 'upcoming' && b) {
        const startsAt = b.starts_at ? new Date(b.starts_at).getTime() : null;
        if (startsAt && now >= startsAt && (isSolo || r.status === 'locked')) {
          log('TICK', 'upcoming expired (starts_at reached) → advanceToActive');
          await advanceToActive(b.id, r.id, isSolo);
        }
      }

      if (currentPhase === 'active' && b) {
        if (!isSolo) {
          const memberCount = membersRef.current?.length || 0;
          const subCount = submissionsRef.current?.length || 0;
          if (memberCount > 1 && subCount >= memberCount) {
            log('TICK', 'all players submitted → advanceToVoting');
            await advanceToVoting(b.id, r.id, r.voting_minutes);
          }
        }
        const votingEndsAt = b.voting_ends_at ? new Date(b.voting_ends_at).getTime() : null;
        if (votingEndsAt && now >= votingEndsAt) {
          if (isSolo) {
            log('TICK', 'solo active expired → advanceToClosed');
            await advanceToClosed(b.id, r.id);
          } else {
            log('TICK', 'active expired (voting_ends_at reached) → advanceToVoting');
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
          log('TICK', 'voting ended — allStopped:', allStopped, '→ advanceToClosed');
          try {
            await advanceToClosed(b.id, r.id);
          } finally {
            setCalculatingWinner(false);
            closingRef.current = false;
          }
        }
      }

      // ── Delayed room close: close room N minutes after battle closes ──
      if (currentPhase === 'closed' && r && r.status !== 'closed' && r.status !== 'lobby') {
        if (!battleClosedAtRef.current) {
          battleClosedAtRef.current = now;
          log('TICK', 'room close timer started — will close in', POST_BATTLE_CLOSE_DELAY_MS / 1000, 'seconds');
        }
        if (now - battleClosedAtRef.current >= POST_BATTLE_CLOSE_DELAY_MS) {
          log('TICK', 'post-battle delay expired → closing room');
          await supabase
            .from('rooms')
            .update({ status: 'closed', current_players: 0 })
            .eq('id', r.id)
            .in('status', ['locked', 'voting', 'open']);
          // Also clean up room_messages before room gets deleted by cleanup
          await supabase.from('room_messages').delete().eq('room_id', r.id);
          battleClosedAtRef.current = null;
        }
      } else if (currentPhase !== 'closed') {
        battleClosedAtRef.current = null;
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
          else nextPhase = derivePhase(b, payload.new, battleWasLoadedRef.current);
          log('RT:ROOM', 'status:', rs, '→ phase:', nextPhase);
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
          log('RT:BATTLE', 'status:', payload.new?.status, '→ phase:', nextPhase);
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
    log('FORCE-CLOSE', 'battle:', battle.id, 'room:', room.id, 'mode:', room.mode);

    // Route ALL modes through advanceToClosed so XP is granted
    await advanceToClosed(battle.id, room.id);
    log('FORCE-CLOSE', 'SUCCESS');
  }, [isOwner, battle, room]);

  return { phase, phaseEndsAt, forceStart, forceClose, isOwner, isSolo, calculatingWinner };
}

function derivePhase(battle, room, battleWasLoaded = false) {
  if (room?.status === 'lobby') return 'lobby';
  if (room?.status === 'matchmaking') return 'matchmaking';
  if (!battle) {
    if (room?.status === 'lobby') return 'lobby';
    // Room locked but battle not loaded yet — optimistic (data arrives via realtime)
    if (room?.status === 'locked') return 'upcoming';
    // Room voting but battle is gone — if we ever had a battle, it was deleted
    if (room?.status === 'voting' && battleWasLoaded) return 'closed';
    if (room?.status === 'voting') return 'voting'; // optimistic — battle data on its way
    if (room?.status === 'closed') return 'closed';
    // No room data yet — loading state
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
  return new Date(battle.voting_ends_at).getTime();
}

async function advanceToActive(battleId, roomId, isSolo = false) {
  log('UPCOMING→ACTIVE', 'battle:', battleId, 'room:', roomId, 'solo:', isSolo);
  const t0 = Date.now();
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
      .eq('status', 'lobby'),
  ]);
  const dt = Date.now() - t0;
  if (battleRes.error) throw new Error(`advanceToActive battles: ${battleRes.error.message}`);
  if (roomRes.error) throw new Error(`advanceToActive rooms: ${roomRes.error.message}`);
  log('UPCOMING→ACTIVE', 'SUCCESS — DB write took', dt + 'ms');
}

async function advanceToVoting(battleId, roomId, votingMinutes = DEFAULT_VOTING_MINUTES) {
  const mins = votingMinutes || DEFAULT_VOTING_MINUTES;
  const votingEndsAt = new Date(Date.now() + mins * 60 * 1000).toISOString();
  log('ACTIVE→VOTING', 'battle:', battleId, 'room:', roomId, 'votingMin:', mins);
  const t0 = Date.now();
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
  const dt = Date.now() - t0;
  if (battleRes.error) throw new Error(`advanceToVoting battles: ${battleRes.error.message}`);
  if (roomRes.error) throw new Error(`advanceToVoting rooms: ${roomRes.error.message}`);
  log('ACTIVE→VOTING', 'SUCCESS — DB write took', dt + 'ms', 'voting ends:', votingEndsAt);
}

async function advanceToClosed(battleId, roomId) {
  if (_closingGuards.get(battleId)) {
    log('→CLOSED', 'SKIP — already closing battle:', battleId);
    return;
  }
  _closingGuards.set(battleId, true);
  log('→CLOSED', 'battle:', battleId, 'room:', roomId);

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

  // ── Refresh rating totals from votes before ELO computation ──
  try {
    const { data: allVotes } = await supabase
      .from('votes')
      .select('submission_id, rating, weight')
      .eq('battle_id', battleId);
    if (allVotes?.length) {
      const voteAgg = new Map();
      for (const v of allVotes) {
        const prev = voteAgg.get(v.submission_id) || { total: 0, count: 0 };
        voteAgg.set(v.submission_id, {
          total: prev.total + (v.rating || 0) * (v.weight || 1),
          count: prev.count + 1,
        });
      }
      for (const [subId, agg] of voteAgg) {
        await supabase.from('submissions').update({ rating_total: agg.total, vote_count: agg.count }).eq('id', subId);
      }
      log('→CLOSED', 'refreshed', voteAgg.size, 'submission ratings from votes');
    }
  } catch (err) {
    log('→CLOSED', 'rating refresh error (non-fatal):', err.message);
  }

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

        devLog('[RoomFSM] FORFEIT ELO:', { battleId, winnerId, eloUpdates });

        const tElo = Date.now();
        await supabase.from('battles').update({ winner_id: winnerId, early_closed: true })
          .eq('id', battleId).is('winner_id', null);

        await Promise.all(eloUpdates.map(u => {
          const prof = (profiles || []).find(p => p.id === u.user_id);
          const isWinner = u.user_id === winnerId;
          const isRanked = battle?.mode === 'ranked';
          return supabase.from('profiles').update({
            elo: u.newElo,
            rank_tier: tierFromElo(u.newElo),
            wins: (prof?.wins || 0) + (isWinner ? 1 : 0),
            battles_entered: (prof?.battles_entered || 0) + 1,
            ...(isRanked ? {
              ranked_wins: (prof?.ranked_wins || 0) + (isWinner ? 1 : 0),
              ranked_losses: (prof?.ranked_losses || 0) + (!isWinner ? 1 : 0),
            } : {}),
          }).eq('id', u.user_id);
        }));
        log('FORFEIT ELO', 'profiles updated in', (Date.now() - tElo) + 'ms');

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

          devLog('[RoomFSM] NORMAL CLOSE ELO:', { battleId, winnerId, eloUpdates });

          const tElo = Date.now();
          await Promise.all(eloUpdates.map(u => {
            const prof = (profiles || []).find(p => p.id === u.user_id);
            const isFirst = ranking[u.user_id] === 1;
            const isRanked = battle?.mode === 'ranked';
            return supabase.from('profiles').update({
              elo: u.newElo,
              rank_tier: tierFromElo(u.newElo),
              wins: (prof?.wins || 0) + (isFirst ? 1 : 0),
              battles_entered: (prof?.battles_entered || 0) + 1,
              ...(isRanked ? {
                ranked_wins: (prof?.ranked_wins || 0) + (isFirst ? 1 : 0),
                ranked_losses: (prof?.ranked_losses || 0) + (!isFirst ? 1 : 0),
              } : {}),
            }).eq('id', u.user_id);
          }));
          log('NORMAL ELO', 'profiles updated in', (Date.now() - tElo) + 'ms');

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
      devError('[RoomFSM] ranked ELO update error:', err);
    }
  }

  // ── Record wins/battles_entered for solo mode ──
  if (battle?.mode === 'solo') {
    try {
      const { data: soloMembers } = await supabase
        .from('room_members')
        .select('user_id')
        .eq('room_id', roomId);
      const userIds = (soloMembers || []).map(m => m.user_id);
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, wins, battles_entered')
          .in('id', userIds);
        for (const p of profiles || []) {
          await supabase.from('profiles').update({
            wins: (p.wins || 0) + 1,
            battles_entered: (p.battles_entered || 0) + 1,
          }).eq('id', p.id);
          log('SOLO WIN', p.id.slice(0, 8));
        }
      }
    } catch (err) {
      log('SOLO WIN', 'ERROR:', err.message);
    }
  }

  // ── Record wins/battles_entered for room mode (winner = top-rated submission) ──
  const { data: currentRoom } = await supabase.from('rooms').select('mode').eq('id', roomId).maybeSingle();
  if (battle?.mode === 'quick' && currentRoom?.mode === 'room') {
    try {
      const { data: roomSubs } = await supabase
        .from('submissions')
        .select('user_id, rating_total')
        .eq('battle_id', battleId)
        .order('rating_total', { ascending: false });
      if (roomSubs?.length) {
        const winnerUserId = roomSubs[0].user_id;
        await supabase.from('battles').update({ winner_id: winnerUserId }).eq('id', battleId).is('winner_id', null);
        const allUserIds = [...new Set(roomSubs.map(s => s.user_id))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, wins, battles_entered')
          .in('id', allUserIds);
        for (const p of profiles || []) {
          const isWinner = p.id === winnerUserId;
          await supabase.from('profiles').update({
            wins: (p.wins || 0) + (isWinner ? 1 : 0),
            battles_entered: (p.battles_entered || 0) + 1,
          }).eq('id', p.id);
        }
        log('ROOM WIN', 'winner:', winnerUserId.slice(0, 8), '| players:', allUserIds.length);
      }
    } catch (err) {
      log('ROOM WIN', 'ERROR:', err.message);
    }
  }

  // ── Grant XP to all participants ──
  const tXp = Date.now();
  try {
    const { data: room } = await supabase.from('rooms').select('mode').eq('id', roomId).maybeSingle();
    const isRanked = battle?.mode === 'ranked';
    const isRoom = room?.mode === 'room';

    const { data: allSubs } = await supabase
      .from('submissions')
      .select('user_id, rating_total')
      .eq('battle_id', battleId)
      .order('rating_total', { ascending: false });

    const { data: battleRow } = await supabase.from('battles').select('winner_id').eq('id', battleId).maybeSingle();
    const winnerId = battleRow?.winner_id;

    const xpGrants = [];
    if (allSubs?.length) {
      for (let i = 0; i < allSubs.length; i++) {
        const rank = i + 1;
        const xp = computeXpGain({ rank, isRanked, isRoom });
        xpGrants.push({ userId: allSubs[i].user_id, xp, rank });
      }
    } else if (winnerId) {
      xpGrants.push({ userId: winnerId, xp: computeXpGain({ rank: 1, isRanked, isRoom }), rank: 1 });
    }

    for (const grant of xpGrants) {
      const { data: prof } = await supabase.from('profiles').select('xp, level').eq('id', grant.userId).maybeSingle();
      const oldXp = prof?.xp || 0;
      const newXp = oldXp + grant.xp;
      const newLevel = levelFromXp(newXp);
      await supabase.from('profiles').update({ xp: newXp, level: newLevel }).eq('id', grant.userId);
      log('XP', grant.userId.slice(0, 8), `+${grant.xp} XP`, `rank #${grant.rank}`, `LVL ${newLevel}`);
    }
    log('XP', 'all grants done in', (Date.now() - tXp) + 'ms');
  } catch (err) {
    log('XP', 'ERROR:', err.message);
  }

  // ── Close battle AFTER ELO is written ──
  const tClose = Date.now();
  const battleRes = await supabase
    .from('battles')
    .update({ status: 'closed', closed_at: new Date().toISOString(), ...(isAutoClose ? { early_closed: true } : {}) })
    .eq('id', battleId)
    .in('status', ['upcoming', 'active', 'voting']);
  if (battleRes.error) throw new Error(`advanceToClosed battles: ${battleRes.error.message}`);
  log('→CLOSED', 'battle closed:', battleId, '| DB write took', (Date.now() - tClose) + 'ms');

  // ── Room is NOT closed here — the tick timer closes it after POST_BATTLE_CLOSE_DELAY_MS ──
  // This gives players time to see results and chat before being kicked out.

  // ── Delete audio files from storage ──
  try {
    const tStorage = Date.now();
    const { data: userFolders, error: listErr } = await supabase.storage
      .from('beats')
      .list(battleId);
    if (listErr) throw listErr;
    let totalDeleted = 0;
    for (const folder of (userFolders || [])) {
      if (!folder.name) continue;
      const { data: files } = await supabase.storage
        .from('beats')
        .list(`${battleId}/${folder.name}`);
      if (files?.length) {
        const paths = files.map(f => `${battleId}/${folder.name}/${f.name}`);
        const { error: delErr } = await supabase.storage.from('beats').remove(paths);
        if (delErr) throw delErr;
        totalDeleted += files.length;
      }
    }
    log('→CLOSED', 'deleted', totalDeleted, 'audio files in', (Date.now() - tStorage) + 'ms');
  } catch (err) {
    log('→CLOSED', 'storage cleanup ERROR:', err.message);
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
  if (error || !members?.length) return false;
  if (members.length < 2) return members.every((m) => m.voting_stopped);
  return members.every((m) => m.voting_stopped);
}
