/**
 * useBattle — realtime + lightweight polling fallback.
 * Uses array reconciliation (only re-renders changed items) and exposes
 * optimistic update helpers so components can update local state instantly,
 * then let realtime sync other clients.
 *
 * Exposes: battle, submissions, room, members, messages, loading,
 *          refresh, refreshRoomData, optimistic*
 */

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// ── Reconciliation helpers ────────────────────────────────────────────────

/** Merge next into prev, returning prev reference if nothing changed. */
function mergeObj(prev, next) {
  if (!next) return null;
  if (!prev) return next;
  let changed = false;
  const merged = { ...prev };
  for (const key of Object.keys(next)) {
    if (merged[key] !== next[key]) {
      merged[key] = next[key];
      changed = true;
    }
  }
  return changed ? merged : prev;
}

/**
 * Reconcile an array by ID. Keeps old references for unchanged items
 * so React skips re-renders for those items.
 */
function reconcileArray(prev, next, keyFn = (item) => item?.id) {
  if (!next) return prev;
  if (!prev?.length) return next;
  const prevMap = new Map(prev.map(item => [keyFn(item), item]));
  let changed = false;
  const result = next.map(item => {
    const key = keyFn(item);
    const old = prevMap.get(key);
    if (!old) { changed = true; return item; }
    if (JSON.stringify(old) !== JSON.stringify(item)) { changed = true; return item; }
    return old;
  });
  if (result.length !== prev.length) changed = true;
  return changed ? result : prev;
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useBattle(id) {
  const [battle, setBattle]           = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [room, setRoom]               = useState(null);
  const [members, setMembers]         = useState([]);
  const [messages, setMessages]       = useState([]);
  const [loading, setLoading]         = useState(true);

  const roomIdRef   = useRef(null);
  const battleIdRef = useRef(null);
  const [subscribedBattleId, setSubscribedBattleId] = useState(null);
  const [subscribedRoomId, setSubscribedRoomId] = useState(null);
  const refreshingRef = useRef(false);

  // ── Resolve the actual battle_id from raw id (could be room UUID or battle UUID) ──
  async function resolveIds(rawId) {
    let b = await supabase.from('battles').select('id').eq('id', rawId).maybeSingle();
    if (b?.data) return { battleId: b.data.id, roomId: null };

    let r = await supabase.from('rooms').select('id, battle_id').eq('id', rawId).maybeSingle();
    if (r?.data) return { battleId: r.data.battle_id || null, roomId: r.data.id };

    return { battleId: null, roomId: null };
  }

  // ── Full refresh (mount / forced) ───────────────────────────────────────
  async function refresh() {
    if (!supabase || !id) return;
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setLoading(true);

    try {
      const ids = await resolveIds(id);
      if (ids.roomId) roomIdRef.current = ids.roomId;
      const actualBattleId = ids.battleId || id;
      battleIdRef.current = actualBattleId;

      const queries = [
        supabase.from('battles').select('*').eq('id', actualBattleId).maybeSingle(),
        supabase.from('submissions')
          .select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)')
          .eq('battle_id', actualBattleId)
          .order('vote_count', { ascending: false }),
      ];

      if (ids.roomId) {
        queries.push(supabase.from('rooms').select('*').eq('id', ids.roomId).maybeSingle());
      } else {
        queries.push(supabase.from('rooms').select('*').eq('battle_id', actualBattleId).maybeSingle());
      }

      const [{ data: battleData }, { data: submissionData }, { data: roomData }] = await Promise.all(queries);

      setBattle(prev => mergeObj(prev, battleData ?? null));
      setSubmissions(prev => reconcileArray(prev, submissionData ?? []));

      let loadedRoom = roomData ?? null;
      if (!loadedRoom && !ids.roomId) {
        const { data: directRoom } = await supabase.from('rooms').select('*').eq('id', id).maybeSingle();
        loadedRoom = directRoom ?? null;
        if (loadedRoom?.id) roomIdRef.current = loadedRoom.id;
      }
      setRoom(prev => mergeObj(prev, loadedRoom));
      roomIdRef.current = loadedRoom?.id ?? roomIdRef.current;

      if (loadedRoom?.id) {
        await refreshRoomData(loadedRoom.id);
      }

      setSubscribedBattleId(battleIdRef.current);
      setSubscribedRoomId(roomIdRef.current);
    } catch (err) {
      console.error('[useBattle] refresh error:', err);
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  }

  // ── Lightweight room-scoped refresh (members + chat only) ─────────────
  async function refreshRoomData(roomId) {
    if (!supabase || !roomId) return;
    const [{ data: memberRows }, { data: messageRows }] = await Promise.all([
      supabase
        .from('room_members')
        .select('role, user_id, is_ready, voting_stopped, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)')
        .eq('room_id', roomId)
        .order('joined_at'),
      supabase
        .from('room_messages')
        .select('*, profiles(username, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon)')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(50),
    ]);
    setMembers(prev => reconcileArray(prev, memberRows ?? []));
    setMessages(prev => reconcileArray(prev, messageRows ?? []));
  }

  // ── Lightweight submissions-only refresh ───────────────────────────────
  async function refreshSubmissions() {
    const bid = battleIdRef.current || id;
    if (!supabase || !bid) return;
    const { data } = await supabase
      .from('submissions')
      .select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)')
      .eq('battle_id', bid)
      .order('vote_count', { ascending: false });
    if (data) setSubmissions(prev => reconcileArray(prev, data));
  }

  // ── Optimistic update helpers ──────────────────────────────────────────
  // Call these BEFORE the server request. Other clients sync via realtime.

  /** Optimistically update a single submission (e.g. after vote lands). */
  function optimisticSubmission(id, patch) {
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }

  /** Optimistically add a new submission to the top of the list. */
  function optimisticAddSubmission(sub) {
    setSubmissions(prev => [sub, ...prev]);
  }

  /** Optimistically remove a submission (e.g. on delete). */
  function optimisticRemoveSubmission(id) {
    setSubmissions(prev => prev.filter(s => s.id !== id));
  }

  /** Optimistically toggle a member's ready state. */
  function optimisticReady(userId, isReady) {
    setMembers(prev => prev.map(m => m.user_id === userId ? { ...m, is_ready: isReady } : m));
  }

  /** Optimistically toggle voting_stopped for a member. */
  function optimisticVotingStopped(userId, stopped) {
    setMembers(prev => prev.map(m => m.user_id === userId ? { ...m, voting_stopped: stopped } : m));
  }

  /** Optimistically append a chat message (with local id). */
  function optimisticMessage(msg) {
    setMessages(prev => [...prev, msg]);
  }

  /** Optimistically remove a local-only message (on send failure). */
  function optimisticRemoveMessage(tempId) {
    setMessages(prev => prev.filter(m => m.id !== tempId));
  }

  /** Optimistically merge battle fields. */
  function optimisticBattle(patch) {
    setBattle(prev => ({ ...prev, ...patch }));
  }

  /** Optimistically merge room fields. */
  function optimisticRoom(patch) {
    setRoom(prev => ({ ...prev, ...patch }));
  }

  // ── Realtime subscriptions ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let channel = null;
    let pollTimer = null;

    (async () => {
      await refresh();
      if (cancelled || !supabase || !id) return;

      const bid = battleIdRef.current || id;
      const rid = roomIdRef.current;

      channel = supabase
        .channel(`battle-${id}-${bid}-${rid}`)

        // Battle row changes — merge only changed fields
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'battles', filter: `id=eq.${bid}` },
          (payload) => {
            setBattle(prev => mergeObj(prev, payload.new));
          },
        )

        // Vote changes → reconcile submissions
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'votes', filter: `battle_id=eq.${bid}` },
          () => { refreshSubmissions(); },
        )

        // Submission inserts — add optimistically or reconcile
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'submissions', filter: `battle_id=eq.${bid}` },
          (payload) => {
            const sub = payload.new;
            setSubmissions(prev => {
              if (prev.some(s => s.id === sub.id)) return prev;
              return [sub, ...prev];
            });
          },
        )

        // Submission updates — merge only changed fields
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'submissions', filter: `battle_id=eq.${bid}` },
          (payload) => {
            const updated = payload.new;
            setSubmissions(prev => prev.map(s => s.id === updated.id ? mergeObj(s, updated) : s));
          },
        )

        // Submission deletes — remove
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'submissions', filter: `battle_id=eq.${bid}` },
          (payload) => {
            const oldId = payload.old?.id;
            if (oldId) setSubmissions(prev => prev.filter(s => s.id !== oldId));
          },
        )

        // Room row updates — merge
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'rooms', filter: rid ? `id=eq.${rid}` : `battle_id=eq.${bid}` },
          (payload) => {
            const updated = payload.new;
            const old = payload.old;
            setRoom(prev => mergeObj(prev, updated));
            roomIdRef.current = updated?.id ?? roomIdRef.current;
            if (updated?.battle_id && !old?.battle_id) {
              battleIdRef.current = updated.battle_id;
              refresh();
            }
          },
        )

        // Room members — reconcile individual member
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'room_members' },
          (payload) => {
            if (payload.new?.room_id === roomIdRef.current) {
              const member = payload.new;
              setMembers(prev => {
                if (prev.some(m => m.user_id === member.user_id)) return prev;
                return [...prev, member];
              });
            }
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'room_members' },
          (payload) => {
            if (payload.new?.room_id === roomIdRef.current) {
              const updated = payload.new;
              setMembers(prev => prev.map(m => m.user_id === updated.user_id ? mergeObj(m, updated) : m));
            }
          },
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'room_members' },
          (payload) => {
            const oldUserId = payload.old?.user_id;
            const oldRoomId = payload.old?.room_id;
            if (oldRoomId === roomIdRef.current && oldUserId) {
              setMembers(prev => prev.filter(m => m.user_id !== oldUserId));
            }
          },
        )

        // Chat messages — append
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'room_messages' },
          (payload) => {
            if (payload.new?.room_id === roomIdRef.current) {
              const msg = payload.new;
              setMessages(prev => {
                if (prev.some(m => m.id === msg.id)) return prev;
                return [...prev, msg];
              });
            }
          },
        )

        .subscribe();

      // ── Fallback polling — only while IDs unresolved ──
      if (!rid || !bid) {
        pollTimer = setInterval(() => {
          if (cancelled) { clearInterval(pollTimer); return; }
          if (roomIdRef.current && battleIdRef.current) {
            clearInterval(pollTimer);
            return;
          }
          refresh();
        }, 3000);
      }
    })();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (channel) supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react/exhaustive-deps
  }, [id, subscribedBattleId, subscribedRoomId]);

  return {
    battle,
    submissions,
    room,
    members,
    messages,
    loading,
    refresh,
    refreshRoomData,
    refreshSubmissions,
    // Optimistic helpers
    optimisticSubmission,
    optimisticAddSubmission,
    optimisticRemoveSubmission,
    optimisticReady,
    optimisticVotingStopped,
    optimisticMessage,
    optimisticRemoveMessage,
    optimisticBattle,
    optimisticRoom,
  };
}
