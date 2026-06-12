-- Site statistics for admin dashboard
-- - page_visits: total page views (incremented on navigation)
-- - peak_online: highest concurrent active count ever recorded

create table if not exists public.site_stats (
  metric    text primary key,
  value     bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Seed initial rows
insert into public.site_stats (metric, value) values
  ('page_visits', 0),
  ('peak_online', 0)
on conflict (metric) do nothing;

-- Allow read access for authenticated users (used in admin panel)
alter table public.site_stats enable row level security;

create policy "authenticated can read site_stats"
  on public.site_stats for select
  using (auth.role() = 'authenticated');

-- Only authenticated users can upsert (for tracking)
create policy "authenticated can upsert site_stats"
  on public.site_stats for insert
  with check (auth.role() = 'authenticated');

create policy "authenticated can update site_stats"
  on public.site_stats for update
  using (auth.role() = 'authenticated');

-- Helper function to atomically increment a counter
create or replace function public.increment_counter(metric_name text)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.site_stats (metric, value) values (metric_name, 1)
  on conflict (metric) do update set value = site_stats.value + 1, updated_at = now();
end;
$$;
