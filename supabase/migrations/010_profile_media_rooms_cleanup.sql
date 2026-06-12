insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

create policy "avatars public read" on storage.objects
for select using (bucket_id = 'avatars');

create policy "avatars authenticated upload" on storage.objects
for insert to authenticated
with check (bucket_id = 'avatars' and owner = auth.uid());

create policy "avatars owner update" on storage.objects
for update to authenticated
using (bucket_id = 'avatars' and owner = auth.uid())
with check (bucket_id = 'avatars' and owner = auth.uid());

create policy "avatars owner delete" on storage.objects
for delete to authenticated
using (bucket_id = 'avatars' and owner = auth.uid());

create policy "owners delete rooms" on public.rooms
for delete to authenticated
using (auth.uid() = owner_id);

update public.shop_items
set is_active = false
where item_type = 'extra_submission_slot';
