import WaveformPlayer from '../audio/WaveformPlayer';
import { formatNumber } from '../../lib/display';
import { playUiSound } from '../../lib/sfx';

export default function BlindSubmissionCard({ submission, index, canVote, currentVote = 0, onVote }) {
  function handleVote(direction) {
    playUiSound(direction > 0 ? 'success' : 'click');
    onVote(direction);
  }

  return (
    <div className="rdb-panel vote-card-grid p-4">
      <div className="reddit-vote-rail">
        <button className={currentVote === 1 ? 'active' : ''} disabled={!canVote} type="button" onClick={() => handleVote(1)} aria-label="Upvote">▲</button>
        <span>{formatNumber(submission.vote_count)}</span>
        <button className={currentVote === -1 ? 'active' : ''} disabled={!canVote} type="button" onClick={() => handleVote(-1)} aria-label="Downvote">▼</button>
      </div>
      <div className="min-w-0">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-mono text-lg uppercase text-rdb-text">PRODUCER #{index + 1}</h3>
          <span className="font-mono text-rdb-muted">SCORE</span>
        </div>
        <WaveformPlayer url={submission.audio_url} />
        <div className="mt-4 font-mono text-[11px] uppercase text-rdb-muted">
          {canVote ? 'Vote like Reddit: up for heat, down for misses.' : 'Own submission voting locked.'}
        </div>
      </div>
    </div>
  );
}
