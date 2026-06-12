-- 036_drop_challenge_battle_fk.sql
-- challenges.battle_id was FK to battles.id, but we store a room ID there
-- so both users can navigate to /battle/{roomId} immediately.

ALTER TABLE IF EXISTS public.challenges
  DROP CONSTRAINT IF EXISTS challenges_battle_id_fkey;
