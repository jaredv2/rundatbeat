create table public.battle_proposals (
  id uuid primary key default gen_random_uuid(),
  proposed_by uuid not null references public.profiles(id) on delete cascade,
  genre text not null,
  bpm int not null,
  mood text not null,
  restrictions text,
  reference_artists text,
  duration_minutes int not null default 60,
  note_to_admin text,
  generated_prompt jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  created_at timestamptz not null default now()
);

alter table public.battle_proposals enable row level security;

create policy "users read own proposals" on public.battle_proposals
for select to authenticated
using (auth.uid() = proposed_by);

create policy "anon admin read proposals" on public.battle_proposals
for select to anon
using (true);

create policy "users insert own proposals" on public.battle_proposals
for insert to authenticated
with check (auth.uid() = proposed_by and status = 'pending');

create policy "authenticated update proposals" on public.battle_proposals
for update to authenticated
using (true)
with check (true);

create policy "anon admin update proposals" on public.battle_proposals
for update to anon
using (true)
with check (true);

grant select, insert, update on public.battle_proposals to authenticated;
grant select, update on public.battle_proposals to anon;

alter publication supabase_realtime add table public.battle_proposals;
