-- 034_cleanup_cron.sql
-- Run this in the Supabase SQL Editor AFTER deploying the room-cleanup edge function.
--
-- Prerequisites:
--   1. Deploy the edge function: supabase functions deploy room-cleanup
--   2. Enable pg_cron + pg_net extensions (Supabase Dashboard → Database → Extensions)
--   3. Replace YOUR_PROJECT_URL and YOUR_SERVICE_ROLE_KEY below, then run.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove old schedules if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'room-cleanup-minute') THEN
    PERFORM cron.unschedule('room-cleanup-minute');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'room-cleanup-daily') THEN
    PERFORM cron.unschedule('room-cleanup-daily');
  END IF;
END
$$;

-- Run daily at 04:00 UTC
SELECT cron.schedule(
  'room-cleanup-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := 'YOUR_PROJECT_URL/functions/v1/room-cleanup',
    headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
