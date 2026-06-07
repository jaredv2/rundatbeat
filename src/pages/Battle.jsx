/**
 * Battle.jsx
 *
 * Changes from original:
 *  – Zero polling. All data via useBattle realtime channel.
 *  – useRoomStateMachine drives all phase transitions server-side (owner)
 *    and client-side (via realtime) — no more scroll-triggered submission checks.
 *  – Vote button is shown inline in the sidebar when phase === 'voting'.
 *    It scrolls to #voting-feed. Members who have already submitted see
 *    a "VOTING IS OPEN" banner instead.
 *  – Solo mode badge + lobby copy is aware of isSolo.
 *  – forceClose exposed so owner can end voting early.
 */

import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import BattlePrompt from '../components/battle/BattlePrompt';
import BattleResults from '../components/battle/BattleResults';
import PremiumGate from '../components/battle/PremiumGate';
import SubmitBeat from '../components/battle/SubmitBeat';
import ConfirmModal from '../components/ui/ConfirmModal';
import WinModal from '../components/ui/WinModal';
import VotingFeed from '../components/voting/VotingFeed';
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
import { DEFAULT_ELO } from '../lib/elo';
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
    upcoming: 'border-yellow-600 text-yellow-400',
    active:   'border-green-600  text-green-400',
    voting:   'border-rdb-orange text-rdb-orange',
    closed:   'border-rdb-border text-rdb-muted',
  };
  const labels = {
    upcoming: 'LOBBY',
    active:   'SUBMITTING',
    voting:   'VOTING',
    closed:   'CLOSED',
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
  const { battle, submissions, room, members, messages, loading, refresh, refreshRoomData } =
    useBattle(id);

  const [votes, setVotes]           = useState({});
  const [paid, setPaid]             = useState(false);
  const [messageBody, setMessageBody] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [leavingRoom, setLeavingRoom] = useState(false);
  const [showDeleteRoomModal, setShowDeleteRoomModal] = useState(false);
  const [showEarlyLeaveModal, setShowEarlyLeaveModal] = useState(false);
  const [showWinModal, setShowWinModal] = useState(false);
  const [winEloGain, setWinEloGain] = useState(null);
  const chatEndRef = useRef(null);

  // ── Room state machine ────────────────────────────────────────────────────
  const { phase, phaseEndsAt, forceStart, forceClose, isOwner, isSolo } =
    useRoomStateMachine({
      battle,
      room,
      profile,
      onStateChange: (nextPhase) => {
        console.log('[Battle] FSM state change →', nextPhase);
        refresh();
      },
    });

  // ── Load existing votes + premium status on mount ─────────────────────────
  useEffect(() => {
    if (!profile || !id || !supabase) return;
    async function loadVoteAndPaid() {
      const [{ data: voteRows }, { data: tx }] = await Promise.all([
        supabase
          .from('votes')
          .select('submission_id, direction')
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
      setVotes(
        Object.fromEntries((voteRows || []).map((r) => [r.submission_id, r.direction || 1])),
      );
      setPaid(Boolean(tx));
    }
    loadVoteAndPaid();
  }, [profile?.id, id]);

  // ── Auto-scroll chat ──────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Redirect when kicked (room_members deleted while on page) ─────────────
  const wasMember = useRef(false);
  useEffect(() => {
    if (loading) return;
    const nowMember = members.some((m) => m.user_id === profile?.id);
    if (!wasMember.current && nowMember) wasMember.current = true;
    if (wasMember.current && !nowMember && profile) {
      addToast('ROOM CLOSED — YOU HAVE BEEN REMOVED');
      navigate('/', { replace: true });
    }
  }, [members, profile?.id, loading]);

  // ── Detect win when battle closes ────────────────────────────────────────
  const wasClosed = useRef(false);
  useEffect(() => {
    if (loading || !profile) return;
    if (phase === 'closed' && !wasClosed.current) {
      wasClosed.current = true;

      if (battle?.winner_id === profile.id) {
        setShowWinModal(true);
        // Compute ELO gain for auto-win
        const leaverId = members.find((m) => m.user_id !== profile.id)?.user_id;
        if (leaverId) {
          supabase
            .from('profiles')
            .select('elo')
            .in('id', [profile.id, leaverId])
            .then(({ data }) => {
              const winElo = (data || []).find((p) => p.id === profile.id)?.elo ?? DEFAULT_ELO;
              const loseElo = (data || []).find((p) => p.id === leaverId)?.elo ?? DEFAULT_ELO;
              const expected = 1 / (1 + Math.pow(10, (loseElo - winElo) / 400));
              setWinEloGain(Math.round(32 * (1 - expected)));
            });
        }
        return;
      }

      if (!isSolo && submissions.length > 0) {
        const sorted = [...submissions].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
        if (sorted[0]?.user_id === profile.id) {
          setShowWinModal(true);
          setWinEloGain(null);
        }
      }
    }
  }, [phase, loading, profile?.id]);

  // ── Re-fetch votes after casting one ─────────────────────────────────────
  async function reloadVotes() {
    if (!profile || !id || !supabase) return;
    const { data } = await supabase
      .from('votes')
      .select('submission_id, direction')
      .eq('battle_id', id)
      .eq('voter_id', profile.id);
    setVotes(Object.fromEntries((data || []).map((r) => [r.submission_id, r.direction || 1])));
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  async function sendRoomMessage() {
    playUiSound('click');
    if (!profile || !room || !messageBody.trim()) return;
    const body = messageBody.trim();
    setMessageBody('');
    try {
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

    const isRanked = room.mode === 'ranked';
    if (isRanked) {
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
    setLeavingRoom(true);
    setShowDeleteRoomModal(false);
    setShowEarlyLeaveModal(false);
    try {
      const isRanked = room.mode === 'ranked';

      await supabase
        .from('room_members')
        .delete()
        .eq('room_id', room.id)
        .eq('user_id', profile.id);

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
          // Auto-win: winner beats leaver (match ELO is the only penalty)
          const winnerId = remaining[0].user_id;

          await Promise.all([
            supabase
              .from('battles')
              .update({ status: 'closed', winner_id: winnerId, early_closed: false })
              .eq('id', battle.id)
              .in('status', ['upcoming', 'active', 'voting']),
            supabase
              .from('rooms')
              .update({ status: 'closed' })
              .eq('id', room.id),
          ]);

          const { data: winnerProfiles } = await supabase
            .from('profiles')
            .select('id, elo, wins, ranked_wins, ranked_losses, battles_entered')
            .in('id', [winnerId, profile.id]);

          const winnerProf = (winnerProfiles || []).find((p) => p.id === winnerId);
          const loseElo = leaverProfile?.elo ?? DEFAULT_ELO;
          const winElo = winnerProf?.elo ?? DEFAULT_ELO;
          const expected = 1 / (1 + Math.pow(10, (loseElo - winElo) / 400));
          const newWinnerElo = Math.round(winElo + 32 * (1 - expected));
          const newLoserElo = Math.round(loseElo + 32 * (0 - (1 - expected)));

          await Promise.all([
            supabase.from('profiles').update({
              elo: newWinnerElo,
              wins: (winnerProf?.wins || 0) + 1,
              battles_entered: (winnerProf?.battles_entered || 0) + 1,
              ranked_wins: (winnerProf?.ranked_wins || 0) + 1,
            }).eq('id', winnerId),
            supabase.from('profiles').update({
              elo: newLoserElo,
              wins: leaverProfile?.wins || 0,
              battles_entered: (leaverProfile?.battles_entered || 0) + 1,
              ranked_losses: (leaverProfile?.ranked_losses || 0) + 1,
            }).eq('id', profile.id),
          ]);
        } else {
          // Non-auto-win: apply -50 early leave penalty
          const currentElo = leaverProfile?.elo ?? DEFAULT_ELO;
          await supabase
            .from('profiles')
            .update({ elo: Math.max(0, currentElo - 50) })
            .eq('id', profile.id);
        }
      }

      if (deleteRoom) {
        await supabase
          .from('rooms')
          .update({ status: 'closed' })
          .eq('id', room.id);
        await supabase
          .from('room_members')
          .delete()
          .eq('room_id', room.id);
        addToast('ROOM CLOSED');
      } else {
        addToast(isRanked ? 'LEFT RANKED MATCH — EARLY LEAVE PENALTY APPLIED' : 'LEFT ROOM');
      }
      navigate('/', { replace: true });
    } catch (err) {
      addToast(err.message || 'COULD NOT LEAVE ROOM', 'error');
    } finally {
      setLeavingRoom(false);
    }
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!profile) return <Navigate to="/login" replace />;
  if (loading)  return <main className="rdb-container font-mono text-rdb-orange blink">LOADING...</main>;
  if (!battle)  return <main className="rdb-container font-mono text-rdb-red">BATTLE NOT FOUND</main>;

  const mine          = submissions.find((s) => s.user_id === profile.id);
  const premiumLocked = battle.is_premium && !paid;
  const canSubmit     = phase === 'active';
  const isMember      = members.some((m) => m.user_id === profile.id);
  const songSeconds   = room?.song_length_seconds || battle.song_length_seconds || null;
  const isVotingPhase = phase === 'voting';

  const statusLabel = {
    upcoming: isSolo ? 'SOLO LOBBY' : 'LOBBY — WAITING',
    active:   'SUBMISSIONS OPEN',
    voting:   'VOTING OPEN',
    closed:   'CLOSED',
  }[phase] || phase?.toUpperCase();

  return (
    <main className="rdb-container-admin">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">

        {/* ══ MAIN COLUMN ═══════════════════════════════════════════════════ */}
        <section className="space-y-5">
          <BattlePrompt battle={battle} />

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
                {formatNumber(submissions.length)} SUBMITTED
              </span>
            </div>
          </div>

          {/* ── Phase countdown timers ── */}
          {phase === 'upcoming' && phaseEndsAt && !isSolo && (
            <PhaseTimer
              label="BATTLE STARTS"
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

          {/* ── Owner controls ── */}
          {isOwner && phase === 'upcoming' && (
            <div className="rdb-panel p-4 flex flex-wrap items-center justify-between gap-3">
              <span className="font-mono text-[11px] uppercase text-rdb-muted">
                {isSolo
                  ? 'SOLO SESSION — READY TO START?'
                  : `${members.length}/${room?.max_players || 4} PLAYERS — FORCE START AVAILABLE`}
              </span>
              <button
                className="rdb-button rdb-button-primary"
                type="button"
                disabled={isStarting}
                onClick={handleForceStart}
              >
                {isStarting ? 'STARTING...' : 'START NOW'}
              </button>
            </div>
          )}
          {isOwner && phase === 'voting' && (
            <div className="rdb-panel p-3 flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] uppercase text-rdb-muted">
                OWNER — END VOTING EARLY
              </span>
              <button
                className="rdb-button border-rdb-red text-rdb-red"
                type="button"
                disabled={isClosing}
                onClick={handleForceClose}
              >
                {isClosing ? 'CLOSING...' : 'CLOSE BATTLE'}
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
                submissions={submissions}
                profile={profile}
                votes={votes}
                onVoted={async () => {
                  await reloadVotes();
                }}
              />
            </div>
          )}

          {/* ── Final results (hidden for solo — no voting) ── */}
          {phase === 'closed' && !isSolo && <BattleResults submissions={submissions} />}

          {/* ── Your submission preview (hidden during voting) ── */}
          {mine && phase !== 'voting' && (
            <div className="rdb-panel p-5">
              <h2 className="font-mono text-[13px] uppercase text-rdb-orange">
                YOUR SUBMISSION
              </h2>
              <div className="mt-3">
                <WaveformPlayer url={mine.audio_url} profile={profile} />
              </div>
            </div>
          )}

          {/* ── All submissions — hidden during voting (blind voting) ── */}
          {phase !== 'voting' && (
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
                          {formatNumber(sub.vote_count ?? 0)} VOTES
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
            {room?.code_only && room?.join_code && (
              <button
                className="mt-2 flex items-center gap-1.5 font-mono text-[11px] uppercase text-rdb-orange hover:underline"
                onClick={() => {
                  playUiSound('click');
                  navigator.clipboard.writeText(room.join_code);
                  addToast('ROOM CODE COPIED');
                }}
              >
                <Copy size={12} />
                CODE: {room.join_code}
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
          <p>Leaving a ranked match early will cost you <span className="text-rdb-red font-bold">-50 ELO</span>.</p>
          <p className="text-[11px] text-rdb-orange">
            {members.filter((m) => m.user_id !== profile?.id).length === 1
              ? 'You are the last to leave — the remaining player will auto-win.'
              : 'Your spot will not be filled.'}
          </p>
        </div>
      </ConfirmModal>

      <WinModal
        open={showWinModal}
        eloChange={winEloGain}
        onPlayAgain={() => navigate('/', { replace: true })}
        onClose={() => setShowWinModal(false)}
      />
    </main>
  );
}