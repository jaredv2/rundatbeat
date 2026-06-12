alter table public.profiles
  add column if not exists description text not null default '',
  add column if not exists elo int not null default 1000,
  add column if not exists ranked_wins int not null default 0,
  add column if not exists ranked_losses int not null default 0,
  add column if not exists active_theme text not null default 'default',
  add column if not exists accent_color text,
  add column if not exists is_featured boolean not null default false,
  add column if not exists featured_until timestamptz,
  add column if not exists has_priority boolean not null default false;

alter table public.shop_items drop constraint if exists shop_items_item_type_check;
alter table public.shop_items
  add constraint shop_items_item_type_check check (item_type in (
    'username_change',
    'profile_badge',
    'custom_badge',
    'homepage_feature',
    'extra_submission_slot',
    'battle_priority',
    'nameplate_icon',
    'profile_accent',
    'replay_access'
  ));

alter table public.token_transactions drop constraint if exists token_transactions_reason_check;
alter table public.token_transactions
  add constraint token_transactions_reason_check check (reason in (
    'battle_enter',
    'submission',
    'vote',
    'battle_win',
    'top3',
    'first_battle',
    'daily_login',
    'shop_purchase',
    'admin_grant',
    'admin_remove',
    'premium_entry',
    'host_battle',
    'refund'
  ));

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  battle_id uuid references public.battles(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'locked', 'closed')),
  max_players int not null default 16,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'mod', 'member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 500),
  created_at timestamptz not null default now()
);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create table if not exists public.friend_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 500),
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete set null,
  battle_id uuid references public.battles(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'open' check (status in ('open', 'reviewing', 'closed')),
  created_at timestamptz not null default now()
);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_messages enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_messages enable row level security;
alter table public.reports enable row level security;

create policy "rooms readable" on public.rooms for select using (true);
create policy "users create rooms" on public.rooms for insert to authenticated with check (auth.uid() = owner_id);
create policy "owners update rooms" on public.rooms for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "room members readable" on public.room_members for select using (true);
create policy "users join rooms" on public.room_members for insert to authenticated with check (auth.uid() = user_id);
create policy "users leave rooms" on public.room_members for delete to authenticated using (auth.uid() = user_id);

create policy "room messages readable" on public.room_messages for select using (true);
create policy "users send room messages" on public.room_messages for insert to authenticated with check (auth.uid() = user_id);

create policy "friendships visible to participants" on public.friendships for select using (auth.uid() in (requester_id, addressee_id));
create policy "users request friendships" on public.friendships for insert to authenticated with check (auth.uid() = requester_id);
create policy "participants update friendships" on public.friendships for update to authenticated using (auth.uid() in (requester_id, addressee_id)) with check (auth.uid() in (requester_id, addressee_id));

create policy "friend messages visible to participants" on public.friend_messages for select using (auth.uid() in (sender_id, receiver_id));
create policy "users send friend messages" on public.friend_messages for insert to authenticated with check (auth.uid() = sender_id);

create policy "users create reports" on public.reports for insert to authenticated with check (auth.uid() = reporter_id);
create policy "users read own reports" on public.reports for select using (auth.uid() = reporter_id);

grant select, insert, update, delete on public.rooms to authenticated;
grant select, insert, update, delete on public.room_members to authenticated;
grant select, insert on public.room_messages to authenticated;
grant select, insert, update on public.friendships to authenticated;
grant select, insert on public.friend_messages to authenticated;
grant select, insert, update on public.reports to authenticated;

insert into public.shop_items (name, description, cost_tokens, item_type)
values
  ('Crimson Grid Theme', 'Unlock a sharper profile and dashboard grid skin.', 120, 'profile_accent'),
  ('Neon Console Theme', 'Unlock a bright terminal-style account theme.', 120, 'profile_accent'),
  ('Midnight Tape Theme', 'Unlock a deep studio-session account theme.', 120, 'profile_accent')
on conflict do nothing;
