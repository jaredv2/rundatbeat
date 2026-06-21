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
import RankUpModal from '../components/ui/RankUpModal';
import VotingFeed from '../components/voting/VotingFeed';
import ChallengeReveal from '../components/battle/ChallengeReveal';
import WaveformPlayer from '../components/audio/WaveformPlayer';
import { useBattle } from '../hooks/useBattle';
import { useRoomStateMachine, markBattleLeaving, clearBattleLeaving } from '../hooks/useRoomStateMachine';
import { useRoomEvents, dispatchRoomEvent } from '../hooks/useRoomEvents';
import { useCountdown } from '../hooks/useCountdown';
import {
  formatNumber,
  getNameCosmeticClassName,
  getNameGradientStyle,
  getNameplateEmoji,
} from '../lib/display';
import { supabase } from '../lib/supabase';
import { devLog, devError } from '../lib/devLog';
import { censorProfanity } from '../lib/profanity';
import { getSoloDurationMinutes } from '../lib/groq';
import { toggleReady, startCountdown, startSoloSession, deleteRoom as deleteRoomFn } from '../lib/roomService';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { playUiSound } from '../lib/sfx';
import { sendBrowserNotification } from '../lib/notifications';

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

function SoloTimer({ target }) {
  const { label: countdown, remaining } = useCountdown(target);
  if (!target) return null;
  const urgent = remaining < 5 * 60 * 1000;
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="font-mono text-xs uppercase text-rdb-muted">
        {urgent ? '⚠ ENDING SOON' : 'ENDS IN'}
      </span>
      <span
        className={`font-mono text-5xl font-bold tracking-widest ${
          urgent ? 'text-red-400' : 'text-rdb-orange'
        }`}
      >
        {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </span>
    </div>
  );
}

function GetReadyCard({ startsAt }) {
  const { remaining } = useCountdown(startsAt);
  if (!startsAt) return null;
  const secs = Math.ceil((remaining || 0) / 1000);
  return (
    <div className="rdb-panel p-8 text-center space-y-4">
      <Spinner label="GETTING READY" />
      <p className="font-mono text-[11px] uppercase text-rdb-muted">
        SUBMISSIONS STARTING IN
      </p>
      <div className="font-mono text-3xl font-bold tracking-widest text-rdb-orange tabular-nums">
        00:{String(secs % 60).padStart(2, '0')}
      </div>
    </div>
  );
}

function SoloInstructionsCard({ challenge }) {
  if (!challenge) return null;
  const allowRestrictions = challenge.allowRestrictions !== false;
  return (
    <div className="rdb-panel p-4 space-y-3">
      <div className="rounded-lg border border-rdb-orange/30 bg-rdb-orange/5 p-3">
        <p className="font-mono text-[10px] uppercase text-rdb-orange mb-1">INSTRUCTIONS</p>
        <p className="font-mono text-xs uppercase text-rdb-text leading-relaxed">
          MAKE A {challenge.instructionGenre || 'TRAP'} BEAT FROM THIS SAMPLE
        </p>
      </div>
      {allowRestrictions && challenge.restrictionsList && (
        <div className="rounded-lg border border-rdb-red/30 bg-rdb-red/5 p-3">
          <p className="font-mono text-[10px] uppercase text-rdb-red mb-1">RESTRICTIONS</p>
          <p className="font-mono text-xs uppercase text-rdb-text leading-relaxed">
            {challenge.restrictionsList}
          </p>
        </div>
      )}
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
  const { battle, submissions, room, members, messages, loading, refresh, refreshRoomData, refreshSubmissions } =
    useBattle(id);

  const [ratings, setRatings]       = useState({});
  const [paid, setPaid]             = useState(false);
  const [messageBody, setMessageBody] = useState('');
  const QUICK_EMOJIS = ['🔥', '🎵', '💯', '🎤', '🏆'];
  const [isStarting, setIsStarting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [leavingRoom, setLeavingRoom] = useState(false);
  const [showDeleteRoomModal, setShowDeleteRoomModal] = useState(false);
  const [showEarlyLeaveModal, setShowEarlyLeaveModal] = useState(false);
  const [showRankUpModal, setShowRankUpModal] = useState(false);
  const [rankUpXpGain, setRankUpXpGain] = useState(0);
  const [rankUpOldXp, setRankUpOldXp] = useState(0);
  const [rankUpNewXp, setRankUpNewXp] = useState(0);
  const [rankUpOldLevel, setRankUpOldLevel] = useState(1);
  const [rankUpNewLevel, setRankUpNewLevel] = useState(1);
  const [countdown, setCountdown] = useState(null);
  const [lobbyTransitioning, setLobbyTransitioning] = useState(false);
  const [showGoHome, setShowGoHome] = useState(false);
  const [challengeRevealed, setChallengeRevealed] = useState(false);
  const chatEndRef = useRef(null);
  const seenMsgIds = useRef(new Set());
  const selfLeaving = useRef(false);
  const lastChatSentAt = useRef(0);

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
        devLog(`%c[${new Date().toISOString().slice(11, 23)}] [BATTLE] PHASE → ${newPhase}`, 'color:#a855f7', { battle: b?.status, room: r?.status });
        if (newPhase === 'active') {
          playUiSound('phase_change');
          sendBrowserNotification('MATCH STARTED', { body: 'Submissions are now open! Go make your beat.', tag: 'battle-active', onClick: () => window.focus() });
        }
        if (newPhase === 'voting') {
          playUiSound('phase_change');
          sendBrowserNotification('VOTING STARTED', { body: 'Time to vote! Listen and rate the beats.', tag: 'battle-voting', onClick: () => window.focus() });
        }
        if (newPhase === 'closed') {
          sendBrowserNotification('VOTING ENDED', { body: 'The battle is over! Check the results.', tag: 'battle-closed', onClick: () => window.focus() });
        }
      },
    });

  useEffect(() => {
    if (phase === 'closed') {
      devLog('[Battle] STATE MACHINE — phase:', phase, { battleStatus: battle?.status, roomStatus: room?.status });
    }
  }, [phase, battle?.status, room?.status]);

  useEffect(() => {
    if (phase !== 'upcoming') setChallengeRevealed(false);
  }, [phase]);

  // Browser notification: match almost ended (60s warning)
  const matchEndWarned = useRef(false);
  useEffect(() => {
    if (!battle || (phase !== 'active' && phase !== 'voting')) { matchEndWarned.current = false; return; }
    const target = phase === 'active' ? battle.voting_ends_at : null;
    if (!target) return;
    const interval = setInterval(() => {
      const remaining = new Date(target).getTime() - Date.now();
      if (remaining <= 60_000 && remaining > 0 && !matchEndWarned.current) {
        matchEndWarned.current = true;
        sendBrowserNotification('MATCH ALMOST ENDED', { body: 'Less than 1 minute remaining!', tag: 'battle-ending', onClick: () => window.focus() });
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [phase, battle?.voting_ends_at]);

  // Browser notification: room message received from someone else
  const lastNotifiedMsgRef = useRef(null);
  useEffect(() => {
    if (!messages?.length || !profile) return;
    const last = messages[messages.length - 1];
    if (!last || last.user_id === profile.id) return;
    if (last.id === lastNotifiedMsgRef.current) return;
    lastNotifiedMsgRef.current = last.id;
    const senderName = last.profiles?.username || 'Someone';
    sendBrowserNotification(senderName, { body: last.body?.slice(0, 120) || 'sent a message', tag: 'room-msg', onClick: () => window.focus() });
  }, [messages]);

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
      setPaid(Boolean(tx));
    }
    loadRatingsAndPaid();
  }, [profile?.id, id]);

  // ── Auto-scroll chat ──────────────────────────────────────────────────────

  // ── Room events (kick, close, etc.) ─────────────────────────────────────
  useRoomEvents(room?.id, {
    profileId: profile?.id,
    onEvent: (event) => {
      devLog(`[RoomEvent] ${event.event_type}`, event.payload);
    },
    onKick: (event) => {
      addToast('YOU HAVE BEEN KICKED BY THE OWNER', 'error');
    },
    onCloseRoom: () => {
      addToast('ROOM CLOSED BY OWNER', 'error');
    },
  });

  // ── Leave cleanup on tab close (ranked rooms only — custom rooms auto-rejoin) ─
  useEffect(() => {
    if (!profile || !room) return;

    const doLeave = async () => {
      if (selfLeaving.current) return;
      if (room.mode !== 'ranked') return;
      if (phase === 'closed') return;
      selfLeaving.current = true;

      // Use sendBeacon for reliable delivery during page unload
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const body = JSON.stringify({
          roomId: room.id,
          eventType: 'player_leave',
          payload: { isRanked: true, battleId: room.battle_id || '' },
        });
        navigator.sendBeacon(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/room-events`,
          new Blob([body], { type: 'application/json' })
        );
        // Also set Authorization via header trick — sendBeacon doesn't support custom headers
        // So we fall back to a quick fetch with keepalive
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/room-events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Best-effort on page unload
      }
    };

    window.addEventListener('beforeunload', doLeave);
    return () => window.removeEventListener('beforeunload', doLeave);
  }, [profile?.id, room?.id, room?.status]);

  // ── Lobby countdown ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!room?.countdown_started_at || phase !== 'lobby') {
      setCountdown(null);
      setLobbyTransitioning(false);
      return;
    }
    devLog(`%c[${new Date().toISOString().slice(11, 23)}] [BATTLE] LOBBY-COUNTDOWN started`, 'color:#a855f7');
    const target = new Date(room.countdown_started_at).getTime() + 5000;
    let raf;
    function tick() {
      const remaining = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setCountdown(remaining > 0 ? remaining : null);
      if (remaining <= 0) setLobbyTransitioning(true);
      if (remaining > 0) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [room?.countdown_started_at, phase]);

  // ── Redirect home when room and battle are both deleted ─────────────────
  useEffect(() => {
    if (!loading && !room && !battle) {
      navigate('/', { replace: true });
    }
  }, [loading, room, battle]);

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
  const soloAiRetries = useRef(0);
  const isFreeMode = soloDifficulty === 'free' || room?.challenge?.freeMode === true;
  useEffect(() => {
    if (!isSolo || phase !== 'upcoming' || !room?.id || soloAiFired.current) return;
    if (room?.challenge?.restrictionsList) return;
    if (!battle?.id) return;
    soloAiFired.current = true;

    async function tryGenerate() {
      const { buildChallenge, buildSamplePayload } = await import('../lib/challengeService');

      if (isFreeMode) {
        const data = await buildChallenge('trap');
        const sample = data.sample || data;
        const payload = buildSamplePayload(sample);
        payload.instructions = '';
        payload.restrictionsList = '';
        await supabase.from('rooms').update({ challenge: payload }).eq('id', room.id);
        const durationMs = (battle.duration_minutes || 30) * 60 * 1000;
        const starts = new Date();
        const votingEnds = new Date(starts.getTime() + durationMs);
        await supabase.from('battles').update({
          title: 'FREE PLAY',
          prompt_text: '',
          genre: 'trap',
          bpm: sample.bpm,
          restrictions: '',
          status: 'active',
          starts_at: starts.toISOString(),
          voting_ends_at: votingEnds.toISOString(),
        }).eq('id', room.battle_id);
        return;
      }

      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const { generateSoloChallenge } = await import('../lib/roomService');
          await generateSoloChallenge(room.id, soloDifficulty);
          return;
        } catch (err) {
          devError(`[Solo] AI generation attempt ${attempt + 1} failed:`, err);
          if (attempt < MAX_RETRIES - 1) {
            soloAiRetries.current = attempt + 2;
            addToast(`AI RETRY ${attempt + 2}/${MAX_RETRIES}...`);
            await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          }
        }
      }
      // All retries failed — write a basic fallback challenge
      addToast('AI UNAVAILABLE — USING BASIC CHALLENGE');
      const data = await buildChallenge('trap');
      const sample = data.sample || data;
      const payload = buildSamplePayload(sample);
      payload.instructions = `Make a trap beat that matches the vibe of "${sample.title}".`;
      payload.restrictionsList = '';
      await supabase.from('rooms').update({ challenge: payload }).eq('id', room.id);
      const starts = new Date();
      const votingEnds = new Date(starts.getTime() + 35 * 60 * 1000);
      await supabase.from('battles').update({
        title: `TRAP PRACTICE`,
        prompt_text: payload.instructions,
        genre: 'trap',
        bpm: sample.bpm,
        restrictions: '',
        status: 'upcoming',
        starts_at: starts.toISOString(),
        voting_ends_at: votingEnds.toISOString(),
      }).eq('id', room.battle_id);
    }
    tryGenerate();
  }, [isSolo, phase, room?.id, room?.challenge?.restrictionsList, soloDifficulty, battle?.id]);

  // ── Detect win/loss when battle closes ────────────────────────────────────
  const wasClosed = useRef(false);
  const oldXpRef = useRef(profile?.xp ?? 0);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);

  // Keep oldXpRef in sync with profile XP (captures pre-battle XP for delta calc)
  useEffect(() => {
    if (profile?.xp !== undefined && !wasClosed.current) {
      oldXpRef.current = profile.xp;
    }
  }, [profile?.xp]);

  useEffect(() => {
    if (loading || !profile) return;
    if (phase === 'closed' && !wasClosed.current) {
      wasClosed.current = true;
      devLog('[Battle] BATTLE CLOSED', { winnerId: battle?.winner_id, myId: profile.id, isRanked, isSolo });

      // Refresh submissions in React state if empty
      if (!submissions.length && battle?.id) refreshSubmissions();

      async function checkAndShowModal() {
        // Submissions may not be loaded yet — fetch directly
        let subs = submissions;
        if (!subs.length && battle?.id) {
          const { data } = await supabase
            .from('submissions')
            .select('user_id, rating_total')
            .eq('battle_id', battle.id);
          subs = data || [];
        }

        const isWinner = battle?.winner_id === profile.id;
        const sorted = subs.length > 0
          ? [...subs].sort((a, b) => (b.rating_total ?? 0) - (a.rating_total ?? 0))
          : [];
        const myRank = sorted.findIndex(s => s.user_id === profile.id) + 1;
        const hasSubmitted = subs.some(s => s.user_id === profile.id);
        const showWin = isWinner || hasSubmitted;

        if (showWin) {
          devLog('[Battle] XP MODAL', { rank: myRank || 1, hasSubmitted });

          async function fetchXpWithRetry(attempts = 0) {
            const { data } = await supabase.from('profiles').select('xp, level').eq('id', profile.id).maybeSingle();
            const newXpVal = data?.xp ?? oldXpRef.current;
            const gain = newXpVal - oldXpRef.current;
            if (gain === 0 && attempts < 3) {
              await new Promise(r => setTimeout(r, 800));
              return fetchXpWithRetry(attempts + 1);
            }
            const oldLevel = profile.level || 1;
            const newLevel = data?.level || 1;
            setRankUpXpGain(gain || 5);
            setRankUpOldXp(oldXpRef.current);
            setRankUpNewXp(newXpVal);
            setRankUpOldLevel(oldLevel);
            setRankUpNewLevel(newLevel);
            playUiSound('win');
            setShowRankUpModal(true);
            refreshProfile();
          }
          fetchXpWithRetry();
          return;
        }

        if (isRanked && battle?.winner_id && battle.winner_id !== profile.id) {
          devLog('[Battle] LOSS DETECTED', { winnerId: battle.winner_id });
          playUiSound('forfeit');
          addToast('BATTLE LOST', 'error');
          refreshProfile();
        }
      }
      checkAndShowModal();
    }
  }, [phase, loading, profile?.id]);

  // ── Show "go home" card 30s after battle closes ─────────────────────────
  useEffect(() => {
    if (phase !== 'closed') { setShowGoHome(false); return; }
    const timer = setTimeout(() => setShowGoHome(true), 30000);
    return () => clearTimeout(timer);
  }, [phase]);

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
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  async function sendRoomMessage() {
    if (!profile || !room || !messageBody.trim()) return;
    // Rate limit: 1 message per second
    const now = Date.now();
    if (now - lastChatSentAt.current < 1000) return;
    lastChatSentAt.current = now;
    playUiSound('chat');
    const body = censorProfanity(messageBody.trim().slice(0, 500));
    setMessageBody('');
    try {
      const { data: roomCheck } = await supabase.from('rooms').select('id').eq('id', room.id).maybeSingle();
      if (!roomCheck) return;
      const { error } = await supabase
        .from('room_messages')
        .insert({ room_id: room.id, user_id: profile.id, body });
      if (error) throw error;
    } catch (err) {
      addToast(err.message || 'MESSAGE FAILED', 'error');
    }
  }

  // ── Owner Actions ────────────────────────────────────────────────────────
  async function handleForceStart() {
    if (isStarting) return;
    playUiSound('click');
    devLog('[Battle] FORCE START', { roomId: room?.id, battleId: battle?.id, isOwner });
    setIsStarting(true);
    try {
      await forceStart();
      devLog('[Battle] FORCE START SUCCESS');
      await Promise.all([refresh(), refreshRoomData()]);
      addToast('BATTLE STARTED');
    } catch (err) {
      devError('[Battle] FORCE START FAILED:', err);
      addToast(err.message || 'START FAILED', 'error');
    } finally {
      setIsStarting(false);
    }
  }

  async function handleStartSolo() {
    if (isStarting || !battle?.id) return;
    playUiSound('click');
    setIsStarting(true);
    try {
      const durationMin = soloDifficulty === 'free'
        ? (battle.duration_minutes || roomSetup?.freeTimer || 30)
        : getSoloDurationMinutes(soloDifficulty);
      await startSoloSession(battle.id, durationMin);
      await forceStart();
      addToast('SESSION STARTED');
    } catch (err) {
      devError('[Battle] SOLO START FAILED:', err);
      addToast(err.message || 'START FAILED', 'error');
    } finally {
      setIsStarting(false);
    }
  }

  async function handleForceClose() {
    if (isClosing) return;
    playUiSound('cancel');
    devLog('[Battle] FORCE CLOSE', { roomId: room?.id, battleId: battle?.id });
    setIsClosing(true);
    try {
      await forceClose();
      devLog('[Battle] FORCE CLOSE SUCCESS');
      await Promise.all([refresh(), refreshRoomData()]);
      addToast('BATTLE CLOSED');
    } catch (err) {
      devError('[Battle] FORCE CLOSE FAILED:', err);
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
    if (phase === 'closed' || battle?.status === 'closed') {
      await supabase.from('room_members').delete().eq('room_id', room.id).eq('user_id', profile.id);
      const { count } = await supabase.from('room_members').select('room_id', { count: 'exact', head: true }).eq('room_id', room.id);
      await supabase.from('rooms').update({ current_players: count ?? 0 }).eq('id', room.id);
      window.__clearReturnTo?.();
      navigate('/', { replace: true });
      return;
    }
    selfLeaving.current = true;
    setLeavingRoom(true);
    setShowDeleteRoomModal(false);
    setShowEarlyLeaveModal(false);
    if (battle?.id) markBattleLeaving(battle.id);
    devLog('[Battle] EXECUTE LEAVE', { roomId: room.id, battleId: battle?.id, deleteRoom, isRanked: room.mode === 'ranked' });
    try {
      const isRanked = room.mode === 'ranked';
      const isOwner = room.owner_id === profile.id;

      // Owner leaving a custom room — dispatch owner_leave event (server handles cleanup)
      if (isOwner && !isRanked) {
        await dispatchRoomEvent({
          roomId: room.id,
          eventType: 'owner_leave',
          payload: { battleId: battle?.id },
        });
        window.__clearReturnTo?.();
        navigate('/', { replace: true });
        return;
      }

      // Signal to advanceToClosed that this is a forfeit (not auto-close)
      if (isRanked && battle?.id) {
        await supabase.from('battles').update({ early_closed: true }).eq('id', battle.id).eq('early_closed', false);
      }

      // Dispatch player_leave event — server handles member removal, submission/vote cleanup,
      // rating recompute, owner transfer, and room closure atomically
      await dispatchRoomEvent({
        roomId: room.id,
        eventType: 'player_leave',
        payload: { isRanked, battleId: room.battle_id || '' },
      });

      window.__clearReturnTo?.();

      if (deleteRoom) {
        addToast('ROOM DELETED');
      } else if (isRanked) {
        addToast('LEFT MATCH');
      } else {
        addToast('LEFT ROOM');
      }
      if (isRanked) refreshProfile();
      navigate('/', { replace: true });
    } catch (err) {
      addToast(err.message || 'COULD NOT LEAVE ROOM', 'error');
    } finally {
      if (battle?.id) clearBattleLeaving(battle.id);
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
    <main className="rdb-container-admin grid min-h-[calc(100vh-88px)] place-items-center py-6">
      <div className="mx-auto w-full max-w-4xl space-y-3">
        {phase === 'upcoming' ? (
          room?.challenge ? (
            isFreeMode ? (
              <div className="rdb-panel p-8 text-center">
                <Spinner label="LOADING SAMPLE" />
              </div>
            ) : (
            <div className="space-y-3">
              <SampleCard challenge={room.challenge} phase={phase} room={room} />
              <div className="rdb-panel flex flex-col items-center gap-4 p-6 text-center">
                <p className="font-mono text-[11px] uppercase text-rdb-muted">
                  READY TO GO?
                </p>
                <button
                  className="rdb-button rdb-button-primary w-48"
                  type="button"
                  disabled={isStarting}
                  onClick={handleStartSolo}
                >
                  {isStarting ? 'STARTING...' : 'START SESSION'}
                </button>
                <button
                  className="rdb-button border-rdb-red text-rdb-red w-full"
                  type="button"
                  disabled={leavingRoom}
                  onClick={leaveRoom}
                >
                  {leavingRoom ? 'LEAVING...' : 'LEAVE'}
                </button>
              </div>
            </div>
            )
          ) : (
            <div className="rdb-panel p-8 text-center">
              <Spinner label="GENERATING CHALLENGE" />
              <p className="mt-3 font-mono text-[10px] uppercase text-rdb-muted">
                Preparing your session...
              </p>
            </div>
          )
        ) : phase === 'closed' ? (
          <div className="rdb-panel flex flex-col items-center gap-4 p-8 text-center">
            <div className="font-mono text-xl font-bold uppercase text-rdb-orange">SESSION ENDED</div>
            <p className="font-mono text-[11px] uppercase text-rdb-muted">Great run. Time to head back.</p>
            <button
              className="rdb-button rdb-button-primary w-48"
              type="button"
              onClick={() => navigate('/')}
            >
              GO HOME
            </button>
            <button
              className="rdb-button border-rdb-red text-rdb-red w-48"
              type="button"
              disabled={leavingRoom}
              onClick={leaveRoom}
            >
              {leavingRoom ? 'LEAVING...' : 'LEAVE'}
            </button>
          </div>
        ) : room?.challenge && phase === 'active' ? (
          <div className="grid gap-3 md:grid-cols-[1fr_320px]">
            {/* ── Left: Sample card ── */}
            <div className="space-y-3">
              <SampleCard challenge={room.challenge} phase={phase} room={room} hideDetails />
              {isFreeMode && (
                <button
                  className="rdb-button w-full"
                  type="button"
                  onClick={async () => {
                    const { buildChallenge, buildSamplePayload } = await import('../lib/challengeService');
                    const data = await buildChallenge('trap');
                    const sample = data.sample || data;
                    const payload = buildSamplePayload(sample);
                    payload.instructions = '';
                    payload.restrictionsList = '';
                    await supabase.from('rooms').update({ challenge: payload }).eq('id', room.id);
                    if (room.battle_id) {
                      const durationMin = isSolo
                        ? (soloDifficulty === 'free' ? (battle.duration_minutes || 30) : getSoloDurationMinutes(soloDifficulty))
                        : (room.challenge?.battleMinutes || 30);
                      const now = new Date();
                      await supabase.from('battles').update({
                        title: 'FREE PLAY',
                        genre: 'trap',
                        bpm: sample.bpm,
                        starts_at: now.toISOString(),
                        voting_ends_at: new Date(now.getTime() + durationMin * 60 * 1000).toISOString(),
                      }).eq('id', room.battle_id);
                    }
                  }}
                >
                  NEW SAMPLE
                </button>
              )}
            </div>

            {/* ── Right: Timer + instructions ── */}
            <div className="flex flex-col gap-3">
              <div className="rdb-panel flex flex-col items-center justify-center gap-5 p-6 text-center">
                <SoloTimer target={battle.voting_ends_at || battle.ends_at} />
                <button
                  className="rdb-button border-rdb-red text-rdb-red w-full"
                  type="button"
                  disabled={leavingRoom}
                  onClick={leaveRoom}
                >
                  {leavingRoom ? 'LEAVING...' : 'LEAVE'}
                </button>
              </div>
              {!isFreeMode && <SoloInstructionsCard challenge={room.challenge} />}
            </div>
          </div>
        ) : phase === 'active' ? (
          <div className="rdb-panel p-8 text-center">
            <Spinner label="GENERATING CHALLENGE" />
            <p className="mt-3 font-mono text-[10px] uppercase text-rdb-muted">
              Preparing your session...
            </p>
          </div>
        ) : phase === 'voting' ? (
          <></>
        ) : isFreeMode ? (
          <></>
        ) : (
          <BattlePrompt battle={battle} />
        )}
      </div>
    </main>
  ) : phase === 'lobby' && !isSolo ? (
    <main className="rdb-container-admin grid min-h-[calc(100vh-88px)] place-items-center py-12">
      <div className="mx-auto w-full max-w-4xl space-y-5 lg:grid lg:grid-cols-[1fr_260px] lg:gap-5 lg:space-y-0">

        {/* ── Room header (spans both columns) ── */}
        <div className="text-center lg:col-span-2">
          <h1 className="font-mono text-2xl font-bold uppercase text-rdb-text">
            {room?.name || 'BATTLE LOBBY'}
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase text-rdb-muted">
            LOBBY — {members.length}/{room?.max_players || 4} PLAYERS
          </p>
        </div>

        {/* ── Left column: lobby content ── */}
        <div className="space-y-5">

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

          {/* ── Loading after countdown ends ── */}
          {lobbyTransitioning && countdown === null && (
            <div className="rdb-panel p-6 text-center">
              <Spinner label="STARTING BATTLE" />
            </div>
          )}

          {/* ── Ready / Start controls ── */}
          {!room?.countdown_started_at && (
          <div className="rdb-panel p-5 flex flex-col items-center gap-3">

            {isOwner && !room?.countdown_started_at && members.length >= 2 && (
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
                onClick={async () => {
                  setLeavingRoom(true);
                  playUiSound('cancel');
                  const isOwnerLeave = room?.owner_id === profile?.id;
                  const payload = { isRanked: room?.mode === 'ranked', battleId: room?.battle_id || '' };
                  try {
                    await dispatchRoomEvent({ roomId: room.id, eventType: isOwnerLeave ? 'owner_leave' : 'player_leave', payload });
                  } catch (err) {
                    devError('[Battle] leave dispatch error:', err);
                  } finally {
                    setLeavingRoom(false);
                  }
                  addToast('LEFT LOBBY');
                  navigate('/', { replace: true });
                }}
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

        {/* ── Right column: room details ── */}
        <div className="space-y-3">
          <div className="rdb-panel p-4">
            <h2 className="font-mono text-[11px] uppercase text-rdb-orange mb-3">ROOM DETAILS</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase text-rdb-muted">SONG LENGTH</span>
                <span className="font-mono text-[11px] uppercase text-rdb-text">{room?.song_length_seconds || 60}s</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase text-rdb-muted">BATTLE TIME</span>
                <span className="font-mono text-[11px] uppercase text-rdb-text">{room?.challenge?.battleMinutes || battle?.duration_minutes || 30}min</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase text-rdb-muted">VOTING</span>
                <span className="font-mono text-[11px] uppercase text-rdb-text">{room?.voting_minutes || 3}min</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase text-rdb-muted">PLAYERS</span>
                <span className="font-mono text-[11px] uppercase text-rdb-text">{members.length}/{room?.max_players || 4}</span>
              </div>
            </div>
          </div>
          <div className="rdb-panel p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase text-rdb-muted">MODE</span>
              <span className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase ${room?.challenge?.freeMode ? 'border-green-400 text-green-400' : 'border-rdb-orange text-rdb-orange'}`}>
                {room?.challenge?.freeMode ? 'FREE' : room?.mode === 'ranked' ? 'RANKED' : 'CUSTOM'}
              </span>
            </div>
          </div>
        </div>

      </div>
    </main>
  ) : (
    <main className="rdb-container-admin">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ══ MAIN COLUMN ═══════════════════════════════════════════════════ */}
        <section key={phase} className="space-y-5 phase-fade">
          {phase === 'upcoming' ? (
            challengeRevealed ? (
              <GetReadyCard startsAt={battle?.starts_at} />
            ) : (
              <ChallengeReveal
                challenge={room?.challenge}
                endsAt={phaseEndsAt ? new Date(phaseEndsAt).toISOString() : battle?.starts_at}
                countdownDuration={5}
                battleId={battle?.id}
                roomId={room?.id}
                roomMode={room?.mode}
                onRevealed={() => setChallengeRevealed(true)}
              />
            )
          ) : phase === 'closed' ? (
            <></>
          ) : room?.challenge && phase === 'active' ? (
            <div className="space-y-3">
              <SampleCard challenge={room.challenge} phase={phase} room={room} />
              {isFreeMode && (
                <button
                  className="rdb-button w-full"
                  type="button"
                  onClick={async () => {
                    const { buildChallenge, buildSamplePayload } = await import('../lib/challengeService');
                    const data = await buildChallenge('trap');
                    const sample = data.sample || data;
                    const payload = buildSamplePayload(sample);
                    payload.instructions = '';
                    payload.restrictionsList = '';
                    await supabase.from('rooms').update({ challenge: payload }).eq('id', room.id);
                    if (room.battle_id) {
                      const durationMin = room.challenge?.battleMinutes || 30;
                      const now = new Date();
                      await supabase.from('battles').update({
                        title: 'FREE PLAY',
                        genre: 'trap',
                        bpm: sample.bpm,
                        starts_at: now.toISOString(),
                        voting_ends_at: new Date(now.getTime() + durationMin * 60 * 1000).toISOString(),
                      }).eq('id', room.battle_id);
                    }
                  }}
                >
                  NEW SAMPLE
                </button>
              )}
            </div>
          ) : phase === 'voting' ? (
            <></>
          ) : isFreeMode ? (
            <></>
          ) : (
            <BattlePrompt battle={battle} />
          )}

          {/* ── Status bar (hidden when closed) ── */}
          {phase !== 'closed' && (
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
          )}

          {/* ── Phase countdown timers ── */}
          {phase === 'upcoming' && isSolo && (
            <PhaseTimer
              label="SESSION STARTS"
              target={battle.starts_at}
            />
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

          {/* ── Voting feed — gated to voting phase, hidden while calculating ── */}
          {isVotingPhase && !calculatingWinner && (
            <div id="voting-feed">
              <VotingFeed
                battle={battle}
                room={room}
                submissions={submissions}
                profile={profile}
                ratings={ratings}
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

          {phase === 'closed' && !isSolo && !showGoHome && (
            <>
              <BattleResults submissions={submissions} currentUserId={profile?.id} />
              <button
                className="rdb-button border-rdb-red text-rdb-red w-full"
                type="button"
                disabled={leavingRoom}
                onClick={leaveRoom}
              >
                {leavingRoom ? 'LEAVING...' : 'LEAVE ROOM'}
              </button>
            </>
          )}

          {phase === 'closed' && !isSolo && showGoHome && (
            <div className="rdb-panel p-8 text-center space-y-4">
              <p className="font-mono text-sm uppercase text-rdb-muted">This battle has ended.</p>
              <p className="font-mono text-[11px] uppercase text-rdb-muted">Time to go home.</p>
              <button
                className="rdb-button rdb-button-primary"
                type="button"
                onClick={async () => {
                  if (profile?.id && room?.id) {
                    await supabase.from('room_members').delete().eq('room_id', room.id).eq('user_id', profile.id);
                    const { count } = await supabase.from('room_members').select('room_id', { count: 'exact', head: true }).eq('room_id', room.id);
                    await supabase.from('rooms').update({ current_players: count ?? 0 }).eq('id', room.id);
                  }
                  navigate('/');
                }}
              >
                GO HOME
              </button>
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
              {isMember && !(isRanked && phase !== 'closed') && (
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

            {isOwner && phase === 'closed' && (
              <button
                className="rdb-button border-rdb-red text-rdb-red mt-3 w-full"
                type="button"
                disabled={leavingRoom}
                onClick={async () => {
                  playUiSound('cancel');
                  if (!confirm('CLOSE THIS ROOM?')) return;
                  setLeavingRoom(true);
                  try {
                    await deleteRoomFn(room.id);
                    addToast('ROOM CLOSED');
                    navigate('/', { replace: true });
                  } catch (err) {
                    addToast(err.message || 'CLOSE FAILED', 'error');
                  } finally {
                    setLeavingRoom(false);
                  }
                }}
              >
                {leavingRoom ? 'CLOSING...' : 'CLOSE ROOM'}
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

            {/* ── Members list (hidden when room is closed — cleanup removes members) ── */}
            {phase !== 'closed' && (
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
                      href={`/profile/${member.user_id}`}
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
            )}
          </section>

          {/* ── Chat panel ── */}
          <section className="rdb-panel p-4">
            <h2 className="rdb-section-title">CHAT</h2>
            <div className="h-56 overflow-y-auto border-y border-rdb-border py-2">
              {messages.map((message) => {
                const isNew = !seenMsgIds.current.has(message.id);
                if (isNew) seenMsgIds.current.add(message.id);
                return (
                <div
                  key={message.id}
                  className={`mb-2 font-mono text-[11px] uppercase text-rdb-muted${isNew ? ' chat-msg-new' : ''}`}
                >
                  <a
                    className={`text-rdb-text hover:underline ${getNameCosmeticClassName(message.profiles)}`}
                    href={`/profile/${message.user_id}`}
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
              );
              })}
              {!messages.length && (
                <div className="font-mono text-[11px] uppercase text-rdb-muted">
                  No chat yet.
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="mt-3">
              <div className="flex gap-2">
                <input
                  className="rdb-input"
                  disabled={!room}
                  placeholder="ROOM MESSAGE"
                  maxLength={500}
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
              <div className="flex gap-2 mt-2">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    className="rounded border border-rdb-border bg-rdb-bg/50 hover:border-rdb-orange hover:bg-rdb-orange/10 px-3 py-1.5 text-lg leading-none cursor-pointer transition"
                    type="button"
                    disabled={!room}
                    onClick={async () => {
                      if (!profile || !room) return;
                      const { data: roomCheck } = await supabase.from('rooms').select('id').eq('id', room.id).maybeSingle();
                      if (!roomCheck) return;
                      await supabase.from('room_messages').insert({ room_id: room.id, user_id: profile.id, body: emoji });
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
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

      <RankUpModal
        open={showRankUpModal}
        xpGain={rankUpXpGain}
        oldXp={rankUpOldXp}
        newXp={rankUpNewXp}
        oldLevel={rankUpOldLevel}
        newLevel={rankUpNewLevel}
        onDone={() => setShowRankUpModal(false)}
      />
    </main>
  );
}