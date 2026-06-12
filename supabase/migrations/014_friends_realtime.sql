-- Add read tracking to friend messages
alter table public.friend_messages
  add column if not exists read_at timestamptz;

-- Allow participants to delete their own messages
create policy "users delete own messages" on public.friend_messages
  for delete to authenticated
  using (auth.uid() = sender_id);

-- Allow participants to delete friendships (unfriend / decline / cancel)
create policy "participants delete friendships" on public.friendships
  for delete to authenticated
  using (auth.uid() in (requester_id, addressee_id));

-- Add social tables to the realtime publication
alter publication supabase_realtime add table public.friend_messages;
alter publication supabase_realtime add table public.friendships;
alter publication supabase_realtime add table public.user_presence;
