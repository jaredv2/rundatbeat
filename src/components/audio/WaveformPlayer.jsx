import { memo, useEffect, useRef, useState } from 'react';
import { getThemeStyle } from '../../lib/display';
import { playUiSound } from '../../lib/sfx';
import { fetchAudioBlob } from '../../lib/challengeService';

let WaveSurfer = null;
let wavesurferPromise = null;

function loadWaveSurfer() {
  if (WaveSurfer) return Promise.resolve(WaveSurfer);
  if (wavesurferPromise) return wavesurferPromise;
  wavesurferPromise = import('wavesurfer.js').then((mod) => {
    WaveSurfer = mod.default;
    return WaveSurfer;
  });
  return wavesurferPromise;
}

function WaveformPlayerInner({ url, profile }) {
  const containerRef = useRef(null);
  const waveRef = useRef(null);
  const destroyedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const theme = getThemeStyle(profile);
  const waveColor = theme.accent;
  const progressColor = profile?.active_theme ? `${theme.accent}99` : '#22d3ee';

  useEffect(() => {
    if (!containerRef.current || !url) return undefined;

    destroyedRef.current = false;
    setReady(false);
    setError(false);
    setPlaying(false);
    setLoaded(false);

    let ws = null;
    let blobUrl = null;

    async function init() {
      const WS = await loadWaveSurfer();
      if (destroyedRef.current || !containerRef.current) return;

      ws = WS.create({
        container: containerRef.current,
        waveColor,
        progressColor,
        cursorWidth: 0,
        height: 56,
        barWidth: 2,
        barGap: 2,
        barRadius: 2,
        normalize: true,
        fillParent: true,
      });

      waveRef.current = ws;

      ws.on('ready', () => {
        if (destroyedRef.current) return;
        setReady(true);
        setLoaded(true);
      });

      ws.on('finish', () => setPlaying(false));

      ws.on('error', (err) => {
        if (destroyedRef.current || err?.name === 'AbortError') return;
        setError(true);
      });

      try {
        const resolvedUrl = await fetchAudioBlob(url);
        if (destroyedRef.current) return;
        blobUrl = resolvedUrl === url ? null : resolvedUrl;
        ws.load(resolvedUrl);
      } catch {
        if (!destroyedRef.current) setError(true);
      }
    }

    init();

    return () => {
      destroyedRef.current = true;
      if (ws) {
        try {
          const result = ws.destroy();
          if (result && typeof result.catch === 'function') result.catch(() => {});
        } catch (_) {}
      }
      waveRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    if (!waveRef.current || !ready) return;
    waveRef.current.setOptions({ waveColor, progressColor });
  }, [waveColor, progressColor, ready]);

  function handlePlayPause() {
    if (!waveRef.current || !ready) return;
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
        {!loaded ? 'LOADING' : playing ? 'PAUSE' : 'PLAY'}
      </button>

      <div
        ref={containerRef}
        className="waveform-strip min-w-0 w-full flex-1"
        style={{ background: 'transparent' }}
      />

      {error && (
        <span className="font-mono text-[10px] uppercase text-rdb-muted">
          AUDIO UNAVAILABLE
        </span>
      )}
    </div>
  );
}

const WaveformPlayer = memo(WaveformPlayerInner, (prev, next) => {
  return prev.url === next.url && prev.profile?.active_theme === next.profile?.active_theme && prev.profile?.accent_color === next.profile?.accent_color;
});

export default WaveformPlayer;
