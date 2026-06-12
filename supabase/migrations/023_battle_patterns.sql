alter table public.battles
  add column if not exists patterns jsonb,
  add column if not exists synths jsonb;
