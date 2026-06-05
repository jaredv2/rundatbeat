import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { generateBattlePrompt } from '../lib/groq';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';

const HOST_DIRECTIVE = [
  'Generate a complete beat battle prompt with no user-supplied fields.',
  'Pick one current producer battle lane from trap, rap, hiphop, edm, jersey club, perc40, tdf, jerk, drill, rage, pluggnb, or a similar underground style.',
  'Use a playable BPM for the chosen lane and give producers one sharp creative limitation.',
  'Make the title short, aggressive, memorable, matched to the beat type, and ending with TYPE BEAT.',
].join(' ');

export default function Host() {
  const { profile, refreshProfile } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);
  const navigate = useNavigate();
  const [status, setStatus] = useState('idle');
  const [createdTitle, setCreatedTitle] = useState('');
  const [error, setError] = useState('');

  if (!profile) return <Navigate to="/login" replace />;

  async function createBattle() {
    if (status === 'creating') return;
    setError('');
    setStatus('creating');
    try {
      const { json } = await generateBattlePrompt({ directive: HOST_DIRECTIVE, mode: 'quick' });
      const starts = new Date(Date.now() + 5 * 60 * 1000);
      const duration = 60;
      const votingEnds = new Date(starts.getTime() + duration * 60 * 1000);
      const { data, error: insertError } = await supabase.from('battles').insert({
        title: json.title,
        prompt_text: json.flavor_text,
        genre: json.genre,
        bpm: Number(json.bpm),
        mood: json.mood,
        restrictions: json.restrictions,
        reference_artists: Array.isArray(json.reference_artists) ? json.reference_artists : [],
        flavor_text: json.flavor_text,
        duration_minutes: duration,
        mode: 'quick',
        status: 'upcoming',
        starts_at: starts.toISOString(),
        voting_ends_at: votingEnds.toISOString(),
        created_by: profile.id,
      }).select('id').single();

      if (insertError) throw insertError;

      await supabase.from('token_transactions').insert({ user_id: profile.id, amount: 15, reason: 'host_battle', battle_id: data.id });
      if (profile.has_priority) await supabase.from('profiles').update({ has_priority: false }).eq('id', profile.id);
      await refreshProfile();
      setCreatedTitle(json.title);
      setStatus('created');
      addToast('BATTLE CREATED');
      window.setTimeout(() => navigate(`/battle/${data.id}`), 900);
    } catch (err) {
      setStatus('idle');
      setError(err.message || 'BATTLE CREATION FAILED');
    }
  }

  return (
    <main className="rdb-container-narrow space-y-8">
      <header className="border-b border-rdb-border pb-3 text-center">
        <h1 className="rdb-section-title">HOST BATTLE</h1>
        <p className="font-mono text-[11px] uppercase text-rdb-muted">AI will generate the beat directives from the system prompt.</p>
      </header>

      <section className={`rdb-panel flex min-h-[260px] flex-col items-center justify-center gap-5 p-6 text-center ${status === 'created' ? 'animate-pulse border-rdb-orange' : ''}`}>
        <div className="font-mono text-[11px] uppercase text-rdb-muted">TRAP | RAP | HIPHOP | EDM | JERSEY CLUB | PERC40 | TDF | JERK | DRILL</div>
        {status === 'created' ? (
          <>
            <div className="font-mono text-3xl uppercase text-rdb-orange">OPENING BATTLE</div>
            <div className="font-mono text-[13px] uppercase text-rdb-text">{createdTitle}</div>
          </>
        ) : (
          <>
            <button className="rdb-button rdb-button-primary" type="button" onClick={createBattle} disabled={status === 'creating'}>
              {status === 'creating' ? 'GENERATING...' : 'GENERATE BATTLE'}
            </button>
            <div className="font-mono text-[11px] uppercase text-rdb-muted">No fields. No setup. One AI-generated battle brief.</div>
          </>
        )}
      </section>

      {error && <div className="border border-rdb-red p-2 text-center font-mono text-[11px] uppercase text-rdb-red">{error}</div>}
    </main>
  );
}
