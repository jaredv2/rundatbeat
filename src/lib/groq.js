import { supabase } from './supabase';

export const RESTRICTION_POOL = [
  "No melodies — drums and 808 only alongside the sample",
  "No 808 — let the sample carry the low end",
  "The beat must feel empty — max 3 elements total including the sample",
  "No hi-hats — kick and snare only",
  "Sample must be pitched down at least 2 semitones from its original pitch",
  "No snare — only kick and hi-hats",
  "No more than one drum element playing at any time",
  "No reverb on anything — everything must sound dry and close",
  "No kicks — 808 and hi-hats carry the rhythm",
  "The beat must be under 60 seconds — short and punchy",
  "No chord pads or sustained synths — single note leads only",
  "No bass of any kind — no 808, no sub, no bass synth",
  "Every element must cut out for at least one full bar somewhere in the beat",
  "No samples other than the provided one — all other sounds must be synthesized",
  "The beat must have a full 4 bar intro with no drums — sample only",
  "No more than 2 elements playing simultaneously at any point",
  "Hi-hats must stay on straight 8th notes — no triplets, no rolls",
  "The 808 must be a different note on every single bar — no repeating patterns",
  "No effects on the sample — use it completely dry, no EQ, no reverb, no compression",
  "The beat must drop to silence for exactly one bar in the middle",
];

export function pickFromPool() {
  return RESTRICTION_POOL[Math.floor(Math.random() * RESTRICTION_POOL.length)];
}

export function difficultyFromTier(tier) {
  const order = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'goat'];
  const idx = order.indexOf(tier?.toLowerCase() || 'bronze');
  if (idx <= 1) return 'easy';
  if (idx <= 3) return 'medium';
  if (idx <= 5) return 'hard';
  return 'very_hard';
}

const GENRE_RESTRICTION_GUIDE = {
  trap: '808 slides/glides, hi-hat rolls (triplets, 1/32), snare/clap patterns, open hat placement, melody loops, dark/bright FX.',
};

function bpmHints(bpm) {
  const bpmNum = Number(bpm) || 140;
  if (bpmNum <= 100) return 'slow tempo — consider: half-time drums, spaced-out bass, long melodic phrases, ambient FX.';
  if (bpmNum <= 130) return 'mid tempo — consider: standard grooves, swing, layered percussion, dynamic arrangement.';
  if (bpmNum <= 155) return 'fast tempo — consider: double-time hi-hats, rapid 808s, energetic transitions, tight quantization.';
  return 'very fast tempo — consider: rapid-fire hats, intense rhythms, aggressive energy, tight fills.';
}

function keyHints(key) {
  if (!key) return '';
  const lower = key.toLowerCase();
  if (lower.includes(' minor') || lower.endsWith('m') || lower.match(/^[a-g]m$/)) return 'minor key — consider: dark, moody, emotional atmosphere.';
  if (lower.includes(' major') || lower.match(/^[a-g]$/)) return 'major key — consider: bright, uplifting, melodic energy.';
  return '';
}

const SOLO_DIFFICULTY = {
  easy: {
    label: 'easy',
    instructionStyle: 'simple creative direction — pick one vibe or mood for the beat.',
  },
  medium: {
    label: 'medium',
    instructionStyle: 'clear creative direction — combine the loop\'s mood with a specific energy or context.',
  },
  hard: {
    label: 'hard',
    instructionStyle: 'detailed creative direction — reference the loop\'s specific character and push the producer\'s skill.',
  },
  expert: {
    label: 'expert',
    instructionStyle: 'demanding creative direction — require structural or arrangement-level thinking, not just sound selection.',
  },
  impossible: {
    label: 'impossible',
    instructionStyle: 'extreme creative direction — require multiple simultaneous constraints and creative problem-solving.',
  },
};

const RANKED_DIFFICULTY = {
  easy: {
    instructionStyle: 'straightforward creative direction — match the loop\'s mood with a clear context.',
  },
  medium: {
    instructionStyle: 'solid creative direction — push beyond basic, require some intentionality.',
  },
  hard: {
    instructionStyle: 'ambitious creative direction — demand technical control and musical decision-making.',
  },
  very_hard: {
    instructionStyle: 'advanced creative direction — require arrangement-level thinking and multi-part coordination.',
  },
};

function roomDifficultyLabel(playerCount) {
  if (playerCount <= 2) return 'easy';
  if (playerCount <= 4) return 'medium';
  if (playerCount <= 6) return 'hard';
  return 'very_hard';
}

export async function generateBattlePrompt({
  genre = '',
  mode = 'ranked',
  tier = 'bronze',
  difficulty = 'medium',
  playerCount = 2,
  loopTitle = '',
  loopBpm = '',
  loopKey = '',
} = {}) {
  if (!supabase) throw new Error("Supabase not configured");

  const bpmHint = bpmHints(loopBpm);
  const keyHint = keyHints(loopKey);
  const genreGuide = GENRE_RESTRICTION_GUIDE[genre?.toLowerCase()] || 'drum patterns, bass slides, FX, arrangement choices.';

  let systemPrompt;
  let userMessage;

  if (mode === 'ranked') {
    const diff = RANKED_DIFFICULTY[difficultyFromTier(tier)] || RANKED_DIFFICULTY.easy;
    systemPrompt = `You are a beat battle prompt generator for RUNDATBEAT.

LOOP CONTEXT:
  Title: ${loopTitle || 'untitled'}
  Genre: ${genre}

RULES:
  1. The instruction MUST start with "Make a ${genre} beat that..." and reference the loop's title or mood.
  2. Do NOT mention BPM, key, or technical music theory. Keep it creative and vibe-based.
  3. Title MUST end with "TYPE BEAT".

Return ONLY raw valid JSON with keys: instruction (string), title (string), flavor_text (string). No markdown, no backticks.`;
    userMessage = `Ranked challenge using a ${genre} loop titled "${loopTitle}".`;

  } else if (mode === 'solo') {
    const diff = SOLO_DIFFICULTY[difficulty] || SOLO_DIFFICULTY.medium;
    systemPrompt = `You are a beat-making practice session generator for RUNDATBEAT.

LOOP CONTEXT:
  Title: ${loopTitle || 'untitled'}
  Genre: ${genre}

RULES:
  1. The instruction MUST start with "Make a ${genre} beat that..." and reference the loop's title or vibe.
  2. Do NOT mention BPM, key, or technical music theory. Keep it creative and vibe-based.
  3. Title MUST end with "TYPE BEAT".

Return ONLY raw valid JSON with keys: instruction (string), title (string), flavor_text (string). No markdown, no backticks.`;
    userMessage = `Solo ${diff.label} practice session using a ${genre} loop titled "${loopTitle}" at ${loopBpm}bpm in ${loopKey}. Match difficulty to the level description. Reference the loop's mood in the instruction.`;

  } else {
    const diffLabel = roomDifficultyLabel(playerCount);
    const diff = RANKED_DIFFICULTY[diffLabel] || RANKED_DIFFICULTY.easy;
    systemPrompt = `You are a room battle prompt generator for RUNDATBEAT.

LOOP CONTEXT:
  Title: ${loopTitle || 'untitled'}
  Genre: ${genre}
  BPM: ${loopBpm || 'unknown'}
  Key: ${loopKey || 'unknown'}
  ${bpmHint}
  ${keyHint}

PLAYERS: ${playerCount} — difficulty: ${diffLabel}
Instruction direction: ${diff.instructionStyle}

RULES:
  1. The instruction MUST start with "Make a ${genre} beat that..." and reference the loop's title or mood.
  2. Use BPM and key to make the instruction specific to this loop.
  3. Title MUST end with "TYPE BEAT".

Return ONLY raw valid JSON with keys: instruction (string), title (string), flavor_text (string). No markdown, no backticks.`;
    userMessage = `Room challenge for ${playerCount} players using a ${genre} loop titled "${loopTitle}" at ${loopBpm}bpm in ${loopKey}. Reference the loop's mood.`;
  }

  const { data, error } = await supabase.functions.invoke('groq-proxy', {
    body: { systemPrompt, userMessage, temperature: 0.9 },
  });

  if (error) {
    const msg = error.message || error.msg || 'AI generation failed';
    if (msg.includes('Rate limit')) throw new Error('Too many requests. Wait a moment and try again.');
    throw new Error(msg);
  }

  if (!data?.json) throw new Error("AI generation failed — empty response");

  data.json.restrictions = [pickFromPool()];

  return { json: data.json, raw: data.raw || '' };
}

export function flattenRestrictions(restrictions) {
  if (Array.isArray(restrictions)) {
    return restrictions.map((r) => {
      if (typeof r === 'string') return r;
      if (r && typeof r === 'object') {
        return r.restriction || r.text || r.name || r.description || r.value || '';
      }
      return String(r);
    }).filter(Boolean).join('; ');
  }
  if (typeof restrictions === 'string') return restrictions;
  return '';
}
