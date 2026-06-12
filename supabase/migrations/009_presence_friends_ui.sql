create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table public.user_presence enable row level security;

create policy "presence readable" on public.user_presence
for select using (true);

create policy "users upsert own presence" on public.user_presence
for insert to authenticated
with check (auth.uid() = user_id);

create policy "users update own presence" on public.user_presence
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update on public.user_presence to authenticated;
