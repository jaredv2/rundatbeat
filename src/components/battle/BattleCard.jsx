import { Link } from 'react-router-dom';
import TagBadge from '../ui/TagBadge';

export default function BattleCard({ battle }) {
  return (
    <article className={`rdb-panel p-3 ${battle.status === 'active' ? 'rdb-active' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        {battle.status === 'active' && <span className="font-mono text-rdb-orange">LIVE</span>}
        <TagBadge>{battle.genre}</TagBadge>
        <TagBadge tone="blue">{battle.bpm} BPM</TagBadge>
        {battle.is_premium && <TagBadge tone="blue">LOCK {battle.entry_fee_tokens} RDB</TagBadge>}
      </div>
      <h3 className="mt-3 font-mono text-[13px] uppercase text-rdb-text">{battle.title}</h3>
      <p className="mt-1 text-[12px] text-rdb-muted">{battle.prompt_text || battle.flavor_text}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] uppercase text-rdb-muted">{battle.status}</span>
        <Link className="rdb-button rdb-button-primary" to={`/battle/${battle.id}`}>JOIN</Link>
      </div>
    </article>
  );
}
