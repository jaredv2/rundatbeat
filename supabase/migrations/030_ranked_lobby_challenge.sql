-- Store the generated challenge payload on the lobby row so
-- all clients see the same sample (only the first client generates it).
ALTER TABLE ranked_lobbies ADD COLUMN IF NOT EXISTS challenge JSONB;
