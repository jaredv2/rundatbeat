import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Trophy, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import { playUiSound } from '../../lib/sfx';

export default function WinModal({ open, eloChange, oldTier, newTier, onPlayAgain, onClose }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    playUiSound('win');
    const duration = 2000;
    const end = Date.now() + duration;
    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: ['#f59e0b', '#22d3ee', '#10b981', '#ec4899'],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: ['#f59e0b', '#22d3ee', '#10b981', '#ec4899'],
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  }, [open]);

  if (!open) return null;

  const displayOld = oldTier || 'bronze';
  const displayNew = newTier || oldTier || 'bronze';
  const rankedUp = displayOld && displayNew && displayOld !== displayNew && eloChange > 0;
  const rankedDown = displayOld && displayNew && displayOld !== displayNew && eloChange < 0;

  return (
    <div className="win-modal-overlay">
      <div className="win-modal" onClick={(e) => e.stopPropagation()}>
        <button className="win-modal-close" type="button" onClick={() => { playUiSound('cancel'); onClose(); }}><X size={16} /></button>
        <div className="win-modal-glow" />
        <Trophy className="win-modal-icon" size={48} />
        <h1 className="win-modal-title">YOU WIN</h1>

        {eloChange !== null && (
          <p className={`win-modal-elo ${eloChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {eloChange >= 0 ? '+' : ''}{eloChange} ELO
          </p>
        )}

        {rankedUp && (
          <p className="mt-1 flex items-center justify-center gap-2 font-mono text-[13px] uppercase text-green-400">
            <ArrowUp size={16} />{displayOld} → {displayNew}
          </p>
        )}
        {rankedDown && (
          <p className="mt-1 flex items-center justify-center gap-2 font-mono text-[13px] uppercase text-red-400">
            <ArrowDown size={16} />{displayOld} → {displayNew}
          </p>
        )}

        {displayOld && displayNew && displayOld === displayNew && eloChange !== null && (
          <p className="mt-1 font-mono text-[11px] uppercase text-rdb-muted">{displayNew}</p>
        )}

        <div className="win-modal-actions">
          <button className="rdb-button" type="button" onClick={() => { playUiSound('click'); navigate('/leaderboard'); }}>
            LEADERBOARD
          </button>
          <button className="rdb-button rdb-button-primary" type="button" onClick={() => { playUiSound('click'); onPlayAgain(); }}>
            PLAY AGAIN
          </button>
        </div>
      </div>
    </div>
  );
}
