import { supabase } from './supabase';

const BASE_URL = 'https://loops-api-rdb.vercel.app';

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

export function buildSamplePayload(sample) {
  const loopId = sample.id || extractLoopId(sample);
  return {
    id: loopId,
    title: sample.title,
    full_title: sample.full_title || sample.title,
    bpm: sample.bpm,
    key: sample.tonality || sample.key,
    genre: sample.genre_tags?.[0]?.toLowerCase() || sample.genre || 'trap',
    duration: sample.duration,
    mp3_url: loopId ? getDownloadUrl(loopId) : sample.mp3_url,
    cover_image: sample.cover_image || sample.thumb,
    thumb: sample.thumb,
    detail_url: sample.discogs_url || sample.detail_url,
    uploader: sample.channel || sample.original_artist || sample.uploader,
    tags: [...(sample.genre_tags || []), ...(sample.style_tags || [])],
    youtube_url: sample.youtube_url || '',
    youtube_video_id: sample.youtube_video_id || '',
    original_artist: sample.original_artist || '',
    label: sample.label || '',
    year: sample.year || null,
  };
}

export function getDownloadUrl(loopId) {
  return `${BASE_URL}/download/${loopId}`;
}

const blobCache = new Map();

function extractLoopIdFromUrl(url) {
  if (!url) return null;
  const proxyMatch = url.match(/[?&]id=(\d+)/);
  if (proxyMatch) return proxyMatch[1];
  const apiMatch = url.match(/\/download\/(\d+)/i);
  if (apiMatch) return apiMatch[1];
  const loopMatch = url.match(/\/loop(?:s)?\/(\d+)/i);
  if (loopMatch) return loopMatch[1];
  const fileIdMatch = url.match(/file_id=(\d+)/i);
  if (fileIdMatch) return fileIdMatch[1];
  return null;
}

export async function fetchAudioBlob(url) {
  if (!url) throw new Error('No URL');
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;

  if (blobCache.has(url)) return blobCache.get(url);

  const loopId = extractLoopIdFromUrl(url);
  const fetchUrl = loopId
    ? `${BASE_URL}/download/${loopId}`
    : url;

  const res = await fetch(fetchUrl);
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  blobCache.set(url, blobUrl);
  return blobUrl;
}
