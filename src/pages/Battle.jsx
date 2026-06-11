/**
 * Battle.jsx
 *
 *  – Zero polling. All data via useBattle realtime channel.
 *  – useRoomStateMachine drives all phase transitions server-side.
 *  – Vote button is shown inline in the sidebar when phase === 'voting'.
 *    It scrolls to #voting-feed. Members who have already submitted see
 *    a "VOTING IS OPEN" banner instead.
 *  – Solo mode badge + lobby copy is aware of isSolo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { Link, Navigate, useBlocker, useNavigate, useParams } from 'react-router-dom';
import BattlePrompt from '../components/battle/BattlePrompt';
import BattleResults from '../components/battle/BattleResults';
import SampleCard from '../components/battle/SampleCard';
import PremiumGate from '../components/battle/PremiumGate';
import SubmitBeat from '../components/battle/SubmitBeat';
import ConfirmModal from '../components/ui/ConfirmModal';
import WinModal from '../components/ui/WinModal';
import VotingFeed from '../components/voting/VotingFeed';
import ChallengeReveal from '../components/battle/ChallengeReveal';
import WaveformPlayer from '../components/audio/WaveformPlayer';
import { useBattle } from '../hooks/useBattle';
import { useRoomStateMachine } from '../hooks/useRoomStateMachine';
import { useCountdown } from '../hooks/useCountdown';
import {
  formatNumber,
  getNameCosmeticClassName,
  getNameGradientStyle,
  getNameplateEmoji,
} from '../lib/display';
import { DEFAULT_ELO, tierFromElo, computeNewElos, getPlayerKFactor } from '../lib/elo';
import { toggleReady, leaveLobby } from '../lib/roomService';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { playUiSound } from '../lib/sfx';

// ── Sub-components ────────────────────────────────────────────────────────────

function PhaseTimer({ label, target, urgent: forcedUrgent }) {
  const { label: countdown, remaining } = useCountdown(target);
  if (!target) return null;
  const urgent = forcedUrgent ?? remaining < 5 * 60 * 1000;
  return (
    <div
      className={`rdb-panel flex items-center justify-between gap-3 p-3 font-mono text-[11px] uppercase ${
        urgent ? 'border-red-500 text-red-400' : 'text-rdb-muted'
      }`}
    >
      <span>{urgent ? `⚠ ${label} CLOSING SOON` : `${label} CLOSES IN`}</span>
      <span
        className={`text-base font-bold tracking-widest ${
          urgent ? 'text-red-400' : 'text-rdb-orange'
        }`}
      >
        {countdown}
      </span>
    </div>
  );
}

function SongLengthBadge({ seconds }) {
  if (!seconds) return null;
  if (seconds >= 10000) {
    return (
      <span className="font-mono text-[10px] uppercase text-rdb-muted">
        MAX <span className="text-rdb-text">∞</span>
      </span>
    );
  }
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, '0');
  return (
    <span className="font-mono text-[10px] uppercase text-rdb-muted">
      MAX <span className="text-rdb-text">{mins}:{secs}</span>
    </span>
  );
}

function PhaseBadge({ phase }) {
  const styles = {
    matchmaking: 'border-yellow-700 text-yellow-500',
    lobby:       'border-yellow-600 text-yellow-400',
    upcoming:    'border-yellow-600 text-yellow-400',
    active:      'border-green-600  text-green-400',
    voting:      'border-rdb-orange text-rdb-orange',
    closed:      'border-rdb-border text-rdb-muted',
  };
  const labels = {
    matchmaking: 'FINDING PLAYERS',
    lobby:       'LOBBY',
    upcoming:    'LOBBY',
    active:      'SUBMITTING',
    voting:      'VOTING',
    closed:      'CLOSED',
  };
  return (
    <span
      className={`font-mono text-[10px] uppercase px-2 py-0.5 border ${
        styles[phase] || styles.upcoming
      }`}
    >
      {labels[phase] || phase?.toUpperCase() || 'UNKNOWN'}
    </span>
  );
}

// Live pulse dot for voting phase
function VotePulse() {
  return (
    <span className="relative mr-2 inline-flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rdb-orange opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-rdb-orange" />
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Battle() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { profile } = useAuthStore();
  const addToast  = useUiStore((s) => s.addToast);

  // useBattle is fully realtime — no polling anywhere below
  const { battle, submissions, room, members, messages, loading, refresh, refreshRoomData, optimisticMessage, optimisticRemoveMessage } =
    useBattle(id);

  const [ratings, setRatings]       = useState({});
  const [descriptions, setDescriptions] = useState({});
  const [paid, setPaid]             = useState(false);
  const [messageBody, setMessageBody] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [leavingRoom, setLeavingRoom] = useState(false);
  const [showDeleteRoomModal, setShowDeleteRoomModal] = useState(false);
  const [showEarlyLeaveModal, setShowEarlyLeaveModal] = useState(false);
  const [showWinModal, setShowWinModal] = useState(false);
  const [winEloGain, setWinEloGain] = useState(null);
  const [winOldTier, setWinOldTier] = useState(null);
  const [winNewTier, setWinNewTier] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const chatEndRef = useRef(null);
  const selfLeaving = useRef(false);

  const myMember = members.find((m) => m.user_id === profile?.id);
  const allReady = members.length >= 2 && members.every((m) => m.is_ready);
  const readyCount = members.filter((m) => m.is_ready).length;

  // ── Room state machine ────────────────────────────────────────────────────
  const { phase, phaseEndsAt, forceStart, forceClose, isSolo } =
    useRoomStateMachine({
      battle,
      room,
      profile,
      onStateChange: (nextPhase) => {
        console.log('[Battle] FSM state change →', nextPhase);
        refresh();
      },
    });

  // ── Load existing ratings + premium status on mount ─────────────────────────
  useEffect(() => {
    if (!profile || !id || !supabase) return;
    async function loadRatingsAndPaid() {
      const [{ data: voteRows }, { data: tx }] = await Promise.all([
        supabase
          .from('votes')
          .select('submission_id, rating, description')
          .eq('battle_id', id)
          .eq('voter_id', profile.id),
        supabase
          .from('token_transactions')
          .select('id')
          .eq('battle_id', id)
          .eq('user_id', profile.id)
          .eq('reason', 'premium_entry')
          .maybeSingle(),
      ]);
      setRatings(
        Object.fromEntries((voteRows || []).map((r) => [r.submission_id, r.rating])),
      );
      setDescriptions(
        Object.fromEntries((voteRows || []).map((r) => [r.submission_id, r.description || ''])),
      );
      setPaid(Boolean(tx));
    }
    loadRatingsAndPaid();
  }, [profile?.id, id]);

  // ── Auto-scroll chat ──────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Leave cleanup on tab close / refresh (all phases) ────────────────────
  useEffect(() => {
    if (!profile || !room) return;

    const doLeave = () => {
      if (selfLeaving.current) return;
      selfLeaving.current = true;
      const isRankedHost = room.mode === 'ranked' && room.owner_id === profile.id;
      supabase.from('room_members').delete().eq('room_id', room.id).eq('user_id', profile.id).then(() => {
        if (isRankedHost) {
          supabase.from('room_members').select('user_id').eq('room_id', room.id).then(({ data: remaining }) => {
            if (remaining?.length) {
              const newHost = remaining[0];
              supabase.from('rooms').update({ owner_id: newHost.user_id }).eq('id', room.id);
              supabase.from('room_members').update({ role: 'owner' }).eq('room_id', room.id).eq('user_id', newHost.user_id);
            }
          });
        }
        supabase.from('room_members').select('room_id', { count: 'exact', head: true }).eq('room_id', room.id).then(({ count }) => {
          if (count <= 0) supabase.from('rooms').update({ status: 'closed' }).eq('id', room.id);
          else supabase.from('rooms').update({ current_players: count }).eq('id', room.id);
        });
      });
    };

    window.addEventListener('beforeunload', doLeave);
    return () => window.removeEventListener('beforeunload', doLeave);
  }, [profile?.id, room?.id, room?.status]);

  // ── Lobby countdown ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!room?.countdown_started_at || phase !== 'lobby') {
      setCountdown(null);
      return;
    }
    const target = new Date(room.countdown_started_at).getTime() + 5000;
    let raf;
    function tick() {
      const remaining = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setCountdown(remaining > 0 ? remaining : null);
      if (remaining > 0) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [room?.countdown_started_at, phase]);

  // ── Redirect when kicked (room_members deleted while on page) ─────────────
  const wasMember = useRef(false);
  useEffect(() => {
    if (loading) return;
    const nowMember = members.some((m) => m.user_id === profile?.id);
    if (!wasMember.current && nowMember) wasMember.current = true;
    if (wasMember.current && !nowMember && profile && !selfLeaving.current) {
      addToast('ROOM CLOSED — YOU HAVE BEEN REMOVED');
      selfLeaving.current = true;
      navigate('/', { replace: true });
    }
  }, [members, profile?.id, loading]);

  // ── Detect win when battle closes ────────────────────────────────────────
  const wasClosed = useRef(false);
  const oldEloRef = useRef(profile?.elo ?? DEFAULT_ELO);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  useEffect(() => {
    if (loading || !profile) return;
    if (phase === 'closed' && !wasClosed.current) {
      wasClosed.current = true;

      if (battle?.winner_id === profile.id) {
        console.log('[Win] battle closed, winner detected, querying profile');
        setShowWinModal(true);
        supabase.from('profiles').select('elo, rank_tier').eq('id', profile.id).maybeSingle().then(({ data }) => {
          const newEloVal = data?.elo ?? oldEloRef.current;
          const newTier = data?.rank_tier || tierFromElo(newEloVal);
          const oldTier = tierFromElo(oldEloRef.current);
          const gain = newEloVal - oldEloRef.current;
          console.log('[Win] elo — old:', oldEloRef.current, 'new:', newEloVal, 'gain:', gain, 'tier:', oldTier, '→', newTier);
          setWinEloGain(gain);
          setWinOldTier(oldTier);
          setWinNewTier(newTier);
          refreshProfile();
        });
        return;
      }

      if (!isSolo && submissions.length > 0) {
        const sorted = [...submissions].sort((a, b) => (b.rating_total ?? 0) - (a.rating_total ?? 0));
        if (sorted[0]?.user_id === profile.id) {
          console.log('[Win] battle closed, top submission detected, querying profile');
          setShowWinModal(true);
          supabase.from('profiles').select('elo, rank_tier').eq('id', profile.id).maybeSingle().then(({ data }) => {
            const newEloVal = data?.elo ?? oldEloRef.current;
            const newTier = data?.rank_tier || tierFromElo(newEloVal);
            const oldTier = tierFromElo(oldEloRef.current);
            let gain = newEloVal - oldEloRef.current;
            if (gain === 0) gain = 1;
            console.log('[Win] elo — old:', oldEloRef.current, 'new:', newEloVal, 'gain:', gain, 'tier:', oldTier, '→', newTier);
            setWinEloGain(gain);
            setWinOldTier(oldTier);
            setWinNewTier(newTier);
            refreshProfile();
          });
        }
      }
    }
  }, [phase, loading, profile?.id]);

  // ── Leave confirmation for ranked match during submission ──────────────────
  const isRankedMatch = room?.mode === 'ranked' && !isSolo;
  const shouldConfirmLeave = isRankedMatch && (phase === 'active' || phase === 'voting');
  useBlocker(
    useCallback(() => !selfLeaving.current && shouldConfirmLeave, [shouldConfirmLeave])
  );
  useEffect(() => {
    if (!shouldConfirmLeave) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [shouldConfirmLeave]);

  // ── Re-fetch ratings after casting one ─────────────────────────────────────
  async function reloadRatings() {
    if (!profile || !id || !supabase) return;
    const { data } = await supabase
      .from('votes')
      .select('submission_id, rating, description')
      .eq('battle_id', id)
      .eq('voter_id', profile.id);
    setRatings(Object.fromEntries((data || []).map((r) => [r.submission_id, r.rating])));
    setDescriptions(Object.fromEntries((data || []).map((r) => [r.submission_id, r.description || ''])));
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  async function sendRoomMessage() {
    playUiSound('click');
    if (!profile || !room || !messageBody.trim()) return;
    const body = messageBody.trim();
    setMessageBody('');
    const tempId = `opt-${Date.now()}`;
    optimisticMessage({ id: tempId, room_id: room.id, user_id: profile.id, body, created_at: new Date().toISOString(), profiles: { username: profile.username } });
    try {
      const { error } = await supabase
        .from('room_messages')
        .insert({ room_id: room.id, user_id: profile.id, body });
      if (error) throw error;
    } catch (err) {
      optimisticRemoveMessage(tempId);
      addToast(err.message || 'MESSAGE FAILED', 'error');
    }
  }

  // ── Owner Actions ────────────────────────────────────────────────────────
  async function handleForceStart() {
    if (isStarting) return;
    playUiSound('click');
    setIsStarting(true);
    try {
      console.log('[Battle] Triggering force start for battle:', id);
      await forceStart();
      // Manually trigger a refresh to ensure the local state catches up immediately
      await Promise.all([refresh(), refreshRoomData()]);
      addToast('BATTLE STARTED');
    } catch (err) {
      console.error('[Battle] Force start failed:', err);
      addToast(err.message || 'START FAILED', 'error');
    } finally {
      setIsStarting(false);
    }
  }

  async function handleForceClose() {
    if (isClosing) return;
    playUiSound('cancel');
    setIsClosing(true);
    try {
      await forceClose();
      // Manually trigger a refresh
      await Promise.all([refresh(), refreshRoomData()]);
      addToast('BATTLE CLOSED');
    } catch (err) {
      addToast(err.message || 'CLOSE FAILED', 'error');
    } finally {
      setIsClosing(false);
    }
  }

  // ── Leave room ────────────────────────────────────────────────────────────
  async function leaveRoom() {
    if (!profile || !room || leavingRoom) return;
    playUiSound('cancel');
    console.log('[cleanup] triggering edge function from leaveRoom');
    supabase.functions.invoke('cleanup-stale-data').then((r) => console.log('[cleanup] done:', r)).catch(() => {});

    const isRanked = room.mode === 'ranked';
    if (isRanked && phase !== 'closed') {
      setShowEarlyLeaveModal(true);
      return;
    }

    const isAlone = members.filter((m) => m.user_id !== profile.id).length === 0;
    if (isAlone && !isSolo) {
      setShowDeleteRoomModal(true);
      return;
    }

    if (isSolo) {
      await executeLeave(true);
      return;
    }

    await executeLeave();
  }

  async function executeLeave(deleteRoom = false) {
    if (!profile || !room || leavingRoom) return;
    selfLeaving.current = true;
    setLeavingRoom(true);
    setShowDeleteRoomModal(false);
    setShowEarlyLeaveModal(false);
    try {
      const isRanked = room.mode === 'ranked';
      const preLeaveCount = members?.length || 0;

      if (isRanked && battle?.id) {
        await supabase.from('battles').update({ early_closed: true }).eq('id', battle.id).eq('early_closed', false);
      }

      await Promise.all([
        supabase.from('room_members').delete().eq('room_id', room.id).eq('user_id', profile.id),
        isRanked ? supabase.from('submissions').delete().eq('battle_id', room.battle_id).eq('user_id', profile.id) : null,
        isRanked ? supabase.from('votes').delete().eq('battle_id', room.battle_id).eq('voter_id', profile.id) : null,
      ]);

      if (isRanked && room.owner_id === profile.id) {
        const { data: remainingMembers } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', room.id);
        if (remainingMembers?.length) {
          const newHost = remainingMembers[0];
          await Promise.all([
            supabase.from('rooms').update({ owner_id: newHost.user_id }).eq('id', room.id),
            supabase.from('room_members').update({ role: 'owner' }).eq('room_id', room.id).eq('user_id', newHost.user_id),
          ]);
        }
      }

      window.__clearReturnTo?.();

      // Ranked: determine outcome after leaving
      if (isRanked) {
        const { data: leaverProfile } = await supabase
          .from('profiles')
          .select('elo, wins, ranked_wins, ranked_losses, battles_entered')
          .eq('id', profile.id)
          .maybeSingle();

        const { data: remaining } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', room.id);

        if (remaining?.length === 1) {
          const winnerId = remaining[0].user_id;
          const isOneVOne = preLeaveCount <= 2;

          const { data: winnerProfiles } = await supabase
            .from('profiles')
            .select('id, elo, rank_tier, wins, ranked_wins, ranked_losses, battles_entered')
            .in('id', [winnerId, profile.id]);

          const winnerProf = (winnerProfiles || []).find((p) => p.id === winnerId);

          const players = (winnerProfiles || []).map((p) => ({
            user_id: p.id,
            elo: p.elo ?? DEFAULT_ELO,
            rank_tier: p.rank_tier,
          }));
          const ranking = { [winnerId]: 1, [profile.id]: 2 };
          const eloUpdates = computeNewElos(players, ranking);

          await Promise.all(eloUpdates.map((u) => {
            const isWinner = u.user_id === winnerId;
            const prof = isWinner ? winnerProf : leaverProfile;
            return supabase.from('profiles').update({
              elo: u.newElo,
              rank_tier: tierFromElo(u.newElo),
              wins: (prof?.wins || 0) + (isWinner ? 1 : 0),
              battles_entered: (prof?.battles_entered || 0) + 1,
              ranked_wins: (prof?.ranked_wins || 0) + (isWinner ? 1 : 0),
              ranked_losses: (prof?.ranked_losses || 0) + (!isWinner ? 1 : 0),
            }).eq('id', u.user_id);
          }));

          if (isOneVOne) {
            await Promise.all([
              supabase.from('battles').update({
                status: 'closed', winner_id: winnerId, early_closed: true,
              }).eq('id', battle.id).in('status', ['upcoming', 'active', 'voting']),
              supabase.from('rooms').update({ status: 'closed' }).eq('id', room.id),
            ]);
            addToast('MATCH WON — opponent left');
          } else {
            const votingMinutes = room?.voting_minutes || 3;
            const votingEndsAt = new Date(Date.now() + votingMinutes * 60 * 1000).toISOString();
            await Promise.all([
              supabase.from('battles').update({
                status: 'voting', voting_ends_at: votingEndsAt,
                early_closed: true, winner_id: winnerId,
              }).eq('id', battle.id).in('status', ['upcoming', 'active', 'voting']),
              supabase.from('rooms').update({ status: 'voting', is_public: true }).eq('id', room.id),
            ]);
            addToast('Opponent left. Voting open for spectators.');
          }
        } else if (!remaining || remaining.length === 0) {
          await supabase.from('room_members').delete().eq('room_id', room.id);
          await Promise.all([
            supabase.from('rooms').update({ status: 'closed' }).eq('id', room.id),
            supabase.from('battles').update({ status: 'closed', early_closed: true }).eq('id', battle.id).in('status', ['upcoming', 'active', 'voting']),
          ]);
          addToast('MATCH CLOSED');
        } else {
          const leaverElo = leaverProfile?.elo ?? DEFAULT_ELO;
          const penalty = getPlayerKFactor(leaverElo, leaverElo);
          const newElo = Math.max(0, leaverElo - penalty);
          await supabase
            .from('profiles')
            .update({
              elo: newElo,
              rank_tier: tierFromElo(newElo),
              ranked_losses: (leaverProfile?.ranked_losses || 0) + 1,
              battles_entered: (leaverProfile?.battles_entered || 0) + 1,
            })
            .eq('id', profile.id);
        }
      }

      if (deleteRoom) {
        await supabase.from('room_members').delete().eq('room_id', room.id);
        await Promise.all([
          supabase.from('rooms').update({ status: 'closed' }).eq('id', room.id),
          supabase.from('battles').update({ status: 'closed', early_closed: true }).eq('id', battle.id).in('status', ['upcoming', 'active', 'voting']),
        ]);
        addToast('ROOM CLOSED');
      } else if (!isRanked) {
        addToast('LEFT ROOM');
      }
      if (isRanked) refreshProfile();
      navigate('/', { replace: true });
    } catch (err) {
      addToast(err.message || 'COULD NOT LEAVE ROOM', 'error');
    } finally {
      setLeavingRoom(false);
      selfLeaving.current = false;
    }
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!profile) return <Navigate to="/login" replace />;
  if (loading)  return <main className="rdb-container font-mono text-rdb-orange blink">LOADING...</main>;
  if (!battle && !room)  return <main className="rdb-container font-mono text-rdb-red">BATTLE NOT FOUND</main>;

  const mine          = submissions.find((s) => s.user_id === profile.id);
  const premiumLocked = battle?.is_premium && !paid;
  const canSubmit     = phase === 'active';
  const isMember      = members.some((m) => m.user_id === profile.id);
  const songSeconds   = room?.song_length_seconds || battle?.song_length_seconds || null;
  const isVotingPhase = phase === 'voting';
  const isRanked      = room?.mode === 'ranked';
  const visibleSubmissions = isRanked && phase === 'active'
    ? submissions.filter((s) => s.user_id === profile.id)
    : submissions;

  const statusLabel = {
    matchmaking: 'FINDING PLAYERS',
    lobby: isSolo ? 'SOLO LOBBY' : 'LOBBY — WAITING',
    upcoming: isSolo ? 'SOLO LOBBY' : 'CHALLENGE REVEAL',
    active:   'SUBMISSIONS OPEN',
    voting:   'VOTING OPEN',
    closed:   'CLOSED',
  }[phase] || phase?.toUpperCase();

  return isSolo ? (
    <main className="rdb-container-admin grid min-h-[calc(100vh-88px)] place-items-center py-12">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        {room?.challenge && phase === 'active' ? (
          <SampleCard challenge={room.challenge} />
        ) : (
          <BattlePrompt battle={battle} />
        )}

        {phase === 'upcoming' && (
          <div className="rdb-panel p-5 text-center">
            <p className="font-mono text-[11px] uppercase text-rdb-muted">SOLO SESSION — READY TO START?</p>
            <button
              className="rdb-button rdb-button-primary mt-4"
              type="button"
              disabled={isStarting}
              onClick={handleForceStart}
            >
              {isStarting ? 'STARTING...' : 'START NOW'}
            </button>
          </div>
        )}
        {phase === 'active' && (
          <div className="rdb-panel p-5 text-center">
            <p className="font-mono text-[11px] uppercase text-green-400">Session active</p>
            <button
              className="rdb-button border-rdb-red text-rdb-red mt-4"
              type="button"
              disabled={isClosing}
              onClick={handleForceClose}
            >
              {isClosing ? 'CLOSING...' : 'END SESSION'}
            </button>
          </div>
        )}
        {phase === 'closed' && (
          <div className="rdb-panel p-5 text-center font-mono text-[11px] uppercase text-rdb-muted">
            Session ended.
          </div>
        )}

        {/* ── Leave button ── */}
        <div className="text-center">
          <button
            className="rdb-button border-rdb-red text-rdb-red"
            type="button"
            disabled={leavingRoom}
            onClick={leaveRoom}
          >
            {leavingRoom ? 'LEAVING...' : 'LEAVE'}
          </button>
        </div>
      </div>
    </main>
  ) : phase === 'lobby' && !isSolo ? (
    <main className="rdb-container-admin grid min-h-[calc(100vh-88px)] place-items-center py-12">
      <div className="mx-auto w-full max-w-xl space-y-5">

        {/* ── Room header ── */}
        <div className="text-center">
          <h1 className="font-mono text-2xl font-bold uppercase text-rdb-text">
            {room?.name || 'BATTLE LOBBY'}
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase text-rdb-muted">
            LOBBY — {members.length}/{room?.max_players || 4} PLAYERS
          </p>
          {room?.room_code && (
            <button
              className="mt-2 inline-flex items-center gap-1.5 font-mono text-[12px] uppercase text-rdb-orange hover:underline"
              onClick={() => { playUiSound('click'); navigator.clipboard.writeText(room.room_code); addToast('ROOM CODE COPIED'); }}
              type="button"
            >
              <Copy size={13} />
              ROOM CODE: {room.room_code}
            </button>
          )}
        </div>

        {/* ── Player list ── */}
        <div className="rdb-panel p-5">
          <h2 className="font-mono text-[12px] uppercase text-rdb-orange mb-3">PLAYERS</h2>
          <div className="space-y-2">
            {members.map((member) => {
              const isSelf = member.user_id === profile?.id;
              return (
                <div
                  key={member.user_id}
                  className="flex items-center justify-between gap-2 rounded border border-rdb-border bg-rdb-bg px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${member.is_ready ? 'bg-green-400' : 'bg-rdb-orange/40'}`} />
                    <span className={`truncate font-mono text-[12px] uppercase ${getNameCosmeticClassName(member.profiles)}`} style={getNameGradientStyle(member.profiles)}>
                      {member.profiles?.nameplate_icon && <span className="mr-1 text-rdb-orange">{getNameplateEmoji(member.profiles.nameplate_icon)}</span>}
                      {member.profiles?.username || 'USER'}
                      {isSelf && <span className="ml-1.5 text-rdb-muted text-[10px]">(YOU)</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`font-mono text-[10px] uppercase ${member.is_ready ? 'text-green-400' : 'text-rdb-muted'}`}>
                      {member.is_ready ? 'READY' : 'NOT READY'}
                    </span>
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

        {/* ── Ready / Start controls ── */}
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
              disabled={countdown !== null}
              onClick={() => { playUiSound('click'); toggleReady(room.id, profile.id).then(() => refresh()); }}
              type="button"
            >
              {myMember?.is_ready ? 'UNREADY' : 'READY UP'}
            </button>
            <button
              className="h-11 px-6 rdb-button border-rdb-red text-rdb-red font-mono text-[12px] uppercase"
              disabled={countdown !== null || leavingRoom}
              onClick={() => { setLeavingRoom(true); playUiSound('cancel'); leaveLobby(room.id, profile.id).finally(() => { setLeavingRoom(false); }); addToast('LEFT LOBBY'); navigate('/', { replace: true }); }}
              type="button"
            >
              {leavingRoom ? 'LEAVING...' : 'LEAVE'}
            </button>
          </div>

          <p className="font-mono text-[10px] uppercase text-rdb-muted text-center">
            {allReady ? 'All players ready — starting countdown...' : `${readyCount}/${members.length} READY`}
          </p>
        </div>

        {/* ── Chat ── */}
        <div className="rdb-panel p-5">
          <h2 className="font-mono text-[12px] uppercase text-rdb-orange mb-3">CHAT</h2>
          <div className="h-48 overflow-y-auto border-y border-rdb-border py-2 mb-3">
            {messages.map((message) => (
              <div key={message.id} className="mb-2 font-mono text-[11px] uppercase text-rdb-muted">
                <Link className={`text-rdb-text hover:underline ${getNameCosmeticClassName(message.profiles)}`} to={`/profile/${message.profiles?.username}`} style={getNameGradientStyle(message.profiles)}>
                  {message.profiles?.nameplate_icon && <span className="mr-1 text-rdb-orange">{getNameplateEmoji(message.profiles.nameplate_icon)}</span>}
                  {message.profiles?.username || 'USER'}:
                </Link>{' '}
                {message.body}
              </div>
            ))}
            {!messages.length && (
              <div className="font-mono text-[11px] uppercase text-rdb-muted">No messages yet.</div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="flex gap-2">
            <input
              className="rdb-input flex-1"
              placeholder="TYPE A MESSAGE"
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendRoomMessage(); }}
            />
            <button className="rdb-button rdb-button-primary" type="button" onClick={sendRoomMessage}>SEND</button>
          </div>
        </div>
      </div>
    </main>
  ) : (
    <main className="rdb-container-admin">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">

        {/* ══ MAIN COLUMN ═══════════════════════════════════════════════════ */}
        <section key={phase} className="space-y-5 phase-fade">
          {phase === 'upcoming' && room?.challenge ? (
            <ChallengeReveal challenge={room.challenge} battleStartsAt={battle?.starts_at} />
          ) : room?.challenge && phase === 'active' ? (
            <SampleCard challenge={room.challenge} />
          ) : (
            <BattlePrompt battle={battle} />
          )}

          {/* ── Status bar ── */}
          <div className="rdb-panel flex flex-wrap items-center justify-between gap-3 p-4 font-mono text-[11px] uppercase">
            <span className="text-rdb-muted">
              STATUS: <span className="text-rdb-orange">{statusLabel}</span>
              {isSolo && (
                <span className="ml-2 border border-rdb-orange px-1.5 py-0.5 text-rdb-orange">
                  SOLO
                </span>
              )}
              
            </span>
            <div className="flex items-center gap-4">
              <SongLengthBadge seconds={songSeconds} />
              <span className="text-rdb-muted">
                {formatNumber(visibleSubmissions.length)} SUBMITTED
              </span>
            </div>
          </div>

          {/* ── Phase countdown timers ── */}
          {phase === 'upcoming' && phaseEndsAt && !isSolo && (
            <PhaseTimer
              label="CHALLENGE REVEAL"
              target={new Date(phaseEndsAt).toISOString()}
            />
          )}
          {phase === 'upcoming' && isSolo && (
            <div className="rdb-panel p-3 font-mono text-[11px] uppercase text-rdb-muted">
              PRACTICE MODE — NO TIMER. START WHEN READY.
            </div>
          )}
          {phase === 'active' && (
            <PhaseTimer
              label="SUBMISSIONS"
              target={battle.voting_ends_at || battle.ends_at}
            />
          )}
          {phase === 'voting' && (
            <PhaseTimer
              label="VOTING"
              target={phaseEndsAt ? new Date(phaseEndsAt).toISOString() : null}
            />
          )}

          {/* ── Forfeit button for ranked matches ── */}
          {room?.mode === 'ranked' && !isSolo && phase !== 'closed' && phase !== 'lobby' && (
            <div className="rdb-panel p-3 flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] uppercase text-rdb-muted">
                LEAVE THE MATCH
              </span>
              <button
                className="rdb-button border-rdb-red text-rdb-red"
                type="button"
                disabled={leavingRoom}
                onClick={leaveRoom}
              >
                {leavingRoom ? 'FORFEITING...' : 'FORFEIT'}
              </button>
            </div>
          )}

          {/* ── Submit area (disabled in solo practice mode) ── */}
          {canSubmit && !isSolo && (
            <div id="submit-beat">
              {premiumLocked ? (
                <PremiumGate
                  battle={battle}
                  profile={profile}
                  onPaid={() => setPaid(true)}
                />
              ) : (
                <SubmitBeat
                  battle={battle}
                  profile={profile}
                  existingSubmission={mine}
                  onSubmitted={refresh}
                />
              )}
            </div>
          )}
          {canSubmit && isSolo && (
            <div className="rdb-panel p-5 text-center font-mono text-[11px] uppercase text-rdb-muted">
              <p className="text-rdb-orange">PRACTICE SESSION</p>
              <p className="mt-2">No submissions in practice mode. Use the chat to test features.</p>
            </div>
          )}

          {/* ── Voting feed — gated to voting phase ── */}
          {isVotingPhase && (
            <div id="voting-feed">
              <VotingFeed
                battle={battle}
                room={room}
                submissions={submissions}
                profile={profile}
                ratings={ratings}
                descriptions={descriptions}
                votingStopped={Boolean(myMember?.voting_stopped)}
                onVoted={async () => {
                  await reloadRatings();
                }}
                onStopVoting={() => {}}
              />
            </div>
          )}

          {/* ── Final results (hidden for solo — no voting) ── */}
          {phase === 'closed' && !isSolo && <BattleResults submissions={submissions} />}

          {/* ── Your submission preview — hidden during active & voting ── */}
          {mine && phase === 'closed' && (
            <div className="rdb-panel p-5">
              <h2 className="font-mono text-[13px] uppercase text-rdb-orange">
                YOUR SUBMISSION
              </h2>
              <div className="mt-3">
                <WaveformPlayer url={mine.audio_url} profile={profile} />
              </div>
            </div>
          )}

          {/* ── All submissions — hidden until results (blind voting) ── */}
          {phase === 'closed' && (
          <div className="rdb-panel p-5">
            <h2 className="font-mono text-[13px] uppercase text-rdb-orange mb-3">
              ALL SUBMISSIONS
              <span className="ml-2 text-rdb-muted text-[11px]">
                ({submissions.length})
              </span>
            </h2>
            {submissions.length === 0 ? (
              <p className="font-mono text-[11px] uppercase text-rdb-muted">
                NO SUBMISSIONS YET.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {submissions.map((sub) => {
                  const isOwn = sub.user_id === profile.id;
                  return (
                    <div
                      key={sub.id}
                      className={`rdb-panel p-4 ${isOwn ? 'border-rdb-orange/40' : ''}`}
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <Link
                          className={`font-mono text-sm font-bold uppercase hover:underline ${getNameCosmeticClassName(sub.profiles)}`}
                          to={`/profile/${sub.profiles?.username}`}
                          style={getNameGradientStyle(sub.profiles)}
                        >
                          {sub.profiles?.nameplate_icon && (
                            <span className="mr-1 text-rdb-orange">
                              {getNameplateEmoji(sub.profiles.nameplate_icon)}
                            </span>
                          )}
                          {sub.profiles?.username || 'PRODUCER'}
                          {isOwn && (
                            <span className="ml-2 text-[10px] text-rdb-muted">(YOU)</span>
                          )}
                        </Link>
                        <span className="font-mono text-[11px] text-rdb-muted">
                          {formatNumber(sub.rating_total ?? sub.vote_count ?? 0)} SCORE
                        </span>
                      </div>
                      <WaveformPlayer url={sub.audio_url} profile={sub.profiles} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}
        </section>

        {/* ══ SIDEBAR ═══════════════════════════════════════════════════════ */}
        <aside className="space-y-4 lg:sticky lg:top-16 lg:self-start">

          {/* ── Room panel ── */}
          <section className="rdb-panel p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="rdb-section-title">
                {isSolo ? 'SOLO SESSION' : 'ROOM'}
              </h2>
              {isMember && (
                <button
                  className="rdb-button border-rdb-red text-rdb-red"
                  type="button"
                  disabled={leavingRoom}
                  onClick={leaveRoom}
                >
                  {leavingRoom ? 'LEAVING...' : 'LEAVE'}
                </button>
              )}
            </div>

            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="font-mono text-[12px] uppercase text-rdb-text">
                {room?.name || 'BATTLE ROOM'}
              </span>
              <PhaseBadge phase={phase} />
            </div>

            {room && (
              <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] uppercase text-rdb-muted">
                <SongLengthBadge seconds={songSeconds} />
                {!isSolo && (
                  <span>
                    {room.code_only
                      ? 'Code Only'
                      : room.is_public === false
                      ? 'Private'
                      : 'Public'}
                  </span>
                )}
                {room.min_rank_tier && room.min_rank_tier !== 'bronze' && (
                  <span>MIN {room.min_rank_tier.toUpperCase()}</span>
                )}
              </div>
            )}
            {room?.room_code && (
              <button
                className="mt-2 flex items-center gap-1.5 font-mono text-[11px] uppercase text-rdb-orange hover:underline"
                onClick={() => {
                  playUiSound('click');
                  navigator.clipboard.writeText(room.room_code);
                  addToast('ROOM CODE COPIED');
                }}
              >
                <Copy size={12} />
                CODE: {room.room_code}
              </button>
            )}

            {/* ── VOTE BUTTON — visible only in voting phase ── */}
            {isVotingPhase && isMember && (
              <div className="mt-3">
                {/* Non-submitters get the primary CTA */}
                {!mine ? (
                  <a
                    className="rdb-button rdb-button-primary w-full block text-center"
                    href="#voting-feed"
                  >
                    <VotePulse />
                    VOTE NOW
                  </a>
                ) : (
                  /* Submitters see a softer reminder since they have a submission */
                  <a
                    className="rdb-button w-full block text-center border-rdb-orange text-rdb-orange"
                    href="#voting-feed"
                  >
                    <VotePulse />
                    CAST YOUR VOTES
                  </a>
                )}
                {/* Countdown mini-bar inside the voting CTA card */}
                {phaseEndsAt && (
                  <div className="mt-2 font-mono text-[10px] uppercase text-rdb-muted text-center">
                    <PhaseTimer
                      label="VOTING"
                      target={new Date(phaseEndsAt).toISOString()}
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── Members list ── */}
            <div className="mt-3 grid gap-2">
              {members.map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center justify-between gap-2 rounded border border-rdb-border bg-rdb-bg px-2 py-2"
                >
                  <Link
                    className={`min-w-0 truncate font-mono text-[11px] uppercase hover:underline ${getNameCosmeticClassName(member.profiles)}`}
                    to={`/profile/${member.profiles?.username}`}
                    style={getNameGradientStyle(member.profiles)}
                  >
                    {member.profiles?.nameplate_icon && (
                      <span className="mr-1 text-rdb-orange">
                        {getNameplateEmoji(member.profiles.nameplate_icon)}
                      </span>
                    )}
                    {member.profiles?.username || 'USER'}
                  </Link>
                  <span className="font-mono text-[10px] uppercase text-rdb-muted">
                    {member.role}
                  </span>
                </div>
              ))}
              {!members.length && (
                <div className="rounded border border-rdb-border bg-rdb-bg p-3 font-mono text-[11px] uppercase text-rdb-muted">
                  {isSolo ? 'Solo session — just you.' : 'No room members loaded.'}
                </div>
              )}
            </div>
          </section>

          {/* ── Chat panel ── */}
          <section className="rdb-panel p-4">
            <h2 className="rdb-section-title">CHAT</h2>
            <div className="h-56 overflow-y-auto border-y border-rdb-border py-2">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className="mb-2 font-mono text-[11px] uppercase text-rdb-muted"
                >
                  <Link
                    className={`text-rdb-text hover:underline ${getNameCosmeticClassName(message.profiles)}`}
                    to={`/profile/${message.profiles?.username}`}
                    style={getNameGradientStyle(message.profiles)}
                  >
                    {message.profiles?.nameplate_icon && (
                      <span className="mr-1 text-rdb-orange">
                        {getNameplateEmoji(message.profiles.nameplate_icon)}
                      </span>
                    )}
                    {message.profiles?.username || 'USER'}:
                  </Link>{' '}
                  {message.body}
                </div>
              ))}
              {!messages.length && (
                <div className="font-mono text-[11px] uppercase text-rdb-muted">
                  No chat yet.
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className="rdb-input"
                disabled={!room}
                placeholder="ROOM MESSAGE"
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendRoomMessage();
                }}
              />
              <button
                className="rdb-button rdb-button-primary"
                disabled={!room}
                type="button"
                onClick={sendRoomMessage}
              >
                SEND
              </button>
            </div>
          </section>
        </aside>
      </div>

      {/* Anchor for sidebar VOTE NOW button */}
      <div id="voting-feed-anchor" />

      <ConfirmModal
        open={showDeleteRoomModal}
        title="Close Room?"
        confirmLabel="CLOSE & LEAVE"
        onConfirm={() => executeLeave(true)}
        onCancel={() => { setShowDeleteRoomModal(false); setLeavingRoom(false); }}
      >
        <p className="font-mono text-[12px] uppercase text-rdb-muted">
          You are the only one in this room. Leaving will close it for everyone.
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={showEarlyLeaveModal}
        title="Early Leave"
        confirmLabel="LEAVE & PAY PENALTY"
        onConfirm={() => executeLeave()}
        onCancel={() => { setShowEarlyLeaveModal(false); setLeavingRoom(false); }}
      >
        <div className="space-y-2 font-mono text-[12px] uppercase text-rdb-muted">
          <p>Leaving a ranked match early will cost you <span className="text-rdb-red font-bold">ELO PENALTY</span>.</p>
          <p className="text-[11px] text-rdb-orange">
            {members.filter((m) => m.user_id !== profile?.id).length === 1
              ? 'Only 2 players — the remaining player wins automatically.'
              : 'Your spot is removed; the match continues without you.'}
          </p>
        </div>
      </ConfirmModal>

      <WinModal
        open={showWinModal}
        eloChange={winEloGain}
        oldTier={winOldTier}
        newTier={winNewTier}
        onPlayAgain={() => { selfLeaving.current = true; navigate('/', { replace: true }); }}
        onClose={() => { setShowWinModal(false); selfLeaving.current = true; setTimeout(() => navigate('/', { replace: true }), 500); }}
      />
    </main>
  );
}