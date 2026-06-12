-- 032_realtime_ranked_lobbies.sql
-- ranked_lobbies UPDATE events carry no new-row payload without
-- REPLICA IDENTITY FULL, so the Lobby page realtime subscription
-- never sees status/countdown/battle_id changes from console commands.

ALTER TABLE public.ranked_lobbies REPLICA IDENTITY FULL;
