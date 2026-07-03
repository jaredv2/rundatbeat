import { useEffect, useMemo, useRef, useState } from 'react';
import { Music, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCountdown } from '../../hooks/useCountdown';
import { supabase } from '../../lib/supabase';
import { playUiSound } from '../../lib/sfx';

export default function SkipVoteCard({ roomId, members, profile, challenge, endsAt, onResult }) {
  const effectiveEndsAt = useMemo(() => {
    const now = Date.now();
    if (endsAt) {
      const parsed = new Date(endsAt).getTime();
      if (parsed > now + 500) return endsAt;
    }
    return new Date(now + 30000).toISOString();
  }, [challenge?.youtube_video_id, challenge?.genre, endsAt]);
  const { remaining } = useCountdown(effectiveEndsAt);
  const [myVote, setMyVote] = useState(null); // true = skip, false = keep
  const [skipCount, setSkipCount] = useState(0);
  const [keepCount, setKeepCount] = useState(0);
  const [ytAvailable, setYtAvailable] = useState(true);
  const autoSkippedRef = useRef(false);
  const totalPlayers = members?.length || 1;
  const majority = Math.ceil(totalPlayers / 2);

  useEffect(() => {
    if (!challenge?.youtube_video_id) return;
    let cancelled = false;
    fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${challenge.youtube_video_id}&format=json`)
      .then((r) => {
        if (cancelled) return;
        const avail = r.ok;
        setYtAvailable(avail);
        if (!avail && !autoSkippedRef.current) {
          autoSkippedRef.current = true;
          onResult?.(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setYtAvailable(false);
        if (!autoSkippedRef.current) {
          autoSkippedRef.current = true;
          onResult?.(true);
        }
      });
    return () => { cancelled = true; };
  }, [challenge?.youtube_video_id]);

  useEffect(() => {
    if (!roomId || !supabase) return;
    const ch = supabase
      .channel(`skip-vote-${roomId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, () => loadVotes())
      .subscribe();
    loadVotes();
    return () => supabase.removeChannel(ch);
  }, [roomId]);

  // Reset vote when challenge changes (new sample after skip)
  useEffect(() => {
    setMyVote(null);
    setSkipCount(0);
    setKeepCount(0);
  }, [challenge?.youtube_video_id, challenge?.genre]);

  async function loadVotes() {
    const { data } = await supabase.from('room_members').select('skip_vote').eq('room_id', roomId);
    const skips = (data || []).filter(m => m.skip_vote === true).length;
    const keeps = (data || []).filter(m => m.skip_vote === false).length;
    const totalVoted = skips + keeps;
    setSkipCount(skips);
    setKeepCount(keeps);
    if (totalPlayers > 3) {
      if (skips >= majority) onResult?.(true);
      else if (keeps >= majority) onResult?.(false);
    } else {
      // <= 3 players: all must vote, skip only if ALL skipped
      if (totalVoted >= totalPlayers) {
        onResult?.(skips === totalPlayers);
      }
    }
  }

  async function vote(skip) {
    if (myVote !== null) return;
    setMyVote(skip);
    playUiSound('click');
    await supabase.from('room_members').update({ skip_vote: skip }).eq('room_id', roomId).eq('user_id', profile.id);
  }

  useEffect(() => {
    if (!challenge) return;
    if (remaining !== null && remaining <= 0) {
      const totalVoted = skipCount + keepCount;
      if (totalPlayers <= 3 && totalVoted >= totalPlayers && skipCount === totalPlayers) {
        onResult?.(true);
      } else {
        onResult?.(false);
      }
    }
  }, [remaining, challenge, skipCount, keepCount, totalPlayers]);

  return (
    <div className="rdb-panel p-6 space-y-4">
      <style>{`
        .skip-flash { animation: skipPulse 0.4s ease-out; }
        @keyframes skipPulse { 0% { filter: brightness(1.5); } 100% { filter: brightness(1); } }
      `}</style>

      <div className="flex items-center justify-center gap-2">
        <Music size={14} className="text-rdb-orange" />
        <span className="font-mono text-[11px] uppercase text-rdb-orange tracking-widest font-bold">
          SKIP THIS SAMPLE?
        </span>
      </div>

      <div className="flex items-center justify-center gap-4">
        <div className="text-center">
          <span className="font-mono text-2xl font-bold text-green-400">{skipCount}</span>
          <p className="font-mono text-[9px] uppercase text-rdb-muted">SKIP</p>
        </div>
        <span className="font-mono text-rdb-muted">/</span>
        <div className="text-center">
          <span className="font-mono text-2xl font-bold text-red-400">{keepCount}</span>
          <p className="font-mono text-[9px] uppercase text-rdb-muted">KEEP</p>
        </div>
        <span className="font-mono text-rdb-muted">/</span>
        <div className="text-center">
          <span className="font-mono text-2xl font-bold text-rdb-orange">{totalPlayers - skipCount - keepCount}</span>
          <p className="font-mono text-[9px] uppercase text-rdb-muted">NO VOTE</p>
        </div>
      </div>

      <p className="text-center font-mono text-[10px] uppercase text-rdb-muted">
        {totalPlayers <= 3 ? `NEED ALL ${totalPlayers} VOTES` : `NEED ${majority} SKIP VOTES TO CHANGE`} • {Math.ceil((remaining || 0) / 1000)}s LEFT
      </p>

      {challenge?.youtube_video_id && (
        <div className="relative w-full overflow-hidden rounded-lg border border-rdb-border" style={{ paddingBottom: '56.25%' }}>
          <iframe
            src={`https://www.youtube.com/embed/${challenge.youtube_video_id}?rel=0`}
            title={challenge.title || 'Sample Preview'}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {challenge?.genre && (
        <div className="flex items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-rdb-orange/20 px-2 py-0.5 font-mono text-[10px] uppercase text-rdb-orange">
            <Music size={10} /> {challenge.genre}
          </span>
          {challenge.bpm && (
            <span className="rounded bg-blue-500/20 px-2 py-0.5 font-mono text-[10px] uppercase text-blue-400">
              {challenge.bpm} BPM
            </span>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button
          className={`flex-1 rdb-button flex items-center justify-center gap-2 ${myVote === true ? 'border-green-400 text-green-400' : myVote !== null ? 'opacity-30' : 'border-green-400 text-green-400 hover:bg-green-400/10'}`}
          type="button"
          disabled={myVote !== null}
          onClick={() => vote(true)}
        >
          <ThumbsDown size={14} /> SKIP
        </button>
        <button
          className={`flex-1 rdb-button flex items-center justify-center gap-2 ${myVote === false ? 'border-red-400 text-red-400' : myVote !== null ? 'opacity-30' : 'border-red-400 text-red-400 hover:bg-red-400/10'}`}
          type="button"
          disabled={myVote !== null}
          onClick={() => vote(false)}
        >
          <ThumbsUp size={14} /> KEEP
        </button>
      </div>
    </div>
  );
}
