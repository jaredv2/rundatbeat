import { supabase } from '../lib/supabase';
import { devLog, devError } from '../lib/devLog';

export default function Login() {
  async function login() {
    // DEBUG: log the redirect URL so you can verify it in the console
    const redirectTo = `${window.location.origin}/auth/callback`;
    devLog('[Login] OAuth redirectTo:', redirectTo);

    const { error } = await supabase?.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        // Explicit /auth/callback path — matches what you whitelist in Supabase + Discord
        redirectTo,
      },
    });

    if (error) {
      devError('[Login] OAuth error:', error.message);
    }
  }

  return (
    <main className="grid min-h-[70vh] place-items-center p-4">
      <section className="rdb-panel w-full max-w-md p-8 text-center">
        <h1 className="font-mono text-5xl font-bold text-rdb-orange">RUNDATBEAT</h1>
        <p className="mt-4 font-mono text-rdb-muted">THINK YOU CAN MAKE IT? RUN DAT BEAT.</p>
        <button
          className="rdb-button mt-8 w-full border-rdb-discord bg-rdb-discord text-white"
          type="button"
          onClick={login}
        >
          CONNECT WITH DISCORD
        </button>
      </section>
    </main>
  );
}