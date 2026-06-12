create extension if not exists "pgcrypto";

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  avatar_url text,
  discord_username text,
  wins int not null default 0,
  battles_entered int not null default 0,
  points int not null default 0,
  tokens int not null default 0,
  total_tokens_earned int not null default 0,
  rank_tier text not null default 'bronze' check (rank_tier in ('bronze', 'silver', 'gold', 'diamond')),
  last_login_reward date,
  created_at timestamptz not null default now()
);

create table public.battles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  prompt_text text,
  genre text,
  bpm int,
  mood text,
  restrictions text,
  reference_artists text[],
  flavor_text text,
  duration_minutes int not null,
  status text not null check (status in ('upcoming', 'active', 'voting', 'closed')),
  is_premium boolean not null default false,
  entry_fee_tokens int not null default 0,
  starts_at timestamptz,
  voting_ends_at timestamptz,
  winner_id uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references public.battles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  audio_url text not null,
  description text,
  vote_count int not null default 0,
  submitted_at timestamptz not null default now()
);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references public.battles(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (battle_id, voter_id)
);

create table public.token_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount int not null,
  reason text not null check (reason in ('battle_enter', 'submission', 'vote', 'battle_win', 'top3', 'first_battle', 'daily_login', 'shop_purchase', 'admin_grant', 'admin_remove', 'premium_entry')),
  battle_id uuid references public.battles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.shop_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  cost_tokens int not null,
  item_type text not null check (item_type in ('username_change', 'profile_badge', 'homepage_feature', 'extra_submission_slot')),
  is_active boolean not null default true
);

create table public.user_shop_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.shop_items(id),
  purchased_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index submissions_battle_id_idx on public.submissions(battle_id);
create index votes_battle_id_idx on public.votes(battle_id);
create index token_transactions_user_id_idx on public.token_transactions(user_id);
