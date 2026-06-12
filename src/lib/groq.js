import { supabase } from './supabase';

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
  hiphop: 'boom-bap swing, kick/snare interplay, sample chops, scratch FX, vinyl crackle, lo-fi texture.',
  edm: 'sidechain pumping, risers/downlifters, build-ups, drops, filter sweeps, layered synths, four-on-the-floor kick patterns.',
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
    restrictions: '1 basic restriction. A single, obvious thing to do (e.g. "use a snare on beats 2 and 4"). No creative judgment required.',
  },
  medium: {
    label: 'medium',
    instructionStyle: 'clear creative direction — combine the loop\'s mood with a specific energy or context.',
    restrictions: '1 restriction that requires creative choice — pick a specific pattern, sound, or technique. Not just "use X" but "use X in a specific way".',
  },
  hard: {
    label: 'hard',
    instructionStyle: 'detailed creative direction — reference the loop\'s specific character and push the producer\'s skill.',
    restrictions: '1 restriction that demands technical execution — specific rhythm, transition, or effect. Must be deliberately placed, not random.',
  },
  expert: {
    label: 'expert',
    instructionStyle: 'demanding creative direction — require structural or arrangement-level thinking, not just sound selection.',
    restrictions: '1 restriction that involves arrangement, dynamics, or interlocking parts. Producer must plan ahead, not just layer.',
  },
  impossible: {
    label: 'impossible',
    instructionStyle: 'extreme creative direction — require multiple simultaneous constraints and creative problem-solving.',
    restrictions: '1 restriction that combines multiple elements or requires unconventional approaches. Still audibly verifiable but very challenging.',
  },
};

const RANKED_DIFFICULTY = {
  easy: {
    instructionStyle: 'straightforward creative direction — match the loop\'s mood with a clear context.',
    restrictions: '1 simple restriction. One obvious drum/bass choice or arrangement/FX choice. Producers at this tier should feel comfortable.',
  },
  medium: {
    instructionStyle: 'solid creative direction — push beyond basic, require some intentionality.',
    restrictions: '1 restriction that requires a deliberate pattern choice — not random layering. Requires timing or placement.',
  },
  hard: {
    instructionStyle: 'ambitious creative direction — demand technical control and musical decision-making.',
    restrictions: '1 restriction that involves a specific technique — transition, automation, or rhythmic variation. Must sound intentional.',
  },
  very_hard: {
    instructionStyle: 'advanced creative direction — require arrangement-level thinking and multi-part coordination.',
    restrictions: '1 complex restriction — involves dynamics, automation, or interlocking parts. Still audibly verifiable.',
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
  2. Generate exactly 1 restriction — a short, hearable audio constraint. One sentence. No complex rules.
  3. Do NOT mention BPM, key, or technical music theory. Keep it creative and vibe-based.
  4. Title MUST end with "TYPE BEAT".

Return ONLY raw valid JSON with keys: instruction (string), restrictions (array of 1 string), title (string), flavor_text (string). No markdown, no backticks.`;
    userMessage = `Ranked challenge using a ${genre} loop titled "${loopTitle}". Make 1 creative, hearable restriction.`;

  } else if (mode === 'solo') {
    const diff = SOLO_DIFFICULTY[difficulty] || SOLO_DIFFICULTY.medium;
    systemPrompt = `You are a beat-making practice session generator for RUNDATBEAT.

LOOP CONTEXT:
  Title: ${loopTitle || 'untitled'}
  Genre: ${genre}

RULES:
  1. The instruction MUST start with "Make a ${genre} beat that..." and reference the loop's title or vibe.
  2. Generate exactly 1 restriction — a short, hearable audio constraint. One sentence. No complex rules.
  3. Do NOT mention BPM, key, or technical music theory. Keep it creative and vibe-based.
  4. Title MUST end with "TYPE BEAT".

Return ONLY raw valid JSON with keys: instruction (string), restrictions (array of 1 string), title (string), flavor_text (string). No markdown, no backticks.`;
    userMessage = `Solo ${diff.label} practice session using a ${genre} loop titled "${loopTitle}" at ${loopBpm}bpm in ${loopKey}. Match difficulty to the level description. Reference the loop's mood in the instruction. Generate 1 restriction.`;

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
Restrictions direction: ${diff.restrictions}

GENRE REFERENCE — pull restriction ideas from this:
  ${genreGuide}

RULES:
  1. The instruction MUST start with "Make a ${genre} beat that..." and reference the loop's title or mood.
  2. Generate exactly 1 restriction — a short, hearable audio constraint scaled to the player count.
  3. Fewer players = easier restriction. More players = tighter, more demanding constraint.
  4. Use BPM and key to make the restriction specific to this loop.
  5. Title MUST end with "TYPE BEAT".

Return ONLY raw valid JSON with keys: instruction (string), restrictions (array of 1 string), title (string), flavor_text (string). No markdown, no backticks.`;
    userMessage = `Room challenge for ${playerCount} players using a ${genre} loop titled "${loopTitle}" at ${loopBpm}bpm in ${loopKey}. Scale the restriction to the player count. Reference the loop's mood. Generate 1 restriction.`;
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
