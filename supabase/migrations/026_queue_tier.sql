-- Per-tier queue: avoids joins through profiles for matchmaking queries
alter table public.matchmaking_queue
  add column if not exists tier text not null default 'bronze'
    check (tier in ('bronze','silver','gold','platinum','diamond','elite','champion','goat'));

create index if not exists matchmaking_queue_tier_idx
  on public.matchmaking_queue(tier, status, mode)
  where status = 'waiting';

-- Backfill existing waiting entries
update public.matchmaking_queue q
  set tier = p.rank_tier
  from public.profiles p
  where q.user_id = p.id and q.tier = 'bronze' and q.status = 'waiting';
