export default function TagBadge({ children, tone = 'orange' }) {
  const color = tone === 'blue' ? 'border-rdb-blue text-rdb-blue' : 'border-rdb-orange text-rdb-orange';
  return <span className={`inline-flex border px-1.5 py-0.5 font-mono text-[10px] uppercase ${color}`}>{children}</span>;
}
