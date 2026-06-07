/**
 * useBattle — pure realtime, zero polling
 *
 * All data is pushed via Supabase realtime channels.
 * No setInterval, no manual polling anywhere in this hook.
 *
 * Exposes: battle, submissions, room, members, messages, loading, refresh, refreshRoomData
 */

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export function useBattle(id) {
  const [battle, setBattle]           = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [room, setRoom]               = useState(null);
  const [members, setMembers]         = useState([]);
  const [messages, setMessages]       = useState([]);
  const [loading, setLoading]         = useState(true);

  // Stable ref so realtime handlers can filter room-scoped events without
  // stale closures — updated whenever room loads or changes via realtime.
  const roomIdRef = useRef(null);

  // ── Full refresh (called once on mount and on submission changes) ─────────
  async function refresh() {
    if (!supabase || !id) return;
    console.log('[useBattle] refresh() — battle id:', id);
    setLoading(true);

    const [
      { data: battleData,     error: battleError },
      { data: submissionData, error: subError },
      { data: roomData,       error: roomError },
    ] = await Promise.all([
      supabase.from('battles').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('submissions')
        .select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)')
        .eq('battle_id', id)
        .order('vote_count', { ascending: false }),
      supabase.from('rooms').select('*').eq('battle_id', id).maybeSingle(),
    ]);

    if (battleError)  console.error('[useBattle] battles error:', battleError);
    if (subError)     console.error('[useBattle] submissions error:', subError);
    if (roomError)    console.error('[useBattle] room error:', roomError);

    setBattle(battleData ?? null);
    setSubmissions(submissionData ?? []);

    const loadedRoom = roomData ?? null;
    setRoom(loadedRoom);
    roomIdRef.current = loadedRoom?.id ?? null;

    if (loadedRoom?.id) {
      await refreshRoomData(loadedRoom.id);
    }

    console.log(
      '[useBattle] status:', battleData?.status,
      '| submissions:', submissionData?.length ?? 0,
      '| room:', loadedRoom?.id ?? 'none',
      '| mode:', loadedRoom?.mode ?? 'n/a',
    );
    setLoading(false);
  }

  // ── Lightweight room-scoped refresh (members + chat only) ─────────────────
  async function refreshRoomData(roomId) {
    if (!supabase || !roomId) return;
    const [{ data: memberRows }, { data: messageRows }] = await Promise.all([
      supabase
        .from('room_members')
        .select('role, user_id, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)')
        .eq('room_id', roomId)
        .order('joined_at'),
      supabase
        .from('room_messages')
        .select('*, profiles(username, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon)')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(50),
    ]);
    setMembers(memberRows ?? []);
    setMessages(messageRows ?? []);
  }

  // ── Lightweight submissions-only refresh (triggered by vote events) ───────
  async function refreshSubmissions() {
    if (!supabase || !id) return;
    const { data } = await supabase
      .from('submissions')
      .select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)')
      .eq('battle_id', id)
      .order('vote_count', { ascending: false });
    if (data) setSubmissions(data);
  }

  // ── Realtime subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let channel = null;

    (async () => {
      await refresh();
      if (cancelled || !supabase || !id) return;

      channel = supabase
        .channel(`battle-${id}`)

        // Battle row changes (status, timestamps)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'battles', filter: `id=eq.${id}` },
          (payload) => {
            console.log('[useBattle] realtime battle →', payload.new?.status);
            setBattle((prev) => ({ ...prev, ...payload.new }));
          },
        )

        // Vote changes → re-rank submissions without full refresh
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'votes', filter: `battle_id=eq.${id}` },
          () => {
            console.log('[useBattle] realtime vote change — refreshing submissions');
            refreshSubmissions();
          },
        )

        // New / updated submissions
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'submissions', filter: `battle_id=eq.${id}` },
          () => {
            console.log('[useBattle] realtime submission change — full refresh');
            refresh();
          },
        )

        // Room row updates (status transitions: open → locked → voting → closed)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `battle_id=eq.${id}` },
          (payload) => {
            console.log('[useBattle] realtime room update → status:', payload.new?.status);
            setRoom((prev) => ({ ...prev, ...payload.new }));
            roomIdRef.current = payload.new?.id ?? roomIdRef.current;
            // Sync battle status from room (battles table may not be in realtime publication)
            const rs = payload.new?.status;
            if (rs === 'closed' || rs === 'voting' || rs === 'locked') {
              setBattle((prev) => {
                if (prev?.status === rs) return prev;
                const mapped = rs === 'locked' ? 'active' : rs;
                return { ...prev, status: mapped };
              });
            }
          },
        )

        // Room members (joins / leaves)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'room_members' },
          (payload) => {
            const affectedRoomId = payload.new?.room_id || payload.old?.room_id;
            if (affectedRoomId && affectedRoomId === roomIdRef.current) {
              console.log('[useBattle] realtime room_members change');
              refreshRoomData(affectedRoomId);
            }
          },
        )

        // Chat messages
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'room_messages' },
          (payload) => {
            const msgRoomId = payload.new?.room_id;
            if (msgRoomId && msgRoomId === roomIdRef.current) {
              console.log('[useBattle] realtime new message');
              refreshRoomData(msgRoomId);
            }
          },
        )

        .subscribe((status) => {
          console.log('[useBattle] realtime channel status:', status);
        });
    })();

    return () => {
      cancelled = true;
      if (channel) {
        console.log('[useBattle] unsubscribing realtime channel');
        supabase.removeChannel(channel);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return {
    battle,
    submissions,
    room,
    members,
    messages,
    loading,
    refresh,
    refreshRoomData,
  };
}