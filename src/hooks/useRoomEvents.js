import { useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { devLog } from '../lib/devLog';

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
            devLog('[RoomEvent] player left:', event.sender_id);
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
 * dispatchRoomEvent — process events client-side and broadcast via realtime.
 *
 * @param {object} opts - { roomId, eventType, payload? }
 */
export async function dispatchRoomEvent({ roomId, eventType, payload = {} }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  if (eventType === 'player_join') {
    const { data: room } = await supabase.from('rooms').select('status, max_players, mode').eq('id', roomId).maybeSingle();
    if (!room) throw new Error('Room not found');
    if (room.status !== 'lobby') throw new Error('Room is not in lobby');
    if (room.mode === 'ranked') throw new Error('Cannot join ranked this way');

    const { count: memberCount } = await supabase.from('room_members').select('room_id', { count: 'exact' }).eq('room_id', roomId);
    if ((memberCount || 0) >= (room.max_players || 4)) throw new Error('Room is full');

    const { error } = await supabase.from('room_members').insert({ room_id: roomId, user_id: user.id, role: 'member', is_ready: false });
    if (error && error.code !== '23505') throw new Error('Failed to join room');

    const { count } = await supabase.from('room_members').select('room_id', { count: 'exact' }).eq('room_id', roomId);
    if (count != null) await supabase.from('rooms').update({ current_players: count }).eq('id', roomId);
  }

  if (eventType === 'player_leave') {
    await supabase.from('room_members').delete().eq('room_id', roomId).eq('user_id', user.id);
    const { count } = await supabase.from('room_members').select('room_id', { count: 'exact' }).eq('room_id', roomId);
    if (count != null) await supabase.from('rooms').update({ current_players: count }).eq('id', roomId);
  }

  if (eventType === 'kick') {
    const { targetUserId } = payload;
    if (!targetUserId) throw new Error('Missing targetUserId');
    await supabase.from('room_members').delete().eq('room_id', roomId).eq('user_id', targetUserId);
    const { count } = await supabase.from('room_members').select('room_id', { count: 'exact' }).eq('room_id', roomId);
    if (count != null) await supabase.from('rooms').update({ current_players: count }).eq('id', roomId);
  }

  if (eventType === 'challenge_ready') {
    const { challenge } = payload;
    if (!challenge) throw new Error('Missing challenge payload');
    await supabase.from('rooms').update({ challenge }).eq('id', roomId);
    const { data: roomRow } = await supabase.from('rooms').select('battle_id').eq('id', roomId).maybeSingle();
    if (roomRow?.battle_id) {
      await supabase.from('battles').update({
        title: challenge.title || 'CUSTOM BATTLE',
        prompt_text: challenge.instructions || '',
        genre: challenge.genre || 'trap',
        bpm: challenge.bpm || null,
        mood: challenge.mood || '',
        restrictions: challenge.restrictionsList || '',
        flavor_text: challenge.flavor_text || '',
      }).eq('id', roomRow.battle_id);
    }
  }

  if (eventType === 'close_room') {
    await supabase.from('rooms').update({ status: 'closed' }).eq('id', roomId).in('status', ['lobby', 'locked', 'voting', 'open']);
  }

  if (eventType === 'owner_leave') {
    const { battleId } = payload;
    if (battleId) {
      await supabase.from('battles').update({ status: 'closed', early_closed: true }).eq('id', battleId).in('status', ['upcoming', 'active', 'voting']);
    }
    await supabase.from('room_messages').delete().eq('room_id', roomId);
    await supabase.from('room_members').delete().eq('room_id', roomId);
    await supabase.from('rooms').delete().eq('id', roomId);
  }

  // Insert event for realtime delivery
  await supabase.from('room_events').insert({
    room_id: roomId,
    sender_id: user.id,
    event_type: eventType,
    payload,
  });
}
