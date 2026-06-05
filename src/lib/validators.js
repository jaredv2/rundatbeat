export const AUDIO_LIMITS = {
  maxSizeBytes: 25 * 1024 * 1024,
  maxDurationSeconds: 6 * 60,
};

export function validateUsername(username) {
  return /^[A-Za-z0-9_]{3,20}$/.test(username);
}

export function validateAudioFile(file) {
  if (!file) return 'Choose an audio file.';
  const allowed = ['audio/mpeg', 'audio/wav', 'audio/x-wav'];
  const extAllowed = /\.(mp3|wav)$/i.test(file.name);
  if (!allowed.includes(file.type) && !extAllowed) return 'MP3 and WAV only.';
  if (file.size > AUDIO_LIMITS.maxSizeBytes) return 'Max size is 25MB.';
  return '';
}

export function validateAudioDuration(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve('Choose an audio file.');
      return;
    }
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration > AUDIO_LIMITS.maxDurationSeconds ? 'Max length is 6 minutes.' : '');
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('Could not read audio length.');
    };
    audio.src = url;
  });
}
