import { useEffect, useState } from 'react';
import { formatNumber } from '../lib/display';
import { supabase } from '../lib/supabase';

function connectDiscord() {
  return supabase?.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: window.location.origin } });
}

export default function Landing() {
  const [stats, setStats] = useState({ battles: 0, producers: 0, submissions: 0, rdb: 0 });

  useEffect(() => {
    async function load() {
      if (!supabase) return;
      const [battles, profiles, submissions, { data: tokenRows }] = await Promise.all([
        supabase.from('battles').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('submissions').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('total_tokens_earned'),
      ]);
      setStats({
        battles: battles.count || 0,
        producers: profiles.count || 0,
        submissions: submissions.count || 0,
      });
    }
    load();
  }, []);

  return (
    <main className="grid min-h-[calc(100vh-88px)] place-items-center px-4 py-12 text-center">
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center">
        <h1 className="font-mono text-[clamp(3.5rem,10vw,7rem)] font-bold uppercase leading-none text-rdb-text">RUNDATBEAT</h1>
        <p className="mt-4 max-w-xl font-mono text-[13px] uppercase text-rdb-muted">AI gives the prompt. You make the beat. The community decides.</p>
        <button className="rdb-button rdb-button-primary mt-8" type="button" onClick={connectDiscord}>Connect With Discord</button>
        <div className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 font-mono text-[11px] uppercase text-rdb-muted">
          <Stat label="Battles" value={stats.battles} />
          <Stat label="Producers" value={stats.producers} />
          <Stat label="Submissions" value={stats.submissions} />
          <Stat label="RDB Earned" value={stats.rdb} />
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }) {
  return <span>{label}: <span className="text-rdb-orange">{formatNumber(value)}</span></span>;
}
