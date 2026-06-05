export default function TokenTransaction({ transaction }) {
  const positive = transaction.amount > 0;
  return (
    <div className="grid grid-cols-[80px_1fr_120px] gap-3 border-t border-rdb-border py-3 text-sm">
      <span className={positive ? 'text-rdb-orange' : 'text-rdb-red'}>{positive ? '+' : ''}{transaction.amount}</span>
      <span className="font-mono uppercase text-rdb-text">{transaction.reason}</span>
      <span className="text-rdb-muted">{new Date(transaction.created_at).toLocaleDateString()}</span>
    </div>
  );
}
