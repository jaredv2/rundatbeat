import { RANK_STYLES } from '../../lib/display';

export default function RankBadge({ tier = 'bronze' }) {
  const key = String(tier || 'bronze').toLowerCase();
  const rankStyle = RANK_STYLES[key] || RANK_STYLES.bronze;

  return (
    <span
      className="inline-flex rounded border px-2 py-1 font-mono text-xs uppercase"
      style={{ borderColor: rankStyle.color, color: rankStyle.color, backgroundColor: rankStyle.bg }}
    >
      {tier}
    </span>
  );
}
