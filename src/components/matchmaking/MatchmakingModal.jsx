import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Timer, Users, Wand2, X } from 'lucide-react';
import { difficultyFromTier } from '../../lib/groq';
import { createRoom, deleteRoom } from '../../lib/roomService';
import { enterQueue as enterLobbyQueue } from '../../lib/lobbyService';
import { playUiSound } from '../../lib/sfx';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';

const DEFAULT_ROOM_SETUP = {
  name: 'PRIVATE STUDIO',
  battleMinutes: 45,
  songLengthSeconds: 60,
  votingMinutes: 3,
  maxPlayers: 4,
  soloDifficulty: 'medium',
  allowInstructions: true,
  allowRestrictions: true,
};

export default function MatchmakingModal({ open, onClose, onQueue }) {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const navigate = useNavigate();
  const [tab, setTab] = useState('ranked');
  const [visibleRooms, setVisibleRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomSetup, setRoomSetup] = useState(DEFAULT_ROOM_SETUP);
  const [status, setStatus] = useState('idle');
  const queueingRef = useRef(false);

  const tier = profile?.rank_tier || 'bronze';

  useEffect(() => {
    if (!open) return;
    loadRooms(true);
    const channel = supabase
      .channel('matchmaking-rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => loadRooms())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members' }, () => loadRooms())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open]);

  if (!open) return null;

  async function loadRooms(isInitial = false) {
    if (isInitial) setRoomsLoading(true);
    try {
      const { data } = await supabase
        .from('rooms')
        .select('*, room_members(count), battles(status)')
        .in('status', ['open', 'locked', 'lobby'])
        .neq('mode', 'ranked')
        .eq('is_public', true)
        .order('created_at', { ascending: false })
        .limit(12);
      setVisibleRooms(data || []);
    } catch {
      // Silently handle
    } finally {
      if (isInitial) setRoomsLoading(false);
    }
  }

  async function enterQueueHandler() {
    if (!profile || status === 'busy' || queueingRef.current) return;
    queueingRef.current = true;
    setStatus('busy');

    try {
      await supabase.from('ranked_lobby_members').delete().eq('user_id', profile.id);
      const lobby = await enterLobbyQueue(profile.id);
      playUiSound('queue');
      queueingRef.current = false;
      setStatus('idle');
      onClose();
      onQueue?.(lobby);
    } catch (error) {
      setStatus('idle');
      queueingRef.current = false;
      addToast(error.message || 'QUEUE FAILED', 'error');
    }
  }

  async function createRoomBattle() {
    playUiSound('click');
    if (!profile || status === 'busy') return;
    setStatus('busy');
    try {
      const setup = normalizeRoomSetup(roomSetup);
      const { room } = await createRoom({
        isPublic: true,
        hostId: profile.id,
        maxPlayers: setup.maxPlayers,
        battleMinutes: setup.battleMinutes,
        songLengthSeconds: setup.songLengthSeconds,
        votingMinutes: setup.votingMinutes,
        name: roomSetup.name,
        allowInstructions: roomSetup.allowInstructions,
        allowRestrictions: roomSetup.allowRestrictions,
      });
      addToast('ROOM CREATED');
      onClose();
      navigate(`/battle/${room.id}`);
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
      const { data: battle, error: battleError } = await supabase.from('battles').insert({
        title: 'SOLO SESSION',
        prompt_text: '',
        genre: 'trap',
        mood: '',
        restrictions: '',
        reference_artists: [],
        flavor_text: '',
        duration_minutes: 35,
        song_length_seconds: 60,
        mode: 'solo',
        status: 'upcoming',
        starts_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        voting_ends_at: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
        created_by: profile.id,
      }).select('id').single();
      if (battleError) throw battleError;

      const { data: room, error: roomError } = await supabase.from('rooms').insert({
        name: 'SOLO SESSION',
        owner_id: profile.id,
        battle_id: battle.id,
        status: 'locked',
        max_players: 1,
        current_players: 1,
        mode: 'solo',
        battle_starts_in_seconds: 0,
        song_length_seconds: 60,
        voting_minutes: 0,
        is_public: false,
        challenge: null,
      }).select('*').single();
      if (roomError) throw roomError;

      const { error: membersErr } = await supabase.from('room_members').upsert({
        room_id: room.id,
        user_id: profile.id,
        role: 'owner',
      });
      if (membersErr) throw membersErr;

      addToast('SOLO SESSION CREATED');
      onClose();
      navigate(`/battle/${battle.id}?difficulty=${roomSetup.soloDifficulty}`);
    } catch (error) {
      addToast(error.message || 'SOLO START FAILED', 'error');
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
            <p className="mt-1 text-sm text-rdb-muted">Choose a match type.</p>
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
                  { value: 'easy', icon: '🌱', label: 'Easy', desc: 'Simple instructions, basic restrictions' },
                  { value: 'medium', icon: '🔥', label: 'Medium', desc: 'Mixed technical and creative constraints' },
                  { value: 'hard', icon: '⚔️', label: 'Hard', desc: 'Demanding instructions, tight restrictions' },
                  { value: 'expert', icon: '💀', label: 'Expert', desc: 'Complex technical demands, strict rules' },
                  { value: 'impossible', icon: '👹', label: 'Impossible', desc: 'Chaotic restrictions, extreme constraints' },
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
              <button className="apple-primary-action" disabled={status === 'busy'} type="button" onClick={startSoloSession}>
                {status === 'busy' ? 'Creating...' : 'Start Solo Session'}
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
                  <div className="mt-1 text-xs uppercase text-rdb-muted">{tier} tier • all tiers welcome</div>
                </div>
              </div>
              <div className="mt-4 font-mono text-[11px] uppercase text-rdb-muted text-center py-8">
                Find a match and get taken to the lobby
              </div>
            </div>
            <div className="grid gap-2 self-stretch">
              <button className="apple-primary-action" disabled={status === 'busy'} type="button" onClick={enterQueueHandler}>
                {status === 'busy' ? 'JOINING...' : 'Find Match'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_290px]">
            <div className="rounded-lg border border-rdb-border bg-rdb-bg/70 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-rdb-text"><Users size={15} />Public Rooms</div>
              <div className="grid gap-2 max-h-[400px] overflow-y-auto pr-1 mt-3">
                {visibleRooms.map((room) => {
                  const isOwner = room.owner_id === profile?.id;
                  const memberCount = room.room_members?.[0]?.count || room.current_players || 0;
                  const isFull = memberCount >= (room.max_players || 4);
                  return (
                    <div className="grid gap-2 rounded-lg border border-rdb-border bg-rdb-surface p-3" key={room.id}>
                      <span>
                        <span className="block font-mono text-[12px] uppercase text-rdb-text">{room.name}</span>
                        <span className="block font-mono text-[10px] uppercase text-rdb-muted">{room.battles?.status || room.status}</span>
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-mono text-[11px] uppercase ${isFull ? 'text-rdb-red' : 'text-rdb-muted'}`}>{memberCount}/{room.max_players || 4}{isFull ? ' FULL' : ''}</span>
                        <div className="flex gap-2">
                          {!isOwner && !isFull && (
                            <button className="rdb-button rdb-button-primary" disabled={status === 'busy'} type="button" onClick={async () => {
                              playUiSound('click');
                              navigate(`/battle/${room.battle_id || room.id}`);
                              onClose();
                            }}>JOIN</button>
                          )}
                          {isOwner && (
                            <button className="rdb-button" disabled={status === 'busy'} type="button" onClick={async () => {
                              playUiSound('cancel');
                              await deleteRoom(room.id);
                              addToast('ROOM DELETED');
                              loadRooms();
                            }}>REMOVE</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!visibleRooms.length && roomsLoading && <div className="rounded-lg border border-rdb-border bg-rdb-surface p-3 text-sm text-rdb-muted">Loading rooms...</div>}
                {!visibleRooms.length && !roomsLoading && <div className="rounded-lg border border-rdb-border bg-rdb-surface p-3 text-sm text-rdb-muted">No public rooms yet.</div>}
              </div>
            </div>
            <div className="rounded-lg border border-rdb-border bg-rdb-bg/70 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-rdb-text"><Wand2 size={15} />Create Room</div>
              <div className="mt-3 grid gap-2">
                <LabeledField icon={<Users size={13} />} label="Name">
                  <input className="rdb-input" value={roomSetup.name} onChange={(event) => updateRoomSetup('name', event.target.value)} />
                </LabeledField>
                <div className="grid grid-cols-2 gap-2">
                  <LabeledField icon={<Timer size={13} />} label="Battle Min">
                    <input className="rdb-input" min="1" type="number" value={roomSetup.battleMinutes} onChange={(event) => updateRoomSetup('battleMinutes', Number(event.target.value))} />
                  </LabeledField>
                  <LabeledField icon={<Music size={13} />} label="Song Length Sec">
                    <input className="rdb-input" min="15" type="number" value={roomSetup.songLengthSeconds} onChange={(event) => updateRoomSetup('songLengthSeconds', Number(event.target.value))} />
                  </LabeledField>
                </div>
                <LabeledField icon={<Timer size={13} />} label="Voting Min">
                  <input className="rdb-input" min="1" max="60" type="number" value={roomSetup.votingMinutes} onChange={(event) => updateRoomSetup('votingMinutes', Number(event.target.value))} />
                </LabeledField>
                <div className="border border-rdb-border bg-rdb-bg/60 p-2">
                  <span className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase text-rdb-muted"><Users size={13} />Max Players: {roomSetup.maxPlayers}</span>
                  <input
                    className="w-full accent-rdb-orange"
                    type="range"
                    min="2"
                    max="10"
                    value={roomSetup.maxPlayers}
                    onChange={(event) => updateRoomSetup('maxPlayers', Number(event.target.value))}
                  />
                  <div className="flex justify-between font-mono text-[9px] uppercase text-rdb-muted">
                    <span>2</span><span>10</span>
                  </div>
                </div>
                <div className="flex gap-4 mt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={roomSetup.allowInstructions}
                      onChange={(e) => updateRoomSetup('allowInstructions', e.target.checked)}
                      className="accent-rdb-orange"
                    />
                    <span className="font-mono text-[10px] uppercase text-rdb-muted">Allow Instructions</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={roomSetup.allowRestrictions}
                      onChange={(e) => updateRoomSetup('allowRestrictions', e.target.checked)}
                      className="accent-rdb-orange"
                    />
                    <span className="font-mono text-[10px] uppercase text-rdb-muted">Allow Restrictions</span>
                  </label>
                </div>
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

function normalizeRoomSetup(setup) {
  return {
    name: String(setup.name || 'PRIVATE STUDIO').trim().slice(0, 40).toUpperCase(),
    battleMinutes: clamp(Number(setup.battleMinutes), 1, Number.MAX_SAFE_INTEGER),
    songLengthSeconds: clamp(Number(setup.songLengthSeconds), 15, 10000),
    votingMinutes: clamp(Number(setup.votingMinutes), 1, 60),
    maxPlayers: clamp(Number(setup.maxPlayers), 2, 10),
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString();
}

function LabeledField({ icon, label, children }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase text-rdb-muted">{icon}{label}</span>
      {children}
    </label>
  );
}
