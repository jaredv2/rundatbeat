import { useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, Unlock } from 'lucide-react';
import WaveformPlayer from '../audio/WaveformPlayer';
import { useVoting } from '../../hooks/useVoting';
import { useUiStore } from '../../store/uiStore';
import { playUiSound } from '../../lib/sfx';

export default function VotingFeed({ battle, room, submissions, profile, votes = {}, ratings = {}, descriptions = {}, votingStopped = false, onVoted, onStopVoting }) {
  const { castRating, stopVoting } = useVoting();
  const addToast = useUiStore((s) => s.addToast);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [localRatings, setLocalRatings] = useState(ratings);
  const [localDescriptions, setLocalDescriptions] = useState(descriptions);
  const [voting, setVoting] = useState(false);
  const [togglingLock, setTogglingLock] = useState(false);

  const myId = profile?.id;
  const otherSubmissions = submissions.filter((s) => s.user_id && myId && s.user_id !== myId);
  const current = otherSubmissions[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < otherSubmissions.length - 1;

  if (!otherSubmissions.length) {
    return (
      <div className="border border-dashed border-rdb-orange p-6 font-mono text-rdb-orange">
        NO SUBMISSIONS TO VOTE ON
      </div>
    );
  }

  async function handleRate(rating) {
    if (!current || voting) return;
    playUiSound('click');
    const prevRating = localRatings[current.id];
    setLocalRatings((prev) => ({ ...prev, [current.id]: rating }));
    setVoting(true);
    try {
      await castRating({
        battleId: battle.id,
        submission: current,
        voterId: myId,
        voterProfile: profile,
        rating,
        description: localDescriptions[current.id] || '',
      });
      addToast('VOTE CAST');
      onVoted?.();
    } catch (error) {
      setLocalRatings((prev) => ({ ...prev, [current.id]: prevRating }));
      addToast(error.message || 'VOTE FAILED', 'error');
    } finally {
      setVoting(false);
    }
  }

  async function handleToggleLock() {
    playUiSound('click');
    const newStopped = !votingStopped;
    setTogglingLock(true);
    try {
      await stopVoting(room?.id || battle.id, myId, newStopped);
      onStopVoting?.(newStopped);
      if (newStopped) addToast('VOTING LOCKED');
    } catch (error) {
      addToast(error.message || 'TOGGLE LOCK FAILED', 'error');
    } finally {
      setTogglingLock(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-sm uppercase text-rdb-orange">VOTE — PRODUCER #{currentIndex + 1}</h2>
        <span className="font-mono text-[11px] text-rdb-muted">{currentIndex + 1} / {otherSubmissions.length}</span>
      </div>

      <div className="rdb-panel p-4">
        <div className="mb-3">
          <h3 className="font-mono text-lg uppercase text-rdb-text">PRODUCER #{currentIndex + 1}</h3>
          <span className="font-mono text-[10px] uppercase text-rdb-muted">ANONYMOUS SUBMISSION</span>
        </div>

        <WaveformPlayer url={current.audio_url} />

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] uppercase text-rdb-muted">COLD</span>
            <span className="font-mono text-sm font-bold text-rdb-orange">{localRatings[current.id] !== undefined ? `${localRatings[current.id]}/10` : '0/10'}</span>
            <span className="font-mono text-[10px] uppercase text-rdb-muted">HOT</span>
          </div>
          <div className="flex gap-1">
            {Array.from({ length: 11 }, (_, i) => (
              <button
                key={i}
                type="button"
                className={`flex-1 h-10 rounded text-[11px] font-bold font-mono transition ${
                  localRatings[current.id] === i
                    ? 'bg-rdb-orange text-black'
                    : 'bg-white/5 text-rdb-muted hover:bg-white/10'
                }`}
                disabled={voting}
                onClick={() => handleRate(i)}
              >
                {i}
              </button>
            ))}
          </div>
          <div className="flex justify-between mt-1 px-1">
            <span className="font-mono text-[9px] text-rdb-muted">0</span>
            <span className="font-mono text-[9px] text-rdb-muted">5</span>
            <span className="font-mono text-[9px] text-rdb-muted">10</span>
          </div>
        </div>

        <div className="mt-4">
          <textarea
            className="rdb-input min-h-20"
            placeholder="DESCRIPTION OF YOUR RATING (OPTIONAL)"
            value={localDescriptions[current.id] || ''}
            onChange={(e) => {
              setLocalDescriptions((prev) => ({ ...prev, [current.id]: e.target.value }));
            }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            className="rdb-button"
            disabled={!hasPrev}
            type="button"
            onClick={() => { playUiSound('click'); setCurrentIndex((i) => i - 1); }}
          >
            <ChevronLeft size={16} /> PREVIOUS
          </button>
          <button
            className="rdb-button"
            disabled={!hasNext}
            type="button"
            onClick={() => { playUiSound('click'); setCurrentIndex((i) => i + 1); }}
          >
            NEXT <ChevronRight size={16} />
          </button>
        </div>
        <button
          className={`rdb-button ${votingStopped ? 'border-green-400 text-green-400' : 'border-rdb-orange text-rdb-orange'}`}
          type="button"
          disabled={togglingLock}
          onClick={handleToggleLock}
        >
          {votingStopped ? <><Unlock size={16} /> UNLOCK</> : <><Lock size={16} /> LOCK VOTING</>}
        </button>
      </div>

      <div className="font-mono text-[10px] uppercase text-rdb-muted text-center">
        {Object.keys(localRatings).length} / {otherSubmissions.length} SUBMISSIONS RATED
        {votingStopped && <span className="ml-2 text-green-400">— LOCKED</span>}
      </div>
    </div>
  );
}
