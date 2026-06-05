import WaveformPlayer from '../audio/WaveformPlayer';
import { formatNumber } from '../../lib/display';
import { Link } from 'react-router-dom';

export default function VoteCard({ submission, rank }) {
  return (
    <div className={`rdb-panel p-4 ${rank === 1 ? 'border-rdb-orange bg-[#FF8C0015]' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-rdb-muted">RANK #{rank}</div>
          <Link className="font-mono text-xl uppercase text-rdb-text hover:underline" to={`/profile/${submission.profiles?.username}`}>{submission.profiles?.username || 'UNKNOWN'}</Link>
        </div>
        {rank === 1 && <span className="font-mono text-rdb-orange">WINNER</span>}
      </div>
      <p className="my-3 text-rdb-muted">{submission.description}</p>
      <WaveformPlayer url={submission.audio_url} />
      <div className="mt-3 font-mono text-rdb-orange">{formatNumber(submission.vote_count)} SCORE</div>
    </div>
  );
}
