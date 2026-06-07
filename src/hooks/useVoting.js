/**
 * useVoting — weighted vote system
 *
 * Vote weight = tierMultiplier × ageMultiplier, rounded to 2 dp.
 *
 * Rank tier multipliers:
 *   bronze=1.0  silver=1.1  gold=1.2  platinum=1.35
 *   diamond=1.5  elite=1.7  champion=1.9  goat=2.0
 *
 * Account age multipliers:
 *   < 7 days   → 0.0   brand-new accounts have zero influence
 *   7–30 days  → 0.8
 *   1–3 months → 1.0   (baseline)
 *   3–12 months→ 1.1
 *   1–2 years  → 1.2
 *   2+ years   → 1.3
 *
 * SQL migration required (run once):
 *
 *   ALTER TABLE votes ADD COLUMN IF NOT EXISTS weight numeric NOT NULL DEFAULT 1;
 *
 *   CREATE OR REPLACE FUNCTION increment_submission_vote_weighted(
 *     submission_id_input uuid,
 *     delta_input numeric
 *   ) RETURNS void LANGUAGE plpgsql AS $$
 *   BEGIN
 *     UPDATE submissions
 *     SET vote_count = COALESCE(vote_count, 0) + delta_input
 *     WHERE id = submission_id_input;
 *   END; $$;
 */

import { supabase } from '../lib/supabase';
import { addTokenTransaction } from '../lib/tokenHelpers';

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

// ── Weight computation helpers ────────────────────────────────────────────────

function accountAgeMultiplier(voterProfile) {
  const createdAt = voterProfile?.created_at;
  if (!createdAt) return 1.0;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);

  if (ageDays < 7)   return 0.0;  // brand-new — zero influence
  if (ageDays < 30)  return 0.8;
  if (ageDays < 90)  return 1.0;
  if (ageDays < 365) return 1.1;
  if (ageDays < 730) return 1.2;
  return 1.3;
}

/**
 * Compute the final vote weight for a voter profile.
 * Exported so VotingFeed / VoteCard can display the weight badge.
 */
export function computeVoteWeight(voterProfile) {
  const tier    = (voterProfile?.rank_tier || 'bronze').toLowerCase();
  const tierMult = TIER_MULTIPLIERS[tier] ?? 1.0;
  const ageMult  = accountAgeMultiplier(voterProfile);
  return Math.round(tierMult * ageMult * 100) / 100; // 2 dp
}

/**
 * Returns a human-readable breakdown of a voter's weight for display.
 * e.g. { tier: 'gold', tierMult: 1.2, ageMult: 1.1, total: 1.32 }
 */
export function voteWeightBreakdown(voterProfile) {
  const tier     = (voterProfile?.rank_tier || 'bronze').toLowerCase();
  const tierMult = TIER_MULTIPLIERS[tier] ?? 1.0;
  const ageMult  = accountAgeMultiplier(voterProfile);
  const total    = Math.round(tierMult * ageMult * 100) / 100;
  return { tier, tierMult, ageMult, total };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVoting() {
  /**
   * Cast or flip a vote.
   *
   * @param {object} options
   * @param {string}  options.battleId
   * @param {object}  options.submission   — full submission row
   * @param {string}  options.voterId
   * @param {object}  options.voterProfile — full profile row (for weight calc)
   * @param {1|-1}    options.direction    — 1 = upvote, -1 = downvote
   * @returns {{ newDirection: number, weight: number, delta: number }}
   */
  async function vote({ battleId, submission, voterId, voterProfile, direction = 1 }) {
    if (!supabase)                  throw new Error('Supabase not initialized');
    if (!voterId)                   throw new Error('Must be logged in to vote');
    if (submission.user_id === voterId) throw new Error('YOU CANNOT VOTE YOUR OWN SUBMISSION');

    const nextDirection    = direction === -1 ? -1 : 1;
    const weight           = computeVoteWeight(voterProfile);
    const effectiveWeight  = weight;

    // Read current vote from this voter on this submission
    const { data: existing, error: readError } = await supabase
      .from('votes')
      .select('id, direction, weight')
      .eq('submission_id', submission.id)
      .eq('voter_id', voterId)
      .maybeSingle();
    if (readError) throw readError;

    // Clicking the same direction again is a no-op (UI should prevent this anyway)
    if (existing?.direction === nextDirection) {
      return { newDirection: nextDirection, weight: effectiveWeight, delta: 0 };
    }

    // Weighted delta: new weighted direction minus previous weighted direction
    const prevWeightedDir = existing ? (existing.direction || 1) * (existing.weight || 1) : 0;
    const nextWeightedDir = nextDirection * effectiveWeight;
    const delta           = Math.round((nextWeightedDir - prevWeightedDir) * 100) / 100;

    // Write or update the vote row
    const writeQuery = existing
      ? supabase
          .from('votes')
          .update({ direction: nextDirection, weight: effectiveWeight })
          .eq('id', existing.id)
      : supabase
          .from('votes')
          .insert({
            battle_id:     battleId,
            submission_id: submission.id,
            voter_id:      voterId,
            direction:     nextDirection,
            weight:        effectiveWeight,
          });

    const { error: writeError } = await writeQuery;
    if (writeError) throw writeError;

    // Apply weighted delta to submission vote_count via RPC
    const { error: rpcError } = await supabase.rpc('increment_submission_vote_weighted', {
      submission_id_input: submission.id,
      delta_input:         delta,
    });

    if (rpcError) {
      // Graceful fallback to original unweighted RPC
      console.warn('[useVoting] weighted RPC unavailable, falling back to unweighted:', rpcError.message);
      const { error: fallbackError } = await supabase.rpc('increment_submission_vote', {
        submission_id_input: submission.id,
        delta_input:         Math.round(delta),
      });
      if (fallbackError) throw fallbackError;
    }

    // Token reward only on first-time votes (not direction flips)
    if (!existing) {
      await addTokenTransaction({
        userId:   voterId,
        amount:   2,
        reason:   'vote',
        battleId,
      });
    }

    return { newDirection: nextDirection, weight: effectiveWeight, delta };
  }

  return { vote, computeVoteWeight, voteWeightBreakdown };
}