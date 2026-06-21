/**
 * useBattle — realtime + lightweight polling fallback.
 * Uses array reconciliation (only re-renders changed items) and exposes
 * optimistic update helpers so components can update local state instantly,
 * then let realtime sync other clients.
 *
 * Exposes: battle, submissions, room, members, messages, loading,
 *          refresh, refreshRoomData, optimistic*
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { devLog } from '../lib/devLog';

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
    // Shallow compare keys — faster than JSON.stringify
    const oldKeys = Object.keys(old);
    const newKeys = Object.keys(item);
    if (oldKeys.length !== newKeys.length) { changed = true; return item; }
    for (let i = 0; i < oldKeys.length; i++) {
      const k = oldKeys[i];
      if (k === 'profiles') continue; // skip nested objects (expensive to compare)
      if (old[k] !== item[k]) { changed = true; return item; }
    }
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
  const loadedRef = useRef(false);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 5;

  // ── Resolve the actual battle_id from raw id (could be room UUID or battle UUID) ──
  async function resolveIds(rawId) {
    const [b, r] = await Promise.all([
      supabase.from('battles').select('id').eq('id', rawId).maybeSingle(),
      supabase.from('rooms').select('id, battle_id').eq('id', rawId).maybeSingle(),
    ]);

    if (b?.data) {
      devLog(`%c[${new Date().toISOString().slice(11, 23)}] [BATTLE] RESOLVE id:${rawId.slice(0,8)} → battle:${b.data.id.slice(0,8)}`, 'color:#a855f7');
      return { battleId: b.data.id, roomId: null };
    }

    if (r?.data) {
      devLog(`%c[${new Date().toISOString().slice(11, 23)}] [BATTLE] RESOLVE id:${rawId.slice(0,8)} → room:${r.data.id.slice(0,8)} battle:${(r.data.battle_id||'none').slice(0,8)}`, 'color:#a855f7');
      return { battleId: r.data.battle_id || null, roomId: r.data.id };
    }

    devLog(`%c[${new Date().toISOString().slice(11, 23)}] [BATTLE] RESOLVE id:${rawId.slice(0,8)} → NOT FOUND`, 'color:#a855f7');
    return { battleId: null, roomId: null };
  }

  // ── Full refresh (mount / forced) ───────────────────────────────────────
  async function refresh() {
    if (!supabase || !id) return;
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (!loadedRef.current) setLoading(true);

    try {
      const ids = await resolveIds(id);
      if (ids.roomId) roomIdRef.current = ids.roomId;
      const actualBattleId = ids.battleId || null;
      battleIdRef.current = actualBattleId;

      // Load room + battle + submissions in parallel
      let loadedRoom = null;
      const roomPromise = (ids.roomId
        ? supabase.from('rooms').select('*').eq('id', ids.roomId).maybeSingle()
        : actualBattleId
          ? supabase.from('rooms').select('*').eq('battle_id', actualBattleId).maybeSingle()
          : Promise.resolve({ data: null })
      ).then(({ data }) => data ?? null);

      const battlePromise = actualBattleId
        ? Promise.all([
            supabase.from('battles').select('*').eq('id', actualBattleId).maybeSingle(),
            supabase.from('submissions')
              .select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)')
              .eq('battle_id', actualBattleId)
              .order('rating_total', { ascending: false }),
          ])
        : Promise.resolve([null, null]);

      const [roomResult, [battleResult, submissionResult]] = await Promise.all([roomPromise, battlePromise]);
      loadedRoom = roomResult;
      // Fallback: direct room lookup by raw id
      if (!loadedRoom) {
        const { data } = await supabase.from('rooms').select('*').eq('id', id).maybeSingle();
        loadedRoom = data ?? null;
        if (loadedRoom?.id) roomIdRef.current = loadedRoom.id;
      }
      setRoom(prev => mergeObj(prev, loadedRoom));
      roomIdRef.current = loadedRoom?.id ?? roomIdRef.current;

      // Set battle + submissions from parallel load
      if (battleResult) {
        setBattle(prev => mergeObj(prev, battleResult.data ?? null));
        setSubmissions(prev => reconcileArray(prev, submissionResult ?? []));
      } else {
        setBattle(null);
        setSubmissions([]);
      }

      // Load members + chat
      if (loadedRoom?.id) {
        await refreshRoomData(loadedRoom.id);
      }

      // Auto-join custom room if user is not yet a member (lobby only — locked rooms are in-progress)
      if (loadedRoom?.id && loadedRoom.status === 'lobby' && loadedRoom.mode !== 'ranked') {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: existingMember } = await supabase
            .from('room_members')
            .select('user_id')
            .eq('room_id', loadedRoom.id)
            .eq('user_id', user.id)
            .maybeSingle();
          if (!existingMember) {
            try {
              devLog(`%c[${new Date().toISOString().slice(11, 23)}] [BATTLE] AUTO-JOIN room:`, 'color:#a855f7', loadedRoom.id);
              if (loadedRoom.status === 'lobby') {
                const { joinRoom } = await import('../lib/roomService');
                await joinRoom(loadedRoom.id, user.id);
              } else {
                const { error: memberErr } = await supabase.from('room_members').insert({
                  room_id: loadedRoom.id,
                  user_id: user.id,
                  role: 'member',
                  is_ready: false,
                });
                if (memberErr && memberErr.code !== '23505') throw memberErr;
              }
              await refreshRoomData(loadedRoom.id);
            } catch { /* room may be full or closed — ignore */ }
          }
        }
      }

      // Fallback: if room.challenge is missing, try fetching from ranked_lobbies
      if (loadedRoom && !loadedRoom.challenge && actualBattleId) {
        const { data: lobbyData } = await supabase
          .from('ranked_lobbies')
          .select('challenge')
          .eq('battle_id', actualBattleId)
          .maybeSingle();
        if (lobbyData?.challenge) {
          loadedRoom = { ...loadedRoom, challenge: lobbyData.challenge };
          setRoom(prev => mergeObj(prev, loadedRoom));
          await supabase.from('rooms').update({ challenge: lobbyData.challenge }).eq('id', loadedRoom.id);
        }
      }

      setSubscribedBattleId(battleIdRef.current);
      setSubscribedRoomId(roomIdRef.current);
      loadedRef.current = true;
    } catch (err) {
      devError('[BATTLE] refresh error:', err);
      retryCountRef.current += 1;
      if (retryCountRef.current >= MAX_RETRIES) {
        loadedRef.current = true;
        setLoading(false);
      }
    } finally {
      refreshingRef.current = false;
      if (loadedRef.current) setLoading(false);
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
      .order('rating_total', { ascending: false });
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

      const bid = battleIdRef.current;
      const rid = roomIdRef.current;

      channel = supabase
        .channel(`battle-${bid || 'none'}-${rid}`)

      // ── Battle-scoped subscriptions (only if battle exists) ──
      if (bid) {
        channel = channel
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'battles', filter: `id=eq.${bid}` }, (payload) => {
            setBattle(prev => mergeObj(prev, payload.new));
          })
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'battles', filter: `id=eq.${bid}` }, () => {
            setBattle(null);
            setSubmissions([]);
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter: `battle_id=eq.${bid}` }, () => { refreshSubmissions(); })
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'submissions', filter: `battle_id=eq.${bid}` }, (payload) => {
            const sub = payload.new;
            setSubmissions(prev => {
              if (prev.some(s => s.id === sub.id)) return prev;
              return [sub, ...prev];
            });
            supabase
              .from('submissions')
              .select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)')
              .eq('id', sub.id)
              .maybeSingle()
              .then(({ data }) => { if (data) setSubmissions(prev => prev.map(s => s.id === data.id ? data : s)); });
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'submissions', filter: `battle_id=eq.${bid}` }, (payload) => {
            const updated = payload.new;
            setSubmissions(prev => prev.map(s => s.id === updated.id ? mergeObj(s, updated) : s));
          })
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'submissions', filter: `battle_id=eq.${bid}` }, (payload) => {
            const oldId = payload.old?.id;
            if (oldId) setSubmissions(prev => prev.filter(s => s.id !== oldId));
          });
      }

      // ── Room-scoped subscriptions (always active) ──
      if (rid) {
        channel = channel
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${rid}` }, (payload) => {
            const updated = payload.new;
            setRoom(prev => mergeObj(prev, updated));
            roomIdRef.current = updated?.id ?? roomIdRef.current;
            // If a battle was just created for this room, restart subscriptions
            if (updated?.battle_id && !battleIdRef.current) {
              battleIdRef.current = updated.battle_id;
              setSubscribedBattleId(updated.battle_id);
            }
          });
      }

      channel = channel
        // Room members — INSERT
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_members' }, (payload) => {
          if (payload.new?.room_id === roomIdRef.current) {
            const member = payload.new;
            setMembers(prev => {
              if (prev.some(m => m.user_id === member.user_id)) return prev;
              return [...prev, member];
            });
            supabase
              .from('room_members')
              .select('role, user_id, is_ready, voting_stopped, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)')
              .eq('room_id', member.room_id)
              .eq('user_id', member.user_id)
              .maybeSingle()
              .then(({ data }) => { if (data) setMembers(prev => prev.map(m => m.user_id === data.user_id ? data : m)); });
          }
        })
        // Room members — UPDATE
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'room_members' }, (payload) => {
          if (payload.new?.room_id === roomIdRef.current) {
            const updated = payload.new;
            setMembers(prev => prev.map(m => m.user_id === updated.user_id ? mergeObj(m, updated) : m));
          }
        })
        // Room members — DELETE
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'room_members' }, (payload) => {
          const oldUserId = payload.old?.user_id;
          const oldRoomId = payload.old?.room_id;
          if (oldRoomId === roomIdRef.current && oldUserId) {
            setMembers(prev => prev.filter(m => m.user_id !== oldUserId));
          } else if (!oldRoomId && roomIdRef.current) {
            supabase
              .from('room_members')
              .select('role, user_id, is_ready, voting_stopped, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)')
              .eq('room_id', roomIdRef.current)
              .order('joined_at')
              .then(({ data }) => { if (data) setMembers(prev => reconcileArray(prev, data)); });
          }
        })
        // Chat messages — INSERT
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages' }, (payload) => {
          if (payload.new?.room_id === roomIdRef.current) {
            const msg = payload.new;
            setMessages(prev => {
              if (prev.some(m => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
            supabase
              .from('room_messages')
              .select('*, profiles(username, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon)')
              .eq('id', msg.id)
              .maybeSingle()
              .then(({ data }) => { if (data) setMessages(prev => prev.map(m => m.id === data.id ? data : m)); });
          }
        })
        .subscribe();

      // ── Fallback polling — only while battle ID is unresolved ──
      if (!bid) {
        pollTimer = setInterval(() => {
          if (cancelled) { clearInterval(pollTimer); return; }
          if (battleIdRef.current) {
            clearInterval(pollTimer);
            // IDs resolved — restart with correct subscriptions
            cancelled = true;
            if (channel) supabase.removeChannel(channel);
            // Trigger re-run by updating subscribed IDs
            setSubscribedBattleId(battleIdRef.current);
            setSubscribedRoomId(roomIdRef.current);
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

  return useMemo(() => ({
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
  }), [battle, submissions, room, members, messages, loading]);
}
