import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import BattlePrompt from '../components/battle/BattlePrompt';
import BattleResults from '../components/battle/BattleResults';
import PremiumGate from '../components/battle/PremiumGate';
import SubmitBeat from '../components/battle/SubmitBeat';
import VotingFeed from '../components/voting/VotingFeed';
import WaveformPlayer from '../components/audio/WaveformPlayer';
import { useBattle } from '../hooks/useBattle';
import { formatNumber, getNameCosmeticClassName, getNameGradientStyle, getNameplateEmoji } from '../lib/display';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';

export default function Battle() {
  const { id } = useParams();
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const { battle, submissions, loading, refresh } = useBattle(id);
  const [votes, setVotes] = useState({});
  const [paid, setPaid] = useState(false);
  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [messageBody, setMessageBody] = useState('');

  useEffect(() => {
    async function loadVote() {
      if (!profile || !id || !supabase) return;
      const { data } = await supabase.from('votes').select('submission_id, direction').eq('battle_id', id).eq('voter_id', profile.id);
      setVotes(Object.fromEntries((data || []).map((row) => [row.submission_id, row.direction || 1])));
      const { data: tx } = await supabase.from('token_transactions').select('id').eq('battle_id', id).eq('user_id', profile.id).eq('reason', 'premium_entry').maybeSingle();
      setPaid(Boolean(tx));
    }
    loadVote();
  }, [profile, id]);

  useEffect(() => {
    if (!id || !supabase) return undefined;
    loadRoom();
    const timer = window.setInterval(loadRoom, 7000);
    return () => window.clearInterval(timer);
  }, [id]);

  async function loadRoom() {
    const { data: roomData } = await supabase.from('rooms').select('*').eq('battle_id', id).maybeSingle();
    setRoom(roomData || null);
    if (!roomData) return;

    const [{ data: memberRows }, { data: messageRows }] = await Promise.all([
      supabase.from('room_members').select('role, user_id, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)').eq('room_id', roomData.id).order('joined_at'),
      supabase.from('room_messages').select('*, profiles(username, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon)').eq('room_id', roomData.id).order('created_at', { ascending: true }).limit(50),
    ]);
    setMembers(memberRows || []);
    setMessages(messageRows || []);
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

  if (!profile) return <Navigate to="/login" replace />;
  if (loading) return <main className="rdb-container font-mono text-rdb-orange blink">LOADING...</main>;
  if (!battle) return <main className="rdb-container font-mono text-rdb-red">BATTLE NOT FOUND</main>;

  const mine = submissions.find((submission) => submission.user_id === profile.id);
  const premiumLocked = battle.is_premium && !paid;
  const canSubmit = ['active', 'upcoming'].includes(battle.status);

  return (
    <main className="rdb-container-admin">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-5">
          <BattlePrompt battle={battle} />
          <div className="rdb-panel flex flex-wrap items-center justify-between gap-3 p-4 font-mono text-[11px] uppercase">
            <span className="text-rdb-muted">Status: <span className="text-rdb-orange">{canSubmit ? 'Submissions Open' : battle.status}</span></span>
            <span className="text-rdb-muted">{formatNumber(submissions.length)} / {formatNumber(room?.max_players || 4)} submitted</span>
          </div>

          {canSubmit && (
            <div id="submit-beat">
              {premiumLocked ? <PremiumGate battle={battle} profile={profile} onPaid={() => setPaid(true)} /> : <SubmitBeat battle={battle} profile={profile} existingSubmission={mine} onSubmitted={refresh} />}
            </div>
          )}
          {battle.status === 'voting' && <VotingFeed battle={battle} submissions={submissions} profile={profile} votes={votes} onVoted={async () => { await refresh(); const { data } = await supabase.from('votes').select('submission_id, direction').eq('battle_id', id).eq('voter_id', profile.id); setVotes(Object.fromEntries((data || []).map((row) => [row.submission_id, row.direction || 1]))); }} />}
          {battle.status === 'closed' && <BattleResults submissions={submissions} />}

          {mine && (
            <div className="rdb-panel p-5">
              <h2 className="font-mono text-rdb-orange">YOUR SUBMISSION</h2>
              <WaveformPlayer url={mine.audio_url} profile={profile} />
            </div>
          )}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-16 lg:self-start">
          <section className="rdb-panel p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="rdb-section-title">ROOM</h2>
              {canSubmit && !mine && <a className="rdb-button rdb-button-primary" href="#submit-beat">SUBMIT</a>}
            </div>
            <div className="font-mono text-[12px] uppercase text-rdb-text">{room?.name || 'Battle Room'}</div>
            {room && (
              <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px] uppercase text-rdb-muted">
                <span>Song {formatNumber(room.song_length_seconds || battle.song_length_seconds || 60)}s</span>
                <span>{room.code_only ? 'Code Only' : room.is_public === false ? 'Private' : 'Public'}</span>
              </div>
            )}
            <div className="mt-3 grid gap-2">
              {members.map((member) => (
                <div className="flex items-center justify-between gap-2 rounded border border-rdb-border bg-rdb-bg px-2 py-2" key={member.user_id}>
                  <Link className={`min-w-0 truncate font-mono text-[11px] uppercase hover:underline ${getNameCosmeticClassName(member.profiles)}`} to={`/profile/${member.profiles?.username}`} style={getNameGradientStyle(member.profiles)}>
                    {member.profiles?.nameplate_icon && <span className="mr-1 text-rdb-orange">{getNameplateEmoji(member.profiles.nameplate_icon)}</span>}
                    {member.profiles?.username || 'USER'}
                  </Link>
                  <span className="font-mono text-[10px] uppercase text-rdb-muted">{member.role}</span>
                </div>
              ))}
              {!members.length && <div className="rounded border border-rdb-border bg-rdb-bg p-3 font-mono text-[11px] uppercase text-rdb-muted">No room members loaded.</div>}
            </div>
          </section>

          <section className="rdb-panel p-4">
            <h2 className="rdb-section-title">SUBMISSIONS</h2>
            <div className="grid gap-2">
              {submissions.map((submission, index) => (
                <div className="rounded border border-rdb-border bg-rdb-bg p-2" key={submission.id}>
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px] uppercase">
                    <Link className={`hover:underline ${getNameCosmeticClassName(submission.profiles)}`} to={`/profile/${submission.profiles?.username}`} style={getNameGradientStyle(submission.profiles)}>{submission.profiles?.username || `Producer ${index + 1}`}</Link>
                    <span className="text-rdb-muted">{formatNumber(submission.vote_count)} votes</span>
                  </div>
                </div>
              ))}
              {!submissions.length && <div className="rounded border border-rdb-border bg-rdb-bg p-3 font-mono text-[11px] uppercase text-rdb-muted">No submissions yet.</div>}
            </div>
          </section>

          <section className="rdb-panel p-4">
            <h2 className="rdb-section-title">CHAT</h2>
            <div className="h-56 overflow-y-auto border-y border-rdb-border py-2">
              {messages.map((message) => (
                <div className="mb-2 font-mono text-[11px] uppercase text-rdb-muted" key={message.id}>
                  <Link className={`text-rdb-text hover:underline ${getNameCosmeticClassName(message.profiles)}`} to={`/profile/${message.profiles?.username}`} style={getNameGradientStyle(message.profiles)}>
                    {message.profiles?.nameplate_icon && <span className="mr-1 text-rdb-orange">{getNameplateEmoji(message.profiles.nameplate_icon)}</span>}
                    {message.profiles?.username || 'USER'}:
                  </Link> {message.body}
                </div>
              ))}
              {!messages.length && <div className="font-mono text-[11px] uppercase text-rdb-muted">No chat yet.</div>}
            </div>
            <div className="mt-3 flex gap-2">
              <input className="rdb-input" disabled={!room} placeholder="ROOM MESSAGE" value={messageBody} onChange={(event) => setMessageBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') sendRoomMessage(); }} />
              <button className="rdb-button rdb-button-primary" disabled={!room} type="button" onClick={sendRoomMessage}>SEND</button>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
