import { useEffect, useState, useRef } from 'react';
import { playUiSound } from '../../lib/sfx';
import { xpForLevel } from '../../lib/xp';

export default function RankUpModal({ open, xpGain, oldXp, newXp, oldLevel, newLevel, onDone }) {
  const [displayXp, setDisplayXp] = useState(0);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [visible, setVisible] = useState(false);
  const animRef = useRef(null);
  const startedRef = useRef(false);

  const currentLevelXp = xpForLevel(newLevel);
  const nextLevelXp = xpForLevel(newLevel + 1);
  const levelUps = newLevel - oldLevel;

  useEffect(() => {
    if (!open || startedRef.current) return;
    startedRef.current = true;
    setVisible(true);
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
        }
        setTimeout(() => {
          setVisible(false);
          setTimeout(() => onDone?.(), 300);
        }, levelUps > 0 ? 3000 : 1500);
      }
    }

    animRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(animRef.current);
      startedRef.current = false;
    };
  }, [open, xpGain]);

  if (!open || !visible) return null;

  return (
    <div
      className="fixed top-4 right-4 z-[100] w-56 rounded-lg border border-rdb-border bg-rdb-bg/95 p-3 shadow-lg backdrop-blur-md transition-all duration-300"
      style={{ animation: 'slide-in-right 300ms cubic-bezier(0.34, 1.56, 0.64, 1) both' }}
    >
      <p className="font-mono text-[10px] uppercase text-rdb-muted mb-1">XP EARNED</p>
      <p className="font-mono text-xl font-bold text-rdb-orange mb-1">
        +{displayXp}
      </p>
      <p className="font-mono text-[9px] uppercase text-rdb-muted mb-2">
        LVL {oldLevel}
      </p>

      <div className="w-full h-1.5 rounded-full bg-rdb-border overflow-hidden mb-1">
        <div
          className="h-full rounded-full bg-rdb-orange transition-none"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <p className="font-mono text-[8px] uppercase text-rdb-muted">
        {(oldXp + displayXp) - currentLevelXp} / {nextLevelXp - currentLevelXp}
      </p>

      {showLevelUp && (
        <div className="mt-2 border-t border-rdb-border pt-2" style={{ animation: 'fade-in 300ms both' }}>
          <p className="font-mono text-[10px] uppercase font-bold text-rdb-orange">LEVEL UP! LVL {newLevel}</p>
        </div>
      )}
    </div>
  );
}
