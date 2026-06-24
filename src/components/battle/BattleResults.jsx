import { useState } from 'react';
import { ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import VoteCard from '../voting/VoteCard';

const PAGE_SIZE = 4;

export default function BattleResults({ submissions, currentUserId }) {
  const [page, setPage] = useState(0);

  if (!submissions?.length) {
    return (
      <div className="rdb-panel p-5 text-center font-mono text-[11px] uppercase text-rdb-muted">
        NO RESULTS YET
      </div>
    );
  }

  const sorted = [...submissions].sort((a, b) => (b.rating_total ?? b.vote_count ?? 0) - (a.rating_total ?? a.vote_count ?? 0));
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageItems = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="w-full max-w-[700px] mx-auto space-y-5">
      <div className="flex items-center justify-center gap-3">
        <Trophy className="text-rdb-orange" size={28} />
        <h2 className="font-mono text-2xl font-bold uppercase text-rdb-orange tracking-wider">
          RESULTS OF THIS BATTLE
        </h2>
        <Trophy className="text-rdb-orange" size={28} />
      </div>

      <div className="space-y-4">
        {pageItems.map((submission, index) => (
          <VoteCard
            key={submission.id}
            submission={submission}
            rank={page * PAGE_SIZE + index + 1}
            currentUserId={currentUserId}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <button
            className="rdb-button"
            disabled={page === 0}
            type="button"
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={16} /> PREV
          </button>
          <span className="font-mono text-xs uppercase text-rdb-muted">
            {page + 1} / {totalPages}
          </span>
          <button
            className="rdb-button"
            disabled={page >= totalPages - 1}
            type="button"
            onClick={() => setPage((p) => p + 1)}
          >
            NEXT <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
