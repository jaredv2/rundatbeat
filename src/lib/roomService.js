import { supabase } from './supabase';
import { devLog } from './devLog';

function log(tag, ...args) {
  devLog(`%c[${new Date().toISOString().slice(11, 23)}] [ROOM] ${tag}`, 'color:#f97316', ...args);
}

export async function createRoom({ isPublic, hostId, maxPlayers = 4, battleMinutes = 45, songLengthSeconds = 60, votingMinutes = 3, name, allowInstructions = true, allowRestrictions = true }) {
  log('CREATE', 'name:', name, 'host:', hostId, 'maxPlayers:', maxPlayers, 'battleMin:', battleMinutes);
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
  log('CREATE', 'room created:', room.id, 'status:', room.status);

  const { error: memberErr } = await supabase
    .from('room_members')
    .insert({ room_id: room.id, user_id: hostId, role: 'owner', is_ready: false });

  if (memberErr) throw memberErr;
  log('CREATE', 'owner added to room_members');

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
  log('READY', 'user:', userId, 'ready:', newReady);

  await supabase
    .from('room_members')
    .update({ is_ready: newReady })
    .eq('room_id', roomId)
    .eq('user_id', userId);

  return newReady;
}

export async function startCountdown(roomId) {
  log('COUNTDOWN', 'starting countdown for room:', roomId);
  await supabase
    .from('rooms')
    .update({ countdown_started_at: new Date().toISOString() })
    .eq('id', roomId);
}

export async function advanceLobbyToActive(roomId) {
  log('LOBBY→ACTIVE', 'advancing room:', roomId);
  // Optimistic lock: only advance if still in lobby
  const { data: room } = await supabase
    .from('rooms')
    .select('mode, status, current_players, song_length_seconds, voting_minutes, challenge')
    .eq('id', roomId)
    .maybeSingle();

  if (!room || room.status !== 'lobby') {
    log('LOBBY→ACTIVE', 'SKIP — room status:', room?.status);
    return null;
  }

  const { count: playerCount } = await supabase
    .from('room_members')
    .select('room_id', { count: 'exact' })
    .eq('room_id', roomId);

  const starts = new Date();
  const duration = room?.challenge?.battleMinutes || 15;
  const songLength = room?.song_length_seconds || 60;
  const votingEnds = new Date(starts.getTime() + duration * 60 * 1000);
  log('LOBBY→ACTIVE', 'players:', playerCount, 'duration:', duration + 'min', 'starts:', starts.toISOString());

  const isSolo = room?.mode === 'solo';
  const battleStatus = isSolo ? 'active' : 'upcoming';

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
      mode: isSolo ? 'solo' : 'quick',
      status: battleStatus,
      starts_at: starts.toISOString(),
      voting_ends_at: votingEnds.toISOString(),
    }).select('id').single();

    if (battleErr) throw battleErr;
    log('LOBBY→ACTIVE', 'battle created:', battle.id);

    // Optimistic lock: only update room if still in lobby (prevents duplicate battles)
    // Preserve full challenge if already generated (restrictionsList means it was generated during countdown)
    const { data: existingRoom } = await supabase.from('rooms').select('challenge').eq('id', roomId).maybeSingle();
    const existingChallenge = existingRoom?.challenge || {};
    const challengeAlreadyGenerated = !!existingChallenge.restrictionsList;
    const { data: updatedRoom, error: roomUpdateErr } = await supabase
      .from('rooms')
      .update({
        battle_id: battle.id,
        status: 'locked',
        challenge: challengeAlreadyGenerated ? existingChallenge : {
          allowInstructions: existingChallenge.allowInstructions !== false,
          allowRestrictions: existingChallenge.allowRestrictions !== false,
          battleMinutes: existingChallenge.battleMinutes || duration,
        },
        countdown_started_at: null,
        battle_starts_in_seconds: 0,
      })
      .eq('id', roomId)
      .eq('status', 'lobby')
      .select('id')
      .maybeSingle();

    if (roomUpdateErr || !updatedRoom) {
      log('LOBBY→ACTIVE', 'RACE LOST — deleting orphan battle:', battle.id);
      // Another client already advanced — delete orphan battle
      await supabase.from('battles').delete().eq('id', battle.id);
      return null;
    }

    log('LOBBY→ACTIVE', 'SUCCESS — room locked, battle linked:', battle.id);

    // Generate challenge AFTER room is locked — only the room owner generates
    // The edge function validates ownership, but this avoids wasted API calls on non-owner clients
    if (!challengeAlreadyGenerated) {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: roomRow } = await supabase.from('rooms').select('owner_id').eq('id', roomId).maybeSingle();
      if (roomRow?.owner_id === user?.id) {
        try {
          await generateCustomRoomChallenge(roomId);
          log('LOBBY→ACTIVE', 'challenge generated for room:', roomId);
        } catch (err) {
          log('LOBBY→ACTIVE', 'challenge generation failed:', err.message);
        }
      } else {
        log('LOBBY→ACTIVE', 'skipped challenge generation — not owner');
      }
    }

    return { battleId: battle.id };
  } catch (err) {
    log('LOBBY→ACTIVE', 'ERROR:', err.message);
    await supabase.from('rooms').update({ countdown_started_at: null }).eq('id', roomId);
    throw err;
  }
}

// Fetch sample + generate AI challenge for a custom room (called during challenge reveal)
export async function generateCustomRoomChallenge(roomId) {
  // Skip if challenge already exists — only generate once per room
  const { data: existingRoom } = await supabase.from('rooms').select('challenge').eq('id', roomId).maybeSingle();
  if (existingRoom?.challenge?.restrictionsList) {
    return existingRoom.challenge;
  }

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
  challengePayload.title = aiJson.title || challengePayload.title;
  challengePayload.mood = aiJson.flavor_text || aiJson.mood || '';
  challengePayload.flavor_text = aiJson.flavor_text || '';

  // Generate instruction genre once — all clients read from challenge
  const BEAT_GENRES = ['TRAP', 'HIPHOP', 'RAGE', 'TDF', 'JERSEY CLUB', 'DRILL', 'HOODTRAP'];
  challengePayload.instructionGenre = BEAT_GENRES[Math.floor(Math.random() * BEAT_GENRES.length)];

  // Preserve room settings from existing challenge
  const roomChallenge = existingRoom?.challenge;
  if (roomChallenge) {
    challengePayload.allowInstructions = roomChallenge.allowInstructions !== false;
    challengePayload.allowRestrictions = roomChallenge.allowRestrictions !== false;
    if (roomChallenge.battleMinutes) {
      challengePayload.battleMinutes = roomChallenge.battleMinutes;
    }
  }

  // Dispatch challenge_ready event — server writes to room + battle atomically
  const { dispatchRoomEvent } = await import('../hooks/useRoomEvents');
  await dispatchRoomEvent({ roomId, eventType: 'challenge_ready', payload: { challenge: challengePayload } });

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
  log('JOIN', 'user:', userId, 'room:', roomId);
  const { dispatchRoomEvent } = await import('../hooks/useRoomEvents');
  await dispatchRoomEvent({ roomId, eventType: 'player_join', payload: {} });
  log('JOIN', 'SUCCESS');
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
  log('LEAVE-LOBBY', 'user:', userId, 'room:', roomId);
  const { data: room } = await supabase
    .from('rooms')
    .select('owner_id, status')
    .eq('id', roomId)
    .maybeSingle();

    const isOwner = room?.owner_id === userId;

  if (isOwner) {
    log('LEAVE-LOBBY', 'owner leaving — dispatching owner_leave');
    const { dispatchRoomEvent } = await import('../hooks/useRoomEvents');
    await dispatchRoomEvent({ roomId, eventType: 'owner_leave', payload: {} });
    return;
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
      log('LEAVE-LOBBY', 'last player left — closing room');
      if (room.status === 'closed') {
        await deleteRoom(roomId);
      } else {
        await supabase.from('rooms').update({ status: 'closed' }).eq('id', roomId);
      }
    } else {
      log('LEAVE-LOBBY', 'remaining players:', count);
      await supabase
        .from('rooms')
        .update({ current_players: count })
        .eq('id', roomId);
    }
  }
}
