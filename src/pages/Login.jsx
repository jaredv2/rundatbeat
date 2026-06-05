import { supabase } from '../lib/supabase';

export default function Login() {
  const login = () => supabase?.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: window.location.origin } });
  return (
    <main className="grid min-h-[70vh] place-items-center p-4">
      <section className="rdb-panel w-full max-w-md p-8 text-center">
        <h1 className="font-mono text-5xl font-bold text-rdb-orange">RUNDATBEAT</h1>
        <p className="mt-4 font-mono text-rdb-muted">THINK YOU CAN MAKE IT? RUN DAT BEAT.</p>
        <button className="rdb-button mt-8 w-full border-rdb-discord bg-rdb-discord text-white" onClick={login}>CONNECT WITH DISCORD</button>
      </section>
    </main>
  );
}
