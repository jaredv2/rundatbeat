import Groq from "groq-sdk";

const apiKey = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";

const groq = new Groq({
  apiKey,
  dangerouslyAllowBrowser: true,
});

// ─────────────────────────────────────────────
// GENRE KNOWLEDGE
// ─────────────────────────────────────────────

const GENRE_KNOWLEDGE = {
  trap: {
    energy: "dark, heavy, cinematic, street, menacing",
    elements: "rolling hi-hats, hard 808s, deep sub bass, melodic leads, piano or strings, sparse percussion",
    mood_pool: ["cold", "aggressive", "haunting", "midnight", "raw", "hungry", "menacing", "empty", "ruthless", "paranoid"],
    restriction_pool: [
      "melody must loop every 2 bars",
      "no snare — claps only",
      "808 must carry the melody",
      "keep it minimal — less than 4 elements",
      "hi-hats must be rolling triplets",
      "no chord pads — single note leads only",
    ],
    bpm_range: [130, 160],
    bad_combos: ["upbeat", "tropical", "bouncy", "euphoric", "playful", "fun", "bright", "happy"],
  },
  drill: {
    energy: "cold, dark, sliding, grimy, calculated, UK or Chicago street energy",
    elements: "sliding 808s, off-beat hi-hats, dark piano or strings, minimal sparse melody, sharp snares",
    mood_pool: ["cold", "grimy", "ruthless", "icy", "tense", "bleak", "hollow", "calculated", "numb", "street"],
    restriction_pool: [
      "808 must slide on every hit",
      "hi-hats must be triplet pattern",
      "melody under 3 notes",
      "no pad — lead melody only",
      "drums must stay minimal — no fills",
      "bass must stay below the melody at all times",
    ],
    bpm_range: [138, 145],
    bad_combos: ["bright", "happy", "tropical", "euphoric", "fun", "bouncy", "playful", "uplifting"],
  },
  jersey_club: {
    energy: "high energy, fast, bouncy, dancefloor, chopped vocals, relentless rhythm",
    elements: "chopped vocal samples, fast kicks, shuffled hi-hats, stab chords, club kick patterns, pitched vocal chops",
    mood_pool: ["hype", "energetic", "wild", "chaotic", "fun", "dancefloor", "frantic", "electric", "unstoppable", "loud"],
    restriction_pool: [
      "vocal chop must drive the melody",
      "kick pattern must stay on club rhythm",
      "keep the drop sudden and immediate",
      "no sustained pads — stabs only",
      "every 4 bars must have a vocal hit",
      "melody must be built from chopped samples only",
    ],
    bpm_range: [130, 150],
    bad_combos: ["dark", "cold", "melancholic", "icy", "aggressive", "bleak", "haunting", "hollow"],
  },
  jerk: {
    energy: "bouncy, west coast, rhythmic, melodic, fun, youthful, confident",
    elements: "bouncy synth bass, bright melodic leads, clap-heavy percussion, chord stabs, playful rhythm",
    mood_pool: ["bouncy", "playful", "bright", "fun", "energetic", "confident", "carefree", "smooth", "vibrant", "youthful"],
    restriction_pool: [
      "clap on every beat",
      "melody must be bright and simple — under 5 notes",
      "bass must bounce with the kick",
      "no dark elements — keep it light",
      "chord stabs must land on the offbeat",
      "drum pattern must feel like it wants to make you move",
    ],
    bpm_range: [140, 160],
    bad_combos: ["dark", "cold", "icy", "melancholic", "haunting", "bleak", "grimy", "aggressive"],
  },
};

// ─────────────────────────────────────────────
// DIFFICULTY PROMPTS
// ─────────────────────────────────────────────

const DIFFICULTY_PROMPTS = {
  easy: [
    'DIFFICULTY: EASY',
    '- Use trap or drill — the most familiar genres',
    '- BPM must stay in the comfortable center of the genre range',
    '- Pick a restriction from the genre restriction_pool exactly as written',
    '- Mood must come from the genre mood_pool — nothing abstract',
  ],
  medium: [
    'DIFFICULTY: MEDIUM',
    '- Any genre from the pool is valid',
    '- BPM can sit near the edge of the genre range',
    '- Restriction can be slightly adapted from the restriction_pool',
    '- Mood can be abstract but must still match the genre energy',
  ],
  hard: [
    'DIFFICULTY: HARD',
    '- Prefer jersey club or jerk — less familiar genres',
    '- BPM must push the edge of the genre range',
    '- Restriction should combine two ideas from the restriction_pool creatively',
    '- Mood should be unconventional but still within the genre energy',
  ],
  very_hard: [
    'DIFFICULTY: VERY HARD',
    '- Pick the genre that is hardest to execute correctly',
    '- BPM must be at the extreme edge of the genre range',
    '- Restriction must be the most challenging from the restriction_pool',
    '- Mood must be extreme and unconventional — push the genre to its limit',
  ],
};

// ─────────────────────────────────────────────
// FLAVOR EXAMPLES
// ─────────────────────────────────────────────

const FLAVOR_EXAMPLES = [
  '"Make a beat with bright synths and a bouncy groove."',
  '"Make a beat that feels like a night drive through an empty city."',
  '"Make a beat with chaotic energy and a drop that hits out of nowhere."',
  '"Make a beat that sounds cold and calculated like you already won."',
  '"Make a beat that feels like the last song before the club closes."',
].join(', ');

// ─────────────────────────────────────────────
// BUILD GENRE KNOWLEDGE BLOCK
// ─────────────────────────────────────────────

function buildGenreBlock(recentGenres = []) {
  const avoidNote = recentGenres.length
    ? `\nAVOID these recently used genres: ${recentGenres.join(', ')}. Pick a different one.\n`
    : '';

  const block = Object.entries(GENRE_KNOWLEDGE)
    .map(([genre, data]) => `
${genre.toUpperCase()}
  Energy: ${data.energy}
  Key elements: ${data.elements}
  Good moods: ${data.mood_pool.join(', ')}
  Good restrictions: ${data.restriction_pool.join(' | ')}
  BPM range: ${data.bpm_range[0]}–${data.bpm_range[1]}
  NEVER pair with these moods: ${data.bad_combos.join(', ')}
    `.trim()).join('\n\n');

  return `${avoidNote}${block}`;
}

// ─────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────

export async function generateBattlePrompt({
  genre = "",
  bpm = "genre-appropriate",
  mood = "",
  restrictions = "",
  reference_artists = "",
  directive = "",
  mode = "quick",
  recentGenres = [],
  difficulty = "medium",
  practice = false,
} = {}) {
  if (!apiKey) throw new Error("Missing VITE_GROQ_API_KEY");

  const difficultyLines = DIFFICULTY_PROMPTS[difficulty] || DIFFICULTY_PROMPTS.medium;
  const temperature = difficulty === 'very_hard' ? 1.1 : 0.9;
  const practiceNote = practice
    ? '\nPRACTICE MODE: This is a solo training prompt. Keep restrictions clear and educational. Avoid extreme combinations.'
    : '';

  const systemContent = `
You are a battle brief generator for RUNDATBEAT, a competitive FL Studio producer platform.

Your job: generate one highly specific, musically coherent battle brief per request.

━━━ GENRE KNOWLEDGE ━━━
Use the genre knowledge below to generate accurate, genre-appropriate combinations.
Mood and restrictions MUST match the genre energy. Never cross into a genre's bad_combos list.
Always pick mood from the genre's mood_pool. Always pick restrictions from or inspired by the genre's restriction_pool.

${buildGenreBlock(recentGenres)}

━━━ OUTPUT RULES ━━━
- title: punchy, max 5 words, must end with TYPE BEAT
- genre: one genre from the pool above
- bpm: a single number within the genre's BPM range
- mood: one word or short phrase — MUST come from the genre's mood_pool. Never use a bad_combo mood for the chosen genre.
- restrictions: exactly 1 audible limitation a voter can hear in the final beat. Must come from or be inspired by the genre's restriction_pool. NOT a production rule about what software or samples to use.
- reference_keywords: exactly 1 YouTube search phrase ending in "type beat" describing the target sound. Examples: "hard drill type beat", "jersey club type beat", "dark trap type beat". NEVER omit this field. NEVER use an artist name.
- flavor_text: one short sentence starting with "Make a beat" describing the vibe plainly. Vary it — do not repeat. Examples: ${FLAVOR_EXAMPLES}
${difficultyLines.map(l => `- ${l}`).join('\n')}${practiceNote}

━━━ IMPORTANT ━━━
- Never combine a genre with a mood from its bad_combos list — this is a hard rule
- Restrictions must be something a listener can actually hear — not "use a specific drum kit"
- Vary output every time — no two briefs should feel the same
- Return ONLY valid raw JSON. No markdown, no explanation, no backticks.

{
  "title": "...",
  "genre": "...",
  "bpm": 140,
  "mood": "...",
  "restrictions": "...",
  "reference_keywords": ["..."],
  "flavor_text": "..."
}
  `.trim();

  // difficulty is always injected via systemContent — directive only overrides the user message
  const userMessage = directive
    || `Generate a ${mode} battle prompt for a ${genre || 'random genre'} beat at ${bpm} BPM with a ${mood || 'genre-appropriate'} mood. Restrictions hint: ${restrictions || 'pick from genre pool'}. Reference artists: ${reference_artists || 'none'}.`;

  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: userMessage },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || "";

  function normalizeJson(json) {
    // enforce reference_keywords always exists
    if (
      !json.reference_keywords ||
      !Array.isArray(json.reference_keywords) ||
      json.reference_keywords.length === 0
    ) {
      json.reference_keywords = [
        json.title
          ? `${json.genre || 'trap'} ${json.title}`
              .toLowerCase()
              .replace(/\s+/g, ' ')
              .replace(/type beat.*$/i, '')
              .trim() + ' type beat'
          : `${json.genre || 'trap'} type beat`,
      ];
    }

    // enforce mood never lands in bad_combos for the genre
    const genreData = GENRE_KNOWLEDGE[json.genre?.toLowerCase()];
    if (genreData && json.mood) {
      const moodLower = json.mood.toLowerCase();
      const isBadCombo = genreData.bad_combos.some(bad => moodLower.includes(bad));
      if (isBadCombo) {
        // replace with a safe mood from the pool
        json.mood = genreData.mood_pool[Math.floor(Math.random() * genreData.mood_pool.length)];
      }
    }

    return json;
  }

  try {
    return { json: normalizeJson(JSON.parse(raw)), raw };
  } catch {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    try {
      return { json: normalizeJson(JSON.parse(cleaned)), raw };
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return { json: normalizeJson(JSON.parse(match[0])), raw };
        } catch {}
      }
      const error = new Error("Failed to parse Groq response as JSON");
      error.raw = raw;
      throw error;
    }
  }
}

// ─────────────────────────────────────────────
// TIER → DIFFICULTY MAPPER
// ─────────────────────────────────────────────

export function difficultyFromTier(tier) {
  const order = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'goat'];
  const idx = order.indexOf(tier?.toLowerCase() || 'bronze');
  if (idx <= 1) return 'easy';
  if (idx <= 3) return 'medium';
  if (idx <= 5) return 'hard';
  return 'very_hard';
}

// ─────────────────────────────────────────────
// EXPORT GENRE DATA (for use in UI if needed)
// ─────────────────────────────────────────────

export { GENRE_KNOWLEDGE };