import { useVoting } from '../../hooks/useVoting';
import { useUiStore } from '../../store/uiStore';
import BlindSubmissionCard from './BlindSubmissionCard';

export default function VotingFeed({ battle, submissions, profile, votes = {}, onVoted }) {
  const { vote } = useVoting();
  const addToast = useUiStore((s) => s.addToast);

  async function cast(submission, direction) {
    try {
      await vote({ battleId: battle.id, submission, voterId: profile.id, direction });
      addToast('+2 RDB VOTE REWARD');
      onVoted?.();
    } catch (error) {
      addToast(error.message || 'VOTE FAILED', 'error');
    }
  }

  if (!submissions.length) return <div className="border border-dashed border-rdb-orange p-6 font-mono text-rdb-orange">NO SUBMISSIONS TO VOTE ON</div>;
  return (
    <div className="grid gap-4">
      {submissions.map((submission, index) => (
        <BlindSubmissionCard
          key={submission.id}
          submission={submission}
          index={index}
          currentVote={votes[submission.id] || 0}
          canVote={submission.user_id !== profile?.id}
          onVote={(direction) => cast(submission, direction)}
        />
      ))}
    </div>
  );
}
