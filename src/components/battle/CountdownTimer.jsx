import { useCountdown } from '../../hooks/useCountdown';

export default function CountdownTimer({ target }) {
  const { label } = useCountdown(target);
  return <span className="font-mono text-rdb-orange">{label}</span>;
}
