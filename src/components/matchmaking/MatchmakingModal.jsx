import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Globe2, KeyRound, LockKeyhole, Music, Timer, Users, Wand2, X } from 'lucide-react';
import { generateBattlePrompt } from '../../lib/groq';
import { playUiSound } from '../../lib/sfx';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';

const QUEUE_DIRECTIVE = [
  'Generate a 4-player producer beat battle prompt for an automatically matched room.',
  'Pick a current competitive beat lane and make the title match that lane.',
  'The title must end with TYPE BEAT.',
  'Make the restrictions fair, clear, and judgeable.',
].join(' ');

const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'goat'];

const DEFAULT_ROOM_SETUP = {
  name: 'PRIVATE STUDIO',
  battleStartSeconds: 60,
  battleMinutes: 35,
  songLengthSeconds: 60,
  aiInstructions: '',
  minRankTier: 'bronze',
  codeOnly: false,
  isPublic: true,
};

export default function MatchmakingModal({ open, onClose, onQueued }) {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const navigate = useNavigate();
  const [tab, setTab] = useState('quick');
  const [queueRows, setQueueRows] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [roomSetup, setRoomSetup] = useState(DEFAULT_ROOM_SETUP);
  const [joinCode, setJoinCode] = useState('');
  const [status, setStatus] = useState('idle');

  const waitingRows = useMemo(() => queueRows.filter((row) => row.mode === tab && row.status === 'waiting'), [queueRows, tab]);
  const visibleRooms = useMemo(() => rooms.filter((room) => room.owner_id === profile?.id || room.is_public !== false), [rooms, profile?.id]);
  const ownWaitingRow = useMemo(() => waitingRows.find((row) => row.user_id === profile?.id), [waitingRows, profile?.id]);
  const ownQueuedRow = useMemo(() => queueRows.find((row) => row.user_id === profile?.id && row.status === 'waiting'), [queueRows, profile?.id]);
  const tier = profile?.rank_tier || 'bronze';

  useEffect(() => {
    if (!open) return;
    loadQueue();
    loadRooms();
  }, [open]);

  if (!open) return null;

  async function loadQueue() {
    const { data } = await supabase
      .from('matchmaking_queue')
      .select('*, profiles(username, avatar_url, rank_tier)')
      .eq('status', 'waiting')
      .order('queued_at', { ascending: true })
      .limit(24);
    setQueueRows(data || []);
  }

  async function loadRooms() {
    const { data } = await supabase
      .from('rooms')
      .select('*, room_members(count)')
      .in('status', ['open', 'locked'])
      .order('created_at', { ascending: false })
      .limit(12);
    setRooms(data || []);
  }

  async function enterQueue(mode) {
    if (!profile || status === 'busy') return;
    setTab(mode);
    setStatus('busy');
    try {
      const { data: existingAny } = await supabase
        .from('matchmaking_queue')
        .select('*')
        .eq('user_id', profile.id)
        .eq('status', 'waiting')
        .order('queued_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingAny && existingAny.mode !== mode) {
        setTab(existingAny.mode);
        addToast(`ALREADY IN ${existingAny.mode === 'ranked' ? 'RANKED' : 'CASUAL'} QUEUE`);
        setStatus('idle');
        onClose();
        onQueued?.();
        return;
      }

      const queueRow = existingAny || (await supabase
        .from('matchmaking_queue')
        .insert({ user_id: profile.id, mode, elo: profile.elo || 1000 })
        .select('*')
        .single()).data;

      const matched = await maybeCreateMatch(mode, queueRow?.id);
      await loadQueue();
      playUiSound(matched ? 'success' : 'queue');
      setStatus('idle');
      if (!matched) {
        onClose();
        onQueued?.();
      }
    } catch (error) {
      setStatus('idle');
      addToast(error.message || 'QUEUE FAILED', 'error');
    }
  }

  async function cancelQueue() {
    if (!profile || !ownWaitingRow || status === 'busy') return;
    setStatus('busy');
    try {
      const { error } = await supabase
        .from('matchmaking_queue')
        .update({ status: 'cancelled' })
        .eq('id', ownWaitingRow.id);
      if (error) throw error;
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

  async function maybeCreateMatch(mode, seedQueueId) {
    const { data } = await supabase
      .from('matchmaking_queue')
      .select('*, profiles(username, rank_tier)')
      .eq('mode', mode)
      .eq('status', 'waiting')
      .order('queued_at', { ascending: true })
      .limit(16);

    const rows = data || [];
    const own = rows.find((row) => row.user_id === profile.id) || rows.find((row) => row.id === seedQueueId);
    if (!own) return false;

    const party = rows.filter((row) => mode === 'quick' || row.profiles?.rank_tier === tier).slice(0, 4);
    if (party.length < 4) {
      addToast(`${party.length}/4 IN ${mode === 'ranked' ? 'RANKED' : 'CASUAL'} QUEUE`);
      return false;
    }

    const { battle, room } = await createAiBattleRoom({
      mode,
      ownerId: profile.id,
      members: party.map((row) => row.user_id),
      queueId: seedQueueId || party[0].id,
      roomName: `${mode.toUpperCase()} MATCH`,
    });

    await supabase
      .from('matchmaking_queue')
      .update({ status: 'matched', battle_id: battle.id, room_id: room.id, matched_at: new Date().toISOString() })
      .in('id', party.map((row) => row.id));

    addToast('MATCH READY');
    onClose();
    navigate(`/battle/${battle.id}`);
    return true;
  }

  async function createAiBattleRoom({ mode, ownerId, members, queueId = null, roomName, setup = null }) {
    const normalizedSetup = setup ? normalizeRoomSetup(setup, mode) : null;
    const customDirective = normalizedSetup?.aiInstructions
      ? `${QUEUE_DIRECTIVE} Host custom instructions: ${normalizedSetup.aiInstructions}. Keep it concise and enforce the host's instruction.`
      : QUEUE_DIRECTIVE;
    const { json } = await generateBattlePrompt({ directive: customDirective, mode });
    const starts = new Date(Date.now() + (normalizedSetup?.battleStartSeconds || 0) * 1000);
    const duration = normalizedSetup?.battleMinutes || (mode === 'ranked' ? 45 : 35);
    const votingEnds = new Date(starts.getTime() + duration * 60 * 1000);

    const { data: battle, error: battleError } = await supabase.from('battles').insert({
      title: json.title,
      prompt_text: json.flavor_text,
      genre: json.genre,
      bpm: Number(json.bpm),
      mood: json.mood,
      restrictions: json.restrictions,
      reference_artists: Array.isArray(json.reference_artists) ? json.reference_artists : [],
      flavor_text: json.flavor_text,
      duration_minutes: duration,
      song_length_seconds: normalizedSetup?.songLengthSeconds || 60,
      ai_instructions: normalizedSetup?.aiInstructions || '',
      mode,
      queue_id: queueId,
      status: normalizedSetup?.battleStartSeconds ? 'upcoming' : 'active',
      starts_at: starts.toISOString(),
      voting_ends_at: votingEnds.toISOString(),
      created_by: ownerId,
    }).select('id, title').single();
    if (battleError) throw battleError;

    const { data: room, error: roomError } = await supabase.from('rooms').insert({
      name: roomName.trim().toUpperCase(),
      owner_id: ownerId,
      battle_id: battle.id,
      status: members.length >= 4 ? 'locked' : 'open',
      max_players: 4,
      current_players: members.length,
      mode,
      battle_starts_in_seconds: normalizedSetup?.battleStartSeconds || 0,
      song_length_seconds: normalizedSetup?.songLengthSeconds || 60,
      ai_instructions: normalizedSetup?.aiInstructions || '',
      min_rank_tier: normalizedSetup?.minRankTier || 'bronze',
      join_code: normalizedSetup?.joinCode || null,
      code_only: Boolean(normalizedSetup?.codeOnly),
      is_public: normalizedSetup?.isPublic !== false,
    }).select('*').single();
    if (roomError) throw roomError;

    await supabase.from('room_members').upsert(members.map((userId, index) => ({
      room_id: room.id,
      user_id: userId,
      role: index === 0 ? 'owner' : 'member',
    })));

    return { battle, room };
  }

  async function joinRoom(room, options = {}) {
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
    if (!profile || status === 'busy') return;
    setStatus('busy');
    try {
      const setup = normalizeRoomSetup(roomSetup, 'quick');
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

  async function joinRoomByCode() {
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
    if (!profile || room.owner_id !== profile.id || status === 'busy') return;
    setStatus('busy');
    try {
      const { error } = await supabase.from('rooms').update({ status: 'closed' }).eq('id', room.id);
      if (error) throw error;
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
          <button className="apple-icon-button" type="button" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="mt-6 grid grid-cols-3 rounded-lg bg-white/5 p-1">
          {[
            ['quick', 'Casual Queue'],
            ['ranked', 'Ranked'],
            ['rooms', 'Rooms'],
          ].map(([value, label]) => (
            <button className={`apple-segment ${tab === value ? 'apple-segment-active' : ''}`} key={value} type="button" onClick={() => setTab(value)}>
              {label}
            </button>
          ))}
        </div>

        {tab !== 'rooms' ? (
          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_180px]">
            <div className="rounded-lg border border-rdb-border bg-rdb-bg/70 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-rdb-text">{tab === 'ranked' ? 'Ranked Queue' : 'Casual Queue'}</div>
                  <div className="mt-1 text-xs uppercase text-rdb-muted">{tab === 'ranked' ? `${tier} tier matching` : 'open 4 player matching'}</div>
                </div>
                <div className="rounded-lg bg-white/10 px-3 py-1 font-mono text-[11px] uppercase text-rdb-muted">{waitingRows.length}/4</div>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {Array.from({ length: 4 }).map((_, index) => {
                  const row = waitingRows[index];
                  return (
                    <div className="h-16 rounded-lg border border-rdb-border bg-rdb-surface p-2 text-center" key={index}>
                      <div className="truncate font-mono text-[11px] uppercase text-rdb-text">{row?.profiles?.username || 'Open'}</div>
                      <div className="mt-1 font-mono text-[10px] uppercase text-rdb-muted">{row?.profiles?.rank_tier || `${index + 1}/4`}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-2 self-stretch">
              <button className="apple-primary-action" disabled={status === 'busy' || Boolean(ownQueuedRow)} type="button" onClick={() => enterQueue(tab)}>
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
                <button className="rdb-button" disabled={status === 'busy'} type="button" onClick={joinRoomByCode}><KeyRound size={14} />JOIN</button>
              </div>
              <div className="grid gap-2 max-h-[400px] overflow-y-auto pr-1">
                {visibleRooms.map((room) => (
                  <div className="grid gap-2 rounded-lg border border-rdb-border bg-rdb-surface p-3" key={room.id}>
                    <span>
                      <span className="block font-mono text-[12px] uppercase text-rdb-text">{room.name}</span>
                      <span className="block font-mono text-[10px] uppercase text-rdb-muted">{room.mode || 'quick'} - {room.status} - min {room.min_rank_tier || 'bronze'}{room.code_only ? ' - code' : ''}</span>
                    </span>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] uppercase text-rdb-muted">{room.room_members?.[0]?.count || room.current_players || 0}/{room.max_players || 4}</span>
                      <div className="flex gap-2">
                        {room.owner_id === profile?.id && <button className="rdb-button" disabled={status === 'busy'} type="button" onClick={() => removeRoom(room)}>REMOVE</button>}
                        <button className="rdb-button rdb-button-primary" disabled={status === 'busy' || room.status === 'locked'} type="button" onClick={() => joinRoom(room)}>JOIN</button>
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
                    <input className="rdb-input" min="5" max="180" type="number" value={roomSetup.battleMinutes} onChange={(event) => updateRoomSetup('battleMinutes', event.target.value)} />
                  </LabeledField>
                </div>
                <LabeledField icon={<Music size={13} />} label="Song Length Sec">
                  <input className="rdb-input" min="15" max="240" type="number" value={roomSetup.songLengthSeconds} onChange={(event) => updateRoomSetup('songLengthSeconds', event.target.value)} />
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
              <button className="apple-primary-action mt-3 w-full" disabled={status === 'busy'} type="button" onClick={createRoomBattle}>
                {status === 'busy' ? 'Creating...' : 'Create'}
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

function normalizeRoomSetup(setup, mode) {
  const codeOnly = Boolean(setup.codeOnly);
  return {
    name: String(setup.name || 'PRIVATE STUDIO').trim().slice(0, 40).toUpperCase(),
    battleStartSeconds: clamp(Number(setup.battleStartSeconds), 0, 600),
    battleMinutes: clamp(Number(setup.battleMinutes), 5, mode === 'ranked' ? 90 : 180),
    songLengthSeconds: clamp(Number(setup.songLengthSeconds), 15, 240),
    aiInstructions: String(setup.aiInstructions || '').trim().slice(0, 300),
    minRankTier: TIER_ORDER.includes(setup.minRankTier) ? setup.minRankTier : 'bronze',
    codeOnly,
    isPublic: Boolean(setup.isPublic),
    joinCode: codeOnly ? makeRoomCode() : null,
  };
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
