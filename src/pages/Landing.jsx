import { supabase } from '../lib/supabase';

function connectDiscord() {
  return supabase?.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: window.location.origin, scopes: 'identify' } });
}

export default function Landing() {
  return (
    <main className="grid min-h-[calc(100vh-88px)] place-items-center px-4 py-12 text-center">
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center">
        <h1 className="flex flex-col items-center gap-4">
          <img src="/logo.png" alt="" className="h-24 w-24 sm:h-32 sm:w-32" />
          <span className="font-mono text-[clamp(3.5rem,10vw,7rem)] font-bold uppercase leading-none text-rdb-text">SAMPLE BATTLE</span>
        </h1>
        <p className="mt-4 max-w-xl font-mono text-[13px] uppercase text-rdb-muted">Get a sample. Follow the prompt. Grind your way to the top.</p>
        <button className="rdb-button rdb-button-primary mt-8" type="button" onClick={connectDiscord}>Connect With Discord</button>
      </section>
    </main>
  );
}
