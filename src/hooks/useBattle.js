import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export function useBattle(id) {
  const [battle, setBattle] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!supabase || !id) return;
    setLoading(true);
    const [{ data: battleData }, { data: submissionData }] = await Promise.all([
      supabase.from('battles').select('*').eq('id', id).maybeSingle(),
      supabase.from('submissions').select('*, profiles(username, avatar_url, active_theme, accent_color, active_name_color, active_name_effect, nameplate_icon, rank_tier)').eq('battle_id', id).order('submitted_at'),
    ]);
    setBattle(battleData);
    setSubmissions(submissionData || []);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    if (!supabase || !id) return undefined;
    const channel = supabase
      .channel(`battle-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battles', filter: `id=eq.${id}` }, (payload) => setBattle(payload.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter: `battle_id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions', filter: `battle_id=eq.${id}` }, refresh)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [id]);

  return { battle, submissions, loading, refresh };
}
