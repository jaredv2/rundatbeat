insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('beats', 'beats', true, 52428800, array['audio/mpeg', 'audio/wav', 'audio/x-wav'])
on conflict (id) do update set public = true, file_size_limit = 52428800, allowed_mime_types = array['audio/mpeg', 'audio/wav', 'audio/x-wav'];

create policy "beats public read" on storage.objects for select using (bucket_id = 'beats');
create policy "beats authenticated upload" on storage.objects for insert to authenticated with check (bucket_id = 'beats');
create policy "beats owner update" on storage.objects for update to authenticated using (bucket_id = 'beats' and owner = auth.uid()) with check (bucket_id = 'beats' and owner = auth.uid());
