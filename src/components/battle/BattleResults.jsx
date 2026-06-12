import VoteCard from '../voting/VoteCard';

export default function BattleResults({ submissions }) {
  if (!submissions?.length) {
    return (
      <div className="rdb-panel p-5 text-center font-mono text-[11px] uppercase text-rdb-muted">
        NO RESULTS YET
      </div>
    );
  }
  const sorted = [...submissions].sort((a, b) => (b.rating_total ?? b.vote_count ?? 0) - (a.rating_total ?? a.vote_count ?? 0));
  return (
    <div className="space-y-4">
      {sorted.map((submission, index) => <VoteCard key={submission.id} submission={submission} rank={index + 1} />)}
    </div>
  );
}
