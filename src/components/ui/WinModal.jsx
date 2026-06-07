import { useNavigate } from 'react-router-dom';
import { Trophy, X } from 'lucide-react';
import { playUiSound } from '../../lib/sfx';

export default function WinModal({ open, eloChange, onPlayAgain, onClose }) {
  const navigate = useNavigate();
  if (!open) return null;

  return (
    <div className="win-modal-overlay" onClick={() => { playUiSound('cancel'); onClose(); }}>
      <div className="win-modal" onClick={(e) => e.stopPropagation()}>
        <button className="win-modal-close" type="button" onClick={() => { playUiSound('cancel'); onClose(); }}><X size={16} /></button>
        <div className="win-modal-glow" />
        <Trophy className="win-modal-icon" size={48} />
        <h1 className="win-modal-title">YOU WIN</h1>
        {eloChange !== undefined && (
          <p className="win-modal-elo">+{eloChange} ELO</p>
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
