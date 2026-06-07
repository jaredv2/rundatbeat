import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { generateBattlePrompt, GENRE_KNOWLEDGE } from '../lib/groq';
import { pickRestrictions, validatePrompt, selectGenre } from '../lib/restrictions';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { playUiSound } from '../lib/sfx';

const HOST_DIRECTIVE = [
  'Generate a complete beat battle prompt.',
  'Use a playable BPM for the chosen genre and give producers one sharp audible limitation (vibe rule, arrangement rule).',
  'Make the title short, aggressive, memorable, matched to the beat type, and ending with TYPE BEAT.',
  'Use reference_keywords (not artist names) — searchable YouTube phrases like "dark 808 trap beat".',
  'flavor_text must start with "Make a beat" and use simple plain words.',
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
    playUiSound('click');
    setError('');
    setStatus('creating');
    try {
      const recentGenres = (() => { try { return JSON.parse(localStorage.getItem('rdb_recent_genres') || '[]'); } catch { return []; } })();
      const difficulty = ['easy', 'medium', 'medium', 'hard'][Math.floor(Math.random() * 4)];
      const genre = await selectGenre(supabase, difficulty);
      const restrictions = pickRestrictions(difficulty, genre, 3);
      const genreDirective = `Generate a ${genre} beat battle prompt. The genre must be ${genre}. Make the title match the genre and end with TYPE BEAT. Only generate the title, mood, flavor_text, and reference_keywords. Do NOT generate restrictions.`;
      const { json } = await generateBattlePrompt({ directive: genreDirective, mode: 'quick', recentGenres, difficulty });
      const validation = validatePrompt(json);
      if (!validation.valid) {
        const retry = await generateBattlePrompt({ directive: genreDirective, mode: 'quick', recentGenres, difficulty });
        const retryValidation = validatePrompt(retry.json);
        if (!retryValidation.valid) throw new Error(`Prompt validation failed: ${retryValidation.errors.join('; ')}`);
        json.title = retry.json.title;
        json.flavor_text = retry.json.flavor_text;
        json.mood = retry.json.mood;
        json.reference_keywords = retry.json.reference_keywords;
      }
      try { localStorage.setItem('rdb_recent_genres', JSON.stringify([genre, ...recentGenres].slice(0, 6))); } catch {}
      const bpmClamped = (() => {
        const g = GENRE_KNOWLEDGE[genre];
        if (!g) return Number(json.bpm) || 140;
        const [min, max] = g.bpm_range;
        const bpm = Number(json.bpm);
        return bpm >= min && bpm <= max ? bpm : Math.floor((min + max) / 2);
      })();
      const starts = new Date(Date.now() + 5 * 60 * 1000);
      const duration = 60;
      const votingEnds = new Date(starts.getTime() + duration * 60 * 1000);
      const { data, error: insertError } = await supabase.from('battles').insert({
        title: json.title,
        prompt_text: json.flavor_text,
        genre,
        bpm: bpmClamped,
        mood: json.mood,
        restrictions: restrictions.join('; '),
        reference_artists: Array.isArray(json.reference_keywords) ? json.reference_keywords : [],
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
        <div className="font-mono text-[11px] uppercase text-rdb-muted">TRAP | JERSEY CLUB | JERK | DRILL</div>
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
