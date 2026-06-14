-- Add XP and level system to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS xp int DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS level int DEFAULT 1;
