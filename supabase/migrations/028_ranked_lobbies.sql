-- 028_ranked_lobbies.sql
-- Replace rooms-table-based ranked matchmaking/lobby with dedicated tables.
-- Drop first in case migration ran with old auth.users FK
DROP TABLE IF EXISTS lobby_messages CASCADE;
DROP TABLE IF EXISTS ranked_lobby_members CASCADE;
DROP TABLE IF EXISTS ranked_lobbies CASCADE;

CREATE TABLE ranked_lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier TEXT NOT NULL DEFAULT 'bronze',
  status TEXT NOT NULL DEFAULT 'matching',
  max_players INTEGER NOT NULL DEFAULT 10,
  current_players INTEGER NOT NULL DEFAULT 1,
  countdown_started_at TIMESTAMPTZ,
  battle_id UUID REFERENCES battles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ranked_lobby_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID NOT NULL REFERENCES ranked_lobbies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  is_ready BOOLEAN NOT NULL DEFAULT false,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lobby_id, user_id)
);

ALTER TABLE ranked_lobbies ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_lobby_members ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read any lobby / lobby_member row
CREATE POLICY "read_ranked_lobbies"
  ON ranked_lobbies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "read_ranked_lobby_members"
  ON ranked_lobby_members FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert lobbies (join queue)
CREATE POLICY "insert_ranked_lobbies"
  ON ranked_lobbies FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "insert_ranked_lobby_members"
  ON ranked_lobby_members FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Authenticated users can update rows in their own lobby
CREATE POLICY "update_ranked_lobbies"
  ON ranked_lobbies FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "update_own_ranked_lobby_member"
  ON ranked_lobby_members FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Authenticated users can delete their own member row
CREATE POLICY "delete_own_ranked_lobby_member"
  ON ranked_lobby_members FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Lobby chat messages
CREATE TABLE IF NOT EXISTS lobby_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID NOT NULL REFERENCES ranked_lobbies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lobby_messages_lobby_id ON lobby_messages(lobby_id);

ALTER TABLE lobby_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_lobby_messages"
  ON lobby_messages FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "insert_lobby_messages"
  ON lobby_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
