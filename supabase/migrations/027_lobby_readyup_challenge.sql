-- 027: Lobby ready-up, room codes, challenge data, expanded status

-- Expand rooms.status check to include new states
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_status_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_status_check
  CHECK (status IN ('open', 'locked', 'closed', 'matchmaking', 'lobby', 'active', 'voting', 'results'));

-- Lobby columns for rooms
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS host_id UUID REFERENCES auth.users(id);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS room_code TEXT UNIQUE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS countdown_started_at TIMESTAMPTZ;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS challenge JSONB;

-- Ready-up for room_members
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS is_ready BOOLEAN DEFAULT FALSE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rooms_room_code ON rooms(room_code) WHERE room_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_lobby_public ON rooms(status, mode) WHERE status = 'lobby' AND is_public = true;

-- Allow host_id to be set on ranked rooms (host_id IS NULL for ranked)
-- The existing "users create rooms" policy already handles this:
--   auth.uid() = owner_id OR (owner_id IS NULL AND mode = 'ranked')
-- We add host_id as a separate concept: host controls lobby, owner owns the DB row.
