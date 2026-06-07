import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Globe2, Music, Timer, Users, Wand2, X } from 'lucide-react';
import { generateBattlePrompt, difficultyFromTier, GENRE_KNOWLEDGE } from '../../lib/groq';
import { pickRestrictions, validatePrompt, selectGenre } from '../../lib/restrictions';
import { playUiSound } from '../../lib/sfx';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';

const OVERTIME_SECONDS = 20;

const DEFAULT_ROOM_SETUP = {
  name: 'PRIVATE STUDIO',
  battleStartSeconds: 60,
  battleMinutes: 35,
  songLengthSeconds: 60,
  votingMinutes: 3,
  aiInstructions: '',
  isPublic: true,
  soloDifficulty: 'medium',
};

export default function MatchmakingModal({ open, onClose, onQueued }) {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const navigate = useNavigate();
  const [tab, setTab] = useState('ranked');
  const [queueRows, setQueueRows] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [roomSetup, setRoomSetup] = useState(DEFAULT_ROOM_SETUP);
  const [status, setStatus] = useState('idle');
  const [queuedAt, setQueuedAt] = useState(null);

  const waitingRows = useMemo(() => queueRows.filter((row) => row.mode === tab && row.status === 'waiting'), [queueRows, tab]);
  const visibleRooms = useMemo(() => rooms.filter((room) => room.owner_id === profile?.id || room.is_public !== false), [rooms, profile?.id]);
  const ownWaitingRow = useMemo(() => waitingRows.find((row) => row.user_id === profile?.id), [waitingRows, profile?.id]);
  const ownQueuedRow = useMemo(() => queueRows.find((row) => row.user_id === profile?.id && row.status === 'waiting'), [queueRows, profile?.id]);
  const tier = profile?.rank_tier || 'bronze';

  const sameTierWaiting = useMemo(
    () => waitingRows.filter((r) => (r.profiles?.rank_tier || 'bronze') === tier),
    [waitingRows, tier],
  );
  const overtimeEarliest = useMemo(() => {
    if (sameTierWaiting.length < 2) return null;
    return sameTierWaiting.reduce((a, b) => (new Date(a.queued_at) < new Date(b.queued_at) ? a : b));
  }, [sameTierWaiting]);
  const overtimeRemaining = useMemo(() => {
    if (!overtimeEarliest) return 0;
    const elapsed = Date.now() - new Date(overtimeEarliest.queued_at).getTime();
    return Math.max(0, OVERTIME_SECONDS * 1000 - elapsed);
  }, [overtimeEarliest]);
  const isOvertime = overtimeRemaining > 0;

  useEffect(() => {
    if (!open) return;
    loadQueue();
    loadRooms();
    checkForMatch();
    // Gentle fallback poll (15s) in case realtime misses an event
    const interval = setInterval(tryMatchmaking, 15000);
    const channel = supabase
      .channel('matchmaking-rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => { loadRooms(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matchmaking_queue' }, () => { loadQueue(); tryMatchmaking(); checkForMatch(); })
      .subscribe();
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
      if (profile) {
        supabase
          .from('matchmaking_queue')
          .update({ status: 'cancelled' })
          .eq('user_id', profile.id)
          .eq('status', 'waiting')
          .then(() => onQueued?.());
      }
    };
  }, [open]);

  // Faster polling during overtime to catch match start as soon as it's ready
  useEffect(() => {
    if (!open || !isOvertime) return;
    const fast = setInterval(tryMatchmaking, 3000);
    return () => clearInterval(fast);
  }, [open, isOvertime]);

  // ── Tiny isolated component for elapsed timer ─────────────────────────────
  function ElapsedTimer({ queuedAt: from }) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
      const t = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(t);
    }, []);
    return <span className="font-mono text-[10px] uppercase text-rdb-muted">Elapsed: {formatElapsed(from || now)}</span>;
  }

  if (!open) return null;

  async function loadQueue() {
    const { data } = await supabase
      .from('matchmaking_queue')
      .select('*, profiles(username, avatar_url, rank_tier)')
      .eq('mode', 'ranked')
      .eq('status', 'waiting')
      .is('group_id', null)
      .order('queued_at', { ascending: true })
      .limit(24);
    setQueueRows(data || []);
  }

  async function loadRooms() {
    const { data } = await supabase
      .from('rooms')
      .select('*, room_members(count), battles(status)')
      .in('status', ['open', 'locked'])
      .neq('mode', 'ranked')
      .order('created_at', { ascending: false })
      .limit(12);
    setRooms(data || []);
  }

  async function enterQueue() {
    if (!profile || status === 'busy') return;
    setStatus('busy');
    try {
      // Check existing queue entry (clean stale groups first)
      const { data: existingAny } = await supabase
        .from('matchmaking_queue')
        .select('id, group_id')
        .eq('user_id', profile.id)
        .eq('status', 'waiting')
        .order('queued_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingAny) {
        if (existingAny.group_id) {
          const { count } = await supabase
            .from('matchmaking_queue')
            .select('id', { count: 'exact', head: true })
            .eq('group_id', existingAny.group_id);
          if ((count || 0) <= 1) {
            // Stale group — clean it up and proceed
            await supabase.from('matchmaking_queue').delete().eq('id', existingAny.id);
          } else {
            setStatus('idle'); onClose(); onQueued?.(); return;
          }
        } else {
          setStatus('idle'); onClose(); onQueued?.(); return;
        }
      }

      // Check queue isn't full (max 8)
      const { count: queueCount } = await supabase
        .from('matchmaking_queue')
        .select('id', { count: 'exact', head: true })
        .eq('mode', 'ranked')
        .eq('status', 'waiting')
        .is('group_id', null);
      if ((queueCount || 0) >= 8) {
        addToast('RANKED QUEUE FULL — TRY AGAIN LATER', 'error');
        setStatus('idle'); return;
      }

      const myTier = profile.rank_tier || 'bronze';
      const elo = profile.elo || 1000;

      // Look for ungrouped waiting players with same tier
      const { data: sameTier } = await supabase
        .from('matchmaking_queue')
        .select('id, user_id, profiles(rank_tier)')
        .eq('mode', 'ranked')
        .eq('status', 'waiting')
        .is('group_id', null)
        .neq('user_id', profile.id)
        .eq('profiles.rank_tier', myTier)
        .order('queued_at', { ascending: true })
        .limit(7);

      const hasSameTier = (sameTier || []).length >= 1;

      await supabase.from('matchmaking_queue').insert({
        user_id: profile.id, mode: 'ranked', elo,
      });
      await loadQueue();
      playUiSound('queue');
      addToast(hasSameTier ? 'QUEUED — MATCH STARTING SOON' : 'QUEUED — WAITING FOR PLAYERS');
      setQueuedAt(Date.now());
      onQueued?.();

      setStatus('idle');
    } catch (error) {
      setStatus('idle');
      addToast(error.message || 'QUEUE FAILED', 'error');
    }
  }

  async function cancelQueue() {
    if (!profile || !ownWaitingRow || status === 'busy') return;
    setStatus('busy');
    try {
      if (ownWaitingRow.group_id) {
        await supabase
          .from('matchmaking_queue')
          .update({ status: 'cancelled' })
          .eq('group_id', ownWaitingRow.group_id);
      } else {
        await supabase
          .from('matchmaking_queue')
          .update({ status: 'cancelled' })
          .eq('id', ownWaitingRow.id);
      }
      playUiSound('cancel');
      addToast('QUEUE CANCELLED');
      await loadQueue();
      onQueued?.();
    } catch (error) {
      addToast(error.message || 'QUEUE CANCEL FAILED', 'error');
    } finally {
      setStatus('idle');
    }
  }

  async function tryMatchmaking() {
    if (!profile || status !== 'idle') return;
    const myEntry = queueRows.find((row) => row.user_id === profile.id && row.status === 'waiting' && !row.group_id);
    if (!myEntry) return;

    const myTier = profile.rank_tier || 'bronze';
    let groupId = null;
    try {
      const { data: sameTier } = await supabase
        .from('matchmaking_queue')
        .select('id, user_id, queued_at, profiles(rank_tier)')
        .eq('mode', 'ranked')
        .eq('status', 'waiting')
        .is('group_id', null)
        .neq('user_id', profile.id)
        .eq('profiles.rank_tier', myTier)
        .order('queued_at', { ascending: true })
        .limit(7);

      if (!sameTier || sameTier.length < 1) return;

      // Overtime: wait until the oldest queued player has waited OVERTIME_SECONDS
      const allQueuedAts = [myEntry, ...sameTier].map((r) => new Date(r.queued_at).getTime());
      const oldest = Math.min(...allQueuedAts);
      if (Date.now() - oldest < OVERTIME_SECONDS * 1000) return;

      setStatus('busy');
      groupId = crypto.randomUUID();
      const ids = sameTier.map((m) => m.id);

      const { error: claimErr } = await supabase
        .from('matchmaking_queue')
        .update({ group_id: groupId })
        .in('id', ids)
        .is('group_id', null);
      if (claimErr) throw claimErr;

      await supabase
        .from('matchmaking_queue')
        .update({ group_id: groupId })
        .eq('id', myEntry.id);

      const { count } = await supabase
        .from('matchmaking_queue')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', groupId);
      if (count < sameTier.length + 1) {
        await supabase.from('matchmaking_queue').update({ group_id: null }).eq('group_id', groupId);
        setStatus('idle');
        return;
      }

      const allUserIds = [...sameTier.map((m) => m.user_id), profile.id];

      const { battle } = await createAiBattleRoom({
        mode: 'ranked',
        members: allUserIds,
        roomName: 'RANKED MATCH',
      });

      await supabase
        .from('matchmaking_queue')
        .update({ status: 'matched', battle_id: battle.id, matched_at: new Date().toISOString() })
        .in('user_id', allUserIds)
        .eq('status', 'waiting');

      playUiSound('success');
      addToast('MATCH READY');
      onClose();
      navigate(`/battle/${battle.id}`);
    } catch {
      if (groupId) {
        await supabase.from('matchmaking_queue').update({ group_id: null }).eq('group_id', groupId);
      }
      setStatus('idle');
    }
  }

  async function checkForMatch() {
    if (!profile) return;
    const { data } = await supabase
      .from('matchmaking_queue')
      .select('battle_id')
      .eq('user_id', profile.id)
      .eq('status', 'matched')
      .not('battle_id', 'is', null)
      .order('matched_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.battle_id) {
      supabase.from('matchmaking_queue').delete().eq('user_id', profile.id).eq('status', 'matched').then(() => {});
      onClose();
      navigate(`/battle/${data.battle_id}`);
    }
  }

  async function createAiBattleRoom({ mode, ownerId, members, queueId = null, roomName, setup = null, difficultyOverride = null }) {
    const isRanked = mode === 'ranked';
    const normalizedSetup = setup ? normalizeRoomSetup(setup) : null;

    const difficulty = difficultyOverride || (isRanked
      ? difficultyFromTier(profile?.rank_tier)
      : ['easy', 'medium', 'medium', 'hard'][Math.floor(Math.random() * 4)]);
    const genre = await selectGenre(supabase, difficulty);
    const restrictions = pickRestrictions(difficulty, genre, 3);
    const customInstr = normalizedSetup?.aiInstructions?.trim();
    const genreDirective = `${customInstr ? `Follow the host's instructions: ${customInstr}. ` : ''}Generate a ${genre} beat battle prompt for a${mode === 'solo' ? ' solo practice session' : ' quick room battle'}. The genre must be ${genre}. Make the title match the genre and end with TYPE BEAT. Only generate the title, mood, flavor_text, and reference_keywords. Do NOT generate restrictions.`;
    const recentGenres = (() => { try { return JSON.parse(localStorage.getItem('rdb_recent_genres') || '[]'); } catch { return []; } })();
    const { json } = await generateBattlePrompt({ directive: genreDirective, mode, recentGenres, difficulty });
    const validation = validatePrompt(json);
    if (!validation.valid) {
      const retry = await generateBattlePrompt({ directive: genreDirective, mode, recentGenres, difficulty });
      const retryValidation = validatePrompt(retry.json);
      if (!retryValidation.valid) throw new Error(`Prompt validation failed: ${retryValidation.errors.join('; ')}`);
      json.title = retry.json.title;
      json.flavor_text = retry.json.flavor_text;
      json.mood = retry.json.mood;
      json.reference_keywords = retry.json.reference_keywords;
    }
    try { localStorage.setItem('rdb_recent_genres', JSON.stringify([genre, ...recentGenres].slice(0, 6))); } catch {}

    const bpmClamped = (() => {
      const g = GENRE_KNOWLEDGE[genre];
      if (!g) return Number(json.bpm) || 140;
      const [min, max] = g.bpm_range;
      const bpm = Number(json.bpm);
      return bpm >= min && bpm <= max ? bpm : Math.floor((min + max) / 2);
    })();

    const startDelay = normalizedSetup?.battleStartSeconds || (isRanked ? 60 : 0);
    const starts = new Date(Date.now() + startDelay * 1000);
    const duration = normalizedSetup?.battleMinutes || (isRanked ? 45 : 35);
    const votingEnds = new Date(starts.getTime() + duration * 60 * 1000);

    const { data: battle, error: battleError } = await supabase.from('battles').insert({
      title: json.title,
      prompt_text: json.flavor_text,
      genre,
      bpm: bpmClamped,
      mood: json.mood,
      restrictions: restrictions.join('; '),
      reference_artists: Array.isArray(json.reference_keywords) ? json.reference_keywords : [],
      flavor_text: json.flavor_text,
      duration_minutes: duration,
      song_length_seconds: normalizedSetup?.songLengthSeconds || 60,
      ai_instructions: normalizedSetup?.aiInstructions || '',
      mode,
      queue_id: queueId,
      status: 'upcoming',
      starts_at: starts.toISOString(),
      voting_ends_at: votingEnds.toISOString(),
      created_by: ownerId || null,
    }).select('id, title').single();
    if (battleError) throw battleError;

    const { data: room, error: roomError } = await supabase.from('rooms').insert({
      name: roomName.trim().toUpperCase(),
      owner_id: isRanked ? null : ownerId,
      battle_id: battle.id,
      status: 'locked',
      max_players: members.length,
      current_players: members.length,
      mode,
      battle_starts_in_seconds: startDelay,
      song_length_seconds: normalizedSetup?.songLengthSeconds || 60,
      voting_minutes: normalizedSetup?.votingMinutes || 3,
      ai_instructions: normalizedSetup?.aiInstructions || '',
      is_public: isRanked ? false : normalizedSetup?.isPublic !== false,
    }).select('*').single();
    if (roomError) throw roomError;

    const { error: membersErr } = await supabase.from('room_members').upsert(members.map((userId, i) => ({
      room_id: room.id,
      user_id: userId,
      role: isRanked ? 'member' : (i === 0 ? 'owner' : 'member'),
    })));
    if (membersErr) throw membersErr;

    return { battle, room };
  }

  async function joinRoom(room) {
    playUiSound('click');
    if (!profile || status === 'busy') return;
    setStatus('busy');
    try {
      await supabase.from('room_members').upsert({ room_id: room.id, user_id: profile.id, role: room.owner_id === profile.id ? 'owner' : 'member' });
      const nextCount = Math.min(room.max_players || 4, Math.max(room.current_players || 0, (room.room_members?.[0]?.count || 0) + 1));
      await supabase.from('rooms').update({ current_players: nextCount, status: nextCount >= (room.max_players || 4) ? 'locked' : room.status }).eq('id', room.id);
      addToast('ROOM JOINED');
      onClose();
      if (room.battle_id) navigate(`/battle/${room.battle_id}`);
      setStatus('idle');
    } catch (error) {
      setStatus('idle');
      addToast(error.message || 'ROOM JOIN FAILED', 'error');
    }
  }

  async function createRoomBattle() {
    playUiSound('click');
    if (!profile || status === 'busy') return;
    setStatus('busy');
    try {
      const setup = normalizeRoomSetup(roomSetup);
      const { battle } = await createAiBattleRoom({
        mode: 'quick',
        ownerId: profile.id,
        members: [profile.id],
        roomName: setup.name || 'PRIVATE STUDIO',
        setup,
      });
      addToast('ROOM BATTLE CREATED');
      onClose();
      navigate(`/battle/${battle.id}`);
    } catch (error) {
      setStatus('idle');
      addToast(error.message || 'ROOM CREATE FAILED', 'error');
    }
  }

  async function startSoloSession() {
    playUiSound('click');
    if (!profile || status === 'busy') return;
    setStatus('busy');
    try {
      const s = roomSetup;
      const parts = ['Generate a solo producer beat battle prompt for a practice session.', 'Pick a current competitive beat lane and make the title match that lane.', 'The title must end with TYPE BEAT.', 'Make the restrictions fair, audible in the final beat, and easy for voters to judge.'];
      if (s.aiInstructions?.trim()) parts.push(`Host instructions: ${s.aiInstructions.trim()}.`);
      const soloDirective = parts.join(' ');
      const setup = { ...s, aiInstructions: soloDirective };
      const { battle } = await createAiBattleRoom({
        mode: 'solo',
        ownerId: profile.id,
        members: [profile.id],
        roomName: 'SOLO SESSION',
        setup,
        difficultyOverride: s.soloDifficulty === 'expert' ? 'hard' : s.soloDifficulty === 'impossible' ? 'very_hard' : s.soloDifficulty,
      });
      addToast('SOLO SESSION STARTED');
      onClose();
      navigate(`/battle/${battle.id}`);
    } catch (error) {
      addToast(error.message || 'SOLO START FAILED', 'error');
    } finally {
      setStatus('idle');
    }
  }

  async function removeRoom(room) {
    playUiSound('cancel');
    if (!profile || room.owner_id !== profile.id || status === 'busy') return;
    setStatus('busy');
    try {
      await supabase.from('rooms').update({ status: 'closed' }).eq('id', room.id);
      await supabase.from('room_members').delete().eq('room_id', room.id);
      addToast('ROOM REMOVED');
      await loadRooms();
    } catch (error) {
      addToast(error.message || 'ROOM REMOVE FAILED', 'error');
    } finally {
      setStatus('idle');
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-center overflow-y-auto bg-black/55 p-4 py-8 backdrop-blur-xl">
      <section className="apple-modal my-auto w-full max-w-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-rdb-text">Play</h2>
            <p className="mt-1 text-sm text-rdb-muted">Choose a match type or create a room battle.</p>
          </div>
          <button className="apple-icon-button" type="button" onClick={() => { playUiSound('cancel'); onClose(); }}><X size={16} /></button>
        </div>

        <div className="mt-6 grid grid-cols-3 rounded-lg bg-white/5 p-1">
          {[
            ['ranked', 'Ranked'],
            ['solo', 'Solo'],
            ['rooms', 'Rooms'],
          ].map(([value, label]) => (
            <button className={`apple-segment ${tab === value ? 'apple-segment-active' : ''}`} key={value} type="button" onClick={() => { playUiSound('click'); setTab(value); }}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'solo' ? (
          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_220px]">
            <div className="rounded-lg border border-rdb-border bg-rdb-bg/70 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-rdb-text">
                <Wand2 size={15} />Solo Session
              </div>
              <div className="mt-3 grid gap-2">
                {[
                  { value: 'easy', icon: '🌱', label: 'Easy', desc: 'Simple structure, common BPM, basic restrictions' },
                  { value: 'medium', icon: '🔥', label: 'Medium', desc: 'Mixed genres, moderate restrictions' },
                  { value: 'hard', icon: '⚔️', label: 'Hard', desc: 'Uncommon genres, edge BPM, challenging restrictions' },
                  { value: 'expert', icon: '💀', label: 'Expert', desc: 'Extreme BPM, creative restrictions, complex mood' },
                  { value: 'impossible', icon: '👹', label: 'Impossible', desc: 'Avant-garde mood, extreme tempo, chaotic restrictions' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${roomSetup.soloDifficulty === opt.value ? 'border-rdb-orange bg-rdb-orange/10' : 'border-rdb-border bg-rdb-bg/40 hover:border-rdb-orange/50'}`}
                    onClick={() => { playUiSound('click'); updateRoomSetup('soloDifficulty', opt.value); }}
                  >
                    <span className="text-xl leading-none">{opt.icon}</span>
                    <div>
                      <div className="font-mono text-[12px] font-bold uppercase text-rdb-text">{opt.label}</div>
                      <div className="mt-0.5 font-mono text-[10px] uppercase text-rdb-muted">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-2 self-stretch">
              <button className="apple-primary-action" disabled={status === 'busy' || Boolean(ownQueuedRow)} type="button" onClick={startSoloSession}>
                {ownQueuedRow ? 'In Queue' : status === 'busy' ? 'Creating...' : 'Start Solo Session'}
              </button>
              <button className="rdb-button" type="button" onClick={() => {
                const difficulties = ['easy', 'medium', 'hard', 'expert', 'impossible'];
                playUiSound('click');
                updateRoomSetup('soloDifficulty', difficulties[Math.floor(Math.random() * difficulties.length)]);
              }}>
                <Wand2 size={14} /> Surprise Me
              </button>
            </div>
          </div>
        ) : tab === 'ranked' ? (
          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_180px]">
            <div className="rounded-lg border border-rdb-border bg-rdb-bg/70 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-rdb-text">Ranked Queue</div>
                  <div className="mt-1 text-xs uppercase text-rdb-muted">{tier} tier • skill-based matching</div>
                </div>
                <div className="rounded-lg bg-white/10 px-3 py-1 font-mono text-[11px] uppercase text-rdb-muted">{formatNumber(sameTierWaiting.length)} searching</div>
              </div>
              {ownQueuedRow ? (
                <div className="mt-4 flex flex-col items-center gap-3 py-6">
                  {isOvertime ? (
                    <>
                      <div className="font-mono text-[11px] uppercase text-rdb-orange">Overtime — {Math.ceil(overtimeRemaining / 1000)}s</div>
                      <div className="font-mono text-[10px] uppercase text-rdb-muted">Waiting for more players</div>
                      <div className="mt-1 h-1 w-full max-w-[200px] overflow-hidden rounded-full bg-white/10">
                        <div className="h-full animate-pulse rounded-full bg-rdb-orange" style={{ width: `${(1 - overtimeRemaining / (OVERTIME_SECONDS * 1000)) * 100}%` }} />
                      </div>
                    </>
                  ) : sameTierWaiting.length >= 2 ? (
                    <>
                      <div className="font-mono text-[11px] uppercase text-green-400">Match found!</div>
                      <div className="font-mono text-[10px] uppercase text-rdb-muted">Starting match...</div>
                      <div className="mt-1 h-1 w-full max-w-[200px] overflow-hidden rounded-full bg-white/10">
                        <div className="h-full w-full animate-pulse rounded-full bg-green-400" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="font-mono text-[11px] uppercase text-rdb-orange blink">Searching for players...</div>
                      <div className="font-mono text-[10px] uppercase text-rdb-muted">
                        <ElapsedTimer queuedAt={queuedAt || Date.now()} />
                      </div>
                      <div className="mt-1 h-1 w-full max-w-[200px] overflow-hidden rounded-full bg-white/10">
                        <div className="h-full w-1/3 animate-pulse rounded-full bg-rdb-orange" />
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="mt-4 font-mono text-[11px] uppercase text-rdb-muted text-center py-8">
                  Search for a ranked match
                </div>
              )}
            </div>
            <div className="grid gap-2 self-stretch">
              <button className="apple-primary-action" disabled={status === 'busy' || Boolean(ownQueuedRow)} type="button" onClick={enterQueue}>
                {ownQueuedRow ? 'In Queue' : status === 'busy' ? 'Matching...' : 'Find Match'}
              </button>
              {ownWaitingRow && <button className="apple-secondary-action" disabled={status === 'busy'} type="button" onClick={cancelQueue}>Cancel Queue</button>}
            </div>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_290px]">
            <div className="rounded-lg border border-rdb-border bg-rdb-bg/70 p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-rdb-text"><Users size={15} />Room Match</div>
              <div className="grid gap-2 max-h-[400px] overflow-y-auto pr-1">
                {visibleRooms.map((room) => (
                  <div className="grid gap-2 rounded-lg border border-rdb-border bg-rdb-surface p-3" key={room.id}>
                    <span>
                      <span className="block font-mono text-[12px] uppercase text-rdb-text">{room.name}</span>
                      <span className="block font-mono text-[10px] uppercase text-rdb-muted">{room.battles?.status || room.status}</span>
                    </span>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] uppercase text-rdb-muted">{formatNumber(room.room_members?.[0]?.count || room.current_players || 0)}/{formatNumber(room.max_players || 4)}</span>
                      <div className="flex items-center gap-2">
                        {room.owner_id === profile?.id && <button className="rdb-button" disabled={status === 'busy'} type="button" onClick={() => removeRoom(room)}>REMOVE</button>}
                        <button className="rdb-button rdb-button-primary" disabled={status === 'busy' || Boolean(ownQueuedRow)} type="button" onClick={() => joinRoom(room)}>JOIN</button>
                      </div>
                    </div>
                  </div>
                ))}
                {!visibleRooms.length && <div className="rounded-lg border border-rdb-border bg-rdb-surface p-3 text-sm text-rdb-muted">No public rooms yet.</div>}
              </div>
            </div>
            <div className="rounded-lg border border-rdb-border bg-rdb-bg/70 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-rdb-text"><Wand2 size={15} />Create Room</div>
              <div className="mt-3 grid gap-2">
                <LabeledField icon={<Users size={13} />} label="Name">
                  <input className="rdb-input" value={roomSetup.name} onChange={(event) => updateRoomSetup('name', event.target.value)} />
                </LabeledField>
                <div className="grid grid-cols-2 gap-2">
                  <LabeledField icon={<Clock size={13} />} label="Start Timer">
                    <input className="rdb-input" min="0" max="600" type="number" value={roomSetup.battleStartSeconds} onChange={(event) => updateRoomSetup('battleStartSeconds', event.target.value)} />
                  </LabeledField>
                  <LabeledField icon={<Timer size={13} />} label="Battle Min">
                    <input className="rdb-input" min="1" type="number" value={roomSetup.battleMinutes} onChange={(event) => updateRoomSetup('battleMinutes', event.target.value)} />
                  </LabeledField>
                </div>
                <LabeledField icon={<Music size={13} />} label="Song Length Sec (10000 = ∞)">
                  <input className="rdb-input" min="15" type="number" value={roomSetup.songLengthSeconds} onChange={(event) => updateRoomSetup('songLengthSeconds', event.target.value)} />
                </LabeledField>
                <LabeledField icon={<Timer size={13} />} label="Voting Min">
                  <input className="rdb-input" min="1" max="60" type="number" value={roomSetup.votingMinutes} onChange={(event) => updateRoomSetup('votingMinutes', event.target.value)} />
                </LabeledField>
                <LabeledField icon={<SparkLabel />} label="AI Instructions">
                  <textarea className="rdb-input min-h-20" maxLength={300} value={roomSetup.aiInstructions} onChange={(event) => updateRoomSetup('aiInstructions', event.target.value)} placeholder="beat style, sample rule, mood..." />
                </LabeledField>
                <label className="flex items-center justify-between gap-3 border border-rdb-border bg-rdb-bg/60 p-2 font-mono text-[11px] uppercase text-rdb-muted">
                  <span className="inline-flex items-center gap-2"><Globe2 size={13} />Public</span>
                  <input type="checkbox" checked={roomSetup.isPublic} onChange={(event) => updateRoomSetup('isPublic', event.target.checked)} />
                </label>
              </div>
              <button className="apple-primary-action mt-3 w-full" disabled={status === 'busy' || Boolean(ownQueuedRow)} type="button" onClick={createRoomBattle}>
                {ownQueuedRow ? 'In Queue' : status === 'busy' ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );

  function updateRoomSetup(key, value) {
    setRoomSetup((state) => ({ ...state, [key]: value }));
  }
}

function normalizeRoomSetup(setup) {
  return {
    name: String(setup.name || 'PRIVATE STUDIO').trim().slice(0, 40).toUpperCase(),
    battleStartSeconds: clamp(Number(setup.battleStartSeconds), 0, 600),
    battleMinutes: clamp(Number(setup.battleMinutes), 1, Number.MAX_SAFE_INTEGER),
    songLengthSeconds: clamp(Number(setup.songLengthSeconds), 15, 10000),
    votingMinutes: clamp(Number(setup.votingMinutes), 1, 60),
    aiInstructions: String(setup.aiInstructions || '').trim().slice(0, 300),
    isPublic: Boolean(setup.isPublic),
  };
}

function formatElapsed(from) {
  const s = Math.floor((Date.now() - from) / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString();
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function LabeledField({ icon, label, children }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase text-rdb-muted">{icon}{label}</span>
      {children}
    </label>
  );
}

function SparkLabel() {
  return <Wand2 size={13} />;
}
