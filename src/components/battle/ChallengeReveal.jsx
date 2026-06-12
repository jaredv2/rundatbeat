import { useState, useEffect, useRef, useMemo } from 'react';
import { Music } from 'lucide-react';
import SampleCard from './SampleCard';
import { playUiSound } from '../../lib/sfx';
import { generateChallengeAsync } from '../../lib/lobbyService';
import { generateCustomRoomChallenge, generateSoloChallenge } from '../../lib/roomService';
import { supabase } from '../../lib/supabase';

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

export default function ChallengeReveal({ challenge, endsAt, countdownDuration = 15, hideChallenge, battleId, roomId, roomMode, difficulty }) {
  // Compute our own deadline on mount — ignore parent endsAt if it's in the past or too short
  const effectiveEndsAt = useMemo(() => {
    const now = Date.now();
    if (endsAt) {
      const t = new Date(endsAt).getTime();
      if (t > now + 2000) return endsAt; // parent time is valid, use it
    }
    // Fallback: 15s from mount
    return new Date(now + countdownDuration * 1000).toISOString();
  }, []); // mount only

  const remaining = useCountdownFrom(effectiveEndsAt);
  const revealed = remaining !== null && remaining <= 0;
  const prevRemaining = useRef(remaining);
  const [revealFlash, setRevealFlash] = useState(false);
  const [totalDur, setTotalDur] = useState(countdownDuration);
  const aiFired = useRef(false);

  // Fire AI generation in background during the 15s reveal countdown
  useEffect(() => {
    if (!battleId || !roomId || aiFired.current) return;
    if (challenge?.instructions) return;
    aiFired.current = true;

    if (roomMode === 'room') {
      // Custom room — fetch sample + generate AI directly
      generateCustomRoomChallenge(roomId)
        .catch((err) => console.error('[ChallengeReveal] AI FAILED:', err));
    } else if (roomMode === 'solo') {
      // Solo — fetch sample + generate AI with difficulty
      generateSoloChallenge(roomId, difficulty)
        .catch((err) => console.error('[ChallengeReveal] AI FAILED:', err));
    } else {
      // Ranked — find lobby and use lobbyService
      (async () => {
        const { data: lobby } = await supabase
          .from('ranked_lobbies')
          .select('id')
          .eq('battle_id', battleId)
          .maybeSingle();
        if (lobby?.id) {
          generateChallengeAsync(battleId, roomId, lobby.id)
            .catch((err) => console.error('[ChallengeReveal] AI FAILED:', err));
        }
      })();
    }
  }, [battleId, roomId, challenge?.instructions, roomMode, difficulty]);

  // Recalculate total duration from the target time
  useEffect(() => {
    if (effectiveEndsAt) {
      const dur = Math.max(1, Math.ceil((new Date(effectiveEndsAt).getTime() - Date.now()) / 1000));
      setTotalDur(dur);
    }
  }, [effectiveEndsAt]);

  // Sound effects on countdown tick
  useEffect(() => {
    if (remaining === null || revealed) return;
    if (prevRemaining.current !== remaining) {
      if (remaining <= 5 && remaining > 0) {
        playUiSound('countdown_tick');
      }
      prevRemaining.current = remaining;
    }
  }, [remaining, revealed]);

  // Play reveal sound when countdown hits 0
  useEffect(() => {
    if (revealed && !revealFlash) {
      setRevealFlash(true);
      playUiSound('countdown_reveal');
    }
  }, [revealed, revealFlash]);

  const progress = useMemo(() => {
    if (!effectiveEndsAt || remaining === null || !totalDur) return 0;
    return Math.min(1, 1 - remaining / totalDur);
  }, [effectiveEndsAt, remaining, totalDur]);

  // Always show countdown card with ring, even while challenge loads
  return (
    <div className={`rdb-panel overflow-hidden ${revealFlash ? 'challenge-reveal-flash' : ''}`}>
      <style>{`
        .challenge-reveal-flash {
          animation: revealPulse 0.6s ease-out;
        }
        @keyframes revealPulse {
          0% { filter: brightness(1.8); }
          100% { filter: brightness(1); }
        }
      `}</style>
      <div className="relative">
        <div className="absolute inset-0 rounded bg-gradient-to-r from-rdb-orange/10 via-rdb-orange/5 to-rdb-orange/10 animate-pulse" />

        <div className="relative p-6 text-center space-y-5">
          {/* Header */}
          <div className="flex items-center justify-center gap-2">
            <Music size={14} className="text-rdb-orange" />
            <span className="font-mono text-[11px] uppercase text-rdb-orange tracking-widest font-bold">
              {hideChallenge ? 'GET READY' : revealed ? 'CHALLENGE UNLOCKED' : 'CHALLENGE REVEAL'}
            </span>
            <Music size={14} className="text-rdb-orange" />
          </div>

          {/* Countdown circle */}
          <div className="relative mx-auto w-28 h-28">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50" cy="50" r="44"
                fill="none"
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="4"
              />
              <circle
                cx="50" cy="50" r="44"
                fill="none"
                stroke={revealed ? 'rgb(34,197,94)' : 'rgb(249,115,22)'}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 44}
                strokeDashoffset={2 * Math.PI * 44 * (1 - progress)}
                className="transition-all duration-1000 ease-linear"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`font-mono text-4xl font-bold tabular-nums ${
                revealed ? 'text-green-400' : remaining <= 3 ? 'text-red-400' : remaining <= 5 ? 'text-yellow-400' : 'text-rdb-orange'
              }`}>
                {revealed ? '✓' : (remaining ?? '--')}
              </span>
            </div>
          </div>

          {/* Challenge info — only show after countdown ends */}
          {!hideChallenge && revealed && challenge && (
            <div className="space-y-2">
              {challenge.genre && (
                <div className="inline-flex items-center gap-1.5 rounded bg-rdb-orange/15 px-3 py-1">
                  <Music size={11} className="text-rdb-orange" />
                  <span className="font-mono text-[10px] uppercase text-rdb-orange">{challenge.genre}</span>
                </div>
              )}
              {challenge.title && (
                <h2 className="font-mono text-xl font-bold uppercase text-rdb-text">
                  {challenge.title}
                </h2>
              )}
              {challenge.bpm && (
                <p className="font-mono text-[11px] uppercase text-rdb-muted">
                  {challenge.bpm} BPM {challenge.key ? `• KEY: ${challenge.key}` : ''}
                </p>
              )}
            </div>
          )}

          {/* Generating indicator while AI runs */}
          {!hideChallenge && !challenge && !revealed && (
            <div className="flex items-center justify-center gap-2">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-rdb-orange/50 border-t-transparent" />
              <span className="font-mono text-[10px] uppercase text-rdb-muted/60">
                GENERATING CHALLENGE...
              </span>
            </div>
          )}

          {/* Loading indicator for partial challenge (has genre/bpm but no instructions yet) */}
          {!hideChallenge && challenge && !challenge.instructions && !challenge.restrictionsList && !revealed && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-rdb-orange/50 border-t-transparent" />
              <span className="font-mono text-[10px] uppercase text-rdb-muted/60">
                GENERATING INSTRUCTIONS...
              </span>
            </div>
          )}

          {/* Full challenge preview when revealed */}
          {!hideChallenge && revealed && challenge?.instructions && (
            <div className="space-y-3 pt-2 text-left">
              {challenge.instructions && (
                <div>
                  <p className="font-mono text-[10px] uppercase text-rdb-orange mb-1">INSTRUCTIONS</p>
                  <p className="font-mono text-sm uppercase text-rdb-text leading-relaxed rounded-lg border border-rdb-orange/30 bg-rdb-orange/5 p-3">
                    {challenge.instructions}
                  </p>
                </div>
              )}
              {challenge.restrictionsList && (
                <div>
                  <p className="font-mono text-[10px] uppercase text-rdb-red mb-1">RESTRICTIONS</p>
                  <p className="font-mono text-sm uppercase text-rdb-text leading-relaxed rounded-lg border border-rdb-red/30 bg-rdb-red/5 p-3">
                    {challenge.restrictionsList}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
