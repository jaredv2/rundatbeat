/**
 * useRoomStateMachine
 *
 * Drives the battle room through its lifecycle:
 *   upcoming → active → voting → closed
 *
 * Features:
 *  – Pure realtime via Supabase subscriptions (no polling on non-owner clients).
 *  – Owner client is authoritative: fires DB writes that advance the FSM.
 *    All other clients react instantly via realtime.
 *  – Each phase countdown is derived from DB timestamps, so page reloads
 *    never lose position.
 *  – SOLO MODE: room.mode === 'solo' skips the "4 players required" gate
 *    and allows the battle to start immediately once the owner is ready.
 *  – forceStart() lets the owner manually kick off an upcoming battle.
 *
 * Phase timestamps used:
 *   upcoming → battle.starts_at
 *   active   → battle.voting_ends_at  (end of beat submission window)
 *   voting   → battle.voting_ends_at + (room.voting_minutes || 3) minutes
 *   closed   → final
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { computeNewElos, DEFAULT_ELO } from '../lib/elo';

const DEFAULT_VOTING_MINUTES = 3;
// How often the owner's FSM tick fires (ms). Keep it reasonable — realtime
// handles most transitions; this is just the safety net for timestamp gates.
const TICK_INTERVAL_MS = 3000;

// ── Public hook ──────────────────────────────────────────────────────────────

export function useRoomStateMachine({ battle, room, profile, onStateChange }) {
  const [phase, setPhase]           = useState(() => derivePhase(battle, room));
  const [phaseEndsAt, setPhaseEndsAt] = useState(() => phaseEndTimestamp(derivePhase(battle, room), battle, room));
  const timerRef = useRef(null);

  const isOwner = Boolean(profile?.id && room?.owner_id === profile.id);
  const isSolo  = room?.mode === 'solo';

  // ── Sync phase whenever DB state changes ─────────────────────────────────
  useEffect(() => {
    const nextPhase = derivePhase(battle, room);
    console.log('[RoomFSM] deriving phase →', nextPhase, '| isSolo:', isSolo);
    setPhase(nextPhase);
    setPhaseEndsAt(phaseEndTimestamp(nextPhase, battle, room));
    onStateChange?.(nextPhase, battle, room);
  // Only re-run when the actual status/timestamp values change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.status, room?.status, battle?.starts_at, battle?.voting_ends_at, room?.voting_minutes]);

  // ── Advance the FSM when timestamps expire ──────────────────────────────
  // Ranked rooms have no owner, so every connected client participates.
  // The WHERE clause in each advance function prevents double-transitions.
  useEffect(() => {
    const canDrive = isOwner || (room?.mode === 'ranked' && !room?.owner_id);
    if (!canDrive || !battle || !room) return;
    clearInterval(timerRef.current);

    timerRef.current = setInterval(async () => {
      const now          = Date.now();
      const currentPhase = derivePhase(battle, room);

      if (currentPhase === 'upcoming') {
        const startsAt = battle.starts_at ? new Date(battle.starts_at).getTime() : null;
        if (!isSolo && startsAt && now >= startsAt && room.status === 'locked') {
          console.log('[RoomFSM] upcoming → active (timer fired)');
          await advanceToActive(battle.id, room.id, isSolo);
        }
      }

      if (currentPhase === 'active') {
        const votingEndsAt = battle.voting_ends_at ? new Date(battle.voting_ends_at).getTime() : null;
        if (votingEndsAt && now >= votingEndsAt) {
          if (isSolo) {
            console.log('[RoomFSM] active → closed (solo, no voting)');
            await advanceToClosed(battle.id, room.id);
          } else {
            console.log('[RoomFSM] active → voting');
            await advanceToVoting(battle.id, room.id, room.voting_minutes);
          }
        }
      }

      if (currentPhase === 'voting') {
        const closedAt = votingCloseTimestamp(battle, room);
        if (closedAt && now >= closedAt) {
          console.log('[RoomFSM] voting → closed');
          await advanceToClosed(battle.id, room.id);
        }
      }
    }, TICK_INTERVAL_MS);

    return () => clearInterval(timerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOwner,
    isSolo,
    battle?.id,
    battle?.status,
    battle?.starts_at,
    battle?.voting_ends_at,
    room?.id,
    room?.status,
    room?.voting_minutes,
    room?.mode,
    room?.owner_id,
  ]);

  // ── Realtime: mirror DB state changes to non-owner clients instantly ──────
  useEffect(() => {
    if (!battle?.id || !room?.id || !supabase) return;

    const channel = supabase
      .channel(`room-fsm-${room.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'battles', filter: `id=eq.${battle.id}` },
        (payload) => {
          const nextPhase = derivePhase(payload.new, room);
          console.log('[RoomFSM] realtime battle update → phase:', nextPhase);
          setPhase(nextPhase);
          setPhaseEndsAt(phaseEndTimestamp(nextPhase, payload.new, room));
          onStateChange?.(nextPhase, payload.new, room);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` },
        (payload) => {
          const nextPhase = derivePhase(battle, payload.new);
          console.log('[RoomFSM] realtime room update → phase:', nextPhase, '| room.status:', payload.new?.status);
          setPhase(nextPhase);
          setPhaseEndsAt(phaseEndTimestamp(nextPhase, battle, payload.new));
          onStateChange?.(nextPhase, battle, payload.new);
        },
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.id, room?.id]);

  // ── Manual override: owner can force-start from the lobby ─────────────────
  const forceStart = useCallback(async () => {
    if (!isOwner || !battle || !room) return;
    if (derivePhase(battle, room) !== 'upcoming') return;
    console.log('[RoomFSM] force start by owner');
    await advanceToActive(battle.id, room.id, isSolo);
  }, [isOwner, isSolo, battle, room]);

  // ── Skip voting directly to closed (owner safety hatch) ───────────────────
  const forceClose = useCallback(async () => {
    if (!isOwner || !battle || !room) return;
    console.log('[RoomFSM] force close by owner');

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

// ── Phase derivation ──────────────────────────────────────────────────────────

function derivePhase(battle, room) {
  if (!battle) return 'upcoming';
  const status = battle.status;
  if (status === 'closed')  return 'closed';
  if (status === 'voting')  return 'voting';
  if (status === 'active')  return 'active';
  return 'upcoming';
}

function phaseEndTimestamp(phase, battle, room) {
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

// ── DB write helpers (owner only) ─────────────────────────────────────────────

async function advanceToActive(battleId, roomId, isSolo = false) {
  const now = new Date().toISOString();
  const [battleRes, roomRes] = await Promise.all([
    supabase
      .from('battles')
      .update({ status: 'active', starts_at: now })
      .eq('id', battleId)
      .eq('status', 'upcoming'),
    supabase
      .from('rooms')
      .update({ status: 'locked' })
      .eq('id', roomId)
      .in('status', ['open', 'locked']),
  ]);
  if (battleRes.error) console.error('[RoomFSM] advanceToActive battles error:', battleRes.error);
  if (roomRes.error)   console.error('[RoomFSM] advanceToActive rooms error:', roomRes.error);
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
      .in('status', ['open', 'locked']),
  ]);
  if (battleRes.error) console.error('[RoomFSM] advanceToVoting battles error:', battleRes.error);
  if (roomRes.error)   console.error('[RoomFSM] advanceToVoting rooms error:', roomRes.error);
}

async function advanceToClosed(battleId, roomId) {
  const [battleRes, roomRes] = await Promise.all([
    supabase
      .from('battles')
      .update({ status: 'closed' })
      .eq('id', battleId)
      .in('status', ['active', 'voting']),
    supabase
      .from('rooms')
      .update({ status: 'closed' })
      .eq('id', roomId)
      .in('status', ['open', 'locked', 'voting']),
  ]);
  if (battleRes.error) console.error('[RoomFSM] advanceToClosed battles error:', battleRes.error);
  if (roomRes.error)   console.error('[RoomFSM] advanceToClosed rooms error:', roomRes.error);

  // Ranked: update ELOs and stats (skip if early_closed — no rewards)
  if (!battleRes.error) {
    try {
      const { data: battle } = await supabase
        .from('battles')
        .select('mode, early_closed')
        .eq('id', battleId)
        .maybeSingle();
      if (battle?.mode === 'ranked' && !battle.early_closed) {
        const { data: subs } = await supabase
          .from('submissions')
          .select('user_id, vote_count')
          .eq('battle_id', battleId)
          .order('vote_count', { ascending: false });
        if (subs?.length) {
          const ranking = {};
          subs.forEach((s, i) => { ranking[s.user_id] = i + 1; });
          const userIds = subs.map((s) => s.user_id);
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, elo, wins, battles_entered, ranked_wins, ranked_losses')
            .in('id', userIds);
          const players = (profiles || []).map((p) => ({ user_id: p.id, elo: p.elo ?? DEFAULT_ELO }));
          const eloUpdates = computeNewElos(players, ranking);
          await Promise.all(eloUpdates.map((u) => {
            const profile = (profiles || []).find((p) => p.id === u.user_id);
            const isFirst = ranking[u.user_id] === 1;
            return supabase.from('profiles').update({
              elo: u.newElo,
              wins: (profile?.wins || 0) + (isFirst ? 1 : 0),
              battles_entered: (profile?.battles_entered || 0) + 1,
              ranked_wins: (profile?.ranked_wins || 0) + (isFirst ? 1 : 0),
              ranked_losses: (profile?.ranked_losses || 0) + (isFirst ? 0 : 1),
            }).eq('id', u.user_id);
          }));
        }
      }
    } catch (err) {
      console.error('[RoomFSM] ranked ELO update error:', err);
    }
  }
}