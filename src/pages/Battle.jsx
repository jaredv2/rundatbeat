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
import { Navigate, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import BattlePrompt from '../components/battle/BattlePrompt';
import BattleResults from '../components/battle/BattleResults';
import SampleCard from '../components/battle/SampleCard';
import PremiumGate from '../components/battle/PremiumGate';
import SubmitBeat from '../components/battle/SubmitBeat';
import ConfirmModal from '../components/ui/ConfirmModal';
import Spinner from '../components/ui/Spinner';
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
import { toggleReady, leaveLobby, startCountdown } from '../lib/roomService';
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
  const [searchParams] = useSearchParams();
  const navigate  = useNavigate();
  const { profile } = useAuthStore();
  const addToast  = useUiStore((s) => s.addToast);

  const soloDifficulty = searchParams.get('difficulty') || 'medium';

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
  const { phase, phaseEndsAt, forceStart, forceClose, isSolo, calculatingWinner } =
    useRoomStateMachine({
      battle,
      room,
      profile,
      onStateChange: (newPhase, b, r) => {
        console.log(`[Battle] PHASE CHANGE → ${newPhase}`, { battleStatus: b?.status, roomStatus: r?.status });
        if (newPhase === 'active') playUiSound('phase_change');
        if (newPhase === 'voting') playUiSound('phase_change');
      },
    });

  useEffect(() => {
    if (phase === 'closed') {
      console.log('[Battle] STATE MACHINE — phase:', phase, { battleStatus: battle?.status, roomStatus: room?.status });
    }
  }, [phase, battle?.status, room?.status]);

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

  // ── Leave cleanup on tab close (ranked rooms only — custom rooms auto-rejoin) ─
  useEffect(() => {
    if (!profile || !room) return;

    const doLeave = () => {
      if (selfLeaving.current) return;
      if (room.mode !== 'ranked') return;
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
        supabase.from('room_members').select('room_id', { count: 'exact' }).eq('room_id', room.id).then(({ count }) => {
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

  // ── Auto-start countdown when all players ready (custom rooms) ──────────
  const autoStartTriggered = useRef(false);
  useEffect(() => {
    if (phase !== 'lobby' || !room?.id || room?.countdown_started_at) return;
    const owner = profile?.id && (room?.owner_id === profile.id || room?.host_id === profile.id);
    if (!owner) return;
    if (members.length < 2 || !members.every((m) => m.is_ready)) {
      autoStartTriggered.current = false;
      return;
    }
    if (autoStartTriggered.current) return;
    autoStartTriggered.current = true;
    startCountdown(room.id).catch(() => { autoStartTriggered.current = false; });
  }, [phase, profile?.id, room?.id, room?.owner_id, room?.host_id, room?.countdown_started_at, members]);

  // ── Solo: fire AI generation during upcoming phase ─────────────────────
  const soloAiFired = useRef(false);
  useEffect(() => {
    if (!isSolo || phase !== 'upcoming' || !room?.id || soloAiFired.current) return;
    if (room?.challenge?.instructions) return;
    soloAiFired.current = true;
    import('../lib/roomService').then(({ generateSoloChallenge }) => {
      generateSoloChallenge(room.id, soloDifficulty).catch(() => {});
    });
  }, [isSolo, phase, room?.id, room?.challenge?.instructions, soloDifficulty]);

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

  // ── Detect win/loss when battle closes ────────────────────────────────────
  const wasClosed = useRef(false);
  const oldEloRef = useRef(profile?.elo ?? DEFAULT_ELO);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  useEffect(() => {
    if (loading || !profile) return;
    if (phase === 'closed' && !wasClosed.current) {
      wasClosed.current = true;
      console.log('[Battle] BATTLE CLOSED', { winnerId: battle?.winner_id, myId: profile.id, isRanked, isSolo });

      if (battle?.winner_id === profile.id) {
        console.log('[Battle] WIN DETECTED');
        playUiSound('win');
        setShowWinModal(true);
        // Retry ELO fetch — advanceToClosed updates ELO AFTER setting status:closed
        async function fetchEloWithRetry(attempts = 0) {
          const { data } = await supabase.from('profiles').select('elo, rank_tier').eq('id', profile.id).maybeSingle();
          const newEloVal = data?.elo ?? oldEloRef.current;
          const gain = newEloVal - oldEloRef.current;
          if (gain === 0 && attempts < 5) {
            await new Promise(r => setTimeout(r, 1500));
            return fetchEloWithRetry(attempts + 1);
          }
          const newTier = data?.rank_tier || tierFromElo(newEloVal);
          const oldTier = tierFromElo(oldEloRef.current);
          setWinEloGain(gain || 1);
          setWinOldTier(oldTier);
          setWinNewTier(newTier);
          refreshProfile();
        }
        fetchEloWithRetry();
        return;
      }

      if (isRanked && battle?.winner_id && battle.winner_id !== profile.id) {
        console.log('[Battle] LOSS DETECTED', { winnerId: battle.winner_id });
        playUiSound('forfeit');
        async function fetchLossWithRetry(attempts = 0) {
          const { data } = await supabase.from('profiles').select('elo, rank_tier').eq('id', profile.id).maybeSingle();
          const newEloVal = data?.elo ?? oldEloRef.current;
          const loss = oldEloRef.current - newEloVal;
          if (loss === 0 && attempts < 5) {
            await new Promise(r => setTimeout(r, 1500));
            return fetchLossWithRetry(attempts + 1);
          }
          if (loss > 0) addToast(`ELO LOSS: -${loss}`, 'error');
          refreshProfile();
        }
        fetchLossWithRetry();
      }

      if (!isSolo && submissions.length > 0) {
        const sorted = [...submissions].sort((a, b) => (b.rating_total ?? 0) - (a.rating_total ?? 0));
        if (sorted[0]?.user_id === profile.id) {
          setShowWinModal(true);
          supabase.from('profiles').select('elo, rank_tier').eq('id', profile.id).maybeSingle().then(({ data }) => {
            const newEloVal = data?.elo ?? oldEloRef.current;
            const newTier = data?.rank_tier || tierFromElo(newEloVal);
            const oldTier = tierFromElo(oldEloRef.current);
            let gain = newEloVal - oldEloRef.current;
            if (gain === 0) gain = 1;
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
    useCallback(() => {
      if (selfLeaving.current) return false;
      return shouldConfirmLeave;
    }, [shouldConfirmLeave])
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
    playUiSound('chat');
    if (!profile || !room || !messageBody.trim()) return;
    const body = messageBody.trim();
    console.log('[Battle] SEND MESSAGE', { roomId: room.id, body: body.slice(0, 50) });
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
    console.log('[Battle] FORCE START', { roomId: room?.id, battleId: battle?.id, isOwner });
    setIsStarting(true);
    try {
      await forceStart();
      console.log('[Battle] FORCE START SUCCESS');
      await Promise.all([refresh(), refreshRoomData()]);
      addToast('BATTLE STARTED');
    } catch (err) {
      console.error('[Battle] FORCE START FAILED:', err);
      addToast(err.message || 'START FAILED', 'error');
    } finally {
      setIsStarting(false);
    }
  }

  async function handleForceClose() {
    if (isClosing) return;
    playUiSound('cancel');
    console.log('[Battle] FORCE CLOSE', { roomId: room?.id, battleId: battle?.id });
    setIsClosing(true);
    try {
      await forceClose();
      console.log('[Battle] FORCE CLOSE SUCCESS');
      await Promise.all([refresh(), refreshRoomData()]);
      addToast('BATTLE CLOSED');
    } catch (err) {
      console.error('[Battle] FORCE CLOSE FAILED:', err);
      addToast(err.message || 'CLOSE FAILED', 'error');
    } finally {
      setIsClosing(false);
    }
  }

  // ── Leave room ────────────────────────────────────────────────────────────
  async function leaveRoom() {
    if (!profile || !room || leavingRoom) return;
    playUiSound('cancel');

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
    console.log('[Battle] EXECUTE LEAVE', { roomId: room.id, battleId: battle?.id, deleteRoom, isRanked: room.mode === 'ranked' });
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
        supabase.from('ranked_lobby_members').delete().eq('user_id', profile.id),
      ]);

      // Recompute rating aggregates for remaining submissions after vote deletion
      if (isRanked && room.battle_id) {
        const { data: remainingSubs } = await supabase
          .from('submissions')
          .select('id')
          .eq('battle_id', room.battle_id);
        for (const sub of remainingSubs || []) {
          const { data: votes } = await supabase
            .from('votes')
            .select('rating, weight')
            .eq('submission_id', sub.id);
          if (votes?.length) {
            const total = votes.reduce((sum, v) => sum + (v.rating || 0) * (v.weight || 1), 0);
            await supabase.from('submissions').update({ rating_total: total, vote_count: votes.length }).eq('id', sub.id);
          }
        }
      }

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
  if (loading)  return <main className="rdb-container-admin grid min-h-[calc(100vh-88px)] place-items-center"><Spinner label="LOADING BATTLE" /></main>;
  if (!battle && !room)  return <main className="rdb-container-admin grid min-h-[calc(100vh-88px)] place-items-center"><Spinner label="BATTLE NOT FOUND" /></main>;

  const mine          = submissions.find((s) => s.user_id === profile.id);
  const premiumLocked = battle?.is_premium && !paid;
  const canSubmit     = phase === 'active';
  const isMember      = members.some((m) => m.user_id === profile.id);
  const songSeconds   = room?.song_length_seconds || battle?.song_length_seconds || null;
  const isVotingPhase = phase === 'voting';
  const isRanked      = room?.mode === 'ranked';
  const isOwner       = profile?.id && (room?.owner_id === profile.id || room?.host_id === profile.id);
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
        {phase === 'upcoming' ? (
          room?.challenge?.instructions ? (
            <SampleCard challenge={room.challenge} phase={phase} />
          ) : (
            <div className="rdb-panel p-8 text-center">
              <Spinner label="GENERATING CHALLENGE" />
              <p className="mt-3 font-mono text-[10px] uppercase text-rdb-muted">
                Preparing your session...
              </p>
            </div>
          )
        ) : room?.challenge && phase === 'active' ? (
          <SampleCard challenge={room.challenge} phase={phase} />
        ) : (
          <BattlePrompt battle={battle} />
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

        {/* ── Lobby countdown reveal ── */}
        {countdown !== null && (
          <ChallengeReveal
            challenge={room?.challenge}
            endsAt={room?.countdown_started_at ? new Date(new Date(room.countdown_started_at).getTime() + 5000).toISOString() : null}
            hideChallenge
          />
        )}

        {/* ── Ready / Start controls ── */}
        {!room?.countdown_started_at && (
        <div className="rdb-panel p-5 flex flex-col items-center gap-3">

          {isOwner && !room?.countdown_started_at && (
            <button
              className="w-full h-11 rdb-button rdb-button-primary font-mono text-[12px] uppercase font-bold"
              disabled={members.length < 2}
              onClick={() => {
                playUiSound('click');
                startCountdown(room.id).catch((err) => {
                  addToast(err.message || 'START FAILED', 'error');
                });
              }}
              type="button"
            >
              {allReady ? 'START NOW' : 'START ANYWAY'}
            </button>
          )}

          <div className="flex items-center gap-3 w-full">
            <button
              className={`flex-1 h-11 font-mono text-[12px] uppercase font-bold ${myMember?.is_ready ? 'rdb-button border-rdb-orange text-rdb-orange' : 'rdb-button rdb-button-primary'}`}
              onClick={() => { playUiSound('click'); toggleReady(room.id, profile.id).then(() => refresh()); }}
              type="button"
            >
              {myMember?.is_ready ? 'UNREADY' : 'READY UP'}
            </button>
            <button
              className="h-11 px-6 rdb-button border-rdb-red text-rdb-red font-mono text-[12px] uppercase"
              disabled={leavingRoom}
              onClick={() => { setLeavingRoom(true); playUiSound('cancel'); leaveLobby(room.id, profile.id).finally(() => { setLeavingRoom(false); }); addToast('LEFT LOBBY'); navigate('/', { replace: true }); }}
              type="button"
            >
              {leavingRoom ? 'LEAVING...' : 'LEAVE'}
            </button>
          </div>

          <p className="font-mono text-[10px] uppercase text-rdb-muted text-center">
            {allReady ? 'All players ready' : `${readyCount}/${members.length} READY`}
          </p>
        </div>
        )}
      </div>
    </main>
  ) : (
    <main className="rdb-container-admin">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ══ MAIN COLUMN ═══════════════════════════════════════════════════ */}
        <section key={phase} className="space-y-5 phase-fade">
          {phase === 'upcoming' ? (
            <ChallengeReveal
              challenge={room?.challenge}
              endsAt={phaseEndsAt ? new Date(phaseEndsAt).toISOString() : battle?.starts_at}
              countdownDuration={15}
              battleId={battle?.id}
              roomId={room?.id}
              roomMode={room?.mode}
            />
          ) : room?.challenge && (phase === 'active' || phase === 'voting') ? (
            <SampleCard challenge={room.challenge} phase={phase} />
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

          {/* ── Calculating winner loading overlay ── */}
          {calculatingWinner && (
            <div className="rdb-panel p-8 text-center">
              <Spinner label="CALCULATING VOTES" />
              <p className="mt-3 font-mono text-[10px] uppercase text-rdb-muted">
                DETERMINING WINNER...
              </p>
            </div>
          )}

          {phase === 'closed' && !isSolo && <BattleResults submissions={submissions} />}

          {/* ── All submissions — hidden until results (blind voting; hidden for ranked) ── */}
          {phase === 'closed' && !isRanked && (
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
                        <a
                          className={`font-mono text-sm font-bold uppercase hover:underline ${getNameCosmeticClassName(sub.profiles)}`}
                          href={`/profile/${sub.profiles?.username}`}
                          target="_blank"
                          rel="noopener noreferrer"
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
                        </a>
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
              {members.map((member) => {
                const displayRole = isRanked && member.role === 'owner' ? 'member' : member.role;
                return (
                  <div
                    key={member.user_id}
                    className="flex items-center justify-between gap-2 rounded border border-rdb-border bg-rdb-bg px-2 py-2"
                  >
                    <a
                      className={`min-w-0 truncate font-mono text-[11px] uppercase hover:underline ${getNameCosmeticClassName(member.profiles)}`}
                      href={`/profile/${member.profiles?.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={getNameGradientStyle(member.profiles)}
                    >
                      {member.profiles?.nameplate_icon && (
                        <span className="mr-1 text-rdb-orange">
                          {getNameplateEmoji(member.profiles.nameplate_icon)}
                        </span>
                      )}
                      {member.profiles?.username || 'USER'}
                    </a>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase text-rdb-muted">
                        {displayRole}
                      </span>
                      {phase === 'active' && (
                        <span className={`font-mono text-[9px] uppercase ${submissions.some(s => s.user_id === member.user_id) ? 'text-green-400' : 'text-rdb-muted'}`}>
                          {submissions.some(s => s.user_id === member.user_id) ? 'SUBMITTED' : 'NO SUB'}
                        </span>
                      )}
                      {member.voting_stopped && phase === 'voting' && (
                        <span className="font-mono text-[9px] uppercase text-green-400">
                          VOTE LOCKED
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
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
                  <a
                    className={`text-rdb-text hover:underline ${getNameCosmeticClassName(message.profiles)}`}
                    href={`/profile/${message.profiles?.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={getNameGradientStyle(message.profiles)}
                  >
                    {message.profiles?.nameplate_icon && (
                      <span className="mr-1 text-rdb-orange">
                        {getNameplateEmoji(message.profiles.nameplate_icon)}
                      </span>
                    )}
                    {message.profiles?.username || 'USER'}:
                  </a>{' '}
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
        onPlayAgain={() => { selfLeaving.current = true; window.__clearReturnTo?.(); navigate('/', { replace: true }); }}
        onClose={() => setShowWinModal(false)}
      />
    </main>
  );
}