import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { getThemeStyle } from '../../lib/display';
import { playUiSound } from '../../lib/sfx';

export default function WaveformPlayer({ url, profile }) {
  const containerRef = useRef(null);
  const waveRef = useRef(null);
  // Track whether the current instance is being destroyed so we can
  // ignore the AbortError that WaveSurfer fires when destroy() cancels the fetch
  const destroyedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  const theme = getThemeStyle(profile);
  const waveColor = theme.accent;
  const progressColor = profile?.active_theme ? `${theme.accent}99` : '#22d3ee';

  useEffect(() => {
    if (!containerRef.current || !url) {
      console.warn('[WaveformPlayer] Skipping init — missing container or url', { url });
      return undefined;
    }

    console.log('[WaveformPlayer] Initialising WaveSurfer for url:', url);

    // Reset flags for this mount
    destroyedRef.current = false;
    setReady(false);
    setError(false);
    setPlaying(false);

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor,
      progressColor,
      cursorWidth: 0,
      height: 56,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      normalize: true,
      backend: 'WebAudio',
      fillParent: true,
    });

    waveRef.current = ws;

    ws.on('ready', () => {
      // Guard: if destroy() was called before ready fired, ignore
      if (destroyedRef.current) {
        console.log('[WaveformPlayer] ready fired after destroy — ignoring');
        return;
      }
      console.log('[WaveformPlayer] WaveSurfer ready:', url);
      setReady(true);
    });

    ws.on('finish', () => {
      console.log('[WaveformPlayer] Playback finished');
      setPlaying(false);
    });

    ws.on('error', (err) => {
      // KEY FIX: AbortError means destroy() cancelled the in-flight fetch.
      // This is expected during cleanup (React Strict Mode unmount, url change, etc.)
      // It is NOT a real audio error — do not show "AUDIO UNAVAILABLE"
      if (destroyedRef.current || err?.name === 'AbortError') {
        console.log('[WaveformPlayer] Suppressed AbortError from destroy():', err?.message);
        return;
      }
      console.error('[WaveformPlayer] Real WaveSurfer error:', err);
      setError(true);
    });

    ws.load(url);
    console.log('[WaveformPlayer] load() called for:', url);

    return () => {
      console.log('[WaveformPlayer] Cleanup — destroying WaveSurfer instance');
      // Mark as destroyed BEFORE calling destroy() so the error handler
      // can identify the resulting AbortError as intentional
      destroyedRef.current = true;
      ws.destroy();
      waveRef.current = null;
    };
  }, [url]); // only re-init when url changes

  // Live-update colors without remounting
  useEffect(() => {
    if (!waveRef.current || !ready) return;
    console.log('[WaveformPlayer] Updating colors — accent:', waveColor);
    waveRef.current.setOptions({ waveColor, progressColor });
  }, [waveColor, progressColor, ready]);

  function handlePlayPause() {
    if (!waveRef.current || !ready) {
      console.warn('[WaveformPlayer] Play attempted before ready');
      return;
    }
    playUiSound('click');
    waveRef.current.playPause();
    setPlaying((v) => !v);
  }

  return (
    <div className="flex w-full items-center gap-3">
      <button
        className="rdb-button rdb-button-primary w-20 shrink-0"
        type="button"
        disabled={!ready}
        onClick={handlePlayPause}
      >
        {playing ? 'PAUSE' : 'PLAY'}
      </button>

      <div
        ref={containerRef}
        className="waveform-strip min-w-0 w-full flex-1"
        style={{ background: 'transparent' }}
      />

      {/* Only show on genuine load errors, never on AbortError */}
      {error && (
        <span className="font-mono text-[10px] uppercase text-rdb-muted">
          AUDIO UNAVAILABLE
        </span>
      )}
    </div>
  );
}