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
