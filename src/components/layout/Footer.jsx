import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { formatNumber } from '../../lib/display';

export default function Footer() {
  const [activePlayers, setActivePlayers] = useState(0);

  useEffect(() => {
    async function load() {
      if (!supabase) return;
      const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { count } = await supabase.from('user_presence').select('user_id', { count: 'exact' }).gte('last_seen_at', since);
      setActivePlayers(count || 0);
    }
    load();
    const timer = window.setInterval(load, 45000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <footer className="relative z-10 border-t border-rdb-border bg-rdb-bg px-4 py-4">
      <div className="mx-auto flex max-w-[800px] flex-col items-center gap-2 font-mono text-xs uppercase text-rdb-muted sm:flex-row sm:justify-between">
        <span className="text-rdb-orange">SAMPLE BATTLE</span>
        <span>Active: <b className="text-rdb-orange">{formatNumber(activePlayers)}</b></span>
        <a className="hover:text-rdb-orange transition-colors" href="https://discord.gg/2PNx4ad29x" target="_blank" rel="noreferrer">Discord</a>
        <Link className="hover:text-rdb-orange transition-colors" to="/credits">Credits</Link>
        <span>v0.7.0</span>
      </div>
    </footer>
  );
}
