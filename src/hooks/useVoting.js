import { supabase } from '../lib/supabase';

const TIER_MULTIPLIERS = {
  bronze:   1.0,
  silver:   1.1,
  gold:     1.2,
  platinum: 1.35,
  diamond:  1.5,
  elite:    1.7,
  champion: 1.9,
  goat:     2.0,
};

function accountAgeMultiplier(voterProfile) {
  const createdAt = voterProfile?.created_at;
  if (!createdAt) return 1.0;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 7)   return 0.0;
  if (ageDays < 30)  return 0.8;
  if (ageDays < 90)  return 1.0;
  if (ageDays < 365) return 1.1;
  if (ageDays < 730) return 1.2;
  return 1.3;
}

export function computeVoteWeight(voterProfile) {
  const tier    = (voterProfile?.rank_tier || 'bronze').toLowerCase();
  const tierMult = TIER_MULTIPLIERS[tier] ?? 1.0;
  const ageMult  = accountAgeMultiplier(voterProfile);
  return Math.round(tierMult * ageMult * 100) / 100;
}

export function voteWeightBreakdown(voterProfile) {
  const tier     = (voterProfile?.rank_tier || 'bronze').toLowerCase();
  const tierMult = TIER_MULTIPLIERS[tier] ?? 1.0;
  const ageMult  = accountAgeMultiplier(voterProfile);
  const total    = Math.round(tierMult * ageMult * 100) / 100;
  return { tier, tierMult, ageMult, total };
}

export function useVoting() {
  async function castRating({ battleId, submission, voterId, voterProfile, rating, description = '' }) {
    if (!supabase) throw new Error('Supabase not initialized');
    if (!voterId) throw new Error('Must be logged in to vote');
    if (submission.user_id === voterId) throw new Error('YOU CANNOT VOTE YOUR OWN SUBMISSION');

    const weight = computeVoteWeight(voterProfile);
    const weightedRating = Math.round(rating * weight * 100) / 100;

    const { data: existing } = await supabase
      .from('votes')
      .select('id, rating, weight')
      .eq('submission_id', submission.id)
      .eq('voter_id', voterId)
      .maybeSingle();

    const prevWeightedRating = existing ? (existing.rating || 0) * (existing.weight || 1) : 0;
    const delta = Math.round((weightedRating - prevWeightedRating) * 100) / 100;

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
      console.warn('[useVoting] RPC unavailable, falling back:', rpcError.message);
    }

    return { rating, weight, delta };
  }

  async function stopVoting(battleId, userId, stopped = true) {
    const { error } = await supabase
      .from('room_members')
      .update({ voting_stopped: stopped })
      .eq('room_id', battleId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  async function getVotersWhoStopped(battleId) {
    const { data } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', battleId)
      .eq('voting_stopped', true);
    return data || [];
  }

  async function getTotalVoters(battleId) {
    const { count } = await supabase
      .from('room_members')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', battleId);
    return count || 0;
  }

  return { castRating, stopVoting, getVotersWhoStopped, getTotalVoters, computeVoteWeight, voteWeightBreakdown };
}
