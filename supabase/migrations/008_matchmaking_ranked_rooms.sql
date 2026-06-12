alter table public.battles
  add column if not exists mode text not null default 'quick' check (mode in ('quick', 'ranked')),
  add column if not exists queue_id uuid;

alter table public.rooms
  add column if not exists mode text not null default 'quick' check (mode in ('quick', 'ranked')),
  add column if not exists current_players int not null default 0;

alter table public.rooms
  alter column max_players set default 4;

create table if not exists public.matchmaking_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('quick', 'ranked')),
  elo int not null default 1000,
  status text not null default 'waiting' check (status in ('waiting', 'matched', 'cancelled')),
  battle_id uuid references public.battles(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  queued_at timestamptz not null default now(),
  matched_at timestamptz
);

alter table public.matchmaking_queue
  drop constraint if exists matchmaking_queue_user_id_mode_status_key;

create index if not exists matchmaking_queue_status_mode_idx
  on public.matchmaking_queue(status, mode, queued_at);

create unique index if not exists matchmaking_queue_one_waiting_per_mode_idx
  on public.matchmaking_queue(user_id, mode)
  where status = 'waiting';

alter table public.matchmaking_queue enable row level security;

create policy "queue readable" on public.matchmaking_queue
for select using (true);

create policy "users enter queue" on public.matchmaking_queue
for insert to authenticated
with check (auth.uid() = user_id);

create policy "users update own queue" on public.matchmaking_queue
for update to authenticated
using (true)
with check (true);

grant select, insert, update on public.matchmaking_queue to authenticated;

insert into public.shop_items (name, description, cost_tokens, item_type)
values
  ('Chrome Stage Theme', 'Unlock a clean high-contrast stage theme for your account.', 120, 'profile_accent'),
  ('Arcade Violet Theme', 'Unlock a ranked lobby profile theme.', 120, 'profile_accent'),
  ('Producer Gold Theme', 'Unlock a gold nameplate and profile accent.', 180, 'profile_accent')
on conflict do nothing;
