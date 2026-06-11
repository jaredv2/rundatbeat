import TagBadge from '../ui/TagBadge';

export default function BattlePrompt({ battle }) {
  if (!battle) return null;
  return (
    <div className="rdb-panel p-5">
      <div className="flex flex-wrap gap-2">
        <TagBadge>{battle.genre}</TagBadge>
        <TagBadge tone="blue">{battle.bpm} BPM</TagBadge>
        <TagBadge tone="blue">{battle.song_length_seconds >= 10000 ? '∞' : `${battle.song_length_seconds || 60}s`} SONG</TagBadge>
        <TagBadge>{battle.mood}</TagBadge>
        {battle.is_premium && <TagBadge tone="blue">LOCK {battle.entry_fee_tokens} RDB</TagBadge>}
      </div>

      <div className="mt-5 space-y-4">
        {battle.prompt_text && (
          <div>
            <p className="font-mono text-[10px] uppercase text-rdb-orange mb-1">INSTRUCTIONS</p>
            <p className="font-mono text-sm uppercase text-rdb-text leading-relaxed">{battle.prompt_text}</p>
          </div>
        )}

        {battle.restrictions && (
          <div>
            <p className="font-mono text-[10px] uppercase text-rdb-red mb-1">RESTRICTIONS</p>
            <p className="font-mono text-sm uppercase text-rdb-text leading-relaxed">{battle.restrictions}</p>
          </div>
        )}
      </div>
    </div>
  );
}
