import { supabase } from './supabase';

const BASE_URL = import.meta.env.DEV
  ? '/api/loops-proxy'
  : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/loops-proxy`;

export async function getChallengeSample(genre) {
  const params = genre ? `?genre=${encodeURIComponent(genre)}&enrich=true` : '?enrich=true';
  const res = await fetch(`${BASE_URL}/challenge${params}`);
  if (!res.ok) throw new Error(`Challenge fetch failed: ${res.status}`);
  return res.json();
}

export async function buildChallenge(genre) {
  return getChallengeSample(genre);
}

function extractLoopId(sample) {
  if (sample.id) return sample.id;
  const url = sample.detail_url || sample.mp3_url || '';
  const match = url.match(/\/loop(?:s)?\/(\d+)/i) || url.match(/\/(\d+)\/?$/);
  return match ? match[1] : null;
}

export function buildSamplePayload(sample, restriction, instructions = '', restrictionsList = '') {
  const loopId = extractLoopId(sample);
  return {
    id: loopId,
    title: sample.title,
    bpm: sample.bpm,
    key: sample.key,
    genre: sample.genre,
    duration: sample.duration,
    mp3_url: loopId ? getDownloadUrl(loopId) : sample.mp3_url,
    waveform_url: sample.waveform_url,
    waveform_img_url: sample.waveform_img_url,
    detail_url: sample.detail_url,
    uploader: sample.uploader,
    tags: sample.tags || [],
    description: sample.description || '',
    restriction,
    instructions,
    restrictionsList,
  };
}

export function getDownloadUrl(loopId) {
  return `${BASE_URL}/download/${loopId}`;
}
