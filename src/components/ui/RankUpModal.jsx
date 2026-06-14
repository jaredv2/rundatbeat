import { useEffect, useState, useRef } from 'react';
import { Trophy } from 'lucide-react';
import confetti from 'canvas-confetti';
import { playUiSound } from '../../lib/sfx';
import { xpForLevel, levelFromXp } from '../../lib/xp';

export default function RankUpModal({ open, xpGain, oldXp, newXp, oldLevel, newLevel, onDone }) {
  const [displayXp, setDisplayXp] = useState(0);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const animRef = useRef(null);
  const startedRef = useRef(false);

  const currentLevelXp = xpForLevel(newLevel);
  const nextLevelXp = xpForLevel(newLevel + 1);
  const levelUps = newLevel - oldLevel;

  useEffect(() => {
    if (!open || startedRef.current) return;
    startedRef.current = true;
    playUiSound('win');

    const duration = 2000;
    const startTime = Date.now();
    const targetXp = xpGain;

    function tick() {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(eased * targetXp);
      setDisplayXp(current);

      const xpInLevel = (oldXp + current) - currentLevelXp;
      const xpRange = nextLevelXp - currentLevelXp;
      setProgressPercent(Math.min(100, (xpInLevel / xpRange) * 100));

      if (t < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        setDisplayXp(targetXp);
        if (levelUps > 0) {
          setShowLevelUp(true);
          playUiSound('win');
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#f59e0b', '#22d3ee', '#10b981', '#ec4899'],
          });
        }
        setTimeout(() => onDone?.(), levelUps > 0 ? 4000 : 2000);
      }
    }

    animRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(animRef.current);
      startedRef.current = false;
    };
  }, [open, xpGain]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="rdb-panel mx-4 w-full max-w-md p-8 text-center" style={{ animation: 'win-modal-in 300ms cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
        <Trophy className="mx-auto mb-4 text-rdb-orange" size={48} />

        <p className="font-mono text-[11px] uppercase text-rdb-muted mb-2">XP EARNED</p>
        <p className="font-mono text-5xl font-bold text-rdb-orange mb-1">
          +{displayXp}
        </p>
        <p className="font-mono text-[11px] uppercase text-rdb-muted mb-6">
          LVL {oldLevel}
        </p>

        {/* Progress bar */}
        <div className="w-full h-3 rounded-full bg-rdb-border overflow-hidden mb-2">
          <div
            className="h-full rounded-full bg-rdb-orange transition-none"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="font-mono text-[10px] uppercase text-rdb-muted mb-6">
          {(oldXp + displayXp) - currentLevelXp} / {nextLevelXp - currentLevelXp} TO NEXT LEVEL
        </p>

        {showLevelUp && (
          <div style={{ animation: 'win-modal-in 400ms cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
            <p className="font-mono text-[11px] uppercase text-rdb-orange mb-2">LEVEL UP!</p>
            <div className="flex items-center justify-center gap-4">
              <span className="font-mono text-2xl text-rdb-muted">LVL {oldLevel}</span>
              <span className="font-mono text-2xl text-rdb-orange">→</span>
              <span className="font-mono text-2xl font-bold text-rdb-orange">LVL {newLevel}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
