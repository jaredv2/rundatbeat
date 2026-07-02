import { ClipboardCopy, ExternalLink, Music } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function SampleCard({ challenge, phase, room, hideDetails, onUnavailable }) {
  const [copied, setCopied] = useState(false);
  const [ytAvailable, setYtAvailable] = useState(true);
  if (!challenge) return null;

  useEffect(() => {
    if (!challenge.youtube_video_id) return;
    let cancelled = false;
    fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${challenge.youtube_video_id}&format=json`)
      .then((r) => {
        if (cancelled) return;
        const avail = r.ok;
        setYtAvailable(avail);
        if (!avail) onUnavailable?.();
      })
      .catch(() => {
        if (cancelled) return;
        setYtAvailable(false);
        onUnavailable?.();
      });
    return () => { cancelled = true; };
  }, [challenge.youtube_video_id]);

  const isVoting = phase === 'voting';
  const allowRestrictions = room?.challenge?.allowRestrictions !== false;
  const isFreeMode = room?.challenge?.freeMode === true || (!challenge.instructions && !challenge.restrictionsList && !challenge.instructionGenre);

  const handleCopyLink = async () => {
    if (!challenge.youtube_url) return;
    await navigator.clipboard.writeText(challenge.youtube_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rdb-panel p-5">
      {!isVoting && (
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-rdb-orange/20 px-2 py-0.5 font-mono text-[10px] uppercase text-rdb-orange">
            <Music size={10} />
            {challenge.genre}
          </span>
          {challenge.bpm && (
            <span className="rounded bg-blue-500/20 px-2 py-0.5 font-mono text-[10px] uppercase text-blue-400">
              {challenge.bpm} BPM
            </span>
          )}
          {challenge.key && (
            <span className="rounded bg-purple-500/20 px-2 py-0.5 font-mono text-[10px] uppercase text-purple-400">
              KEY: {challenge.key}
            </span>
          )}
        </div>
      )}

      {challenge.uploader && (
        <p className="mt-4 font-mono text-sm font-bold uppercase text-rdb-text">
          SAMPLE THIS FROM {challenge.uploader}
        </p>
      )}

      {challenge.youtube_video_id && ytAvailable ? (
        <div className="mt-4">
          <p className="mb-1 font-mono text-[10px] uppercase text-rdb-muted">
            {isVoting ? 'CURRENT SAMPLE' : 'PREVIEW'}
          </p>
          <div className="relative w-full overflow-hidden rounded-lg border border-rdb-border" style={{ paddingBottom: '56.25%' }}>
            <iframe
              src={`https://www.youtube.com/embed/${challenge.youtube_video_id}?rel=0`}
              title={challenge.title}
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      ) : challenge.youtube_video_id && !ytAvailable ? (
        <div className="mt-4 rounded-lg border border-rdb-red/30 bg-rdb-red/5 p-3">
          <p className="font-mono text-[10px] uppercase text-rdb-red">SAMPLE UNAVAILABLE</p>
          <p className="font-mono text-xs text-rdb-muted mt-1">This YouTube video is no longer available.</p>
        </div>
      ) : (challenge.cover_image || challenge.thumb) && (
        <div className="mt-4">
          <p className="mb-1 font-mono text-[10px] uppercase text-rdb-muted">
            {isVoting ? 'CURRENT SAMPLE' : 'PREVIEW'}
          </p>
          <img
            src={challenge.cover_image || challenge.thumb}
            alt={challenge.title}
            className="w-full rounded-lg border border-rdb-border object-cover"
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {challenge.youtube_url && (
          <button
            className="rdb-button flex items-center gap-2"
            onClick={handleCopyLink}
          >
            <ClipboardCopy size={14} /> {copied ? 'COPIED!' : 'COPY LINK'}
          </button>
        )}
        {challenge.detail_url && (
          <a
            className="rdb-button flex items-center gap-2"
            href={challenge.detail_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={14} /> CREDITS
          </a>
        )}
      </div>

      {!hideDetails && !isFreeMode && (
        <>
          <div className="mt-3 rounded-lg border border-rdb-orange/30 bg-rdb-orange/5 p-3">
            <p className="font-mono text-[10px] uppercase text-rdb-orange mb-1">INSTRUCTIONS</p>
            <p className="font-mono text-sm uppercase text-rdb-text leading-relaxed">
              MAKE A {challenge.instructionGenre || 'TRAP'} BEAT FROM THIS SAMPLE
            </p>
          </div>

          {allowRestrictions && challenge.restrictionsList && (
            <div className="mt-4">
              <p className="font-mono text-[10px] uppercase text-rdb-red mb-1">RESTRICTIONS</p>
              <p className="font-mono text-sm uppercase text-rdb-text leading-relaxed rounded-lg border border-rdb-red/30 bg-rdb-red/5 p-4">
                {challenge.restrictionsList}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
