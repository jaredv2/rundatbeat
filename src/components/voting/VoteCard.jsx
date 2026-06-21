import { memo } from 'react';
import WaveformPlayer from '../audio/WaveformPlayer';
import { formatNumber } from '../../lib/display';
import { Link } from 'react-router-dom';

const RANK_STYLES = {
  1: { border: 'border-2 border-yellow-500', bg: 'bg-yellow-500/15', waveColor: '#eab308', label: '🥇 GOLD', labelColor: 'text-yellow-400' },
  2: { border: 'border-2 border-gray-300', bg: 'bg-gray-300/15', waveColor: '#d1d5db', label: '🥈 SILVER', labelColor: 'text-gray-300' },
  3: { border: 'border-2 border-amber-600', bg: 'bg-amber-600/15', waveColor: '#d97706', label: '🥉 BRONZE', labelColor: 'text-amber-500' },
};

function VoteCardInner({ submission, rank, currentUserId }) {
  const style = RANK_STYLES[rank];
  const isSelf = submission.user_id === currentUserId;
  return (
    <div className={`rdb-panel p-4 ${style ? `${style.border} ${style.bg}` : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className={`font-mono text-xs ${style ? style.labelColor : 'text-rdb-muted'}`}>RANK #{rank}</div>
          <div className="flex items-center gap-2">
            <Link className="font-mono text-xl uppercase text-rdb-text hover:underline" to={submission.user_id ? `/profile/${submission.user_id}` : '#'}>{submission.profiles?.username || 'UNKNOWN'}</Link>
            {isSelf && <span className="font-mono text-[11px] text-rdb-orange">(YOU)</span>}
          </div>
        </div>
        {style && <span className={`font-mono text-sm ${style.labelColor}`}>{style.label}</span>}
      </div>
      <WaveformPlayer url={submission.audio_url} rankColor={style?.waveColor} />
      <div className="mt-3 font-mono text-rdb-orange">{formatNumber(submission.rating_total ?? submission.vote_count ?? 0)} SCORE</div>
    </div>
  );
}

const VoteCard = memo(VoteCardInner, (prev, next) => {
  return prev.submission?.id === next.submission?.id
    && prev.submission?.rating_total === next.submission?.rating_total
    && prev.submission?.vote_count === next.submission?.vote_count
    && prev.rank === next.rank
    && prev.currentUserId === next.currentUserId;
});

export default VoteCard;
