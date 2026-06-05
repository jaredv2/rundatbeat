export default function StatCard({ label, value }) {
  return (
    <div className="rdb-panel p-3">
      <div className="rdb-section-title">{label}</div>
      <div className="mt-1 font-mono text-[13px] text-rdb-text">{value}</div>
    </div>
  );
}
