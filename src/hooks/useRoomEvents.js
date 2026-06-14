import { useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/**
 * useRoomEvents — subscribe to room_events for a given room.
 * Dispatches events to handlers and handles kick/close_room/challenge_ready automatically.
 *
 * @param {string|null} roomId
 * @param {object} opts - { onEvent?, onKick?, onCloseRoom?, onChallengeReady?, profileId? }
 */
export function useRoomEvents(roomId, { onEvent, onKick, onCloseRoom, onChallengeReady, profileId } = {}) {
  const navigate = useNavigate();
  const handlersRef = useRef({ onEvent, onKick, onCloseRoom, onChallengeReady });

  useEffect(() => {
    handlersRef.current = { onEvent, onKick, onCloseRoom, onChallengeReady };
  }, [onEvent, onKick, onCloseRoom, onChallengeReady]);

  useEffect(() => {
    if (!roomId) return;

    const channel = supabase
      .channel(`room_events:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_events', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const event = payload.new;
          const handlers = handlersRef.current;

          // Always fire generic handler
          handlers.onEvent?.(event);

          // Handle specific event types
          if (event.event_type === 'kick') {
            handlers.onKick?.(event);
            navigate('/', { replace: true });
          }

          if (event.event_type === 'player_leave' && event.sender_id !== profileId) {
            // Another player left — just log, don't redirect self
            console.log('[RoomEvent] player left:', event.sender_id);
          }

          if (event.event_type === 'owner_leave') {
            handlers.onCloseRoom?.(event);
            navigate('/', { replace: true });
          }

          if (event.event_type === 'close_room') {
            handlers.onCloseRoom?.(event);
            navigate('/', { replace: true });
          }

          if (event.event_type === 'challenge_ready') {
            handlers.onChallengeReady?.(event);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, navigate, profileId]);
}

/**
 * dispatchRoomEvent — send an event to the server for processing and broadcast.
 *
 * @param {object} opts - { roomId, eventType, payload? }
 */
export async function dispatchRoomEvent({ roomId, eventType, payload = {} }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/room-events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ roomId, eventType, payload }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Event dispatch failed');
  return json;
}
