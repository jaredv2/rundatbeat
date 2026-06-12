import { useState, useEffect, useRef } from 'react';
import { playUiSound } from '../../lib/sfx';

export default function QueueCard({ onLeave }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const secs = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm">
      <div className="rdb-panel p-4 flex items-center gap-4 shadow-2xl shadow-black/50">
        {/* Pulsing dot */}
        <span className="relative flex h-3 w-3 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rdb-orange opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-rdb-orange" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="font-mono text-[12px] uppercase font-bold text-rdb-text tracking-wide">
            RANKED MATCH
          </div>
          <div className="font-mono text-[10px] uppercase text-rdb-muted">
            SEARCHING FOR PLAYERS...
          </div>
        </div>

        <span className="font-mono text-lg font-bold tabular-nums text-rdb-orange">
          {mins}:{secs}
        </span>

        <button
          className="flex-shrink-0 h-8 px-3 rdb-button border-rdb-red text-rdb-red font-mono text-[10px] uppercase"
          type="button"
          onClick={() => { playUiSound('cancel'); onLeave(); }}
        >
          LEAVE
        </button>
      </div>
    </div>
  );
}
