import { supabase } from './supabase';

const MAX_PLAYERS = 10;

export async function enterQueue(userId) {
  // Clean up any stale lobby memberships from previous matches
  await supabase.from('ranked_lobby_members').delete().eq('user_id', userId);

  const { data: profile } = await supabase
    .from('profiles')
    .select('elo, rank_tier')
    .eq('id', userId)
    .maybeSingle();

  const playerElo = profile?.elo ?? 1000;

  const { data: candidates } = await supabase
    .from('ranked_lobbies')
    .select('*, ranked_lobby_members!inner(user_id)')
    .eq('status', 'matching')
    .lt('current_players', MAX_PLAYERS);

  let bestLobby = null;
  let bestScore = Infinity;

  if (candidates?.length) {
    for (const lobby of candidates) {
      const { data: members } = await supabase
        .from('ranked_lobby_members')
        .select('user_id')
        .eq('lobby_id', lobby.id);

      if (!members || members.length >= MAX_PLAYERS) continue;

      const { data: memberProfiles } = await supabase
        .from('profiles')
        .select('elo')
        .in('id', members.map(m => m.user_id));

      const avgElo = memberProfiles?.length
        ? memberProfiles.reduce((s, p) => s + (p.elo ?? 1000), 0) / memberProfiles.length
        : 1000;

      const score = Math.abs(playerElo - avgElo);
      const fillRatio = members.length / MAX_PLAYERS;

      const weightedScore = score * (1 - fillRatio * 0.5);

      if (weightedScore < bestScore) {
        bestScore = weightedScore;
        bestLobby = lobby;
      }
    }
  }

  let lobby;
  if (bestLobby) {
    const { data: updated, error: lockErr } = await supabase
      .from('ranked_lobbies')
      .update({ current_players: bestLobby.current_players + 1 })
      .eq('id', bestLobby.id)
      .eq('current_players', bestLobby.current_players)
      .select('*')
      .single();

    if (lockErr || !updated) {
      return enterQueue(userId);
    }
    lobby = updated;
  } else {
    const { data: newLobby, error: createErr } = await supabase
      .from('ranked_lobbies')
      .insert({ current_players: 1, status: 'matching', max_players: MAX_PLAYERS })
      .select('*')
      .single();
    if (createErr) throw createErr;
    lobby = newLobby;
  }

  const role = lobby.current_players === 1 ? 'host' : 'member';
  const { error: memberErr } = await supabase
    .from('ranked_lobby_members')
    .insert({ lobby_id: lobby.id, user_id: userId, role });
  if (memberErr) throw memberErr;

  return lobby;
}

export async function leaveLobby(lobbyId, userId) {
  await supabase.from('ranked_lobby_members').delete().eq('lobby_id', lobbyId).eq('user_id', userId);

  const { count } = await supabase
    .from('ranked_lobby_members')
    .select('id', { count: 'exact', head: true })
    .eq('lobby_id', lobbyId);

  if (count <= 0) {
    await supabase.from('ranked_lobbies').update({ status: 'closed' }).eq('id', lobbyId);
  } else {
    await supabase.from('ranked_lobbies').update({ current_players: count }).eq('id', lobbyId);
  }
}

export async function toggleReady(lobbyId, userId) {
  const { data: member } = await supabase
    .from('ranked_lobby_members')
    .select('is_ready')
    .eq('lobby_id', lobbyId)
    .eq('user_id', userId)
    .maybeSingle();

  const newReady = !member?.is_ready;
  await supabase.from('ranked_lobby_members').update({ is_ready: newReady }).eq('lobby_id', lobbyId).eq('user_id', userId);
  return newReady;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function startCountdown(lobbyId) {
  const { data: existing } = await supabase
    .from('ranked_lobbies')
    .select('countdown_started_at')
    .eq('id', lobbyId)
    .maybeSingle();
  if (existing?.countdown_started_at) return;

  const { data: claimed } = await supabase
    .from('ranked_lobbies')
    .update({ countdown_started_at: new Date().toISOString() })
    .eq('id', lobbyId)
    .is('countdown_started_at', null)
    .select('id');
  if (!claimed?.length) return;

  try {
    const genre = 'trap';
    const { buildChallenge, buildSamplePayload } = await import('./challengeService');
    const { generateBattlePrompt, flattenRestrictions } = await import('./groq');

    const data = await buildChallenge(genre);
    const sample = data.sample || data;
    const restriction = data.restriction || '';
    const challengePayload = buildSamplePayload(sample, restriction);

    const { json: aiJson } = await generateBattlePrompt({
      genre: challengePayload.genre,
      mode: 'ranked',
      tier: 'bronze',
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
      song_length_seconds: 90,
      mode: 'ranked',
      status: 'upcoming',
      starts_at: starts.toISOString(),
      voting_ends_at: votingEnds.toISOString(),
    }).select('id').single();
    if (battleErr) throw battleErr;

    const { data: members } = await supabase
      .from('ranked_lobby_members')
      .select('user_id')
      .eq('lobby_id', lobbyId);

    const hostIndex = Math.floor(Math.random() * (members?.length || 1));
    const hostUserId = members?.[hostIndex]?.user_id || null;

    const { data: room, error: roomErr } = await supabase.from('rooms').insert({
      name: 'RANKED MATCH',
      mode: 'ranked',
      status: 'locked',
      battle_id: battle.id,
      max_players: members?.length || 2,
      current_players: members?.length || 2,
      owner_id: hostUserId,
      is_public: false,
      challenge: challengePayload,
      battle_starts_in_seconds: startDelay,
      song_length_seconds: 90,
      voting_minutes: 3,
    }).select('*').single();
    if (roomErr) throw roomErr;

    if (members?.length) {
      await supabase.from('room_members').insert(
        members.map((m, i) => ({
          room_id: room.id,
          user_id: m.user_id,
          role: i === hostIndex ? 'owner' : 'member',
          is_ready: true,
        }))
      );
    }

    await supabase.from('ranked_lobbies').update({ battle_id: battle.id, challenge: challengePayload }).eq('id', lobbyId);
  } catch (err) {
    console.error('[lobbyService] startCountdown failed, resetting:', err);
    await supabase.from('ranked_lobbies').update({ countdown_started_at: null }).eq('id', lobbyId);
    throw err;
  }
}

export async function advanceLobbyToActive(lobbyId) {
  const { data: lobby } = await supabase
    .from('ranked_lobbies')
    .select('battle_id, status')
    .eq('id', lobbyId)
    .maybeSingle();

  if (!lobby || lobby.status === 'closed') throw new Error('LOBBY ALREADY CLOSED');

  let battleId = lobby.battle_id;
  for (let i = 0; i < 20 && !battleId; i++) {
    await sleep(500);
    const { data: refreshed } = await supabase
      .from('ranked_lobbies')
      .select('battle_id')
      .eq('id', lobbyId)
      .maybeSingle();
    battleId = refreshed?.battle_id;
  }
  if (!battleId) throw new Error('BATTLE NOT READY YET');

  const { data: existing } = await supabase
    .from('rooms')
    .select('id')
    .eq('battle_id', battleId)
    .maybeSingle();
  if (!existing) throw new Error('ROOM NOT FOUND');

  await supabase.from('ranked_lobbies').update({
    status: 'closed',
    countdown_started_at: null,
  }).eq('id', lobbyId);

  return { battleId, roomId: existing.id };
}
