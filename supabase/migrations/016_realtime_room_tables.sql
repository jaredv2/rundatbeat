-- Room tables were missing from supabase_realtime, causing all
-- realtime subscriptions in useBattle.js to silently fail:
--   - room_members (joins/leaves) → stale members list → leave modal never shows
--   - rooms (status transitions) → stale room state
--   - room_messages (new chat)    → no live chat

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_members;
alter publication supabase_realtime add table public.room_messages;

-- matchmaking_queue needs realtime so the room list refreshes on queue changes
alter publication supabase_realtime add table public.matchmaking_queue;

-- room_members subscription reads payload.old.room_id on DELETE
-- (useBattle.js line 154), so we need REPLICA IDENTITY FULL.
alter table public.room_members replica identity full;
