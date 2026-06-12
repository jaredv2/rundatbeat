import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { generateBattlePrompt, flattenRestrictions } from '../lib/groq';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { playUiSound } from '../lib/sfx';

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
    playUiSound('click');
    setError('');
    setStatus('creating');
    try {
      const genres = ['trap', 'hip-hop', 'uk-drill', 'rap'];
      const genre = genres[Math.floor(Math.random() * genres.length)];
      const { json } = await generateBattlePrompt({
        genre,
        mode: 'room',
        playerCount: 2,
        loopTitle: `${genre} loop`,
        loopBpm: '140',
        loopKey: 'Am',
      });

      const restrictionsText = flattenRestrictions(json.restrictions) || json.restrictions_text || '';

      const starts = new Date(Date.now() + 5 * 60 * 1000);
      const duration = 60;
      const votingEnds = new Date(starts.getTime() + duration * 60 * 1000);
      const { data, error: insertError } = await supabase.from('battles').insert({
        title: json.title,
        prompt_text: json.instruction || '',
        genre,
        bpm: json.bpm || 140,
        mood: json.flavor_text || json.mood || '',
        restrictions: restrictionsText,
        reference_artists: [],
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
        <p className="font-mono text-[11px] uppercase text-rdb-muted">AI will generate the beat directives.</p>
      </header>

      <section className={`rdb-panel flex min-h-[260px] flex-col items-center justify-center gap-5 p-6 text-center ${status === 'created' ? 'animate-pulse border-rdb-orange' : ''}`}>
        <div className="font-mono text-[11px] uppercase text-rdb-muted">AI-GENERATED BATTLE</div>
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
            <div className="font-mono text-[11px] uppercase text-rdb-muted">One AI-generated battle brief.</div>
          </>
        )}
      </section>

      {error && <div className="border border-rdb-red p-2 text-center font-mono text-[11px] uppercase text-rdb-red">{error}</div>}
    </main>
  );
}
