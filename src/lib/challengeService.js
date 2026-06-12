import { supabase } from './supabase';

const BASE_URL = 'https://loops-api-rdb.vercel.app';
const PROXY_URL = supabase ? `${supabase.supabaseUrl}/functions/v1/proxy-audio` : null;

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
  if (PROXY_URL && loopId) {
    return `${PROXY_URL}?id=${loopId}`;
  }
  return `${BASE_URL}/download/${loopId}`;
}

const blobCache = new Map();

function extractLoopIdFromUrl(url) {
  if (!url) return null;
  const proxyMatch = url.match(/[?&]id=(\d+)/);
  if (proxyMatch) return proxyMatch[1];
  const directMatch = url.match(/\/download\/(\d+)/i) || url.match(/\/loop(?:s)?\/(\d+)/i);
  if (directMatch) return directMatch[1];
  return null;
}

export async function fetchAudioBlob(url) {
  if (!url) throw new Error('No URL');
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;

  if (blobCache.has(url)) return blobCache.get(url);

  const loopId = extractLoopIdFromUrl(url);
  const fetchUrl = loopId ? getDownloadUrl(loopId) : url;

  const { data: { session } } = await supabase.auth.getSession();
  const headers = {};
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

  const res = await fetch(fetchUrl, { headers });
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  blobCache.set(url, blobUrl);
  return blobUrl;
}
