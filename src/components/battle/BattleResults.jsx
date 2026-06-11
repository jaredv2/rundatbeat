import VoteCard from '../voting/VoteCard';

export default function BattleResults({ submissions }) {
  const sorted = [...submissions].sort((a, b) => (b.rating_total ?? b.vote_count ?? 0) - (a.rating_total ?? a.vote_count ?? 0));
  return (
    <div className="space-y-4">
      {sorted.map((submission, index) => <VoteCard key={submission.id} submission={submission} rank={index + 1} />)}
    </div>
  );
}
