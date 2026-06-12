-- Allow 'solo' mode in battles and rooms
alter table public.battles
  drop constraint if exists battles_mode_check,
  add constraint battles_mode_check check (mode in ('quick', 'ranked', 'solo'));

alter table public.rooms
  drop constraint if exists rooms_mode_check,
  add constraint rooms_mode_check check (mode in ('quick', 'ranked', 'solo'));

-- Add group_id for independent queue groups
alter table public.matchmaking_queue
  add column if not exists group_id uuid;

create index if not exists matchmaking_queue_ungrouped_idx
  on public.matchmaking_queue(status, mode, group_id)
  where status = 'waiting' and group_id is null;

-- Allow deleting queue entries (used when a match is formed)
create policy "users delete queue" on public.matchmaking_queue
  for delete to authenticated
  using (true);

grant delete on public.matchmaking_queue to authenticated;
