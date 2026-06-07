import { ExternalLink } from 'lucide-react';
import TagBadge from '../ui/TagBadge';
import { youtubeSearchUrl } from '../../lib/youtube';

export default function BattlePrompt({ battle }) {
  if (!battle) return null;
  return (
    <div className="rdb-panel p-5">
      <div className="flex flex-wrap gap-2">
        <TagBadge>{battle.genre}</TagBadge>
        <TagBadge tone="blue">{battle.bpm} BPM</TagBadge>
        <TagBadge tone="blue">{battle.song_length_seconds || 60}s SONG</TagBadge>
        <TagBadge>{battle.mood}</TagBadge>
        {battle.is_premium && <TagBadge tone="blue">LOCK {battle.entry_fee_tokens} RDB</TagBadge>}
      </div>
      <h1 className="mt-5 font-mono text-4xl font-bold uppercase text-rdb-text">{battle.title}</h1>
      <p className="mt-4 text-lg text-rdb-muted">{battle.flavor_text}</p>
      <dl className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <dt className="font-mono text-xs uppercase text-rdb-muted">Restrictions</dt>
          <dd className="text-rdb-text">{battle.restrictions}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase text-rdb-muted">Search References</dt>
          <dd className="mt-1 flex flex-wrap gap-2 text-rdb-text">
            {(Array.isArray(battle.reference_artists) ? battle.reference_artists : []).map((keyword) => (
              <a
                key={keyword}
                href={youtubeSearchUrl(battle.genre ? `${battle.genre} ${keyword}` : keyword)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded border border-rdb-border bg-rdb-bg/50 px-2 py-1 text-[12px] uppercase hover:border-rdb-orange hover:text-rdb-orange"
              >
                <ExternalLink size={11} />
                {keyword}
              </a>
            ))}
          </dd>
        </div>
      </dl>
    </div>
  );
}
