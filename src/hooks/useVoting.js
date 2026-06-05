import { supabase } from '../lib/supabase';
import { addTokenTransaction } from '../lib/tokenHelpers';

export function useVoting() {
  async function vote({ battleId, submission, voterId, direction = 1 }) {
    if (submission.user_id === voterId) throw new Error('YOU CANNOT VOTE YOUR OWN SUBMISSION');
    const nextDirection = direction === -1 ? -1 : 1;
    const { data: existing, error: readError } = await supabase
      .from('votes')
      .select('id, direction')
      .eq('submission_id', submission.id)
      .eq('voter_id', voterId)
      .maybeSingle();
    if (readError) throw readError;

    if (existing?.direction === nextDirection) return;

    const delta = existing ? nextDirection - (existing.direction || 1) : nextDirection;
    const write = existing
      ? supabase.from('votes').update({ direction: nextDirection }).eq('id', existing.id)
      : supabase.from('votes').insert({ battle_id: battleId, submission_id: submission.id, voter_id: voterId, direction: nextDirection });
    const { error } = await write;
    if (error) throw error;
    await supabase.rpc('increment_submission_vote', { submission_id_input: submission.id, delta_input: delta });
    if (!existing) await addTokenTransaction({ userId: voterId, amount: 2, reason: 'vote', battleId });
  }
  return { vote };
}
