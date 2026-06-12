-- 035_notifications_insert_policy.sql
-- Fix: allow authenticated users to insert notifications for OTHER users
-- (e.g. 1v1 challenges, friend requests, battle invites)

DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;

CREATE POLICY "notifications_insert_authed" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (true);
