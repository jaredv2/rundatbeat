const apiKey = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";

let _groq = null;
function getGroq() {
  if (!_groq) {
    // Lazy-load groq-sdk (only imported when AI generation is actually needed)
    return import("groq-sdk").then(({ default: Groq }) => {
      _groq = new Groq({ apiKey, dangerouslyAllowBrowser: true });
      return _groq;
    });
  }
  return Promise.resolve(_groq);
}

export function difficultyFromTier(tier) {
  const order = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'goat'];
  const idx = order.indexOf(tier?.toLowerCase() || 'bronze');
  if (idx <= 1) return 'easy';
  if (idx <= 3) return 'medium';
  if (idx <= 5) return 'hard';
  return 'very_hard';
}

// ── Genre-specific restriction cheat sheet ──────────────────────────────
// Gives the AI concrete examples per genre so restrictions feel genre-aware.
const GENRE_RESTRICTION_GUIDE = {
  trap: '808 slides/glides, hi-hat rolls (triplets, 1/32), snare/clap patterns, open hat placement, melody loops, dark/bright FX.',
  hiphop: 'boom-bap swing, kick/snare interplay, sample chops, scratch FX, vinyl crackle, lo-fi texture.',
  'uk-drill': '808 slides, skip hi-hats, dark piano/guitar, percussive FX, triplets, reverse elements.',
  edm: 'build-ups, drops, filter sweeps, sidechain compression, white noise risers, vocal chops.',
  rap: '808 patterns, hi-hat variation, ad-libs, synth leads, arrangement switch-ups.',
  house: 'four-on-the-floor kick, hi-hat open/close, claps, synth stabs, filter modulation.',
};

// ── BPM-based restriction hints ─────────────────────────────────────────
function bpmHints(bpm) {
  const bpmNum = Number(bpm) || 140;
  if (bpmNum <= 100) return 'slow tempo — consider: half-time drums, spaced-out bass, long melodic phrases, ambient FX.';
  if (bpmNum <= 130) return 'mid tempo — consider: standard grooves, swing, layered percussion, dynamic arrangement.';
  if (bpmNum <= 155) return 'fast tempo — consider: double-time hi-hats, rapid 808s, energetic transitions, tight quantization.';
  return 'very fast tempo — consider: rapid-fire hats, intense rhythms, aggressive energy, tight fills.';
}

// ── Key-based restriction hints ─────────────────────────────────────────
function keyHints(key) {
  if (!key) return '';
  const lower = key.toLowerCase();
  if (lower.includes(' minor') || lower.endsWith('m') || lower.match(/^[a-g]m$/)) return 'minor key — consider: dark, moody, emotional atmosphere.';
  if (lower.includes(' major') || lower.match(/^[a-g]$/)) return 'major key — consider: bright, uplifting, melodic energy.';
  return '';
}

// ── Solo difficulty definitions ─────────────────────────────────────────
// Each level is structurally different — not just "more restrictions".
const SOLO_DIFFICULTY = {
  easy: {
    label: 'easy',
    instructionStyle: 'simple creative direction — pick one vibe or mood for the beat.',
    restrictions: '1 basic restriction. A single, obvious thing to do (e.g. "use a snare on beats 2 and 4"). No creative judgment required.',
    examples: 'e.g. "Make a trap beat that goes hard in the club" | Restriction: "Add an open hat on the off-beats"',
  },
  medium: {
    label: 'medium',
    instructionStyle: 'clear creative direction — combine the loop\'s mood with a specific energy or context.',
    restrictions: '1 restriction that requires creative choice — pick a specific pattern, sound, or technique. Not just "use X" but "use X in a specific way".',
    examples: 'e.g. "Make a hip-hop beat that captures a late-night drive vibe" | Restriction: "Add a triplet hi-hat pattern in the hook"',
  },
  hard: {
    label: 'hard',
    instructionStyle: 'detailed creative direction — reference the loop\'s specific character and push the producer\'s skill.',
    restrictions: '1 restriction that demands technical execution — specific rhythm, transition, or effect. Must be deliberately placed, not random.',
    examples: 'e.g. "Make a drill beat that switches between aggressive and calm energy" | Restriction: "Create a half-time switch at the 16-bar mark using snare and 808 drop"',
  },
  expert: {
    label: 'expert',
    instructionStyle: 'demanding creative direction — require structural or arrangement-level thinking, not just sound selection.',
    restrictions: '1 restriction that involves arrangement, dynamics, or interlocking parts. Producer must plan ahead, not just layer.',
    examples: 'e.g. "Make an EDM build that evolves across 3 distinct sections" | Restriction: "Use a sidechain pump that increases intensity across 8 bars, peaking at the drop"',
  },
  impossible: {
    label: 'impossible',
    instructionStyle: 'extreme creative direction — require multiple simultaneous constraints and creative problem-solving.',
    restrictions: '1 restriction that combines multiple elements or requires unconventional approaches. Still audibly verifiable but very challenging.',
    examples: 'e.g. "Make a house track that fuses 3 different sub-genres" | Restriction: "Layer a four-on-the-floor kick with a syncopated breakbeat, keeping both audible throughout"',
  },
};

// ── Difficulty tiers for ranked mode ────────────────────────────────────
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

// ── Room difficulty based on player count ───────────────────────────────
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
  if (!apiKey) throw new Error("Missing VITE_GROQ_API_KEY");

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
  5. Title MUST end with "TYPE BEAT".

Return ONLY raw valid JSON with keys: instruction (string), restrictions (array of 1 string), title (string), flavor_text (string). No markdown, no backticks.`;
    userMessage = `Solo ${diff.label} practice session using a ${genre} loop titled "${loopTitle}" at ${loopBpm}bpm in ${loopKey}. Match difficulty to the level description. Reference the loop's mood in the instruction. Generate 1 restriction.`;

  } else {
    // Room mode — difficulty scales with player count
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

  const client = await getGroq();
  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0.9,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || "";
  const tryParse = str => { try { return JSON.parse(str); } catch { return null; } };

  const parsed =
    tryParse(raw) ||
    tryParse(raw.replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/\s*```$/i,"").trim()) ||
    (() => { const m = raw.match(/\{[\s\S]*\}/); return m ? tryParse(m[0]) : null; })();

  if (!parsed) {
    const error = new Error("Failed to parse Groq response as JSON");
    error.raw = raw;
    throw error;
  }

  return { json: parsed, raw };
}

// Normalize restrictions from AI response into a semicolon-joined string.
// Handles both array-of-strings, array-of-objects, and plain string formats.
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
