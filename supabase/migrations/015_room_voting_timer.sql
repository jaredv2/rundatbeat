alter table public.rooms
  add column if not exists voting_minutes int not null default 3;
