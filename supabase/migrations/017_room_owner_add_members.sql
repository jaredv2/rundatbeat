-- Room owners need to add other members (e.g. matched partner) to their room.
-- The existing "users join rooms" policy only allows auth.uid() = user_id,
-- which prevents the owner from inserting rows for other users.

create policy "room owners add members" on public.room_members
  for insert to authenticated
  with check (
    exists (
      select 1 from public.rooms
      where rooms.id = room_id
      and rooms.owner_id = auth.uid()
    )
  );

-- Room owners need to remove members when closing / cleaning up their room.
-- The existing "users leave rooms" policy only allows auth.uid() = user_id.
create policy "room owners remove members" on public.room_members
  for delete to authenticated
  using (
    exists (
      select 1 from public.rooms
      where rooms.id = room_id
      and rooms.owner_id = auth.uid()
    )
  );

-- UPSERT on room_members (used by join / createAiBattleRoom) needs an UPDATE
-- policy so the ON CONFLICT branch doesn't get blocked.
create policy "users update own membership" on public.room_members
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
