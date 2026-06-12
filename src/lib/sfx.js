let audioContext;

export function playUiSound(type = 'click') {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const now = audioContext.currentTime;

    if (type === 'countdown_tick') {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(now);
      osc.stop(now + 0.1);
      return;
    }

    if (type === 'countdown_reveal') {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.06);
        gain.gain.setValueAtTime(0.18, now + i * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5 + i * 0.06);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now + i * 0.06);
        osc.stop(now + 0.5 + i * 0.06);
      });
      return;
    }

    if (type === 'submit') {
      [523, 659, 784].forEach((freq, i) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.05);
        gain.gain.setValueAtTime(0.15, now + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3 + i * 0.05);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now + i * 0.05);
        osc.stop(now + 0.3 + i * 0.05);
      });
      return;
    }

    if (type === 'vote') {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.setValueAtTime(880, now + 0.08);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(now);
      osc.stop(now + 0.2);
      return;
    }

    if (type === 'phase_change') {
      [440, 554, 659].forEach((freq, i) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.12, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4 + i * 0.08);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + 0.4 + i * 0.08);
      });
      return;
    }

    if (type === 'error') {
      [200, 180].forEach((freq, i) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0.1, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3 + i * 0.1);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + 0.3 + i * 0.1);
      });
      return;
    }

    if (type === 'notification') {
      [880, 1100, 880].forEach((freq, i) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.07);
        gain.gain.setValueAtTime(0.12, now + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25 + i * 0.07);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now + i * 0.07);
        osc.stop(now + 0.25 + i * 0.07);
      });
      return;
    }

    if (type === 'match_found') {
      [523, 659, 784, 1047].forEach((freq, i) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.16, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5 + i * 0.08);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + 0.5 + i * 0.08);
      });
      return;
    }

    if (type === 'forfeit') {
      [300, 200, 150].forEach((freq, i) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + i * 0.12);
        gain.gain.setValueAtTime(0.1, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4 + i * 0.12);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + 0.4 + i * 0.12);
      });
      return;
    }

    if (type === 'chat') {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(now);
      osc.stop(now + 0.06);
      return;
    }

    if (type === 'ready') {
      [660, 880].forEach((freq, i) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.06);
        gain.gain.setValueAtTime(0.12, now + i * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2 + i * 0.06);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now + i * 0.06);
        osc.stop(now + 0.2 + i * 0.06);
      });
      return;
    }

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const tones = {
      click: [420, 0.03, 0.06],
      queue: [660, 0.05, 0.08],
      success: [880, 0.06, 0.10],
      cancel: [220, 0.05, 0.07],
      win: [523, 0.12, 0.12],
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
