import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const BATCH_LIMIT = 500;

const log = (msg: string) => console.log(`[room-cleanup] ${msg}`);

Deno.serve(async () => {
  const start = Date.now();
  log("started");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const stats = {
    closed: 0,
    deleted_rooms: 0,
    deleted_lobbies: 0,
    deleted_battles: 0,
    cleaned_members: 0,
    fixed_player_counts: 0,
  };

  const lobbyCutoff = new Date(Date.now() - THREE_HOURS_MS).toISOString();

  // ── Phase 1: Close stale open/locked rooms ──────────────────────────────

  const staleIds: string[] = [];

  const { data: emptyRooms } = await supabase
    .from("rooms")
    .select("id")
    .in("status", ["open", "locked"])
    .lte("current_players", 0)
    .limit(BATCH_LIMIT);
  if (emptyRooms) staleIds.push(...emptyRooms.map((r: { id: string }) => r.id));
  log(`phase1: found ${emptyRooms?.length ?? 0} empty rooms`);

  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: ghostRooms } = await supabase
    .from("rooms")
    .select("id")
    .eq("mode", "ranked")
    .eq("status", "locked")
    .is("owner_id", null)
    .lt("created_at", twoMinAgo)
    .limit(BATCH_LIMIT);
  if (ghostRooms) staleIds.push(...ghostRooms.map((r: { id: string }) => r.id));
  log(`phase1: found ${ghostRooms?.length ?? 0} ghost ranked rooms`);

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: staleRooms } = await supabase
    .from("rooms")
    .select("id")
    .neq("mode", "ranked")
    .in("status", ["open", "locked"])
    .lt("created_at", tenMinAgo)
    .limit(BATCH_LIMIT);
  if (staleRooms) staleIds.push(...staleRooms.map((r: { id: string }) => r.id));
  log(`phase1: found ${staleRooms?.length ?? 0} stale non-ranked rooms`);

  if (staleIds.length > 0) {
    const unique = [...new Set(staleIds)];
    await supabase.from("rooms").update({ status: "closed" }).in("id", unique);
    stats.closed = unique.length;
    log(`phase1: closed ${stats.closed} stale rooms`);
  } else {
    log("phase1: nothing to close");
  }

  // ── Phase 1b: Clean stale members from closed rooms ───────────────────
  // Players who crashed/closed tab without leave handler are still in room_members

  const { data: closedRoomsWithMembers } = await supabase
    .from("rooms")
    .select("id")
    .eq("status", "closed")
    .limit(BATCH_LIMIT);

  if (closedRoomsWithMembers?.length) {
    const closedIds = closedRoomsWithMembers.map((r: { id: string }) => r.id);
    const { count, error } = await supabase
      .from("room_members")
      .delete({ count: "exact" })
      .in("room_id", closedIds);
    stats.cleaned_members = count ?? 0;
    if (error) log(`phase1b: error: ${error.message}`);
    else log(`phase1b: cleaned ${stats.cleaned_members} stale members from closed rooms`);
  } else {
    log("phase1b: no closed rooms with members");
  }

  // ── Phase 1c: Fix current_players drift ────────────────────────────────
  // Recalculate current_players from actual room_members count

  const { data: activeRooms } = await supabase
    .from("rooms")
    .select("id, current_players")
    .in("status", ["open", "locked", "lobby"])
    .limit(BATCH_LIMIT);

  if (activeRooms?.length) {
    for (const room of activeRooms) {
      const { count } = await supabase
        .from("room_members")
        .select("room_id", { count: "exact", head: true })
        .eq("room_id", room.id);
      const actual = count ?? 0;
      if (actual !== room.current_players) {
        await supabase
          .from("rooms")
          .update({ current_players: actual })
          .eq("id", room.id);
        stats.fixed_player_counts++;
        log(`phase1c: fixed room ${room.id}: ${room.current_players} → ${actual}`);
      }
    }
    if (stats.fixed_player_counts) {
      log(`phase1c: fixed ${stats.fixed_player_counts} drifted player counts`);
    } else {
      log("phase1c: all player counts correct");
    }
  }

  // ── Phase 2: Delete closed rooms (cascade handles members + messages) ─

  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const deadRoomIds: string[] = [];

  const { data: emptyClosedRooms } = await supabase
    .from("rooms")
    .select("id")
    .eq("status", "closed")
    .eq("current_players", 0)
    .limit(BATCH_LIMIT);
  if (emptyClosedRooms?.length) deadRoomIds.push(...emptyClosedRooms.map((r: { id: string }) => r.id));
  log(`phase2: found ${emptyClosedRooms?.length ?? 0} closed rooms with 0 players`);

  const { data: oldClosedRooms } = await supabase
    .from("rooms")
    .select("id")
    .eq("status", "closed")
    .gt("current_players", 0)
    .lt("created_at", fifteenMinAgo)
    .limit(BATCH_LIMIT);
  if (oldClosedRooms?.length) deadRoomIds.push(...oldClosedRooms.map((r: { id: string }) => r.id));
  log(`phase2: found ${oldClosedRooms?.length ?? 0} closed rooms with players (>15min old)`);

  if (deadRoomIds.length) {
    const roomIds = [...new Set(deadRoomIds)];
    const { count, error } = await supabase
      .from("rooms")
      .delete({ count: "exact" })
      .in("id", roomIds);
    stats.deleted_rooms = count ?? 0;
    if (error) log(`phase2: error: ${error.message}`);
    else log(`phase2: deleted ${stats.deleted_rooms} rooms (+ cascade members/messages)`);
  }

  // ── Phase 3: Delete stuck ranked lobbies (>3h) ─────────────────────────
  // Cascade handles lobby_members + lobby_messages

  const { data: deadLobbies } = await supabase
    .from("ranked_lobbies")
    .select("id")
    .eq("status", "matching")
    .lt("created_at", lobbyCutoff)
    .limit(BATCH_LIMIT);

  log(`phase3: found ${deadLobbies?.length ?? 0} stuck ranked lobbies (>3h)`);

  if (deadLobbies?.length) {
    const lobbyIds = deadLobbies.map((l: { id: string }) => l.id);
    const { count, error } = await supabase
      .from("ranked_lobbies")
      .delete({ count: "exact" })
      .in("id", lobbyIds);
    stats.deleted_lobbies = count ?? 0;
    if (error) log(`phase3: error: ${error.message}`);
    else log(`phase3: deleted ${stats.deleted_lobbies} lobbies (+ cascade members/messages)`);
  }

  // ── Phase 3b: Fix ranked lobby current_players drift ───────────────────

  const { data: activeLobbies } = await supabase
    .from("ranked_lobbies")
    .select("id, current_players")
    .eq("status", "matching")
    .limit(BATCH_LIMIT);

  if (activeLobbies?.length) {
    for (const lobby of activeLobbies) {
      const { count } = await supabase
        .from("ranked_lobby_members")
        .select("lobby_id", { count: "exact", head: true })
        .eq("lobby_id", lobby.id);
      const actual = count ?? 0;
      if (actual !== lobby.current_players) {
        await supabase
          .from("ranked_lobbies")
          .update({ current_players: actual })
          .eq("id", lobby.id);
        stats.fixed_player_counts++;
        log(`phase3b: fixed lobby ${lobby.id}: ${lobby.current_players} → ${actual}`);
      }
    }
  }

  // ── Phase 4: Delete closed battles (only if no active room references them) ──
  // Cascade handles submissions → votes

  const { data: deadBattles } = await supabase
    .from("battles")
    .select("id")
    .eq("status", "closed")
    .limit(BATCH_LIMIT);

  log(`phase4: found ${deadBattles?.length ?? 0} closed battles`);

  if (deadBattles?.length) {
    const battleIds = deadBattles.map((b: { id: string }) => b.id);

    // Don't delete battles still referenced by active rooms
    const { data: activeRooms } = await supabase
      .from("rooms")
      .select("battle_id")
      .in("battle_id", battleIds)
      .in("status", ["locked", "voting", "lobby"]);
    const keepBattleIds = new Set((activeRooms || []).map(r => r.battle_id));
    const safeToDelete = battleIds.filter(id => !keepBattleIds.has(id));

    if (safeToDelete.length) {
      const { count, error } = await supabase
        .from("battles")
        .delete({ count: "exact" })
        .in("id", safeToDelete);
      stats.deleted_battles = count ?? 0;
      if (error) log(`phase4: error: ${error.message}`);
      else log(`phase4: deleted ${stats.deleted_battles} battles (+ cascade submissions/votes)`);
    } else {
      log(`phase4: all ${battleIds.length} battles still referenced by active rooms — skipped`);
    }
  }

  const elapsed = Date.now() - start;
  log(`finished in ${elapsed}ms — ${JSON.stringify(stats)}`);

  return new Response(JSON.stringify(stats), {
    headers: { "Content-Type": "application/json" },
  });
});
