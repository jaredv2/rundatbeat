import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export function useBattle(id) {
  const [battle, setBattle] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!supabase || !id) return;
    console.log('[useBattle] refresh() — battle id:', id);
    setLoading(true);
    const [{ data: battleData, error: battleError }, { data: submissionData, error: subError }] = await Promise.all([
      supabase.from('battles').select('*').eq('id', id).maybeSingle(),
      // Select full profile data so WaveformPlayer and name cosmetics work on submissions
      supabase.from('submissions')
        .select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)')
        .eq('battle_id', id)
        .order('vote_count', { ascending: false }), // show highest voted first
    ]);

    if (battleError) console.error('[useBattle] battles fetch error:', battleError);
    if (subError) console.error('[useBattle] submissions fetch error:', subError);

    console.log('[useBattle] battle status:', battleData?.status, '| submissions loaded:', submissionData?.length ?? 0);
    setBattle(battleData);
    setSubmissions(submissionData || []);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    if (!supabase || !id) return undefined;

    // Subscribe to realtime changes on battles, submissions, votes, AND rooms
    // so the UI reacts to state transitions (active → voting → closed) immediately
    const channel = supabase
      .channel(`battle-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'battles', filter: `id=eq.${id}` },
        (payload) => {
          console.log('[useBattle] realtime battle update — new status:', payload.new?.status);
          // Update battle directly from payload for instant status change reflection
          setBattle((prev) => ({ ...prev, ...payload.new }));
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'votes', filter: `battle_id=eq.${id}` },
        () => {
          console.log('[useBattle] realtime vote change — refreshing');
          refresh();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'submissions', filter: `battle_id=eq.${id}` },
        () => {
          console.log('[useBattle] realtime submission change — refreshing');
          refresh();
        },
      )
      .on(
        // React to room status changes (open → locked → closed) in real time
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `battle_id=eq.${id}` },
        (payload) => {
          console.log('[useBattle] realtime room update — status:', payload.new?.status);
          // Room data is managed by Battle.jsx's loadRoom(), trigger a refresh cycle
          refresh();
        },
      )
      .subscribe((status) => {
        console.log('[useBattle] realtime channel status:', status);
      });

    return () => {
      console.log('[useBattle] unsubscribing realtime channel');
      supabase.removeChannel(channel);
    };
  }, [id]);

  return { battle, submissions, loading, refresh };
}