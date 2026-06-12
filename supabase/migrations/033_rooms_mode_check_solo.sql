-- 033_rooms_mode_check_solo.sql
-- Fix rooms_mode_check to allow 'solo' + battles_mode_check to allow 'room'

ALTER TABLE public.battles DROP CONSTRAINT IF EXISTS battles_mode_check;
ALTER TABLE public.battles ADD CONSTRAINT battles_mode_check CHECK (mode IN ('quick', 'ranked', 'solo', 'room'));

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_mode_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_mode_check CHECK (mode IN ('room', 'ranked', 'solo', 'matchmaking'));
