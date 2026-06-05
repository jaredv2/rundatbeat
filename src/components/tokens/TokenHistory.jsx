import TokenTransaction from './TokenTransaction';

export default function TokenHistory({ transactions = [] }) {
  if (!transactions.length) return <div className="border border-dashed border-rdb-orange p-6 font-mono text-rdb-orange">NO TOKEN HISTORY</div>;
  return <div>{transactions.map((transaction) => <TokenTransaction key={transaction.id} transaction={transaction} />)}</div>;
}
