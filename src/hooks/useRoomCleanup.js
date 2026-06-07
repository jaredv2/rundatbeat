import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';

const CLEANUP_INTERVAL = 2 * 60 * 1000;

export function useRoomCleanup() {
  const { profile } = useAuthStore();
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!profile || !supabase) return;

    async function cleanup() {
      try {
        // Close rooms with current_players <= 0
        const { data: emptyRooms } = await supabase
          .from('rooms')
          .select('id')
          .in('status', ['open', 'locked'])
          .lte('current_players', 0)
          .limit(50);

        // Close rankeds rooms that have been locked for more than 2 minutes
        // but have no members (ownerless rooms where all players left)
        const { data: ghostRooms } = await supabase
          .from('rooms')
          .select('id')
          .eq('mode', 'ranked')
          .eq('status', 'locked')
          .is('owner_id', null)
          .lt('created_at', new Date(Date.now() - 2 * 60 * 1000).toISOString())
          .limit(50);

        const ids = [
          ...(emptyRooms || []).map((r) => r.id),
          ...(ghostRooms || []).map((r) => r.id),
        ];

        if (ids.length > 0) {
          const unique = [...new Set(ids)];
          await supabase
            .from('rooms')
            .update({ status: 'closed' })
            .in('id', unique);
          await supabase
            .from('room_members')
            .delete()
            .in('room_id', unique);
        }
      } catch (err) {
        console.error('[RoomCleanup]', err);
      }
    }

    cleanup();
    intervalRef.current = setInterval(cleanup, CLEANUP_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [profile?.id]);
}
