import TagBadge from '../ui/TagBadge';

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
        <div><dt className="font-mono text-xs uppercase text-rdb-muted">Restrictions</dt><dd className="text-rdb-text">{battle.restrictions}</dd></div>
        <div><dt className="font-mono text-xs uppercase text-rdb-muted">Reference Artists</dt><dd className="text-rdb-text">{battle.reference_artists?.join(', ')}</dd></div>
        {battle.ai_instructions && <div className="md:col-span-2"><dt className="font-mono text-xs uppercase text-rdb-muted">Host AI Instructions</dt><dd className="text-rdb-text">{battle.ai_instructions}</dd></div>}
      </dl>
    </div>
  );
}
