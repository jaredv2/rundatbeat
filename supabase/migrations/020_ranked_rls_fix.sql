-- Ranked rooms have owner_id = null, so the existing
-- "users create rooms" check (auth.uid() = owner_id) blocks them.

drop policy if exists "users create rooms" on public.rooms;
create policy "users create rooms" on public.rooms
  for insert to authenticated
  with check (
    auth.uid() = owner_id
    or
    (owner_id is null and mode = 'ranked')
  );

-- Ranked room FSM updates need to work without an owner.
drop policy if exists "owners update rooms" on public.rooms;
create policy "owners update rooms" on public.rooms
  for update to authenticated
  using (
    auth.uid() = owner_id
    or
    owner_id is null
  )
  with check (
    auth.uid() = owner_id
    or
    owner_id is null
  );

-- createAiBattleRoom upserts room_members for all matched players.
-- For ranked (ownerless) rooms the existing "room owners add members"
-- policy does not apply, and "users join rooms" only permits self-insert.
create policy "ranked room members upsert" on public.room_members
  for insert to authenticated
  with check (
    exists (
      select 1 from public.rooms
      where rooms.id = room_id
      and rooms.owner_id is null
      and rooms.mode = 'ranked'
    )
  );

-- UPDATE is needed for the upsert conflict branch.
create policy "ranked room members update" on public.room_members
  for update to authenticated
  using (
    exists (
      select 1 from public.rooms
      where rooms.id = room_id
      and rooms.owner_id is null
      and rooms.mode = 'ranked'
    )
  )
  with check (
    exists (
      select 1 from public.rooms
      where rooms.id = room_id
      and rooms.owner_id is null
      and rooms.mode = 'ranked'
    )
  );
