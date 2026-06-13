import { Download, ExternalLink, Music } from 'lucide-react';
import WaveformPlayer from '../audio/WaveformPlayer';
import { getDownloadUrl } from '../../lib/challengeService';
import { useAuthStore } from '../../store/authStore';

export default function SampleCard({ challenge, phase, room }) {
  const { profile } = useAuthStore();
  if (!challenge) return null;

  const isVoting = phase === 'voting';
  const allowRestrictions = room?.challenge?.allowRestrictions !== false;

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

      <h1 className={`${isVoting ? '' : 'mt-4'} font-mono text-3xl font-bold uppercase text-rdb-text`}>
        {challenge.title}
      </h1>

      {challenge.uploader && (
        <p className="mt-1 font-mono text-[11px] uppercase text-rdb-muted">
          SAMPLE BY {challenge.uploader}
        </p>
      )}

      {!isVoting && challenge.tags?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {challenge.tags.map((tag) => (
            <span
              key={tag}
              className="rounded border border-rdb-border bg-rdb-bg/50 px-2 py-0.5 font-mono text-[10px] uppercase text-rdb-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {challenge.mp3_url && (
        <div className="mt-4">
          <p className="mb-1 font-mono text-[10px] uppercase text-rdb-muted">
            {isVoting ? 'CURRENT SAMPLE' : 'PREVIEW'}
          </p>
          <WaveformPlayer url={challenge.mp3_url} profile={profile} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {challenge.id && (
          <a
            className="rdb-button flex items-center gap-2"
            href={getDownloadUrl(challenge.id)}
            download
          >
            <Download size={14} /> DOWNLOAD
          </a>
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
      <p className="mt-2 font-mono text-[9px] uppercase text-rdb-muted">
        Powered by{' '}
        <a href="https://loopazon.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-rdb-orange">
          loopazon.com
        </a>
      </p>

      {allowRestrictions && challenge.restrictionsList && (
        <div className="mt-4">
          <p className="font-mono text-[10px] uppercase text-rdb-red mb-1">RESTRICTIONS</p>
          <p className="font-mono text-sm uppercase text-rdb-text leading-relaxed rounded-lg border border-rdb-red/30 bg-rdb-red/5 p-4">
            {challenge.restrictionsList}
          </p>
        </div>
      )}

      {allowRestrictions && challenge.restriction && !challenge.restrictionsList && (
        <div className="mt-4 rounded-lg border border-rdb-orange/40 bg-rdb-orange/10 p-4">
          <p className="font-mono text-[10px] uppercase text-rdb-orange">RESTRICTION</p>
          <p className="mt-1 font-mono text-sm uppercase text-rdb-text">{challenge.restriction}</p>
        </div>
      )}
    </div>
  );
}
