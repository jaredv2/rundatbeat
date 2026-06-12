alter table public.battles
  add column if not exists early_closed boolean not null default false;
