/* eslint-disable no-console */
import { supabase } from './supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { useBattleStore } from '../store/battleStore';
import { useTokenStore } from '../store/tokenStore';
import { useFriendStore } from '../store/friendStore';
import { enterQueue, leaveLobby, startCountdown, advanceLobbyToActive, generateChallengeAsync } from './lobbyService';
import { createRoom } from './roomService';
import { getChallengeSample } from './challengeService';
import { computeNewElos, tierFromElo, runEloTests } from './elo';

(() => {
if (!import.meta.env.DEV) return;

function uid() { return useAuthStore.getState().profile?.id; }
function label(icon, text) { return `%c${icon} ${text}`; }
const HL = 'color:#f97316;font-weight:bold';
const OK = 'color:#22c55e;font-weight:bold';
const ER = 'color:#ef4444;font-weight:bold';
const DIM = 'color:#6b7280';

async function dbOp(promise, successMsg) {
  const { data, error } = await promise;
  if (error) { console.log(label('❌', error.message), ER); return null; }
  if (successMsg) console.log(label('✅', successMsg), OK);
  return data;
}

function table(data, title) {
  if (title) console.log(`%c${title}`, HL);
  console.table(data);
}

function dumpProfile(p) {
  if (!p) { console.log('%cNo profile loaded', ER); return; }
  console.log(label('👤', 'PROFILE'), HL);
  console.log(`  ID:       ${p.id}`);
  console.log(`  Username: ${p.username}`);
  console.log(`  ELO:      ${p.elo} (${tierFromElo(p.elo)})`);
  console.log(`  Wins/Losses: ${p.ranked_wins || 0}W / ${p.ranked_losses || 0}L`);
  console.log(`  Tokens:   ${p.tokens ?? 'N/A'}`);
  console.log(`  Rank:     ${p.rank_tier || 'bronze'}`);
  console.log(`  Admin:    ${p.is_admin || false}`);
}

// ─── COMMANDS ───────────────────────────────────────────────────────────────

const cmds = {};

// ── 1. whoami ──
cmds.whoami = () => {
  const p = useAuthStore.getState().profile;
  dumpProfile(p);
};

// ── 2. myElo ──
cmds.myElo = () => {
  const p = useAuthStore.getState().profile;
  if (!p) return console.log('%cNot logged in', ER);
  console.log(label('🏆', 'ELO'), HL);
  console.log(`  Current:  ${p.elo}`);
  console.log(`  Tier:     ${tierFromElo(p.elo)}`);
  console.log(`  Base ELO: ±3 × tier multiplier`);
  console.log(`  Wins:     ${p.ranked_wins || 0}`);
  console.log(`  Losses:   ${p.ranked_losses || 0}`);
};

// ── 3. testElo ──
cmds.testElo = () => runEloTests();

// ── 4. computeElo ──
cmds.computeElo = (players, ranking) => {
  console.log(label('🧮', 'ELO COMPUTE'), HL);
  console.log(computeNewElos(players, ranking));
};

// ── 5. tierFromElo ──
cmds.tierFromElo = (elo) => {
  const tier = tierFromElo(elo);
  console.log(`${elo} → %c${tier}`, OK);
  return tier;
};

// ── 6. toasts ──
cmds.toast = (msg, type) => {
  useUiStore.getState().addToast(msg || 'TEST TOAST', type || 'info');
};
cmds.toastError = (msg) => cmds.toast(msg || 'ERROR', 'error');
cmds.toastSuccess = (msg) => cmds.toast(msg || 'SUCCESS', 'success');

// ── 7. refreshProfile ──
cmds.refreshProfile = async () => {
  console.log(label('🔄', 'Refreshing profile...'), DIM);
  await useAuthStore.getState().refreshProfile();
  dumpProfile(useAuthStore.getState().profile);
};

// ── 8. onlinePlayers ──
cmds.onlinePlayers = async () => {
  const since = new Date(Date.now() - 120000).toISOString();
  const { data, count } = await supabase
    .from('user_presence').select('user_id, last_seen_at', { count: 'exact' })
    .gte('last_seen_at', since);
  console.log(label('🟢', `${count || 0} ONLINE PLAYERS`), OK);
  if (data?.length) console.table(data.map(r => ({ id: r.user_id.slice(0, 8), last_seen: new Date(r.last_seen_at).toLocaleTimeString() })));
};

// ── 9. myRoom ──
cmds.myRoom = async () => {
  const id = uid();
  if (!id) return console.log('%cNot logged in', ER);
  const { data } = await supabase.from('room_members').select('room_id').eq('user_id', id).limit(1).maybeSingle();
  if (!data) { console.log('%cNot in any room', DIM); return; }
  const { data: room } = await supabase.from('rooms').select('*, battles(title, status)').eq('id', data.room_id).single();
  console.log(label('🏠', 'CURRENT ROOM'), HL);
  console.log(`  ID:     ${room.id}`);
  console.log(`  Name:   ${room.name}`);
  console.log(`  Status: ${room.status}`);
  console.log(`  Mode:   ${room.mode}`);
  console.log(`  Battle: ${room.battles?.title || room.battle_id}`);
  return room;
};

// ── 10. myLobby ──
cmds.myLobby = async () => {
  const id = uid();
  if (!id) return console.log('%cNot logged in', ER);
  const { data } = await supabase.from('ranked_lobby_members').select('lobby_id').eq('user_id', id).limit(1).maybeSingle();
  if (!data) { console.log('%cNot in any lobby', DIM); return; }
  const { data: lobby } = await supabase.from('ranked_lobbies').select('*').eq('id', data.lobby_id).single();
  const { data: members } = await supabase.from('ranked_lobby_members').select('user_id, profiles(username, elo)').eq('lobby_id', data.lobby_id);
  console.log(label('🎯', 'CURRENT LOBBY'), HL);
  console.log(`  ID:       ${lobby.id}`);
  console.log(`  Status:   ${lobby.status}`);
  console.log(`  Players:  ${members?.length || 0}/${lobby.max_players}`);
  console.log(`  Challenge: ${lobby.challenge ? 'SET' : 'none'}`);
  if (members?.length) table(members.map(m => ({ user: m.profiles?.username, elo: m.profiles?.elo })), 'MEMBERS');
  return lobby;
};

// ── 11. activeRooms ──
cmds.activeRooms = async () => {
  const { data } = await supabase.from('rooms').select('id, name, status, mode, current_players, battle_id').in('status', ['open', 'locked', 'voting']).order('created_at', { ascending: false });
  console.log(label('🏟️', `${data?.length || 0} ACTIVE ROOMS`), OK);
  if (data?.length) table(data.map(r => ({ name: r.name, status: r.status, mode: r.mode, players: r.current_players, battle: r.battle_id?.slice(0, 8) })));
};

// ── 12. activeLobbies ──
cmds.activeLobbies = async () => {
  const { data } = await supabase.from('ranked_lobbies').select('*').in('status', ['matching', 'ready']).order('created_at', { ascending: false });
  console.log(label('📋', `${data?.length || 0} ACTIVE LOBBIES`), OK);
  if (data?.length) table(data.map(l => ({ id: l.id.slice(0, 8), status: l.status, players: `${l.current_players}/${l.max_players}`, countdown: l.countdown_started_at ? 'YES' : 'no' })));
};

// ── 13. submissions ──
cmds.submissions = async (battleId) => {
  if (!battleId) { console.log('%cUsage: db.submissions("battle-id")', DIM); return; }
  const { data } = await supabase.from('submissions').select('user_id, loop_url, created_at, profiles(username)').eq('battle_id', battleId);
  console.log(label('🎵', `${data?.length || 0} SUBMISSIONS`), OK);
  if (data?.length) table(data.map(s => ({ user: s.profiles?.username, url: s.loop_url?.slice(0, 60), time: new Date(s.created_at).toLocaleTimeString() })));
};

// ── 14. votes ──
cmds.votes = async (battleId) => {
  if (!battleId) { console.log('%cUsage: db.votes("battle-id")', DIM); return; }
  const { data } = await supabase.from('votes').select('voter_id, target_user_id, rating, battle_id, profiles:voter_id(username)').eq('battle_id', battleId);
  console.log(label('🗳️', `${data?.length || 0} VOTES`), OK);
  if (data?.length) table(data.map(v => ({ from: v.profiles?.username, to: v.target_user_id?.slice(0, 8), rating: v.rating })));
};

// ── 15. messages ──
cmds.messages = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.messages("lobby-id")', DIM); return; }
  const { data } = await supabase.from('lobby_messages').select('body, created_at, profiles(username)').eq('lobby_id', lobbyId).order('created_at');
  console.log(label('💬', `${data?.length || 0} MESSAGES`), OK);
  if (data?.length) table(data.map(m => ({ from: m.profiles?.username, body: m.body, time: new Date(m.created_at).toLocaleTimeString() })));
};

// ── 16. queue ──
cmds.queue = async () => {
  const id = uid();
  if (!id) return console.log('%cNot logged in', ER);
  console.log(label('⏳', 'Entering ranked queue...'), DIM);
  const lobby = await enterQueue(id);
  console.log(label('✅', `Joined lobby ${lobby.id.slice(0, 8)}`), OK);
  return lobby;
};

// ── 17. leaveQueue ──
cmds.leaveQueue = async () => {
  const id = uid();
  if (!id) return console.log('%cNot logged in', ER);
  const { data } = await supabase.from('ranked_lobby_members').select('lobby_id').eq('user_id', id).limit(1).maybeSingle();
  if (!data) { console.log('%cNot in a queue', DIM); return; }
  await leaveLobby(data.lobby_id, id);
  console.log(label('❌', 'Left queue'), OK);
};

// ── 18. createRoom ──
cmds.createRoom = async (opts) => {
  const id = uid();
  if (!id) return console.log('%cNot logged in', ER);
  const { room, roomCode } = await createRoom({ hostId: id, isPublic: true, maxPlayers: 8, ...opts });
  console.log(label('🏗️', 'ROOM CREATED'), OK);
  console.log(`  ID:   ${room.id}`);
  console.log(`  Code: ${roomCode}`);
  return room;
};

// ── 19. forceClose ──
cmds.forceClose = async (roomId) => {
  if (!roomId) { console.log('%cUsage: db.forceClose("room-id")', DIM); return; }
  await supabase.from('rooms').update({ status: 'closed' }).eq('id', roomId);
  console.log(label('🔒', `Room ${roomId.slice(0, 8)} closed`), OK);
};

// ── 20. forceBattleClose ──
cmds.forceBattleClose = async (battleId) => {
  if (!battleId) { console.log('%cUsage: db.forceBattleClose("battle-id")', DIM); return; }
  await supabase.from('battles').update({ status: 'closed', early_closed: false }).eq('id', battleId);
  console.log(label('🔒', `Battle ${battleId.slice(0, 8)} closed`), OK);
};

// ── 21. setElo ──
cmds.setElo = async (targetUserId, elo) => {
  if (!targetUserId || elo === undefined) { console.log('%cUsage: db.setElo("user-id", 1200)', DIM); return; }
  await supabase.from('profiles').update({ elo, rank_tier: tierFromElo(elo) }).eq('id', targetUserId);
  console.log(label('✏️', `ELO set to ${elo} (${tierFromElo(elo)})`), OK);
};

// ── 22. myElo ── (already defined above as #2)

// ── 23. testChallenge ──
cmds.testChallenge = async (genre) => {
  console.log(label('🎲', `Fetching challenge: ${genre || 'trap'}...`), DIM);
  const sample = await getChallengeSample(genre || 'trap');
  console.log(label('✅', 'CHALLENGE SAMPLE'), OK);
  console.log(sample);
  return sample;
};

// ── 24. realtimeChannels ──
cmds.realtimeChannels = () => {
  const channels = supabase.getChannels();
  console.log(label('📡', `${channels.length} ACTIVE CHANNELS`), OK);
  channels.forEach(ch => console.log(`  ${ch.topic}`));
  return channels;
};

// ── 25. killChannels ──
cmds.killChannels = () => {
  const count = supabase.getChannels().length;
  supabase.removeAllChannels();
  console.log(label('☠️', `Killed ${count} channels`), OK);
};

// ── 26. health ──
cmds.health = async () => {
  console.log(label('🩺', 'SYSTEM HEALTH'), HL);
  const { data: auth } = await supabase.auth.getSession();
  console.log(`  Auth:     ${auth?.session ? '✅' : '❌'}`);
  const p = useAuthStore.getState().profile;
  console.log(`  Profile:  ${p ? '✅' : '❌'}`);
  const { count: presences } = await supabase.from('user_presence').select('user_id', { count: 'exact' }).gte('last_seen_at', new Date(Date.now() - 120000).toISOString());
  console.log(`  Online:   ${presences || 0} players`);
  const channels = supabase.getChannels();
  console.log(`  Channels: ${channels.length}`);
  const { count: rooms } = await supabase.from('rooms').select('id', { count: 'exact' }).in('status', ['open', 'locked', 'voting']);
  console.log(`  Rooms:    ${rooms || 0} active`);
  const { count: lobbies } = await supabase.from('ranked_lobbies').select('id', { count: 'exact' }).in('status', ['matching', 'ready']);
  console.log(`  Lobbies:  ${lobbies || 0} searching`);
};

// ── 27. fakeJoin ──
cmds.fakeJoin = async (lobbyId) => {
  const id = uid();
  if (!id) return console.log('%cNot logged in', ER);
  if (!lobbyId) { console.log('%cUsage: db.fakeJoin("lobby-id")', DIM); return; }
  await supabase.from('ranked_lobby_members').insert({ lobby_id: lobbyId, user_id: id });
  console.log(label('➕', `Joined lobby ${lobbyId.slice(0, 8)}`), OK);
};

// ── 28. db ── (raw query helper)
cmds.db = {
  from: (table) => ({
    select: (cols, opts) => supabase.from(table).select(cols || '*', opts),
    insert: (row) => supabase.from(table).insert(row),
    update: (row) => supabase.from(table).update(row),
    delete: () => supabase.from(table).delete(),
    eq: (col, val) => supabase.from(table).select('*').eq(col, val),
  }),
};

// ── 29. session ──
cmds.session = () => {
  const s = useAuthStore.getState().session;
  if (!s) { console.log('%cNo session', ER); return; }
  console.log(label('🔑', 'SESSION'), HL);
  console.log(`  User:     ${s.user?.id?.slice(0, 8)}`);
  console.log(`  Expires:  ${new Date(s.expires_at * 1000).toLocaleString()}`);
  console.log(`  Token:    ${s.access_token?.slice(0, 20)}...`);
};

// ── 30. logout ──
cmds.logout = async () => {
  await useAuthStore.getState().logout();
  console.log(label('👋', 'Logged out'), OK);
};

// ── 31. roomState ──
cmds.roomState = async (roomId) => {
  if (!roomId) { console.log('%cUsage: db.roomState("room-id")', DIM); return; }
  const { data: room } = await supabase.from('rooms').select('*').eq('id', roomId).single();
  if (!room) { console.log('%cRoom not found', ER); return; }
  const { data: members } = await supabase.from('room_members').select('user_id, is_ready, role, profiles(username, elo, rank_tier)').eq('room_id', roomId);
  const { data: battle } = room.battle_id ? await supabase.from('battles').select('*').eq('id', room.battle_id).single() : { data: null };
  console.log(label('🏠', 'ROOM STATE'), HL);
  console.log(`  ID:          ${room.id}`);
  console.log(`  Name:        ${room.name}`);
  console.log(`  Code:        ${room.room_code}`);
  console.log(`  Status:      %c${room.status}`, room.status === 'closed' ? ER : OK);
  console.log(`  Mode:        ${room.mode || 'classic'}`);
  console.log(`  Players:     ${room.current_players}/${room.max_players}`);
  console.log(`  Timer:       ${room.timer_enabled ? 'ON' : 'OFF'}`);
  console.log(`  Battle ID:   ${room.battle_id || 'none'}`);
  console.log(`  Owner:       ${room.owner_id?.slice(0, 8) || 'none'}`);
  console.log(`  Countdown:   ${room.countdown_started_at || 'none'}`);
  console.log(`  Created:     ${new Date(room.created_at).toLocaleString()}`);
  if (battle) {
    console.log(label('⚔️', 'BATTLE'), HL);
    console.log(`  Status:      %c${battle.status}`, battle.status === 'closed' ? ER : OK);
    console.log(`  Title:       ${battle.title}`);
    console.log(`  Genre:       ${battle.genre}`);
    console.log(`  Starts:      ${battle.starts_at ? new Date(battle.starts_at).toLocaleString() : 'none'}`);
    console.log(`  Ends:        ${battle.ends_at ? new Date(battle.ends_at).toLocaleString() : 'none'}`);
    console.log(`  Early close: ${battle.early_closed || false}`);
  }
  if (members?.length) {
    table(members.map(m => ({
      user: m.profiles?.username,
      elo: m.profiles?.elo,
      tier: m.profiles?.rank_tier,
      ready: m.is_ready ? '✅' : '❌',
      role: m.role,
    })), 'MEMBERS');
  }
  return { room, members, battle };
};

// ── 32. lobbyState ──
cmds.lobbyState = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.lobbyState("lobby-id")', DIM); return; }
  const { data: lobby } = await supabase.from('ranked_lobbies').select('*').eq('id', lobbyId).single();
  if (!lobby) { console.log('%cLobby not found', ER); return; }
  const { data: members } = await supabase.from('ranked_lobby_members').select('user_id, joined_at, profiles(username, elo, rank_tier, ranked_wins, ranked_losses)').eq('lobby_id', lobbyId).order('joined_at');
  console.log(label('🎯', 'LOBBY STATE'), HL);
  console.log(`  ID:          ${lobby.id}`);
  console.log(`  Status:      %c${lobby.status}`, lobby.status === 'closed' ? ER : OK);
  console.log(`  Players:     ${members?.length || 0}/${lobby.max_players}`);
  console.log(`  Challenge:   ${lobby.challenge ? '✅ SET' : '❌ NONE'}`);
  console.log(`  Battle ID:   ${lobby.battle_id || 'pending'}`);
  console.log(`  Countdown:   ${lobby.countdown_started_at || 'not started'}`);
  console.log(`  Created:     ${new Date(lobby.created_at).toLocaleString()}`);
  if (lobby.challenge) {
    console.log(label('🎲', 'CHALLENGE'), HL);
    console.log(`  Title:       ${lobby.challenge.title}`);
    console.log(`  BPM:         ${lobby.challenge.bpm}`);
    console.log(`  Key:         ${lobby.challenge.key}`);
    console.log(`  Genre:       ${lobby.challenge.genre}`);
  }
  if (members?.length) {
    table(members.map(m => ({
      user: m.profiles?.username,
      elo: m.profiles?.elo,
      tier: m.profiles?.rank_tier,
      wins: m.profiles?.ranked_wins || 0,
      losses: m.profiles?.ranked_losses || 0,
      joined: new Date(m.joined_at).toLocaleTimeString(),
    })), 'MEMBERS');
  }
  return { lobby, members };
};

// ── 33. battleState ──
cmds.battleState = async (battleId) => {
  if (!battleId) { console.log('%cUsage: db.battleState("battle-id")', DIM); return; }
  const { data: battle } = await supabase.from('battles').select('*').eq('id', battleId).single();
  if (!battle) { console.log('%cBattle not found', ER); return; }
  const { data: subs } = await supabase.from('submissions').select('user_id, loop_url, created_at, profiles(username, elo)').eq('battle_id', battleId);
  const { data: votes } = await supabase.from('votes').select('voter_id, target_user_id, rating, profiles:voter_id(username)').eq('battle_id', battleId);
  console.log(label('⚔️', 'BATTLE STATE'), HL);
  console.log(`  ID:          ${battle.id}`);
  console.log(`  Title:       ${battle.title}`);
  console.log(`  Status:      %c${battle.status}`, battle.status === 'closed' ? ER : OK);
  console.log(`  Genre:       ${battle.genre}`);
  console.log(`  Mode:        ${battle.mode || 'classic'}`);
  console.log(`  Submissions: ${subs?.length || 0}`);
  console.log(`  Votes:       ${votes?.length || 0}`);
  console.log(`  Starts:      ${battle.starts_at ? new Date(battle.starts_at).toLocaleString() : 'none'}`);
  console.log(`  Ends:        ${battle.ends_at ? new Date(battle.ends_at).toLocaleString() : 'none'}`);
  console.log(`  Early close: ${battle.early_closed || false}`);
  if (subs?.length) {
    table(subs.map(s => ({
      user: s.profiles?.username,
      elo: s.profiles?.elo,
      url: s.loop_url?.slice(0, 50),
      time: new Date(s.created_at).toLocaleTimeString(),
    })), 'SUBMISSIONS');
  }
  if (votes?.length) {
    table(votes.map(v => ({
      from: v.profiles?.username,
      to: v.target_user_id?.slice(0, 8),
      rating: v.rating,
    })), 'VOTES');
  }
  return { battle, submissions: subs, votes };
};

// ── 34. countdown ──
cmds.countdown = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.countdown("lobby-id")', DIM); return; }
  console.log(label('⏱️', 'Starting countdown...'), DIM);
  await startCountdown(lobbyId);
  const { data: lobby } = await supabase.from('ranked_lobbies').select('countdown_started_at, battle_id').eq('id', lobbyId).single();
  console.log(label('✅', 'Countdown started'), OK);
  console.log(`  Started at:  ${lobby?.countdown_started_at}`);
  console.log(`  Battle ID:   ${lobby?.battle_id || 'pending'}`);
};

// ── 35. advanceLobby ──
cmds.advanceLobby = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.advanceLobby("lobby-id")', DIM); return; }
  console.log(label('⏩', 'Advancing lobby to active...'), DIM);
  const result = await advanceLobbyToActive(lobbyId);
  console.log(label('✅', 'Lobby advanced'), OK);
  console.log(`  Battle ID:   ${result.battleId}`);
  console.log(`  Room ID:     ${result.roomId}`);
  return result;
};

// ── 36. genChallenge ──
cmds.genChallenge = async (battleId, roomId, lobbyId) => {
  if (!battleId || !roomId || !lobbyId) {
    console.log('%cUsage: db.genChallenge("battle-id", "room-id", "lobby-id")', DIM);
    return;
  }
  console.log(label('🤖', 'Generating challenge...'), DIM);
  await generateChallengeAsync(battleId, roomId, lobbyId);
  const { data } = await supabase.from('battles').select('challenge').eq('id', battleId).single();
  console.log(label('✅', 'Challenge generated'), OK);
  console.log(data?.challenge);
  return data?.challenge;
};

// ── 37. inspectRoom ──
cmds.inspectRoom = async (roomId) => {
  if (!roomId) { console.log('%cUsage: db.inspectRoom("room-id")', DIM); return; }
  const { data: room } = await supabase.from('rooms').select('*').eq('id', roomId).single();
  console.log(label('🔍', 'RAW ROOM DATA'), HL);
  console.dir(room);
  return room;
};

// ── 38. inspectLobby ──
cmds.inspectLobby = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.inspectLobby("lobby-id")', DIM); return; }
  const { data } = await supabase.from('ranked_lobbies').select('*').eq('id', lobbyId).single();
  console.log(label('🔍', 'RAW LOBBY DATA'), HL);
  console.dir(data);
  return data;
};

// ── 39. inspectBattle ──
cmds.inspectBattle = async (battleId) => {
  if (!battleId) { console.log('%cUsage: db.inspectBattle("battle-id")', DIM); return; }
  const { data } = await supabase.from('battles').select('*').eq('id', battleId).single();
  console.log(label('🔍', 'RAW BATTLE DATA'), HL);
  console.dir(data);
  return data;
};

// ── 40. roomMembers ──
cmds.roomMembers = async (roomId) => {
  if (!roomId) { console.log('%cUsage: db.roomMembers("room-id")', DIM); return; }
  const { data } = await supabase.from('room_members').select('user_id, is_ready, role, joined_at, profiles(username, elo, rank_tier)').eq('room_id', roomId).order('joined_at');
  console.log(label('👥', `${data?.length || 0} ROOM MEMBERS`), OK);
  if (data?.length) table(data.map(m => ({
    user: m.profiles?.username,
    elo: m.profiles?.elo,
    tier: m.profiles?.rank_tier,
    ready: m.is_ready ? '✅' : '❌',
    role: m.role,
    joined: new Date(m.joined_at).toLocaleTimeString(),
  })));
  return data;
};

// ── 41. lobbyMembers ──
cmds.lobbyMembers = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.lobbyMembers("lobby-id")', DIM); return; }
  const { data } = await supabase.from('ranked_lobby_members').select('user_id, joined_at, profiles(username, elo, rank_tier, ranked_wins, ranked_losses)').eq('lobby_id', lobbyId).order('joined_at');
  console.log(label('👥', `${data?.length || 0} LOBBY MEMBERS`), OK);
  if (data?.length) table(data.map(m => ({
    user: m.profiles?.username,
    elo: m.profiles?.elo,
    tier: m.profiles?.rank_tier,
    w: m.profiles?.ranked_wins || 0,
    l: m.profiles?.ranked_losses || 0,
    joined: new Date(m.joined_at).toLocaleTimeString(),
  })));
  return data;
};

// ── 42. mySubmissions ──
cmds.mySubmissions = async () => {
  const id = uid();
  if (!id) return console.log('%cNot logged in', ER);
  const { data } = await supabase.from('submissions').select('battle_id, loop_url, created_at, battles(title, status)').eq('user_id', id).order('created_at', { ascending: false }).limit(10);
  console.log(label('🎵', `${data?.length || 0} YOUR SUBMISSIONS`), OK);
  if (data?.length) table(data.map(s => ({
    battle: s.battles?.title || s.battle_id?.slice(0, 8),
    status: s.battles?.status,
    url: s.loop_url?.slice(0, 50),
    time: new Date(s.created_at).toLocaleString(),
  })));
  return data;
};

// ── 43. myVotes ──
cmds.myVotes = async () => {
  const id = uid();
  if (!id) return console.log('%cNot logged in', ER);
  const { data } = await supabase.from('votes').select('rating, battle_id, target_user_id, battles(title, status), profiles:target_user_id(username)').eq('voter_id', id).order('created_at', { ascending: false }).limit(10);
  console.log(label('🗳️', `${data?.length || 0} YOUR VOTES`), OK);
  if (data?.length) table(data.map(v => ({
    battle: v.battles?.title || v.battle_id?.slice(0, 8),
    status: v.battles?.status,
    target: v.profiles?.username || v.target_user_id?.slice(0, 8),
    rating: v.rating,
  })));
  return data;
};

// ── 44. stuckRooms ──
cmds.stuckRooms = async () => {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await supabase.from('rooms').select('id, name, status, mode, current_players, created_at')
    .in('status', ['open', 'locked', 'voting'])
    .lt('created_at', cutoff)
    .order('created_at');
  console.log(label('⚠️', `${data?.length || 0} STUCK ROOMS (>30min old)`), ER);
  if (data?.length) table(data.map(r => ({
    id: r.id.slice(0, 8),
    name: r.name,
    status: r.status,
    mode: r.mode,
    players: r.current_players,
    age: Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000) + 'min',
  })));
  return data;
};

// ── 45. stuckLobbies ──
cmds.stuckLobbies = async () => {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data } = await supabase.from('ranked_lobbies').select('*')
    .in('status', ['matching', 'ready'])
    .lt('created_at', cutoff)
    .order('created_at');
  console.log(label('⚠️', `${data?.length || 0} STUCK LOBBIES (>10min old)`), ER);
  if (data?.length) table(data.map(l => ({
    id: l.id.slice(0, 8),
    status: l.status,
    players: `${l.current_players}/${l.max_players}`,
    countdown: l.countdown_started_at ? 'YES' : 'no',
    age: Math.round((Date.now() - new Date(l.created_at).getTime()) / 60000) + 'min',
  })));
  return data;
};

// ── 46. closeStuckRooms ──
cmds.closeStuckRooms = async () => {
  const stuck = await cmds.stuckRooms();
  if (!stuck?.length) { console.log('%cNo stuck rooms', OK); return; }
  for (const r of stuck) {
    await supabase.from('rooms').update({ status: 'closed' }).eq('id', r.id);
    await supabase.from('battles').update({ status: 'closed', early_closed: false }).eq('battle_id', r.battle_id).in('status', ['upcoming', 'active', 'voting']);
    console.log(`  Closed: ${r.id.slice(0, 8)} (${r.name})`);
  }
  console.log(label('✅', `Closed ${stuck.length} stuck rooms`), OK);
};

// ── 47. closeStuckLobbies ──
cmds.closeStuckLobbies = async () => {
  const stuck = await cmds.stuckLobbies();
  if (!stuck?.length) { console.log('%cNo stuck lobbies', OK); return; }
  for (const l of stuck) {
    await supabase.from('ranked_lobbies').update({ status: 'closed' }).eq('id', l.id);
    console.log(`  Closed: ${l.id.slice(0, 8)}`);
  }
  console.log(label('✅', `Closed ${stuck.length} stuck lobbies`), OK);
};

// ── 48. forceStart ──
cmds.forceStart = async (roomId) => {
  if (!roomId) { console.log('%cUsage: db.forceStart("room-id")', DIM); return; }
  await supabase.from('rooms').update({ countdown_started_at: new Date().toISOString() }).eq('id', roomId);
  console.log(label('🚀', 'Countdown force-started'), OK);
};

// ── 49. forceVote ──
cmds.forceVote = async (battleId) => {
  if (!battleId) { console.log('%cUsage: db.forceVote("battle-id")', DIM); return; }
  await supabase.from('battles').update({ status: 'voting' }).eq('id', battleId);
  console.log(label('🗳️', 'Battle force-moved to voting'), OK);
};

// ── 50. forceActive ──
cmds.forceActive = async (battleId) => {
  if (!battleId) { console.log('%cUsage: db.forceActive("battle-id")', DIM); return; }
  const starts = new Date(Date.now() - 60000).toISOString();
  const ends = new Date(Date.now() + 45 * 60000).toISOString();
  await supabase.from('battles').update({ status: 'active', starts_at: starts, ends_at: ends }).eq('id', battleId);
  console.log(label('⚡', 'Battle force-moved to active'), OK);
};

// ── 51. stateTimeline ──
cmds.stateTimeline = async (roomId) => {
  if (!roomId) { console.log('%cUsage: db.stateTimeline("room-id")', DIM); return; }
  const { data: room } = await supabase.from('rooms').select('id, name, status, mode, countdown_started_at, created_at').eq('id', roomId).single();
  const { data: battle } = room?.battle_id ? await supabase.from('battles').select('status, starts_at, ends_at, created_at').eq('id', room.battle_id).single() : { data: null };
  console.log(label('📜', 'STATE TIMELINE'), HL);
  console.log(`  Room:       ${room?.name} (${room?.id.slice(0, 8)})`);
  console.log(`  Created:    ${new Date(room?.created_at).toLocaleString()}`);
  console.log(`  Countdown:  ${room?.countdown_started_at ? new Date(room.countdown_started_at).toLocaleString() : 'none'}`);
  if (battle) {
    console.log(`  Battle:     created ${new Date(battle.created_at).toLocaleString()}`);
    console.log(`  Starts:     ${battle.starts_at ? new Date(battle.starts_at).toLocaleString() : 'none'}`);
    console.log(`  Ends:       ${battle.ends_at ? new Date(battle.ends_at).toLocaleString() : 'none'}`);
  }
  console.log(`  Current:    room=%c${room?.status}%c battle=%c${battle?.status}`, OK, '', battle?.status === 'closed' ? ER : OK);
};

// ── 52. closeLobby ──
cmds.closeLobby = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.closeLobby("lobby-id")', DIM); return; }
  await dbOp(supabase.from('ranked_lobbies').update({ status: 'closed' }).eq('id', lobbyId), `Lobby ${lobbyId.slice(0, 8)} closed`);
};

// ── 53. kickLobby ──
cmds.kickLobby = async (lobbyId, userId) => {
  if (!lobbyId || !userId) { console.log('%cUsage: db.kickLobby("lobby-id", "user-id")', DIM); return; }
  await dbOp(supabase.from('ranked_lobby_members').delete().eq('lobby_id', lobbyId).eq('user_id', userId), `Kicked ${userId.slice(0, 8)}`);
};

// ── 54. kickSelf ──
cmds.kickSelf = async (lobbyId) => {
  const id = uid();
  if (!id) return console.log('%cNot logged in', ER);
  if (!lobbyId) { console.log('%cUsage: db.kickSelf("lobby-id")', DIM); return; }
  await dbOp(supabase.from('ranked_lobby_members').delete().eq('lobby_id', lobbyId).eq('user_id', id), 'Removed self from lobby');
};

// ── 55. setLobbyStatus ──
cmds.setLobbyStatus = async (lobbyId, status) => {
  if (!lobbyId || !status) { console.log('%cUsage: db.setLobbyStatus("lobby-id", "matching"|"ready"|"closed")', DIM); return; }
  await dbOp(supabase.from('ranked_lobbies').update({ status }).eq('id', lobbyId), `Lobby status → ${status}`);
};

// ── 56. setLobbyCountdown ──
cmds.setLobbyCountdown = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.setLobbyCountdown("lobby-id")', DIM); return; }
  await dbOp(supabase.from('ranked_lobbies').update({ countdown_started_at: new Date().toISOString() }).eq('id', lobbyId), 'Countdown set to now');
};

// ── 57. clearLobbyCountdown ──
cmds.clearLobbyCountdown = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.clearLobbyCountdown("lobby-id")', DIM); return; }
  await dbOp(supabase.from('ranked_lobbies').update({ countdown_started_at: null }).eq('id', lobbyId), 'Countdown cleared');
};

// ── 58. setLobbyChallenge ──
cmds.setLobbyChallenge = async (lobbyId, challenge) => {
  if (!lobbyId || !challenge) { console.log('%cUsage: db.setLobbyChallenge("lobby-id", {title, bpm, key, genre, ...})', DIM); return; }
  await dbOp(supabase.from('ranked_lobbies').update({ challenge }).eq('id', lobbyId), 'Challenge set');
  console.dir(challenge);
};

// ── 59. clearLobbyChallenge ──
cmds.clearLobbyChallenge = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.clearLobbyChallenge("lobby-id")', DIM); return; }
  await dbOp(supabase.from('ranked_lobbies').update({ challenge: null }).eq('id', lobbyId), 'Challenge cleared');
};

// ── 60. setLobbyMaxPlayers ──
cmds.setLobbyMaxPlayers = async (lobbyId, max) => {
  if (!lobbyId || !max) { console.log('%cUsage: db.setLobbyMaxPlayers("lobby-id", 4)', DIM); return; }
  await dbOp(supabase.from('ranked_lobbies').update({ max_players: max }).eq('id', lobbyId), `Max players → ${max}`);
};

// ── 61. setLobbyBattle ──
cmds.setLobbyBattle = async (lobbyId, battleId) => {
  if (!lobbyId || !battleId) { console.log('%cUsage: db.setLobbyBattle("lobby-id", "battle-id")', DIM); return; }
  await dbOp(supabase.from('ranked_lobbies').update({ battle_id: battleId }).eq('id', lobbyId), `Battle linked → ${battleId.slice(0, 8)}`);
};

// ── 62. fillLobby ──
cmds.fillLobby = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.fillLobby("lobby-id") — adds self to lobby (RLS: auth.uid() = user_id)', DIM); return; }
  const id = uid();
  if (!id) return console.log('%cNot logged in', ER);
  await dbOp(supabase.from('ranked_lobby_members').insert({ lobby_id: lobbyId, user_id: id }), 'Added self to lobby (use multiple tabs to add more)');
};

// ── 63. emptyLobby ──
cmds.emptyLobby = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.emptyLobby("lobby-id")', DIM); return; }
  const { data: before } = await supabase.from('ranked_lobby_members').select('user_id').eq('lobby_id', lobbyId);
  await dbOp(supabase.from('ranked_lobby_members').delete().eq('lobby_id', lobbyId), `Removed ${before?.length || 0} members`);
};

// ── 64. resetLobby ──
cmds.resetLobby = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.resetLobby("lobby-id") — resets lobby to matching state', DIM); return; }
  await dbOp(supabase.from('ranked_lobbies').update({
    status: 'matching',
    countdown_started_at: null,
    battle_id: null,
    challenge: null,
  }).eq('id', lobbyId), 'Lobby reset to matching');
};

// ── 65. deleteLobby ──
cmds.deleteLobby = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.deleteLobby("lobby-id")', DIM); return; }
  await supabase.from('ranked_lobby_members').delete().eq('lobby_id', lobbyId);
  await dbOp(supabase.from('ranked_lobbies').delete().eq('id', lobbyId), 'Lobby deleted');
};

// ── 66. joinLobby ──
cmds.joinLobby = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.joinLobby("lobby-id")', DIM); return; }
  const id = uid();
  if (!id) return console.log('%cNot logged in', ER);
  await dbOp(supabase.from('ranked_lobby_members').insert({ lobby_id: lobbyId, user_id: id }), 'Joined lobby');
};

// ── 67. lobbyChat ──
cmds.lobbyChat = async (lobbyId, body) => {
  if (!lobbyId || !body) { console.log('%cUsage: db.lobbyChat("lobby-id", "hello!")', DIM); return; }
  const id = uid();
  if (!id) return console.log('%cNot logged in', ER);
  await dbOp(supabase.from('lobby_messages').insert({ lobby_id: lobbyId, user_id: id, body }), 'Message sent');
};

// ── 68. clearLobbyChat ──
cmds.clearLobbyChat = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.clearLobbyChat("lobby-id")', DIM); return; }
  await dbOp(supabase.from('lobby_messages').delete().eq('lobby_id', lobbyId), 'Chat cleared');
};

// ── 69. cloneLobby ──
cmds.cloneLobby = async (lobbyId) => {
  if (!lobbyId) { console.log('%cUsage: db.cloneLobby("lobby-id")', DIM); return; }
  const { data: src } = await supabase.from('ranked_lobbies').select('*').eq('id', lobbyId).single();
  if (!src) { console.log('%cSource lobby not found', ER); return; }
  const newLobby = await dbOp(supabase.from('ranked_lobbies').insert({
    status: 'matching',
    max_players: src.max_players,
    challenge: src.challenge,
  }).select().single(), `Lobby cloned → new ID below`);
  if (newLobby) console.log(`  %c${newLobby.id}`, OK);
  return newLobby;
};

// ── 70. lobbiesByStatus ──
cmds.lobbiesByStatus = async () => {
  const statuses = ['matching', 'ready', 'closed'];
  for (const s of statuses) {
    const { count } = await supabase.from('ranked_lobbies').select('id', { count: 'exact' }).eq('status', s);
    console.log(`  ${s}: %c${count || 0}`, count > 0 ? OK : DIM);
  }
};

// ── 71. roomsByStatus ──
cmds.roomsByStatus = async () => {
  const statuses = ['open', 'locked', 'voting', 'closed'];
  for (const s of statuses) {
    const { count } = await supabase.from('rooms').select('id', { count: 'exact' }).eq('status', s);
    console.log(`  ${s}: %c${count || 0}`, count > 0 ? OK : DIM);
  }
};

// ── REGISTER ALL ────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.db = cmds;
  window.whoami = cmds.whoami;
  window.myElo = cmds.myElo;
  window.testElo = cmds.testElo;
  window.computeElo = cmds.computeElo;
  window.tierFromElo = cmds.tierFromElo;
  window.toast = cmds.toast;
  window.toastError = cmds.toastError;
  window.toastSuccess = cmds.toastSuccess;
  window.refreshProfile = cmds.refreshProfile;
  window.onlinePlayers = cmds.onlinePlayers;
  window.myRoom = cmds.myRoom;
  window.myLobby = cmds.myLobby;
  window.activeRooms = cmds.activeRooms;
  window.activeLobbies = cmds.activeLobbies;
  window.submissions = cmds.submissions;
  window.votes = cmds.votes;
  window.messages = cmds.messages;
  window.queue = cmds.queue;
  window.leaveQueue = cmds.leaveQueue;
  window.createRoom = cmds.createRoom;
  window.forceClose = cmds.forceClose;
  window.forceBattleClose = cmds.forceBattleClose;
  window.setElo = cmds.setElo;
  window.testChallenge = cmds.testChallenge;
  window.realtimeChannels = cmds.realtimeChannels;
  window.killChannels = cmds.killChannels;
  window.health = cmds.health;
  window.session = cmds.session;
  window.logout = cmds.logout;
  window.roomState = cmds.roomState;
  window.lobbyState = cmds.lobbyState;
  window.battleState = cmds.battleState;
  window.countdown = cmds.countdown;
  window.advanceLobby = cmds.advanceLobby;
  window.genChallenge = cmds.genChallenge;
  window.inspectRoom = cmds.inspectRoom;
  window.inspectLobby = cmds.inspectLobby;
  window.inspectBattle = cmds.inspectBattle;
  window.roomMembers = cmds.roomMembers;
  window.lobbyMembers = cmds.lobbyMembers;
  window.mySubmissions = cmds.mySubmissions;
  window.myVotes = cmds.myVotes;
  window.stuckRooms = cmds.stuckRooms;
  window.stuckLobbies = cmds.stuckLobbies;
  window.closeStuckRooms = cmds.closeStuckRooms;
  window.closeStuckLobbies = cmds.closeStuckLobbies;
  window.forceStart = cmds.forceStart;
  window.forceVote = cmds.forceVote;
  window.forceActive = cmds.forceActive;
  window.stateTimeline = cmds.stateTimeline;
  window.closeLobby = cmds.closeLobby;
  window.kickLobby = cmds.kickLobby;
  window.kickSelf = cmds.kickSelf;
  window.setLobbyStatus = cmds.setLobbyStatus;
  window.setLobbyCountdown = cmds.setLobbyCountdown;
  window.clearLobbyCountdown = cmds.clearLobbyCountdown;
  window.setLobbyChallenge = cmds.setLobbyChallenge;
  window.clearLobbyChallenge = cmds.clearLobbyChallenge;
  window.setLobbyMaxPlayers = cmds.setLobbyMaxPlayers;
  window.setLobbyBattle = cmds.setLobbyBattle;
  window.fillLobby = cmds.fillLobby;
  window.emptyLobby = cmds.emptyLobby;
  window.resetLobby = cmds.resetLobby;
  window.deleteLobby = cmds.deleteLobby;
  window.inviteLobby = cmds.joinLobby;
  window.lobbyChat = cmds.lobbyChat;
  window.clearLobbyChat = cmds.clearLobbyChat;
  window.cloneLobby = cmds.cloneLobby;
  window.lobbiesByStatus = cmds.lobbiesByStatus;
  window.roomsByStatus = cmds.roomsByStatus;

  console.log('%c🔧 RUNDATBEAT Debug Console Loaded', 'color:#f97316;font-size:14px;font-weight:bold');
  console.log('%cType db.* for all commands, or use shorthand (whoami, health, etc.)', 'color:#6b7280;font-style:italic');
}
})();
