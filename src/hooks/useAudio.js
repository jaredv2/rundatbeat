import { useRef, useState } from 'react';

export function useAudio() {
  const wavesurferRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    wavesurferRef.current?.playPause();
    setPlaying((value) => !value);
  };
  return { wavesurferRef, playing, setPlaying, toggle };
}
