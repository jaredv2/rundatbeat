-- 031_realtime_lobby_tables.sql
-- ranked_lobbies, ranked_lobby_members, and lobby_messages were never added
-- to the supabase_realtime publication, so all client-side realtime
-- subscriptions on these tables silently failed:
--   - Members joining/leaving → stale player list
--   - Lobby status changes   → stale status (matching → ready → countdown)
--   - Chat messages          → no live chat
--
-- REPLICA IDENTITY FULL on ranked_lobby_members so DELETE events carry
-- the old row (needed to filter by lobby_id on the client).

alter publication supabase_realtime add table public.ranked_lobbies;
alter publication supabase_realtime add table public.ranked_lobby_members;
alter publication supabase_realtime add table public.lobby_messages;

alter table public.ranked_lobby_members replica identity full;
alter table public.lobby_messages replica identity full;
