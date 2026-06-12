alter table public.profiles enable row level security;
alter table public.battles enable row level security;
alter table public.submissions enable row level security;
alter table public.votes enable row level security;
alter table public.token_transactions enable row level security;
alter table public.shop_items enable row level security;
alter table public.user_shop_purchases enable row level security;

create policy "profiles readable" on public.profiles for select using (true);
create policy "users insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "users update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "battles readable" on public.battles for select using (true);
create policy "authenticated create battles" on public.battles for insert to authenticated with check (true);
create policy "authenticated update battles" on public.battles for update to authenticated using (true) with check (true);

create policy "submissions readable" on public.submissions for select using (true);
create policy "users create own submissions" on public.submissions for insert to authenticated with check (auth.uid() = user_id);
create policy "users update own submissions" on public.submissions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "votes readable" on public.votes for select using (true);
create policy "users vote once and not self" on public.votes for insert to authenticated with check (
  auth.uid() = voter_id
  and not exists (
    select 1 from public.submissions s
    where s.id = submission_id and s.user_id = auth.uid()
  )
);

create policy "transactions readable by owner" on public.token_transactions for select using (auth.uid() = user_id);
create policy "transactions insert by owner" on public.token_transactions for insert to authenticated with check (auth.uid() = user_id);

create policy "shop readable" on public.shop_items for select using (true);
create policy "shop editable authenticated" on public.shop_items for all to authenticated using (true) with check (true);

create policy "purchases readable by owner" on public.user_shop_purchases for select using (auth.uid() = user_id);
create policy "purchases insert by owner" on public.user_shop_purchases for insert to authenticated with check (auth.uid() = user_id);
