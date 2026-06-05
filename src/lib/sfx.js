let audioContext;

export function playUiSound(type = 'click') {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    const tones = {
      click: [420, 0.025, 0.018],
      queue: [660, 0.045, 0.026],
      success: [880, 0.055, 0.032],
      cancel: [220, 0.04, 0.024],
    };
    const [frequency, duration, volume] = tones[type] || tones.click;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  } catch {
    // Audio is optional and may be blocked by the browser.
  }
}
