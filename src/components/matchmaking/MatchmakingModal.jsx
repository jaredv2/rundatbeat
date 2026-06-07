import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Globe2, KeyRound, LockKeyhole, Music, Timer, Users, Wand2, X } from 'lucide-react';
import { generateBattlePrompt, difficultyFromTier } from '../../lib/groq';
import { playUiSound } from '../../lib/sfx';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';

const QUEUE_DIRECTIVE = [
  'Generate a producer beat battle prompt for an automatically matched room.',
  'Pick a current competitive beat lane and make the title match that lane.',
  'The title must end with TYPE BEAT.',
  'Make the restrictions fair, audible in the final beat, and easy for voters to judge.',
].join(' ');

const SOLO_DIRECTIVE = [
  'Generate a solo producer beat battle prompt for a practice session.',
  'Pick a current competitive beat lane and make the title match that lane.',
  'The title must end with TYPE BEAT.',
  'Make the restrictions fair, audible in the final beat, and easy for voters to judge.',
].join(' ');

const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'goat'];

const DEFAULT_ROOM_SETUP = {
  name: 'PRIVATE STUDIO',
  battleStartSeconds: 60,
  battleMinutes: 35,
  songLengthSeconds: 60,
  votingMinutes: 3,
  aiInstructions: '',
  minRankTier: 'bronze',
  codeOnly: false,
  isPublic: true,
};

export default function MatchmakingModal({ open, onClose, onQueued }) {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const navigate = useNavigate();
  const [tab, setTab] = useState('ranked');
  const [queueRows, setQueueRows] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [roomSetup, setRoomSetup] = useState(DEFAULT_ROOM_SETUP);
  const [joinCode, setJoinCode] = useState('');
  const [status, setStatus] = useState('idle');
  const [queuedAt, setQueuedAt] = useState(null);

  const waitingRows = useMemo(() => queueRows.filter((row) => row.mode === tab && row.status === 'waiting'), [queueRows, tab]);
  const visibleRooms = useMemo(() => rooms.filter((room) => room.owner_id === profile?.id || room.is_public !== false), [rooms, profile?.id]);
  const ownWaitingRow = useMemo(() => waitingRows.find((row) => row.user_id === profile?.id), [waitingRows, profile?.id]);
  const ownQueuedRow = useMemo(() => queueRows.find((row) => row.user_id === profile?.id && row.status === 'waiting'), [queueRows, profile?.id]);
  const tier = profile?.rank_tier || 'bronze';

  useEffect(() => {
    if (!open) return;
    loadQueue();
    loadRooms();
    // Gentle fallback poll (15s) in case realtime misses an event
    const interval = setInterval(tryMatchmaking, 15000);
    const channel = supabase
      .channel('matchmaking-rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => { loadRooms(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matchmaking_queue' }, () => { loadQueue(); tryMatchmaking(); })
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
      .select('*, room_members(count)')
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
      const { data: candidates } = await supabase
        .from('matchmaking_queue')
        .select('id, user_id, profiles(rank_tier)')
        .eq('mode', 'ranked')
        .eq('status', 'waiting')
        .is('group_id', null)
        .neq('user_id', profile.id)
        .order('queued_at', { ascending: true })
        .limit(7);

      const sameTier = (candidates || []).filter(
        (c) => (c.profiles?.rank_tier || 'bronze') === myTier
      );

      let groupId;
      if (sameTier.length >= 1) {
        // Found at least 1 other same-tier player — form a group
        groupId = crypto.randomUUID();
        const ids = sameTier.map((m) => m.id);

        const { error: claimErr } = await supabase
          .from('matchmaking_queue')
          .update({ group_id: groupId })
          .in('id', ids)
          .is('group_id', null);
        if (claimErr) throw claimErr;

        const { data: verify } = await supabase
          .from('matchmaking_queue')
          .select('id')
          .eq('group_id', groupId);
        if ((verify || []).length < 1) {
          await supabase.from('matchmaking_queue').insert({ user_id: profile.id, mode: 'ranked', elo });
          await loadQueue();
          playUiSound('queue');
          addToast('QUEUED — WAITING FOR PLAYERS');
          setQueuedAt(Date.now());
          setStatus('idle'); onQueued?.(); return;
        }

        // Add self to group
        await supabase.from('matchmaking_queue').insert({
          user_id: profile.id, mode: 'ranked', elo, group_id: groupId,
        });

        const allUserIds = [...sameTier.map((m) => m.user_id), profile.id];

        const { battle, room } = await createAiBattleRoom({
          mode: 'ranked',
          members: allUserIds,
          roomName: 'RANKED MATCH',
        });

        await supabase
          .from('matchmaking_queue')
          .delete()
          .in('user_id', allUserIds)
          .eq('status', 'waiting');

        playUiSound('success');
        addToast('MATCH READY');
        onClose();
        navigate(`/battle/${battle.id}`);
      } else {
        // No same-tier players — queue alone
        await supabase.from('matchmaking_queue').insert({
          user_id: profile.id, mode: 'ranked', elo,
        });
        await loadQueue();
        playUiSound('queue');
        addToast('QUEUED — WAITING FOR PLAYERS');
        setQueuedAt(Date.now());
        onQueued?.();
      }

      setStatus('idle');
    } catch (error) {
      if (groupId) {
        supabase.from('matchmaking_queue').delete().eq('group_id', groupId).then();
      }
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
    let groupId;
    try {
      const { data: candidates } = await supabase
        .from('matchmaking_queue')
        .select('id, user_id, profiles(rank_tier)')
        .eq('mode', 'ranked')
        .eq('status', 'waiting')
        .is('group_id', null)
        .neq('user_id', profile.id)
        .order('queued_at', { ascending: true })
        .limit(7);

      const sameTier = (candidates || []).filter(
        (c) => (c.profiles?.rank_tier || 'bronze') === myTier
      );
      if (sameTier.length < 1) return;

      setStatus('busy');
      groupId = crypto.randomUUID();
      const ids = sameTier.map((m) => m.id);

      const { error: claimErr } = await supabase
        .from('matchmaking_queue')
        .update({ group_id: groupId })
        .in('id', ids)
        .is('group_id', null);
      if (claimErr) throw claimErr;

      const { data: verify } = await supabase
        .from('matchmaking_queue')
        .select('id')
        .eq('group_id', groupId);
      if ((verify || []).length < 1) { setStatus('idle'); return; }

      await supabase
        .from('matchmaking_queue')
        .update({ group_id: groupId })
        .eq('id', myEntry.id);

      const allUserIds = [...sameTier.map((m) => m.user_id), profile.id];

      const { battle } = await createAiBattleRoom({
        mode: 'ranked',
        members: allUserIds,
        roomName: 'RANKED MATCH',
      });

      await supabase
        .from('matchmaking_queue')
        .delete()
        .in('user_id', allUserIds)
        .eq('status', 'waiting');

      playUiSound('success');
      addToast('MATCH READY');
      onClose();
      navigate(`/battle/${battle.id}`);
    } catch {
      if (groupId) {
        supabase.from('matchmaking_queue').delete().eq('group_id', groupId).then();
      }
      setStatus('idle');
    }
  }

  async function createAiBattleRoom({ mode, ownerId, members, queueId = null, roomName, setup = null }) {
    const isRanked = mode === 'ranked';
    const normalizedSetup = setup ? normalizeRoomSetup(setup) : null;
    const directive = mode === 'solo' ? SOLO_DIRECTIVE : QUEUE_DIRECTIVE;
    const customDirective = normalizedSetup?.aiInstructions
      ? `${directive} Host custom instructions: ${normalizedSetup.aiInstructions}. Keep it concise and enforce the host's instruction.`
      : directive;

    const difficulty = isRanked
      ? difficultyFromTier(profile?.rank_tier)
      : ['easy', 'medium', 'medium', 'hard'][Math.floor(Math.random() * 4)];
    const recentGenres = (() => { try { return JSON.parse(localStorage.getItem('rdb_recent_genres') || '[]'); } catch { return []; } })();
    const { json } = await generateBattlePrompt({ directive: customDirective, mode, recentGenres, difficulty });
    try { localStorage.setItem('rdb_recent_genres', JSON.stringify([json.genre, ...recentGenres].slice(0, 6))); } catch {}

    const startDelay = normalizedSetup?.battleStartSeconds || (isRanked ? 60 : 0);
    const starts = new Date(Date.now() + startDelay * 1000);
    const duration = normalizedSetup?.battleMinutes || (isRanked ? 45 : 35);
    const votingEnds = new Date(starts.getTime() + duration * 60 * 1000);

    const { data: battle, error: battleError } = await supabase.from('battles').insert({
      title: json.title,
      prompt_text: json.flavor_text,
      genre: json.genre,
      bpm: Number(json.bpm),
      mood: json.mood,
      restrictions: json.restrictions,
      reference_artists: Array.isArray(json.reference_keywords) ? json.reference_keywords : Array.isArray(json.reference_artists) ? json.reference_artists : [],
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
      min_rank_tier: normalizedSetup?.minRankTier || 'bronze',
      join_code: normalizedSetup?.joinCode || null,
      code_only: Boolean(normalizedSetup?.codeOnly),
      is_public: isRanked ? false : normalizedSetup?.isPublic !== false,
    }).select('*').single();
    if (roomError) throw roomError;

    await supabase.from('room_members').upsert(members.map((userId) => ({
      room_id: room.id,
      user_id: userId,
      role: 'member',
    })));

    return { battle, room };
  }

  async function joinRoom(room, options = {}) {
    playUiSound('click');
    if (!profile || status === 'busy') return;
    if (!options.byCode && room.code_only) {
      addToast('ENTER ROOM CODE TO JOIN', 'error');
      return;
    }
    if (!canJoinTier(profile.rank_tier, room.min_rank_tier)) {
      addToast(`MIN TIER ${room.min_rank_tier || 'BRONZE'} REQUIRED`, 'error');
      return;
    }
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
      const setup = normalizeRoomSetup(roomSetup);
      const { battle } = await createAiBattleRoom({
        mode: 'solo',
        ownerId: profile.id,
        members: [profile.id],
        roomName: 'SOLO SESSION',
        setup,
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

  async function joinRoomByCode() {
    playUiSound('click');
    if (!joinCode.trim() || status === 'busy') return;
    setStatus('busy');
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('*, room_members(count)')
        .eq('join_code', joinCode.trim().toUpperCase())
        .in('status', ['open', 'locked'])
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('ROOM CODE NOT FOUND');
      setStatus('idle');
      await joinRoom(data, { byCode: true });
    } catch (error) {
      setStatus('idle');
      addToast(error.message || 'ROOM CODE FAILED', 'error');
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
                <LabeledField icon={<Clock size={13} />} label="Start Timer">
                  <input className="rdb-input" min="0" max="600" type="number" value={roomSetup.battleStartSeconds} onChange={(event) => updateRoomSetup('battleStartSeconds', event.target.value)} />
                </LabeledField>
                <LabeledField icon={<Timer size={13} />} label="Battle Min">
                  <input className="rdb-input" min="1" type="number" value={roomSetup.battleMinutes} onChange={(event) => updateRoomSetup('battleMinutes', event.target.value)} />
                </LabeledField>
                <LabeledField icon={<Music size={13} />} label="Song Length Sec">
                  <input className="rdb-input" min="15" max="240" type="number" value={roomSetup.songLengthSeconds} onChange={(event) => updateRoomSetup('songLengthSeconds', event.target.value)} />
                </LabeledField>
                <LabeledField icon={<Timer size={13} />} label="Voting Min">
                  <input className="rdb-input" min="1" max="60" type="number" value={roomSetup.votingMinutes} onChange={(event) => updateRoomSetup('votingMinutes', event.target.value)} />
                </LabeledField>
                <LabeledField icon={<SparkLabel />} label="AI Instructions">
                  <textarea className="rdb-input min-h-16" maxLength={300} value={roomSetup.aiInstructions} onChange={(event) => updateRoomSetup('aiInstructions', event.target.value)} placeholder="beat style, sample rule, mood..." />
                </LabeledField>
              </div>
            </div>
            <div className="grid gap-2 self-stretch">
              <button className="apple-primary-action" disabled={status === 'busy' || Boolean(ownQueuedRow)} type="button" onClick={startSoloSession}>
                {ownQueuedRow ? 'In Queue' : status === 'busy' ? 'Creating...' : 'Start Solo Session'}
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
                <div className="rounded-lg bg-white/10 px-3 py-1 font-mono text-[11px] uppercase text-rdb-muted">{formatNumber(queueRows.filter(r => r.mode === 'ranked' && r.status === 'waiting').length)} searching</div>
              </div>
              {ownQueuedRow ? (
                <div className="mt-4 flex flex-col items-center gap-3 py-6">
                  <div className="font-mono text-[11px] uppercase text-rdb-orange blink">Searching for players...</div>
                  <div className="font-mono text-[10px] uppercase text-rdb-muted">
                    <ElapsedTimer queuedAt={queuedAt || Date.now()} />
                  </div>
                  <div className="mt-1 h-1 w-full max-w-[200px] overflow-hidden rounded-full bg-white/10">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-rdb-orange" />
                  </div>
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
              <div className="mb-3 flex gap-2">
                <input className="rdb-input" placeholder="ROOM CODE" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} />
                <button className="rdb-button" disabled={status === 'busy' || Boolean(ownQueuedRow)} type="button" onClick={joinRoomByCode}><KeyRound size={14} />JOIN</button>
              </div>
              <div className="grid gap-2 max-h-[400px] overflow-y-auto pr-1">
                {visibleRooms.map((room) => (
                  <div className="grid gap-2 rounded-lg border border-rdb-border bg-rdb-surface p-3" key={room.id}>
                    <span>
                      <span className="block font-mono text-[12px] uppercase text-rdb-text">{room.name}</span>
                      <span className="block font-mono text-[10px] uppercase text-rdb-muted">{room.mode || 'quick'} — {room.status}{room.min_rank_tier && room.min_rank_tier !== 'bronze' ? ` — MIN ${room.min_rank_tier.toUpperCase()}` : ''}</span>
                    </span>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] uppercase text-rdb-muted">{formatNumber(room.room_members?.[0]?.count || room.current_players || 0)}/{formatNumber(room.max_players || 4)}</span>
                      <div className="flex items-center gap-2">
                        {room.code_only && <span className="font-mono text-[10px] uppercase text-rdb-orange">CODE</span>}
                        {room.owner_id === profile?.id && <button className="rdb-button" disabled={status === 'busy'} type="button" onClick={() => removeRoom(room)}>REMOVE</button>}
                        <button className="rdb-button rdb-button-primary" disabled={status === 'busy' || Boolean(ownQueuedRow) || room.status === 'locked'} type="button" onClick={() => joinRoom(room)}>JOIN</button>
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
                <LabeledField icon={<Music size={13} />} label="Song Length Sec">
                  <input className="rdb-input" min="15" max="240" type="number" value={roomSetup.songLengthSeconds} onChange={(event) => updateRoomSetup('songLengthSeconds', event.target.value)} />
                </LabeledField>
                <LabeledField icon={<Timer size={13} />} label="Voting Min">
                  <input className="rdb-input" min="1" max="60" type="number" value={roomSetup.votingMinutes} onChange={(event) => updateRoomSetup('votingMinutes', event.target.value)} />
                </LabeledField>
                <LabeledField icon={<SparkLabel />} label="AI Instructions">
                  <textarea className="rdb-input min-h-20" maxLength={300} value={roomSetup.aiInstructions} onChange={(event) => updateRoomSetup('aiInstructions', event.target.value)} placeholder="beat style, sample rule, mood..." />
                </LabeledField>
                <LabeledField icon={<LockKeyhole size={13} />} label="Min Tier Rank">
                  <select className="rdb-input" value={roomSetup.minRankTier} onChange={(event) => updateRoomSetup('minRankTier', event.target.value)}>
                    {TIER_ORDER.map((tier) => <option key={tier} value={tier}>{tier.toUpperCase()}</option>)}
                  </select>
                </LabeledField>
                <label className="flex items-center justify-between gap-3 border border-rdb-border bg-rdb-bg/60 p-2 font-mono text-[11px] uppercase text-rdb-muted">
                  <span className="inline-flex items-center gap-2"><KeyRound size={13} />Code Only</span>
                  <input type="checkbox" checked={roomSetup.codeOnly} onChange={(event) => updateRoomSetup('codeOnly', event.target.checked)} />
                </label>
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
  const codeOnly = Boolean(setup.codeOnly);
  return {
    name: String(setup.name || 'PRIVATE STUDIO').trim().slice(0, 40).toUpperCase(),
    battleStartSeconds: clamp(Number(setup.battleStartSeconds), 0, 600), // Max 10 minutes for start delay
    battleMinutes: clamp(Number(setup.battleMinutes), 1, Number.MAX_SAFE_INTEGER), // Min 1 minute, effectively infinite max
    songLengthSeconds: clamp(Number(setup.songLengthSeconds), 15, 240),
    votingMinutes: clamp(Number(setup.votingMinutes), 1, 60),
    aiInstructions: String(setup.aiInstructions || '').trim().slice(0, 300),
    minRankTier: TIER_ORDER.includes(setup.minRankTier) ? setup.minRankTier : 'bronze',
    codeOnly,
    isPublic: Boolean(setup.isPublic),
    joinCode: codeOnly ? makeRoomCode() : null,
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

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function canJoinTier(userTier = 'bronze', minTier = 'bronze') {
  return TIER_ORDER.indexOf(String(userTier || 'bronze').toLowerCase()) >= TIER_ORDER.indexOf(String(minTier || 'bronze').toLowerCase());
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
