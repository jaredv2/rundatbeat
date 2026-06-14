import { memo } from 'react';
import WaveformPlayer from '../audio/WaveformPlayer';
import { formatNumber } from '../../lib/display';
import { Link } from 'react-router-dom';

const RANK_STYLES = {
  1: { border: 'border-2 border-yellow-500', bg: 'bg-yellow-500/10', label: '🥇 GOLD', labelColor: 'text-yellow-400' },
  2: { border: 'border-2 border-gray-300', bg: 'bg-gray-300/10', label: '🥈 SILVER', labelColor: 'text-gray-300' },
  3: { border: 'border-2 border-amber-600', bg: 'bg-amber-600/10', label: '🥉 BRONZE', labelColor: 'text-amber-500' },
};

function VoteCardInner({ submission, rank }) {
  const style = RANK_STYLES[rank];
  return (
    <div className={`rdb-panel p-4 ${style ? `${style.border} ${style.bg}` : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-rdb-muted">RANK #{rank}</div>
          <Link className="font-mono text-xl uppercase text-rdb-text hover:underline" to={submission.profiles?.username ? `/profile/${submission.profiles.username}` : '#'}>{submission.profiles?.username || 'UNKNOWN'}</Link>
        </div>
        {style && <span className={`font-mono text-sm ${style.labelColor}`}>{style.label}</span>}
      </div>
      <WaveformPlayer url={submission.audio_url} />
      <div className="mt-3 font-mono text-rdb-orange">{formatNumber(submission.rating_total ?? submission.vote_count ?? 0)} SCORE</div>
    </div>
  );
}

const VoteCard = memo(VoteCardInner, (prev, next) => {
  return prev.submission?.id === next.submission?.id
    && prev.submission?.rating_total === next.submission?.rating_total
    && prev.submission?.vote_count === next.submission?.vote_count
    && prev.rank === next.rank;
});

export default VoteCard;
