import { Gem } from 'lucide-react';
import { formatNumber } from '../../lib/display';

export default function TokenBadge({ amount = 0 }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-rdb-orange">
      <Gem size={12} />
      {formatNumber(amount)} RDB
    </span>
  );
}
