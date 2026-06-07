import { useEffect } from 'react';

export function useRoomCleanup() {
  useEffect(() => {
    // Room cleanup is handled server-side by Supabase Edge Function
    // (supabase/functions/room-cleanup) scheduled via cron.
  }, []);
}
