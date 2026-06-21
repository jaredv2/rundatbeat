import { supabase } from './supabase';

export const RESTRICTION_POOL = [
  "The beat must feel empty — max 3 elements total including the sample",
  "No hi-hats — kick and snare only",
  "Sample must be pitched down at least 2 semitones from its original pitch",
  "No snare — only kick and hi-hats",
  "No more than one drum element playing at any time",
  "No reverb on anything — everything must sound dry and close",
  "The beat must be under 60 seconds — short and punchy",
  "No chord pads or sustained synths — single note leads only",
  "Every element must cut out for at least one full bar somewhere in the beat",
  "No samples other than the provided one — all other sounds must be synthesized",
  "The beat must have a full 4 bar intro with no drums — sample only",
  "No more than 2 elements playing simultaneously at any point",
  "Hi-hats must stay on straight 8th notes — no triplets, no rolls",
  "No effects on the sample — use it completely dry, no EQ, no reverb, no compression",
  "The beat must drop to silence for exactly one bar in the middle",
  "Only use percussion from the sample — chop and rearrange the original sounds",
  "The beat must switch up completely halfway through — two distinct sections",
  "No kicks at all — let the snare and hi-hats drive the rhythm",
];

export function pickFromPool() {
  return RESTRICTION_POOL[Math.floor(Math.random() * RESTRICTION_POOL.length)];
}

export function getSoloDurationMinutes(difficulty) {
  return SOLO_DIFFICULTY[difficulty]?.durationMinutes || SOLO_DIFFICULTY.medium.durationMinutes;
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
  trap: `TRAP: Tuned 808 sub-bass with slides and bends, layered with punchy kicks. Crisp compressed snares/claps on the 3rd beat. Rattling hi-hats with 1/16, 1/32, triplet rolls and stutter patterns. Atmospheric, eerie, or cinematic melodies (synths, brass, dark piano). Simple loop-based melody every 4-8 bars. Built for vocalists — leave dynamic space in the mix. Tempo 130-170 BPM half-time feel.`,
  tdf: `TDF: Dreamy, ambient, playful synth loops (video-game-like melodic aesthetic). Distorted/overdriven 808s — sub-bass pushed to extreme, "microwave" levels of distortion. Ambient plugg atmospherics mixed with punchy bounce drum patterns. Playful yet abrasive — airy melodies contrasted with grimy, heavy-hitting low-end. Blend underground plugg textures with modern trap bounce.`,
  drill: `DRILL: Sliding 808 bass — the defining feature. Bass frequently glides between notes creating eerie, distorted, warbly pitch. Off-kilter hi-hats with triplet rolls and dotted-note burst patterns (not straight continuous notes). Syncopated snares — primary snare on the 3rd beat, counter-snare on the 8th beat. Dark minor-key melodies: reverse piano, eerie ambient pads, orchestral stabs. Cold, suspenseful mood. Tempo 130-145 BPM halftime.`,
  'jersey club': `JERSEY CLUB: Fast-paced kick drum pattern — alternating straight and triplet kicks creating propulsive "bounce". Signature "bed squeak" sample. Sliced, fragmented vocal chops looped as percussion. Classic drum break samples. Heavy pulsating 808 sub-bass anchoring rapid rhythm. High energy, bouncy feel. Tempo 130-140 BPM.`,
  hiphop: `HIPHOP: Boom-bap or modern melodic hip-hop drums. Swing or straight grooves. Sample-based or synth melodies. Layered percussion with dynamic arrangement. Creative use of space — not every bar needs to hit hard. Focus on groove, swing, and pocket. Tempo varies widely depending on sub-style.`,
  rage: `RAGE: Heavy distorted synths and leads — abrasive, aggressive tonality. Hard-hitting 808s with distortion. High-energy, in-your-face drums. Loud, abrasive aesthetic — think Playboi Carti / Yeat style. Minimal melodic complexity — raw energy and texture over melody. Aggressive hi-hat patterns. Dark, gritty atmosphere.`,
  hoodtrap: `HOODTRAP: Gritty, raw trap production. Heavy 808s with aggressive patterns. Dark, menacing melodies. Hard-hitting drums with bounce. Blend of street energy with trap elements. Atmospheric but aggressive — moody pads with punchy drums. Focus on rhythm and groove over complex melodies.`,
};

function bpmHints(bpm) {
  const bpmNum = Number(bpm) || 140;
  if (bpmNum <= 100) return 'slow tempo — consider: half-time drums, spaced-out bass, long melodic phrases, ambient FX.';
  if (bpmNum <= 130) return 'mid tempo — consider: standard grooves, swing, layered percussion, dynamic arrangement.';
  if (bpmNum <= 155) return 'fast tempo — consider: double-time hi-hats, rapid rolls, energetic transitions, tight quantization.';
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
  free: {
    label: 'free',
    durationMinutes: 30,
    instructionStyle: '',
  },
  easy: {
    label: 'easy',
    durationMinutes: 45,
    instructionStyle: 'simple creative direction — pick one vibe or mood for the beat.',
  },
  medium: {
    label: 'medium',
    durationMinutes: 30,
    instructionStyle: 'clear creative direction — combine the loop\'s mood with a specific energy or context.',
  },
  hard: {
    label: 'hard',
    durationMinutes: 20,
    instructionStyle: 'detailed creative direction — reference the loop\'s specific character and push the producer\'s skill.',
  },
  expert: {
    label: 'expert',
    durationMinutes: 15,
    instructionStyle: 'demanding creative direction — require structural or arrangement-level thinking, not just sound selection.',
  },
  impossible: {
    label: 'impossible',
    durationMinutes: 10,
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
    systemPrompt = `You are a beat battle prompt generator for SAMPLE BATTLE.

LOOP CONTEXT:
  Title: ${loopTitle || 'untitled'}
  Genre: ${genre}

GENRE PROFILE:
${genreGuide}

RULES:
  1. The instruction MUST start with "Make a ${genre} beat that..." and reference the loop's title or mood.
  2. Do NOT mention BPM, key, or technical music theory. Keep it creative and vibe-based.
  3. The instruction MUST reference genre-specific elements from the GENRE PROFILE above (e.g. hi-hat patterns, 808 style, melodic character) to make the challenge authentic to the genre.
  4. Title MUST end with "TYPE BEAT".

Return ONLY raw valid JSON with keys: instruction (string), title (string), flavor_text (string). No markdown, no backticks.`;
    userMessage = `Ranked challenge using a ${genre} loop titled "${loopTitle}".`;

  } else if (mode === 'solo') {
    const diff = SOLO_DIFFICULTY[difficulty] || SOLO_DIFFICULTY.medium;
    systemPrompt = `You are a beat-making practice session generator for SAMPLE BATTLE.

LOOP CONTEXT:
  Title: ${loopTitle || 'untitled'}
  Genre: ${genre}

GENRE PROFILE:
${genreGuide}

RULES:
  1. The instruction MUST start with "Make a ${genre} beat that..." and reference the loop's title or vibe.
  2. Do NOT mention BPM, key, or technical music theory. Keep it creative and vibe-based.
  3. The instruction MUST reference genre-specific elements from the GENRE PROFILE above to make the challenge authentic to the genre.
  4. Title MUST end with "TYPE BEAT".

Return ONLY raw valid JSON with keys: instruction (string), title (string), flavor_text (string). No markdown, no backticks.`;
    userMessage = `Solo ${diff.label} practice session using a ${genre} loop titled "${loopTitle}" at ${loopBpm}bpm in ${loopKey}. Match difficulty to the level description. Reference the loop's mood in the instruction.`;

  } else {
    const diffLabel = roomDifficultyLabel(playerCount);
    const diff = RANKED_DIFFICULTY[diffLabel] || RANKED_DIFFICULTY.easy;
    systemPrompt = `You are a room battle prompt generator for SAMPLE BATTLE.

LOOP CONTEXT:
  Title: ${loopTitle || 'untitled'}
  Genre: ${genre}
  BPM: ${loopBpm || 'unknown'}
  Key: ${loopKey || 'unknown'}
  ${bpmHint}
  ${keyHint}

GENRE PROFILE:
${genreGuide}

PLAYERS: ${playerCount} — difficulty: ${diffLabel}
Instruction direction: ${diff.instructionStyle}

RULES:
  1. The instruction MUST start with "Make a ${genre} beat that..." and reference the loop's title or mood.
  2. Use BPM and key to make the instruction specific to this loop.
  3. The instruction MUST reference genre-specific elements from the GENRE PROFILE above to make the challenge authentic to the genre.
  4. Title MUST end with "TYPE BEAT".

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
