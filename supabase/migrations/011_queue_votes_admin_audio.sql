alter table public.profiles
  add column if not exists custom_badge text,
  add column if not exists nameplate_icon text,
  add column if not exists banned_until timestamptz,
  add column if not exists ban_reason text;

create table if not exists public.shop_review_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_type text not null check (item_type in ('custom_badge', 'nameplate_icon')),
  item_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  purchased_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.shop_review_queue enable row level security;

drop policy if exists "review queue owner readable" on public.shop_review_queue;
create policy "review queue owner readable" on public.shop_review_queue
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "review queue owner insert" on public.shop_review_queue;
create policy "review queue owner insert" on public.shop_review_queue
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "review queue admin update" on public.shop_review_queue;
create policy "review queue admin update" on public.shop_review_queue
for update to authenticated
using (true)
with check (true);

drop policy if exists "anon admin read review queue" on public.shop_review_queue;
create policy "anon admin read review queue" on public.shop_review_queue
for select to anon
using (true);

drop policy if exists "anon admin update review queue" on public.shop_review_queue;
create policy "anon admin update review queue" on public.shop_review_queue
for update to anon
using (true)
with check (true);

grant select, insert, update on public.shop_review_queue to authenticated;
grant select, update on public.shop_review_queue to anon;

alter table public.votes
  add column if not exists direction int not null default 1 check (direction in (-1, 1));

alter table public.votes
  drop constraint if exists votes_battle_id_voter_id_key;

create unique index if not exists votes_submission_voter_unique_idx
  on public.votes(submission_id, voter_id);

drop policy if exists "users update own votes" on public.votes;
create policy "users update own votes" on public.votes
for update to authenticated
using (auth.uid() = voter_id)
with check (auth.uid() = voter_id);

grant update on public.votes to authenticated;

create or replace function public.increment_submission_vote(submission_id_input uuid, delta_input int default 1)
returns void
language sql
security definer
set search_path = public
as $$
  update public.submissions
  set vote_count = vote_count + delta_input
  where id = submission_id_input;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('beats', 'beats', true, 26214400, array['audio/mpeg', 'audio/wav', 'audio/x-wav'])
on conflict (id) do update set
  public = true,
  file_size_limit = 26214400,
  allowed_mime_types = array['audio/mpeg', 'audio/wav', 'audio/x-wav'];

grant select on public.user_presence to anon;
grant select, update on public.rooms to anon;
grant select, update on public.matchmaking_queue to anon;

drop policy if exists "anon admin update rooms" on public.rooms;
create policy "anon admin update rooms" on public.rooms
for update to anon
using (true)
with check (true);

drop policy if exists "anon admin update queues" on public.matchmaking_queue;
create policy "anon admin update queues" on public.matchmaking_queue
for update to anon
using (true)
with check (true);

create or replace view public.leaderboard_period_stats as
select
  p.id as user_id,
  periods.period,
  coalesce(points.period_points, 0)::int as period_points,
  coalesce(wins.period_wins, 0)::int as period_wins,
  coalesce(battles.period_battles, 0)::int as period_battles
from public.profiles p
cross join (
  values
    ('week'::text, now() - interval '7 days'),
    ('month'::text, now() - interval '30 days')
) as periods(period, since_at)
left join lateral (
  select sum(amount) as period_points
  from public.token_transactions
  where user_id = p.id and amount > 0 and created_at >= periods.since_at
) points on true
left join lateral (
  select count(*) as period_wins
  from public.battles
  where winner_id = p.id and created_at >= periods.since_at
) wins on true
left join lateral (
  select count(distinct battle_id) as period_battles
  from public.submissions
  where user_id = p.id and submitted_at >= periods.since_at
) battles on true;

grant select on public.leaderboard_period_stats to anon, authenticated;
