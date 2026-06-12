create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references public.profiles(id) on delete cascade,
  challengee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  battle_id uuid references public.battles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists challenges_pending_idx on public.challenges(challengee_id, status) where status = 'pending';

alter table public.challenges enable row level security;

create policy "challenges select" on public.challenges for select using (true);
create policy "challenges insert" on public.challenges for insert to authenticated with check (auth.uid() = challenger_id);
create policy "challenges update" on public.challenges for update to authenticated using (auth.uid() in (challenger_id, challengee_id)) with check (auth.uid() in (challenger_id, challengee_id));

grant select, insert, update on public.challenges to authenticated;

alter publication supabase_realtime add table public.challenges;
