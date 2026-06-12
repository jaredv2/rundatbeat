-- v2 voting system: rating 0-10, description, vote stopping

-- Add rating and description to votes
alter table public.votes
  add column if not exists rating int check (rating >= 0 and rating <= 10),
  add column if not exists description text,
  alter column direction drop not null;

-- Track per-vote weight for rating
alter table public.votes
  add column if not exists weight numeric not null default 1;

-- Allow one vote per submission per voter (replace the unique constraint)
drop index if exists votes_submission_voter_unique_idx;
create unique index if not exists votes_submission_voter_unique_idx
  on public.votes(submission_id, voter_id);

-- Add rating_total to submissions for computed score
alter table public.submissions
  add column if not exists rating_total numeric not null default 0,
  add column if not exists rating_count int not null default 0;

-- Track if a player has stopped voting early
alter table public.room_members
  add column if not exists voting_stopped boolean not null default false;

-- RPC to update submission rating (upsert-style)
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
