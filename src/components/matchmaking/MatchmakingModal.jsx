import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Music, Timer, Users, Wand2, X } from 'lucide-react';
import { difficultyFromTier } from '../../lib/groq';
import { createRoom } from '../../lib/roomService';
import { enterQueue as enterLobbyQueue } from '../../lib/lobbyService';
import { playUiSound } from '../../lib/sfx';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';

const DEFAULT_ROOM_SETUP = {
  name: 'PRIVATE STUDIO',
  battleStartSeconds: 60,
  battleMinutes: 35,
  songLengthSeconds: 60,
  votingMinutes: 3,
  isPublic: true,
  soloDifficulty: 'medium',
};

export default function MatchmakingModal({ open, onClose }) {
  const { profile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const navigate = useNavigate();
  const [tab, setTab] = useState('ranked');
  const [visibleRooms, setVisibleRooms] = useState([]);
  const [roomSetup, setRoomSetup] = useState(DEFAULT_ROOM_SETUP);
  const [status, setStatus] = useState('idle');
  const queueingRef = useRef(false);

  const tier = profile?.rank_tier || 'bronze';

  useEffect(() => {
    if (!open) return;
    loadRooms();
    const channel = supabase
      .channel('matchmaking-rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => loadRooms())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open]);

  if (!open) return null;

  async function loadRooms() {
    const { data } = await supabase
      .from('rooms')
      .select('*, room_members(count), battles(status)')
      .in('status', ['open', 'locked'])
      .neq('mode', 'ranked')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(12);
    setVisibleRooms(data || []);
  }

  async function enterQueueHandler() {
    if (!profile || status === 'busy' || queueingRef.current) return;
    queueingRef.current = true;
    setStatus('busy');
    supabase.functions.invoke('cleanup-stale-data').then((r) => console.log('[cleanup] done:', r)).catch(() => {});

    try {
      const lobby = await enterLobbyQueue(profile.id);
      playUiSound('queue');
      addToast('SEARCHING FOR PLAYERS');
      queueingRef.current = false;
      onClose();
      navigate(`/lobby/${lobby.id}`);
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
    supabase.functions.invoke('cleanup-stale-data').then((r) => console.log('[cleanup] done:', r)).catch(() => {});
    try {
      const setup = normalizeRoomSetup(roomSetup);
      const { room, roomCode } = await createRoom({
        timerEnabled: setup.battleStartSeconds > 0,
        isPublic: setup.isPublic,
        hostId: profile.id,
        maxPlayers: 8,
      });
      addToast(`ROOM CREATED — CODE: ${roomCode}`);
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
    supabase.functions.invoke('cleanup-stale-data').then((r) => console.log('[cleanup] done:', r)).catch(() => {});

    try {
      const s = roomSetup;
      const { buildChallenge, buildSamplePayload } = await import('../../lib/challengeService');
      const { generateBattlePrompt, flattenRestrictions } = await import('../../lib/groq');

      const genres = ['trap', 'drill', 'boom-bap', 'house', 'lo-fi', 'r&b', 'phonk', 'jersey-club', 'drum-and-bass', 'pluggnb'];
      const genre = genres[Math.floor(Math.random() * genres.length)];
      const challenge = await buildChallenge(genre);
      const challengePayload = buildSamplePayload(challenge.sample, challenge.restriction);

      const { json: aiJson } = await generateBattlePrompt({
        genre: challengePayload.genre,
        mode: 'solo',
        difficulty: s.soloDifficulty === 'expert' ? 'hard' : s.soloDifficulty === 'impossible' ? 'very_hard' : s.soloDifficulty,
        loopTitle: challengePayload.title,
        loopBpm: challengePayload.bpm,
        loopKey: challengePayload.key,
      });

      const restrictionsText = flattenRestrictions(aiJson.restrictions) || aiJson.restrictions_text || '';
      challengePayload.instructions = aiJson.instruction || '';
      challengePayload.restrictionsList = restrictionsText;

      const startDelay = 0;
      const starts = new Date(Date.now() + startDelay * 1000);
      const duration = 35;
      const votingEnds = new Date(starts.getTime() + duration * 60 * 1000);

      const { data: battle, error: battleError } = await supabase.from('battles').insert({
        title: aiJson.title || challengePayload.title,
        prompt_text: aiJson.instruction || '',
        genre: challengePayload.genre,
        bpm: challengePayload.bpm,
        mood: aiJson.flavor_text || aiJson.mood || '',
        restrictions: restrictionsText,
        reference_artists: [],
        flavor_text: aiJson.flavor_text || '',
        duration_minutes: duration,
        song_length_seconds: 60,
        mode: 'solo',
        status: 'upcoming',
        starts_at: starts.toISOString(),
        voting_ends_at: votingEnds.toISOString(),
        created_by: profile.id,
      }).select('id, title').single();
      if (battleError) throw battleError;

      const { data: room, error: roomError } = await supabase.from('rooms').insert({
        name: 'SOLO SESSION',
        owner_id: profile.id,
        battle_id: battle.id,
        status: 'locked',
        max_players: 1,
        current_players: 1,
        mode: 'solo',
        battle_starts_in_seconds: startDelay,
        song_length_seconds: 60,
        voting_minutes: 0,
        is_public: false,
        challenge: challengePayload,
      }).select('*').single();
      if (roomError) throw roomError;

      const { error: membersErr } = await supabase.from('room_members').upsert({
        room_id: room.id,
        user_id: profile.id,
        role: 'owner',
      });
      if (membersErr) throw membersErr;

      addToast('SOLO SESSION STARTED');
      onClose();
      navigate(`/battle/${battle.id}`);
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
                  return (
                    <div className="grid gap-2 rounded-lg border border-rdb-border bg-rdb-surface p-3" key={room.id}>
                      <span>
                        <span className="block font-mono text-[12px] uppercase text-rdb-text">{room.name}</span>
                        <span className="block font-mono text-[10px] uppercase text-rdb-muted">{room.battles?.status || room.status}</span>
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] uppercase text-rdb-muted">{room.room_members?.[0]?.count || room.current_players || 0}/{room.max_players || 4}</span>
                        {isOwner && (
                          <button className="rdb-button" disabled={status === 'busy'} type="button" onClick={async () => {
                            playUiSound('cancel');
                            await supabase.from('rooms').update({ status: 'closed' }).eq('id', room.id);
                            await supabase.from('room_members').delete().eq('room_id', room.id);
                            addToast('ROOM REMOVED');
                            loadRooms();
                          }}>REMOVE</button>
                        )}
                      </div>
                    </div>
                  );
                })}
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
                  <input className="rdb-input" min="15" type="number" value={roomSetup.songLengthSeconds} onChange={(event) => updateRoomSetup('songLengthSeconds', event.target.value)} />
                </LabeledField>
                <LabeledField icon={<Timer size={13} />} label="Voting Min">
                  <input className="rdb-input" min="1" max="60" type="number" value={roomSetup.votingMinutes} onChange={(event) => updateRoomSetup('votingMinutes', event.target.value)} />
                </LabeledField>
                <label className="flex items-center justify-between gap-3 border border-rdb-border bg-rdb-bg/60 p-2 font-mono text-[11px] uppercase text-rdb-muted">
                  <span className="inline-flex items-center gap-2"><Users size={13} />Public</span>
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

function normalizeRoomSetup(setup) {
  return {
    name: String(setup.name || 'PRIVATE STUDIO').trim().slice(0, 40).toUpperCase(),
    battleStartSeconds: clamp(Number(setup.battleStartSeconds), 0, 600),
    battleMinutes: clamp(Number(setup.battleMinutes), 1, Number.MAX_SAFE_INTEGER),
    songLengthSeconds: clamp(Number(setup.songLengthSeconds), 15, 10000),
    votingMinutes: clamp(Number(setup.votingMinutes), 1, 60),
    isPublic: Boolean(setup.isPublic),
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
