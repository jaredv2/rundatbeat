alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create policy "admin update any profile" on public.profiles
  for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
