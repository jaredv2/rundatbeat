import { GENRE_KNOWLEDGE } from './groq';

const RESTRICTIONS = {
  easy: [
    'no 808 slides',
    'no more than 3 melody layers',
    'keep the arrangement under 2:30',
    'must use a simple kick-snare pattern',
    'no vocal samples',
    'only 1 synth throughout',
    'no pitch automation',
    'must leave 4 empty bars as a breakdown',
  ],
  medium: [
    'must use a vocal chop or spoken word sample',
    'no open hi-hats',
    'must include an 8-bar breakdown section',
    'no more than 4 simultaneous melody layers',
    'must switch the drum pattern at least once',
    'no reverb on the 808',
    'must use a call-and-response melody',
    'arrangement must have 3 distinct sections',
  ],
  hard: [
    'no kick for the first 8 bars',
    'must include 2 distinct beat switches',
    'must use odd time signature for at least one section',
    'no 808 slides, only staccato bass hits',
    'must automate at least 3 mixer effects',
    'must use a polyrhythmic drum pattern',
    'no melody repetition across sections',
    'must create an original riser or transition effect',
  ],
  very_hard: [
    'no kick for the first 8 bars',
    'must include 2 distinct beat switches',
    'must use odd percussion throughout the entire track',
    'must automate at least 3 mixer effects',
    'must create an original riser or transition effect',
    'no melody line can repeat identically',
    'must use call-and-response between two contrasting melodies',
    'must write and record an original vocal hook',
    'no drum pattern can repeat — every 4 bars must change',
  ],
};

export function pickRestrictions(difficulty, genre, count = 3) {
  const pool = [...(RESTRICTIONS[difficulty] || RESTRICTIONS.medium)];
  const genreData = GENRE_KNOWLEDGE[genre];
  if (genreData?.mandatory_elements) {
    pool.push(...genreData.mandatory_elements);
  }
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

const MIN_FLAVOR_LENGTH = 20;
const REQUIRED_SUFFIX = 'TYPE BEAT';

export function validatePrompt(json) {
  const errors = [];
  if (!json.title || typeof json.title !== 'string') {
    errors.push('title is required');
  } else if (!json.title.toUpperCase().endsWith(REQUIRED_SUFFIX)) {
    errors.push(`title must end with ${REQUIRED_SUFFIX}`);
  }
  if (!json.flavor_text || json.flavor_text.length < MIN_FLAVOR_LENGTH) {
    errors.push(`flavor_text must be at least ${MIN_FLAVOR_LENGTH} characters`);
  }
  if (!Array.isArray(json.reference_keywords) || json.reference_keywords.length === 0) {
    errors.push('reference_keywords must be a non-empty array');
  }
  const genre = json.genre?.toLowerCase();
  const genreData = GENRE_KNOWLEDGE[genre];
  if (genreData) {
    const [min, max] = genreData.bpm_range;
    if (!json.bpm || json.bpm < min || json.bpm > max) {
      errors.push(`bpm ${json.bpm} outside ${genre} range ${min}-${max}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export async function selectGenre(supabase, difficulty) {
  const candidates = {
    easy: ['trap', 'drill', 'jersey_club'],
    medium: ['trap', 'drill', 'jersey_club'],
    hard: ['drill', 'jersey_club', 'jerk'],
    very_hard: ['jersey_club', 'jerk'],
  };
  const pool = candidates[difficulty] || ['trap'];
  if (pool.length === 1) return pool[0];

  try {
    const { data } = await supabase
      .from('battles')
      .select('genre')
      .in('genre', pool)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    const counts = {};
    for (const row of data || []) {
      const g = row.genre?.toLowerCase();
      if (g) counts[g] = (counts[g] || 0) + 1;
    }
    const weights = pool.map((g) => ({ genre: g, weight: 1 / (1 + (counts[g] || 0)) }));
    const total = weights.reduce((s, w) => s + w.weight, 0);
    let roll = Math.random() * total;
    for (const { genre, weight } of weights) {
      roll -= weight;
      if (roll <= 0) return genre;
    }
    return pool[Math.floor(Math.random() * pool.length)];
  } catch {
    return pool[Math.floor(Math.random() * pool.length)];
  }
}
