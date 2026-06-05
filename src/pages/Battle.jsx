import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import BattlePrompt from '../components/battle/BattlePrompt';
import BattleResults from '../components/battle/BattleResults';
import PremiumGate from '../components/battle/PremiumGate';
import SubmitBeat from '../components/battle/SubmitBeat';
import VotingFeed from '../components/voting/VotingFeed';
import WaveformPlayer from '../components/audio/WaveformPlayer';
import { useBattle } from '../hooks/useBattle';
import { useCountdown } from '../hooks/useCountdown';
import { formatNumber, getNameCosmeticClassName, getNameGradientStyle, getNameplateEmoji } from '../lib/display';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';

// ── Submission countdown banner ─────────────────────────────────────────────
function SubmissionTimer({ battle }) {
  // Use voting_ends_at if available, fall back to ends_at
  const target = battle.voting_ends_at || battle.ends_at;
  const { label, remaining } = useCountdown(target);

  if (!target || battle.status !== 'active') return null;

  const urgent = remaining < 5 * 60 * 1000; // < 5 min = red
  console.log('[SubmissionTimer] remaining ms:', remaining, 'label:', label);

  return (
    <div className={`rdb-panel flex items-center justify-between gap-3 p-3 font-mono text-[11px] uppercase ${urgent ? 'border-red-500 text-red-400' : 'text-rdb-muted'}`}>
      <span>{urgent ? '⚠ SUBMISSIONS CLOSING SOON' : 'SUBMISSIONS CLOSE IN'}</span>
      <span className={`text-base font-bold tracking-widest ${urgent ? 'text-red-400' : 'text-rdb-orange'}`}>{label}</span>
    </div>
  );
}

// ── Song-length indicator ────────────────────────────────────────────────────
function SongLengthBadge({ seconds }) {
  if (!seconds) return null;
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, '0');
  return (
    <span className="font-mono text-[10px] uppercase text-rdb-muted">
      MAX LENGTH <span className="text-rdb-text">{mins}:{secs}</span>
    </span>
  );
}

export default function Battle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const { battle, submissions, loading, refresh } = useBattle(id);
  const [votes, setVotes] = useState({});
  const [paid, setPaid] = useState(false);
  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [messageBody, setMessageBody] = useState('');
  const [leavingRoom, setLeavingRoom] = useState(false);
  const chatEndRef = useRef(null);

  // ── Load user's existing vote + premium status ───────────────────────────
  useEffect(() => {
    async function loadVote() {
      if (!profile || !id || !supabase) return;
      console.log('[Battle] Loading votes + premium status for battle:', id);
      const { data } = await supabase.from('votes').select('submission_id, direction').eq('battle_id', id).eq('voter_id', profile.id);
      setVotes(Object.fromEntries((data || []).map((row) => [row.submission_id, row.direction || 1])));
      const { data: tx } = await supabase.from('token_transactions').select('id').eq('battle_id', id).eq('user_id', profile.id).eq('reason', 'premium_entry').maybeSingle();
      setPaid(Boolean(tx));
    }
    loadVote();
  }, [profile, id]);

  // ── Poll room data every 5s ──────────────────────────────────────────────
  useEffect(() => {
    if (!id || !supabase) return undefined;
    loadRoom();
    const timer = window.setInterval(loadRoom, 5000);
    return () => window.clearInterval(timer);
  }, [id]);

  // ── Auto-scroll chat to bottom when new messages arrive ─────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadRoom() {
    if (!supabase) return;
    const { data: roomData } = await supabase.from('rooms').select('*').eq('battle_id', id).maybeSingle();
    setRoom(roomData || null);
    if (!roomData) {
      console.log('[Battle] No room found for battle:', id);
      return;
    }
    console.log('[Battle] Room loaded:', roomData.id, 'status:', roomData.status);

    const [{ data: memberRows }, { data: messageRows }] = await Promise.all([
      supabase.from('room_members')
        .select('role, user_id, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)')
        .eq('room_id', roomData.id)
        .order('joined_at'),
      supabase.from('room_messages')
        .select('*, profiles(username, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon)')
        .eq('room_id', roomData.id)
        .order('created_at', { ascending: true })
        .limit(50),
    ]);
    setMembers(memberRows || []);
    setMessages(messageRows || []);
    console.log('[Battle] Members:', memberRows?.length, 'Messages:', messageRows?.length);
  }

  async function sendRoomMessage() {
    if (!profile || !room || !messageBody.trim()) return;
    const body = messageBody.trim();
    setMessageBody('');
    try {
      const { error } = await supabase.from('room_messages').insert({ room_id: room.id, user_id: profile.id, body });
      if (error) throw error;
      await loadRoom();
    } catch (error) {
      addToast(error.message || 'MESSAGE FAILED', 'error');
    }
  }

  // ── Leave room ───────────────────────────────────────────────────────────
  async function leaveRoom() {
    if (!profile || !room || leavingRoom) return;
    setLeavingRoom(true);
    console.log('[Battle] Leaving room:', room.id, 'user:', profile.id);
    try {
      const { error } = await supabase
        .from('room_members')
        .delete()
        .eq('room_id', room.id)
        .eq('user_id', profile.id);
      if (error) throw error;
      addToast('LEFT ROOM');
      navigate('/', { replace: true });
    } catch (error) {
      console.error('[Battle] Leave room error:', error);
      addToast(error.message || 'COULD NOT LEAVE ROOM', 'error');
    } finally {
      setLeavingRoom(false);
    }
  }

  if (!profile) return <Navigate to="/login" replace />;
  if (loading) return <main className="rdb-container font-mono text-rdb-orange blink">LOADING...</main>;
  if (!battle) return <main className="rdb-container font-mono text-rdb-red">BATTLE NOT FOUND</main>;

  const mine = submissions.find((s) => s.user_id === profile.id);
  const premiumLocked = battle.is_premium && !paid;
  const canSubmit = ['active', 'upcoming'].includes(battle.status);
  const songSeconds = room?.song_length_seconds || battle.song_length_seconds || null;
  const isMember = members.some((m) => m.user_id === profile.id);

  // Friendly battle status label
  const statusLabel = {
    active: 'SUBMISSIONS OPEN',
    upcoming: 'UPCOMING',
    voting: 'VOTING',
    closed: 'CLOSED',
  }[battle.status] || battle.status.toUpperCase();

  return (
    <main className="rdb-container-admin">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">

        {/* ── MAIN COLUMN ── */}
        <section className="space-y-5">
          <BattlePrompt battle={battle} />

          {/* Status bar — removed submission count cap */}
          <div className="rdb-panel flex flex-wrap items-center justify-between gap-3 p-4 font-mono text-[11px] uppercase">
            <span className="text-rdb-muted">
              STATUS: <span className="text-rdb-orange">{statusLabel}</span>
            </span>
            <div className="flex items-center gap-4">
              <SongLengthBadge seconds={songSeconds} />
              <span className="text-rdb-muted">
                {formatNumber(submissions.length)} SUBMITTED
              </span>
            </div>
          </div>

          {/* Countdown timer — only when active */}
          <SubmissionTimer battle={battle} />

          {/* Submit area */}
          {canSubmit && (
            <div id="submit-beat">
              {premiumLocked
                ? <PremiumGate battle={battle} profile={profile} onPaid={() => setPaid(true)} />
                : <SubmitBeat battle={battle} profile={profile} existingSubmission={mine} onSubmitted={refresh} />}
            </div>
          )}

          {/* Voting feed */}
          {battle.status === 'voting' && (
            <VotingFeed
              battle={battle}
              submissions={submissions}
              profile={profile}
              votes={votes}
              onVoted={async () => {
                await refresh();
                const { data } = await supabase
                  .from('votes')
                  .select('submission_id, direction')
                  .eq('battle_id', id)
                  .eq('voter_id', profile.id);
                setVotes(Object.fromEntries((data || []).map((row) => [row.submission_id, row.direction || 1])));
              }}
            />
          )}

          {/* Results */}
          {battle.status === 'closed' && <BattleResults submissions={submissions} />}

          {/* Your submission preview */}
          {mine && (
            <div className="rdb-panel p-5">
              <h2 className="font-mono text-[13px] uppercase text-rdb-orange">YOUR SUBMISSION</h2>
              <div className="mt-3">
                <WaveformPlayer url={mine.audio_url} profile={profile} />
              </div>
            </div>
          )}

          {/* ── ALL SUBMISSIONS — visible to everyone ── */}
          <div className="rdb-panel p-5">
            <h2 className="font-mono text-[13px] uppercase text-rdb-orange mb-3">
              ALL SUBMISSIONS
              <span className="ml-2 text-rdb-muted text-[11px]">({submissions.length})</span>
            </h2>
            {submissions.length === 0 && (
              <p className="font-mono text-[11px] uppercase text-rdb-muted">NO SUBMISSIONS YET.</p>
            )}
            <div className="flex flex-col gap-4">
              {submissions.map((submission) => {
                console.log('[Battle] Rendering submission:', submission.id, submission.profiles?.username);
                const isOwn = submission.user_id === profile.id;
                return (
                  <div
                    key={submission.id}
                    className={`rdb-panel p-4 ${isOwn ? 'border-rdb-orange/40' : ''}`}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <Link
                        className={`font-mono text-sm font-bold uppercase hover:underline ${getNameCosmeticClassName(submission.profiles)}`}
                        to={`/profile/${submission.profiles?.username}`}
                        style={getNameGradientStyle(submission.profiles)}
                      >
                        {submission.profiles?.nameplate_icon && (
                          <span className="mr-1 text-rdb-orange">{getNameplateEmoji(submission.profiles.nameplate_icon)}</span>
                        )}
                        {submission.profiles?.username || 'PRODUCER'}
                        {isOwn && <span className="ml-2 text-[10px] text-rdb-muted">(YOU)</span>}
                      </Link>
                      <span className="font-mono text-[11px] text-rdb-muted">
                        {formatNumber(submission.vote_count ?? 0)} VOTES
                      </span>
                    </div>
                    <WaveformPlayer url={submission.audio_url} profile={submission.profiles} />
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── SIDEBAR ── */}
        <aside className="space-y-4 lg:sticky lg:top-16 lg:self-start">

          {/* ROOM panel */}
          <section className="rdb-panel p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="rdb-section-title">ROOM</h2>
              {/* Leave room button replaces SUBMIT */}
              {isMember && (
                <button
                  className="rdb-button text-rdb-red border-rdb-red"
                  type="button"
                  disabled={leavingRoom}
                  onClick={leaveRoom}
                >
                  {leavingRoom ? 'LEAVING...' : 'LEAVE ROOM'}
                </button>
              )}
            </div>

            {/* Room name + status badge */}
            <div className="flex items-center justify-between gap-2 mt-1">
              <span className="font-mono text-[12px] uppercase text-rdb-text">{room?.name || 'Battle Room'}</span>
              {room && (
                <span className={`font-mono text-[10px] uppercase px-2 py-0.5 border ${
                  room.status === 'open'   ? 'border-green-600 text-green-400' :
                  room.status === 'locked' ? 'border-yellow-600 text-yellow-400' :
                                             'border-rdb-border text-rdb-muted'
                }`}>
                  {room.status?.toUpperCase() || 'UNKNOWN'}
                </span>
              )}
            </div>

            {room && (
              <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] uppercase text-rdb-muted">
                <SongLengthBadge seconds={songSeconds} />
                <span>{room.code_only ? 'Code Only' : room.is_public === false ? 'Private' : 'Public'}</span>
              </div>
            )}

            {/* Members list */}
            <div className="mt-3 grid gap-2">
              {members.map((member) => (
                <div
                  className="flex items-center justify-between gap-2 rounded border border-rdb-border bg-rdb-bg px-2 py-2"
                  key={member.user_id}
                >
                  <Link
                    className={`min-w-0 truncate font-mono text-[11px] uppercase hover:underline ${getNameCosmeticClassName(member.profiles)}`}
                    to={`/profile/${member.profiles?.username}`}
                    style={getNameGradientStyle(member.profiles)}
                  >
                    {member.profiles?.nameplate_icon && (
                      <span className="mr-1 text-rdb-orange">{getNameplateEmoji(member.profiles.nameplate_icon)}</span>
                    )}
                    {member.profiles?.username || 'USER'}
                  </Link>
                  <span className="font-mono text-[10px] uppercase text-rdb-muted">{member.role}</span>
                </div>
              ))}
              {!members.length && (
                <div className="rounded border border-rdb-border bg-rdb-bg p-3 font-mono text-[11px] uppercase text-rdb-muted">
                  No room members loaded.
                </div>
              )}
            </div>
          </section>

          {/* CHAT panel */}
          <section className="rdb-panel p-4">
            <h2 className="rdb-section-title">CHAT</h2>
            <div className="h-56 overflow-y-auto border-y border-rdb-border py-2">
              {messages.map((message) => (
                <div className="mb-2 font-mono text-[11px] uppercase text-rdb-muted" key={message.id}>
                  <Link
                    className={`text-rdb-text hover:underline ${getNameCosmeticClassName(message.profiles)}`}
                    to={`/profile/${message.profiles?.username}`}
                    style={getNameGradientStyle(message.profiles)}
                  >
                    {message.profiles?.nameplate_icon && (
                      <span className="mr-1 text-rdb-orange">{getNameplateEmoji(message.profiles.nameplate_icon)}</span>
                    )}
                    {message.profiles?.username || 'USER'}:
                  </Link>{' '}
                  {message.body}
                </div>
              ))}
              {!messages.length && (
                <div className="font-mono text-[11px] uppercase text-rdb-muted">No chat yet.</div>
              )}
              {/* Anchor for auto-scroll */}
              <div ref={chatEndRef} />
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className="rdb-input"
                disabled={!room}
                placeholder="ROOM MESSAGE"
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendRoomMessage(); }}
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
    </main>
  );
}