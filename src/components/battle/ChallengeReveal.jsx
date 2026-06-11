import { useState, useEffect, useRef } from 'react';
import { Download } from 'lucide-react';
import { getDownloadUrl } from '../../lib/challengeService';
import WaveformPlayer from '../audio/WaveformPlayer';
import { useAuthStore } from '../../store/authStore';

function useCountdownFrom(endsAt) {
  const [remaining, setRemaining] = useState(null);
  const rafRef = useRef();

  useEffect(() => {
    if (!endsAt) return;
    function tick() {
      const rem = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000));
      setRemaining(rem);
      if (rem > 0) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [endsAt]);

  return remaining;
}

export default function ChallengeReveal({ challenge, battleStartsAt }) {
  const { profile } = useAuthStore();
  const remaining = useCountdownFrom(battleStartsAt);
  const revealed = remaining !== null && remaining <= 0;

  // Preload audio during countdown so WaveSurfer serves from cache after reveal
  useEffect(() => {
    if (!challenge?.mp3_url || revealed) return;
    const audio = new Audio(challenge.mp3_url);
    audio.preload = 'auto';
    audio.load();
  }, [challenge?.mp3_url, revealed]);

  if (!challenge) {
    return (
      <div className="rdb-panel p-8 text-center">
        <div className="font-mono text-[11px] uppercase text-rdb-muted">LOADING CHALLENGE...</div>
      </div>
    );
  }

  if (!revealed) {
    return (
      <div className="rdb-panel p-8 text-center">
        <div className="font-mono text-4xl font-bold text-rdb-orange blink">{remaining ?? '--'}</div>
        <div className="mt-2 font-mono text-[11px] uppercase text-rdb-muted">CHALLENGE REVEAL IN</div>
      </div>
    );
  }

  return (
    <div className="rdb-panel p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-lg font-bold uppercase text-rdb-text">{challenge.title}</h2>
          {challenge.uploader && (
            <span className="font-mono text-[10px] uppercase text-rdb-muted">by {challenge.uploader}</span>
          )}
        </div>
        <a
          href={getDownloadUrl(challenge.id)}
          className="rdb-button flex items-center gap-2"
          download
        >
          <Download size={14} /> DOWNLOAD
        </a>
      </div>

      <div className="grid grid-cols-3 gap-3 font-mono text-[11px] uppercase">
        <div className="rounded border border-rdb-border bg-rdb-bg p-2 text-center">
          <div className="text-rdb-muted">BPM</div>
          <div className="text-rdb-text font-bold">{challenge.bpm || '—'}</div>
        </div>
        <div className="rounded border border-rdb-border bg-rdb-bg p-2 text-center">
          <div className="text-rdb-muted">KEY</div>
          <div className="text-rdb-text font-bold">{challenge.key || '—'}</div>
        </div>
        <div className="rounded border border-rdb-border bg-rdb-bg p-2 text-center">
          <div className="text-rdb-muted">GENRE</div>
          <div className="text-rdb-text font-bold">{challenge.genre || '—'}</div>
        </div>
      </div>

      {challenge.mp3_url && <WaveformPlayer url={challenge.mp3_url} profile={profile} />}

      <p className="font-mono text-[9px] uppercase text-rdb-muted">
        Powered by{' '}
        <a href="https://loopazon.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-rdb-orange">
          loopazon.com
        </a>
      </p>

      {challenge.instructions && (
        <div>
          <p className="font-mono text-[10px] uppercase text-rdb-orange mb-1">INSTRUCTIONS</p>
          <p className="font-mono text-sm uppercase text-rdb-text leading-relaxed p-3 border border-rdb-orange/30 rounded">
            {challenge.instructions}
          </p>
        </div>
      )}

      {challenge.restrictionsList && (
        <div>
          <p className="font-mono text-[10px] uppercase text-rdb-red mb-1">RESTRICTIONS</p>
          <p className="font-mono text-sm uppercase text-rdb-text leading-relaxed p-3 border border-rdb-red/30 rounded">
            {challenge.restrictionsList}
          </p>
        </div>
      )}

      {challenge.restriction && !challenge.restrictionsList && (
        <div className="font-mono text-[11px] uppercase text-rdb-orange p-3 border border-rdb-orange/30 rounded">
          RESTRICTION: {challenge.restriction}
        </div>
      )}

      {challenge.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {challenge.tags.map((tag, i) => (
            <span key={i} className="font-mono text-[9px] uppercase text-rdb-muted bg-white/5 px-2 py-0.5 rounded">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
