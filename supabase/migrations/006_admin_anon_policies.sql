grant usage on schema public to anon;

grant select, insert, update on public.battles to anon;
grant select, update on public.profiles to anon;
grant select, insert on public.token_transactions to anon;
grant select, update on public.shop_items to anon;

create policy "anon admin insert battles" on public.battles
for insert to anon
with check (true);

create policy "anon admin update battles" on public.battles
for update to anon
using (true)
with check (true);

create policy "anon admin update profiles" on public.profiles
for update to anon
using (true)
with check (true);

create policy "anon admin read transactions" on public.token_transactions
for select to anon
using (true);

create policy "anon admin insert transactions" on public.token_transactions
for insert to anon
with check (true);

create policy "anon admin update shop" on public.shop_items
for update to anon
using (true)
with check (true);
