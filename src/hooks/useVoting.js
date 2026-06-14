import { supabase } from '../lib/supabase';

export function useVoting() {
  async function castRating({ battleId, submission, voterId, rating, description = '' }) {
    if (!supabase) throw new Error('Supabase not initialized');
    if (!voterId) throw new Error('Must be logged in to vote');
    if (submission.user_id === voterId) throw new Error('YOU CANNOT VOTE YOUR OWN SUBMISSION');
    if (typeof rating !== 'number' || rating < 0 || rating > 10) throw new Error('Rating must be between 0 and 10');

    const weight = 1;

    const { data: existing } = await supabase
      .from('votes')
      .select('id, rating, weight')
      .eq('submission_id', submission.id)
      .eq('voter_id', voterId)
      .maybeSingle();

    const prevRating = existing ? (existing.rating || 0) : 0;
    const delta = Math.round((rating - prevRating) * 100) / 100;

    const writeQuery = existing
      ? supabase
          .from('votes')
          .update({ rating, weight, description: description || null })
          .eq('id', existing.id)
      : supabase
          .from('votes')
          .insert({
            battle_id: battleId,
            submission_id: submission.id,
            voter_id: voterId,
            rating,
            weight,
            description: description || null,
          });

    const { error: writeError } = await writeQuery;
    if (writeError) throw writeError;

    const { error: rpcError } = await supabase.rpc('update_submission_rating', {
      submission_id_input: submission.id,
      delta_input: delta,
      new_rating_input: rating,
    });

    if (rpcError) {
      const { data: allVotes } = await supabase
        .from('votes')
        .select('rating')
        .eq('submission_id', submission.id);
      if (allVotes?.length) {
        const total = allVotes.reduce((sum, v) => sum + (v.rating || 0), 0);
        await supabase.from('submissions').update({ rating_total: total, vote_count: allVotes.length }).eq('id', submission.id);
      }
    }

    return { rating, weight, delta };
  }

  async function stopVoting(roomId, userId, stopped = true) {
    const { error } = await supabase
      .from('room_members')
      .update({ voting_stopped: stopped })
      .eq('room_id', roomId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  async function getVotersWhoStopped(roomId) {
    const { data } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
      .eq('voting_stopped', true);
    return data || [];
  }

  async function getTotalVoters(roomId) {
    const { count } = await supabase
      .from('room_members')
      .select('room_id', { count: 'exact' })
      .eq('room_id', roomId);
    return count || 0;
  }

  return { castRating, stopVoting, getVotersWhoStopped, getTotalVoters };
}
