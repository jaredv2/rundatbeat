-- Rollback: remove unused pattern columns from battles
alter table public.battles
  drop column if exists patterns,
  drop column if exists synths;
