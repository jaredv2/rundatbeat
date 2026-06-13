import { supabase } from './supabase';
import { useAuthStore } from '../store/authStore';

const MAX_PLAYERS = 10;
const MAX_QUEUE_RETRIES = 5;

export async function enterQueue(userId, retries = 0) {
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
      if (retries >= MAX_QUEUE_RETRIES) throw new Error('QUEUE BUSY — TRY AGAIN');
      return enterQueue(userId, retries + 1);
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
    .select('id', { count: 'exact' })
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
  // Check if already started
  const { data: existing } = await supabase
    .from('ranked_lobbies')
    .select('countdown_started_at, battle_id')
    .eq('id', lobbyId)
    .maybeSingle();
  if (existing?.countdown_started_at) return;

  try {
    const { data: members } = await supabase
      .from('ranked_lobby_members')
      .select('user_id')
      .eq('lobby_id', lobbyId);

    const startDelay = 15;
    const starts = new Date(Date.now() + startDelay * 1000);
    const duration = 15;
    const votingEnds = new Date(starts.getTime() + duration * 60 * 1000);

    // Create battle FIRST
    const { data: battle, error: battleErr } = await supabase.from('battles').insert({
      title: 'RANKED MATCH',
      prompt_text: '',
      genre: 'trap',
      mood: '',
      restrictions: '',
      reference_artists: [],
      flavor_text: '',
      duration_minutes: duration,
      song_length_seconds: 90,
      mode: 'ranked',
      status: 'upcoming',
      starts_at: starts.toISOString(),
      voting_ends_at: votingEnds.toISOString(),
    }).select('id').single();
    if (battleErr) throw battleErr;

    // Link battle to lobby
    await supabase.from('ranked_lobbies').update({ battle_id: battle.id }).eq('id', lobbyId);

    // Create room
    const { data: room, error: roomErr } = await supabase.from('rooms').insert({
      name: 'RANKED MATCH',
      mode: 'ranked',
      status: 'locked',
      battle_id: battle.id,
      max_players: members?.length || 2,
      current_players: members?.length || 2,
      owner_id: useAuthStore.getState().profile?.id,
      is_public: false,
      battle_starts_in_seconds: startDelay,
      song_length_seconds: 90,
      voting_minutes: 3,
    }).select('*').single();
    if (roomErr) throw roomErr;

    // Insert ALL lobby members into room_members (ignore duplicates)
    if (members?.length) {
      const currentUser = useAuthStore.getState().profile?.id;
      const memberRows = members.map((m) => ({
        room_id: room.id,
        user_id: m.user_id,
        role: m.user_id === currentUser ? 'owner' : 'member',
        is_ready: false,
      }));
      const { error: batchErr } = await supabase.from('room_members').insert(memberRows);
      // Ignore duplicate key errors (race with advanceLobbyToActive)
      if (batchErr && batchErr.code !== '23505') throw batchErr;
    }

    // NOW set countdown_started_at — battle + room are guaranteed to exist
    await supabase.from('ranked_lobbies').update({
      countdown_started_at: new Date().toISOString(),
    }).eq('id', lobbyId).is('countdown_started_at', null);

  } catch (err) {
    // Reset on failure so it can be retried
    await supabase.from('ranked_lobbies').update({
      countdown_started_at: null,
      battle_id: null,
    }).eq('id', lobbyId);
    throw err;
  }
}

export async function generateChallengeAsync(battleId, roomId, lobbyId) {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const genre = 'trap';
      const { buildChallenge, buildSamplePayload } = await import('./challengeService');
      const { generateBattlePrompt, flattenRestrictions, difficultyFromTier } = await import('./groq');

      // Compute lobby average tier for difficulty scaling
      let lobbyTier = 'bronze';
      try {
        const { data: members } = await supabase
          .from('ranked_lobby_members')
          .select('user_id')
          .eq('lobby_id', lobbyId);
        if (members?.length) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('rank_tier')
            .in('id', members.map(m => m.user_id));
          const order = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'goat'];
          const avgIdx = profiles?.length
            ? Math.round(profiles.reduce((s, p) => s + order.indexOf(p.rank_tier || 'bronze'), 0) / profiles.length)
            : 0;
          lobbyTier = order[Math.max(0, Math.min(order.length - 1, avgIdx))] || 'bronze';
        }
      } catch { /* fallback to bronze */ }

      const data = await buildChallenge(genre);
      const sample = data.sample || data;
      const challengePayload = buildSamplePayload(sample);

      const { json: aiJson } = await generateBattlePrompt({
        genre: challengePayload.genre,
        mode: 'ranked',
        tier: lobbyTier,
        loopTitle: challengePayload.title,
        loopBpm: challengePayload.bpm,
        loopKey: challengePayload.key,
      });

      const restrictionsText = flattenRestrictions(aiJson.restrictions) || aiJson.restrictions_text || '';
      challengePayload.instructions = aiJson.instruction || '';
      challengePayload.restrictionsList = restrictionsText;

      await supabase.from('battles').update({
        title: aiJson.title || challengePayload.title,
        prompt_text: aiJson.instruction || '',
        genre: challengePayload.genre,
        bpm: challengePayload.bpm,
        mood: aiJson.flavor_text || aiJson.mood || '',
        restrictions: restrictionsText,
        flavor_text: aiJson.flavor_text || '',
      }).eq('id', battleId);

      await supabase.from('rooms').update({ challenge: challengePayload }).eq('id', roomId);
      await supabase.from('ranked_lobbies').update({ challenge: challengePayload }).eq('id', lobbyId);
      return;
    } catch (err) {
      console.error(`generateChallengeAsync attempt ${attempt + 1} failed:`, err);
      if (attempt < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, 2000));
    }
  }
}

export async function fetchChallengeFromLobby(battleId) {
  const { data: lobby } = await supabase
    .from('ranked_lobbies')
    .select('challenge')
    .eq('battle_id', battleId)
    .maybeSingle();
  return lobby?.challenge || null;
}

export async function advanceLobbyToActive(lobbyId) {
  const { data: lobby } = await supabase
    .from('ranked_lobbies')
    .select('battle_id, status')
    .eq('id', lobbyId)
    .maybeSingle();

  if (!lobby || lobby.status === 'closed') return { battleId: lobby?.battle_id || null };

  let battleId = lobby.battle_id;
  for (let i = 0; i < 60 && !battleId; i++) {
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

  // Each client inserts itself into room_members (RLS: auth.uid() = user_id)
  const currentUser = useAuthStore.getState().profile?.id;
  if (currentUser) {
    const { error: joinErr } = await supabase
      .from('room_members')
      .insert({ room_id: existing.id, user_id: currentUser, role: 'member', is_ready: false })
      .select()
      .maybeSingle();
    // Ignore duplicate key error (already a member)
    if (joinErr && joinErr.code !== '23505') {
      // Non-duplicate error — still proceed, realtime may catch up
    }
  }

  await supabase.from('ranked_lobbies').update({
    status: 'closed',
    countdown_started_at: null,
  }).eq('id', lobbyId);

  return { battleId, roomId: existing.id };
}
