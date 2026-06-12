-- ELO column for skill-based matchmaking
alter table public.profiles
  add column if not exists elo int not null default 1000;

-- Expand rank_tier check to include all tiers used in the app
alter table public.profiles
  drop constraint if exists profiles_rank_tier_check,
  add constraint profiles_rank_tier_check
    check (rank_tier in ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'goat'));

-- Allow ranked rooms to be created without an owner
alter table public.rooms
  alter column owner_id drop not null;
