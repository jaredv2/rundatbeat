-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/djvszoljoibvpwiipcak/sql/new

-- === Migration 029: v2 voting system ===
alter table public.votes
  add column if not exists rating int check (rating >= 0 and rating <= 10),
  add column if not exists description text,
  alter column direction drop not null;

alter table public.votes
  add column if not exists weight numeric not null default 1;

drop index if exists votes_submission_voter_unique_idx;
create unique index if not exists votes_submission_voter_unique_idx
  on public.votes(submission_id, voter_id);

alter table public.submissions
  add column if not exists rating_total numeric not null default 0,
  add column if not exists rating_count int not null default 0;

alter table public.room_members
  add column if not exists voting_stopped boolean not null default false;

create or replace function public.update_submission_rating(
  submission_id_input uuid,
  delta_input numeric,
  new_rating_input int
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.submissions
  set
    rating_total = rating_total + delta_input,
    rating_count = rating_count + 1
  where id = submission_id_input;
end;
$$;

-- === Migration 030: ranked lobby challenge column ===
ALTER TABLE ranked_lobbies ADD COLUMN IF NOT EXISTS challenge JSONB;

-- === Migration 031: realtime for lobby tables ===
alter publication supabase_realtime add table public.ranked_lobbies;
alter publication supabase_realtime add table public.ranked_lobby_members;
alter publication supabase_realtime add table public.lobby_messages;
alter table public.ranked_lobby_members replica identity full;
alter table public.lobby_messages replica identity full;

-- === Migration 032: REPLICA IDENTITY FULL on ranked_lobbies ===
-- Without this, UPDATE events (status, countdown, battle_id) carry no payload
ALTER TABLE public.ranked_lobbies REPLICA IDENTITY FULL;

-- === Migration 033: Fix rooms_mode_check to allow 'solo' + battles_mode_check to allow 'room' ===
-- Run this ONE constraint at a time if needed — or just paste the whole thing

ALTER TABLE public.battles DROP CONSTRAINT IF EXISTS battles_mode_check;
ALTER TABLE public.battles ADD CONSTRAINT battles_mode_check CHECK (mode IN ('quick', 'ranked', 'solo', 'room'));

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_mode_check;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_mode_check CHECK (mode IN ('room', 'ranked', 'solo', 'matchmaking'));

-- === Migration 034: Notifications table ===
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,             -- 'battle_invite', 'battle_won', 'battle_lost', 'friend_online', 'challenge', 'dm', 'system', 'vote_received'
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,                      -- optional route to navigate to on click
  actor_id UUID,                  -- the user who triggered this notification (optional)
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own notifications (via edge functions or server)
CREATE POLICY "notifications_insert_own" ON public.notifications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update (mark as read) their own notifications
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own notifications
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE USING (auth.uid() = user_id);

-- Index for fast unread count queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, read_at)
  WHERE read_at IS NULL;

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
