import { supabase } from './supabase';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export async function createRoom({ timerEnabled, isPublic, hostId, maxPlayers = 4 }) {
  const roomCode = generateRoomCode();

  const { data: room, error: roomErr } = await supabase
    .from('rooms')
    .insert({
      name: 'CUSTOM ROOM',
      mode: 'room',
      status: 'lobby',
      host_id: hostId,
      owner_id: hostId,
      room_code: roomCode,
      is_public: isPublic !== false,
      max_players: maxPlayers,
      current_players: 1,
      battle_starts_in_seconds: timerEnabled ? 60 : 0,
    })
    .select('*')
    .single();

  if (roomErr) throw roomErr;

  const { error: memberErr } = await supabase
    .from('room_members')
    .insert({ room_id: room.id, user_id: hostId, role: 'owner', is_ready: true });

  if (memberErr) throw memberErr;

  return { room, roomCode };
}

export async function toggleReady(roomId, userId) {
  const { data: member } = await supabase
    .from('room_members')
    .select('is_ready')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();

  const newReady = !member?.is_ready;

  await supabase
    .from('room_members')
    .update({ is_ready: newReady })
    .eq('room_id', roomId)
    .eq('user_id', userId);

  return newReady;
}

export async function startCountdown(roomId) {
  await supabase
    .from('rooms')
    .update({ countdown_started_at: new Date().toISOString() })
    .eq('id', roomId);
}

export async function advanceLobbyToActive(roomId) {
  const { data: room } = await supabase
    .from('rooms')
    .select('mode')
    .eq('id', roomId)
    .maybeSingle();

  try {
    const genres = ['trap', 'hiphop', 'uk-drill', 'edm', 'rap'];
    const genre = genres[Math.floor(Math.random() * genres.length)];

    const { buildChallenge, buildSamplePayload } = await import('./challengeService');
    const data = await buildChallenge(genre);
    const sample = data.sample || data;
    const restriction = data.restriction || '';
    const challengePayload = buildSamplePayload(sample, restriction);

    const { generateBattlePrompt, flattenRestrictions } = await import('./groq');
    const { json: aiJson } = await generateBattlePrompt({
      genre: challengePayload.genre,
      mode: 'room',
      loopTitle: challengePayload.title,
      loopBpm: challengePayload.bpm,
      loopKey: challengePayload.key,
    });

    const restrictionsText = flattenRestrictions(aiJson.restrictions) || aiJson.restrictions_text || '';

    challengePayload.instructions = aiJson.instruction || '';
    challengePayload.restrictionsList = restrictionsText;

    const startDelay = 15;
    const starts = new Date(Date.now() + startDelay * 1000);
    const duration = 45;
    const votingEnds = new Date(starts.getTime() + duration * 60 * 1000);

    const { data: battle, error: battleErr } = await supabase.from('battles').insert({
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
      mode: room?.mode || 'room',
      status: 'upcoming',
      starts_at: starts.toISOString(),
      voting_ends_at: votingEnds.toISOString(),
    }).select('id').single();

    if (battleErr) throw battleErr;

    await supabase
      .from('rooms')
      .update({
        battle_id: battle.id,
        status: 'locked',
        challenge: challengePayload,
        countdown_started_at: null,
        battle_starts_in_seconds: startDelay,
        song_length_seconds: 60,
        voting_minutes: 3,
      })
      .eq('id', roomId);

    return { battleId: battle.id };
  } catch (err) {
    console.error('[roomService] advanceLobbyToActive failed, resetting:', err);
    await supabase.from('rooms').update({ countdown_started_at: null }).eq('id', roomId);
    throw err;
  }
}

export async function kickPlayer(roomId, hostId, targetUserId) {
  const { data: room } = await supabase
    .from('rooms')
    .select('host_id, owner_id')
    .eq('id', roomId)
    .maybeSingle();

  if (!room) throw new Error('ROOM NOT FOUND');
  if (room.host_id !== hostId && room.owner_id !== hostId) throw new Error('NOT HOST');

  await supabase
    .from('room_members')
    .delete()
    .eq('room_id', roomId)
    .eq('user_id', targetUserId);

  const { count } = await supabase
    .from('room_members')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', roomId);

  await supabase
    .from('rooms')
    .update({ current_players: count })
    .eq('id', roomId);
}

export async function leaveLobby(roomId, userId) {
  await supabase
    .from('room_members')
    .delete()
    .eq('room_id', roomId)
    .eq('user_id', userId);

  const { count } = await supabase
    .from('room_members')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', roomId);

  if (count <= 0) {
    await supabase.from('rooms').update({ status: 'closed' }).eq('id', roomId);
  } else {
    await supabase
      .from('rooms')
      .update({ current_players: count })
      .eq('id', roomId);
  }
}
