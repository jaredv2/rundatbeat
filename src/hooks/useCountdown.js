import { useEffect, useState } from 'react';

export function useCountdown(target) {
  const getRemaining = () => Math.max(0, new Date(target || Date.now()).getTime() - Date.now());
  const [remaining, setRemaining] = useState(getRemaining());

  useEffect(() => {
    const timer = setInterval(() => setRemaining(getRemaining()), 1000);
    return () => clearInterval(timer);
  }, [target]);

  const total = Math.floor(remaining / 1000);
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return { remaining, label: `${hours}:${minutes}:${seconds}` };
}
