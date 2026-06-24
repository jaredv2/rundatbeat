import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { devLog, devError } from '../lib/devLog';

export default function Login() {
  const [flow, setFlow] = useState('chooser');
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const [resendCooldown, setResendCooldown] = useState(0);

  async function discordLogin() {
    const redirectTo = `${window.location.origin}/auth/callback`;
    devLog('[Login] OAuth redirectTo:', redirectTo);
    const { error } = await supabase?.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo, scopes: 'identify' },
    });
    if (error) devError('[Login] OAuth error:', error.message);
  }

  async function emailAuth(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        setSent(true);
      }
    } catch (err) {
      devError('[Login] email auth error:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function resendConfirmation() {
    if (resendCooldown > 0) return;
    setError('');
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    if (error) {
      setError(error.message);
    } else {
      setResendCooldown(30);
      const interval = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) { clearInterval(interval); return 0; }
          return prev - 1;
        });
      }, 1000);
    }
  }

  if (sent) {
    return (
      <main className="grid min-h-[70vh] place-items-center p-4">
        <section className="rdb-panel w-full max-w-md p-8 text-center">
          <h1 className="font-mono text-3xl text-rdb-orange">CHECK YOUR EMAIL</h1>
          <p className="mt-4 font-mono text-sm text-rdb-muted">
            We sent a confirmation link to <span className="text-rdb-text">{email}</span>. Confirm it, then come back and log in.
          </p>
          {error && <div className="mt-3 border border-rdb-red p-2 font-mono text-[11px] text-rdb-red">{error}</div>}
          <div className="mt-6 space-y-3">
            <button className="rdb-button rdb-button-primary w-full" disabled={resendCooldown > 0} type="button" onClick={resendConfirmation}>
              {resendCooldown > 0 ? `RESEND IN ${resendCooldown}s` : 'RESEND CONFIRMATION EMAIL'}
            </button>
            <button className="rdb-button w-full" type="button" onClick={() => { setSent(false); setEmail(''); setPassword(''); setMode('login'); setFlow('chooser'); }}>BACK TO LOGIN</button>
          </div>
        </section>
      </main>
    );
  }

  if (flow === 'chooser') {
    return (
      <main className="grid min-h-[70vh] place-items-center p-4">
        <section className="rdb-panel w-full max-w-md p-8 text-center">
          <h1 className="font-mono text-5xl font-bold text-rdb-orange">SAMPLE BATTLE</h1>
          <p className="mt-4 font-mono text-rdb-muted">THINK YOU CAN MAKE IT? SAMPLE BATTLE.</p>
          <div className="mt-8 space-y-3">
            <button className="rdb-button rdb-button-primary w-full" type="button" onClick={() => setFlow('email')}>
              EMAIL / PASSWORD
            </button>
            <button className="rdb-button w-full border-rdb-discord bg-rdb-discord text-white" type="button" onClick={discordLogin}>
              CONNECT WITH DISCORD
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="grid min-h-[70vh] place-items-center p-4">
      <section className="rdb-panel w-full max-w-md p-8 text-center">
        <h1 className="font-mono text-5xl font-bold text-rdb-orange">SAMPLE BATTLE</h1>
        <p className="mt-4 font-mono text-rdb-muted">THINK YOU CAN MAKE IT? SAMPLE BATTLE.</p>

        <form className="mt-8 space-y-3" onSubmit={emailAuth}>
          {error && <div className="border border-rdb-red p-2 font-mono text-[11px] text-rdb-red">{error}</div>}
          <input
            className="rdb-input w-full"
            type="email"
            placeholder="EMAIL"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="rdb-input w-full"
            type="password"
            placeholder="PASSWORD"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <button className="rdb-button rdb-button-primary w-full" disabled={loading} type="submit">
            {loading ? '...' : mode === 'login' ? 'LOG IN' : 'SIGN UP'}
          </button>
          <p className="font-mono text-[11px] text-rdb-muted">
            {mode === 'login' ? (
              <>Don't have an account? <button className="text-rdb-orange hover:underline" type="button" onClick={() => { setMode('signup'); setError(''); }}>SIGN UP</button></>
            ) : (
              <>Already have an account? <button className="text-rdb-orange hover:underline" type="button" onClick={() => { setMode('login'); setError(''); }}>LOG IN</button></>
            )}
          </p>
          {mode === 'signup' && <p className="font-mono text-[10px] text-rdb-muted">Email confirmation is required before you can log in.</p>}
        </form>

        <button className="mt-4 font-mono text-[11px] text-rdb-muted hover:text-rdb-orange transition-colors" type="button" onClick={() => { setFlow('chooser'); setError(''); }}>
          &larr; BACK
        </button>
      </section>
    </main>
  );
}
