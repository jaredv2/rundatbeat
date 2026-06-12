import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: closedRooms } = await supabase
    .from("rooms")
    .select("id, battle_id")
    .in("status", ["closed", "lobby"])
    .limit(100);
  const closedIds = (closedRooms || []).map((r) => r.id);
  const battleIds = (closedRooms || []).map((r) => r.battle_id).filter(Boolean);

  if (closedIds.length > 0) {
    await Promise.all([
      supabase.from("room_members").delete().in("room_id", closedIds),
      supabase.from("room_messages").delete().in("room_id", closedIds),
    ]);
    await supabase.from("rooms").delete().in("id", closedIds);
  }

  if (battleIds.length > 0) {
    await supabase.from("battles").delete().in("id", battleIds);
  }

  const { data: staleQueue } = await supabase
    .from("matchmaking_queue")
    .select("id")
    .in("status", ["cancelled", "matched"])
    .limit(100);
  const qIds = (staleQueue || []).map((r) => r.id);
  if (qIds.length > 0) {
    await supabase.from("matchmaking_queue").delete().in("id", qIds);
  }

  return new Response(
    JSON.stringify({ rooms: closedIds.length, battles: battleIds.length, queue: qIds.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
