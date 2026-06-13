import { supabase } from './supabase';

export async function createRoom({ isPublic, hostId, maxPlayers = 4, battleMinutes = 45, songLengthSeconds = 60, votingMinutes = 3, name, allowInstructions = true, allowRestrictions = true }) {
  const { data: room, error: roomErr } = await supabase
    .from('rooms')
    .insert({
      name: name || 'BATTLE ROOM',
      mode: 'room',
      status: 'lobby',
      host_id: hostId,
      owner_id: hostId,
      is_public: isPublic !== false,
      max_players: maxPlayers,
      current_players: 1,
      song_length_seconds: songLengthSeconds,
      voting_minutes: votingMinutes,
      battle_starts_in_seconds: 0,
      challenge: { allowInstructions, allowRestrictions, battleMinutes },
    })
    .select('*')
    .single();

  if (roomErr) throw roomErr;

  const { error: memberErr } = await supabase
    .from('room_members')
    .insert({ room_id: room.id, user_id: hostId, role: 'owner', is_ready: false });

  if (memberErr) throw memberErr;

  return { room };
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
  // Optimistic lock: only advance if still in lobby
  const { data: room } = await supabase
    .from('rooms')
    .select('mode, status, current_players, song_length_seconds, voting_minutes, challenge')
    .eq('id', roomId)
    .maybeSingle();

  if (!room || room.status !== 'lobby') return null;

  const { count: playerCount } = await supabase
    .from('room_members')
    .select('room_id', { count: 'exact' })
    .eq('room_id', roomId);

  const startDelay = 15;
  const starts = new Date(Date.now() + startDelay * 1000);
  const duration = room?.challenge?.battleMinutes || 15;
  const songLength = room?.song_length_seconds || 60;
  const votingEnds = new Date(starts.getTime() + duration * 60 * 1000);

  try {
    const { data: battle, error: battleErr } = await supabase.from('battles').insert({
      title: 'CUSTOM BATTLE',
      prompt_text: '',
      genre: 'trap',
      mood: '',
      restrictions: '',
      reference_artists: [],
      flavor_text: '',
      duration_minutes: duration,
      song_length_seconds: songLength,
      mode: 'quick',
      status: 'upcoming',
      starts_at: starts.toISOString(),
      voting_ends_at: votingEnds.toISOString(),
    }).select('id').single();

    if (battleErr) throw battleErr;

    // Optimistic lock: only update room if still in lobby (prevents duplicate battles)
    // Preserve challenge settings (allowInstructions, allowRestrictions, battleMinutes)
    const { data: existingRoom } = await supabase.from('rooms').select('challenge').eq('id', roomId).maybeSingle();
    const existingChallenge = existingRoom?.challenge || {};
    const { data: updatedRoom, error: roomUpdateErr } = await supabase
      .from('rooms')
      .update({
        battle_id: battle.id,
        status: 'locked',
        challenge: {
          allowInstructions: existingChallenge.allowInstructions !== false,
          allowRestrictions: existingChallenge.allowRestrictions !== false,
          battleMinutes: existingChallenge.battleMinutes || duration,
        },
        countdown_started_at: null,
        battle_starts_in_seconds: startDelay,
      })
      .eq('id', roomId)
      .eq('status', 'lobby')
      .select('id')
      .maybeSingle();

    if (roomUpdateErr || !updatedRoom) {
      // Another client already advanced — delete orphan battle
      await supabase.from('battles').delete().eq('id', battle.id);
      return null;
    }

    return { battleId: battle.id };
  } catch (err) {
    await supabase.from('rooms').update({ countdown_started_at: null }).eq('id', roomId);
    throw err;
  }
}

// Fetch sample + generate AI challenge for a custom room (called during challenge reveal)
export async function generateCustomRoomChallenge(roomId) {
  const { count: playerCount } = await supabase
    .from('room_members')
    .select('room_id', { count: 'exact' })
    .eq('room_id', roomId);

  const { buildChallenge, buildSamplePayload } = await import('./challengeService');
  const { generateBattlePrompt, flattenRestrictions } = await import('./groq');

  const data = await buildChallenge('trap');
  const sample = data.sample || data;
  const challengePayload = buildSamplePayload(sample);

  const { json: aiJson } = await generateBattlePrompt({
    genre: challengePayload.genre,
    mode: 'room',
    playerCount: playerCount || 2,
    loopTitle: challengePayload.title,
    loopBpm: challengePayload.bpm,
    loopKey: challengePayload.key,
  });

  const restrictionsText = flattenRestrictions(aiJson.restrictions) || aiJson.restrictions_text || '';
  challengePayload.instructions = aiJson.instruction || '';
  challengePayload.restrictionsList = restrictionsText;

  // Preserve room settings from existing challenge
  const { data: existingRoom } = await supabase.from('rooms').select('challenge').eq('id', roomId).maybeSingle();
  if (existingRoom?.challenge) {
    challengePayload.allowInstructions = existingRoom.challenge.allowInstructions !== false;
    challengePayload.allowRestrictions = existingRoom.challenge.allowRestrictions !== false;
    if (existingRoom.challenge.battleMinutes) {
      challengePayload.battleMinutes = existingRoom.challenge.battleMinutes;
    }
  }

  // Update room with challenge
  await supabase.from('rooms').update({ challenge: challengePayload }).eq('id', roomId);

  // Update battle with AI content
  const { data: room } = await supabase.from('rooms').select('battle_id').eq('id', roomId).maybeSingle();
  if (room?.battle_id) {
    await supabase.from('battles').update({
      title: aiJson.title || challengePayload.title,
      prompt_text: aiJson.instruction || '',
      genre: challengePayload.genre,
      bpm: challengePayload.bpm,
      mood: aiJson.flavor_text || aiJson.mood || '',
      restrictions: restrictionsText,
      flavor_text: aiJson.flavor_text || '',
    }).eq('id', room.battle_id);
  }

  return challengePayload;
}

// Fetch sample + generate AI challenge for solo session (called during challenge reveal)
export async function generateSoloChallenge(roomId, difficulty = 'medium') {
  const { buildChallenge, buildSamplePayload } = await import('./challengeService');
  const { generateBattlePrompt, flattenRestrictions } = await import('./groq');

  const data = await buildChallenge('trap');
  const sample = data.sample || data;
  const challengePayload = buildSamplePayload(sample);

  const { json: aiJson } = await generateBattlePrompt({
    genre: challengePayload.genre,
    mode: 'solo',
    difficulty,
    loopTitle: challengePayload.title,
    loopBpm: challengePayload.bpm,
    loopKey: challengePayload.key,
  });

  const restrictionsText = flattenRestrictions(aiJson.restrictions) || aiJson.restrictions_text || '';
  challengePayload.instructions = aiJson.instruction || '';
  challengePayload.restrictionsList = restrictionsText;

  // Update room with challenge
  await supabase.from('rooms').update({ challenge: challengePayload }).eq('id', roomId);

  // Update battle with AI content (don't overwrite status/timing — advanceLobbyToActive already set those)
  const { data: room } = await supabase.from('rooms').select('battle_id').eq('id', roomId).maybeSingle();
  if (room?.battle_id) {
    await supabase.from('battles').update({
      title: aiJson.title || challengePayload.title,
      prompt_text: aiJson.instruction || '',
      genre: challengePayload.genre,
      bpm: challengePayload.bpm,
      mood: aiJson.flavor_text || aiJson.mood || '',
      restrictions: restrictionsText,
      flavor_text: aiJson.flavor_text || '',
    }).eq('id', room.battle_id);
  }

  return challengePayload;
}

export async function joinRoom(roomId, userId) {
  const { data: room } = await supabase
    .from('rooms')
    .select('status, max_players, current_players, mode')
    .eq('id', roomId)
    .maybeSingle();

  if (!room) throw new Error('ROOM NOT FOUND');
  if (room.status !== 'lobby') throw new Error('ROOM IS NOT IN LOBBY');
  if (room.mode === 'ranked') throw new Error('CANNOT JOIN RANKED THIS WAY');

  const { count } = await supabase
    .from('room_members')
    .select('room_id', { count: 'exact' })
    .eq('room_id', roomId);

  if (count >= (room.max_players || 4)) throw new Error('ROOM IS FULL');

  const { error } = await supabase
    .from('room_members')
    .insert({ room_id: roomId, user_id: userId, role: 'member', is_ready: false });

  if (error) {
    if (error.code === '23505') return;
    throw error;
  }

  await supabase
    .from('rooms')
    .update({ current_players: (count || 0) + 1 })
    .eq('id', roomId);
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
    .select('room_id', { count: 'exact' })
    .eq('room_id', roomId);

  await supabase
    .from('rooms')
    .update({ current_players: count })
    .eq('id', roomId);
}

export async function closeRoom(roomId, userId) {
  const { data: room } = await supabase
    .from('rooms')
    .select('owner_id, host_id')
    .eq('id', roomId)
    .maybeSingle();

  if (!room) throw new Error('ROOM NOT FOUND');
  if (room.owner_id !== userId && room.host_id !== userId) throw new Error('NOT HOST');

  await supabase.from('rooms').update({ status: 'closed' }).eq('id', roomId);

  const { count } = await supabase
    .from('room_members')
    .select('room_id', { count: 'exact' })
    .eq('room_id', roomId);

  if (count <= 0) {
    await deleteRoom(roomId);
  }
}

export async function deleteRoom(roomId) {
  await supabase.from('room_messages').delete().eq('room_id', roomId);
  await supabase.from('room_members').delete().eq('room_id', roomId);
  await supabase.from('rooms').delete().eq('id', roomId);
}

export async function leaveLobby(roomId, userId) {
  const { data: room } = await supabase
    .from('rooms')
    .select('owner_id, status')
    .eq('id', roomId)
    .maybeSingle();

  const isOwner = room?.owner_id === userId;

  if (isOwner) {
    await supabase.from('room_members').delete().eq('room_id', roomId);
    if (room.status === 'closed') {
      await deleteRoom(roomId);
    } else {
      await supabase.from('rooms').update({ status: 'closed', current_players: 0 }).eq('id', roomId);
    }
  } else {
    await supabase
      .from('room_members')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', userId);

    const { count } = await supabase
      .from('room_members')
      .select('room_id', { count: 'exact' })
      .eq('room_id', roomId);

    if (count <= 0) {
      if (room.status === 'closed') {
        await deleteRoom(roomId);
      } else {
        await supabase.from('rooms').update({ status: 'closed' }).eq('id', roomId);
      }
    } else {
      await supabase
        .from('rooms')
        .update({ current_players: count })
        .eq('id', roomId);
    }
  }
}
