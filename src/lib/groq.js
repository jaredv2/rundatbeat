import Groq from "groq-sdk";

const apiKey = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";

const groq = new Groq({
  apiKey,
  dangerouslyAllowBrowser: true,
});

// ─────────────────────────────────────────────
// DIFFICULTY → GENRE MAPPING
// ─────────────────────────────────────────────

export const DIFFICULTY_GENRES = {
  easy: 'trap',
  medium: 'drill',
  hard: 'jersey_club',
  very_hard: 'jerk',
};

// ─────────────────────────────────────────────
// GENRE KNOWLEDGE
// ─────────────────────────────────────────────

const GENRE_KNOWLEDGE = {
  trap: {
    energy: "dark, heavy, cinematic, street",
    bpm_range: [130, 160],
    mandatory_elements: ['dark melodic atmosphere', 'heavy 808 presence'],
    flavor_pool: [
      "Make this knock like it's coming out of a car.",
      "Make this feel cold and empty.",
      "Make this hit hard with space between every element.",
      "Make this feel cinematic and heavy.",
    ],
  },
  drill: {
    energy: "cold, sliding, off-beat, grimy",
    bpm_range: [138, 145],
    mandatory_elements: ['sliding 808 bass', 'off-grid percussion'],
    flavor_pool: [
      "Make this sound calculated and cold.",
      "Make this feel like it was made at 3am.",
      "Make every hit feel delayed on purpose.",
      "Make this slide and knock at the same time.",
    ],
  },
  jersey_club: {
    energy: "fast, bouncy, dancefloor, relentless",
    bpm_range: [130, 150],
    mandatory_elements: ['club kick pattern', 'bounce section'],
    flavor_pool: [
      "Make this feel like the last song before the club closes.",
      "Make every element fight for space.",
      "Make this unstoppable from the first beat.",
      "Make this feel like controlled chaos.",
    ],
  },
  jerk: {
    energy: "bouncy, west coast, rhythmic, youthful",
    bpm_range: [140, 160],
    mandatory_elements: ['syncopated bounce rhythm', 'bright melodic lead'],
    flavor_pool: [
      "Make this feel like you can't stand still.",
      "Make this bounce from the first hit.",
      "Make every element lock together like a puzzle.",
      "Make this feel youthful and confident.",
    ],
  },
};

const DIFFICULTY_PROMPTS = {
  easy: ["EASY — accessible, straightforward, beginner-friendly challenge"],
  medium: ["MEDIUM — some technical demand, moderate complexity"],
  hard: ["HARD — technically demanding, complex arrangement required"],
  very_hard: ["VERY HARD — maximum complexity, expert-level challenge"],
};

// ─────────────────────────────────────────────
// NORMALIZATION
// ─────────────────────────────────────────────

function normalizeOutput(json) {
  const genre = json.genre?.toLowerCase();
  const genreData = GENRE_KNOWLEDGE[genre];

  if (genreData) {
    const [min, max] = genreData.bpm_range;
    if (!json.bpm || json.bpm < min || json.bpm > max) {
      json.bpm = Math.floor((min + max) / 2);
    }
  }

  if (!json.flavor_text && genreData) {
    const pool = genreData.flavor_pool;
    json.flavor_text = pool[Math.floor(Math.random() * pool.length)];
  }

  if (!Array.isArray(json.reference_keywords) || !json.reference_keywords.length) {
    json.reference_keywords = [`${genre || 'trap'} type beat`];
  }

  return json;
}

function buildSystemPrompt({ difficulty, recentGenres, practice }) {
  const difficultyLines = DIFFICULTY_PROMPTS[difficulty] || DIFFICULTY_PROMPTS.medium;
  const avoidNote = recentGenres.length
    ? `AVOID recently used genres: ${recentGenres.join(', ')}.\n` : '';
  const practiceNote = practice
    ? 'PRACTICE MODE: Keep the challenge accessible and creative.\n' : '';

  const genreBlock = Object.entries(GENRE_KNOWLEDGE).map(([genre, data]) => `
${genre.toUpperCase()} — ${data.energy}
BPM: ${data.bpm_range[0]}–${data.bpm_range[1]}
  `.trim()).join('\n\n');

  return `
You are a battle prompt generator for RUNDATBEAT, a competitive music production platform.
Generate a creative beat battle prompt that inspires producers to make something great.

━━━ GENRE KNOWLEDGE ━━━
${genreBlock}

━━━ DIFFICULTY ━━━
${difficultyLines.join('\n')}

━━━ OUTPUT FORMAT ━━━
${avoidNote}${practiceNote}
Return ONLY raw valid JSON. No markdown, no backticks, no explanation.

{
  "title": "DARK ALLEY TYPE BEAT",
  "genre": "trap",
  "bpm": 140,
  "mood": "dark and cinematic",
  "flavor_text": "Make this feel like you're walking through a dark alley at 3am.",
  "reference_keywords": ["dark trap type beat", "cinematic beat"]
}
  `.trim();
}

export async function generateBattlePrompt({
  genre = "",
  bpm = "genre-appropriate",
  mood = "",
  recentGenres = [],
  difficulty = "medium",
  practice = false,
  directive = "",
  mode = "quick",
} = {}) {
  if (!apiKey) throw new Error("Missing VITE_GROQ_API_KEY");

  const temperature = difficulty === 'very_hard' ? 1.1 : 0.9;
  const systemContent = buildSystemPrompt({ difficulty, recentGenres, practice });
  const userMessage = directive
    || `Generate a ${difficulty} difficulty ${genre || 'random genre'} battle prompt.${mood ? ` Mood: ${mood}.` : ''}`;

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

  return { json: normalizeOutput(parsed), raw };
}

export function difficultyFromTier(tier) {
  const order = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'goat'];
  const idx = order.indexOf(tier?.toLowerCase() || 'bronze');
  if (idx <= 1) return 'easy';
  if (idx <= 3) return 'medium';
  if (idx <= 5) return 'hard';
  return 'very_hard';
}

export { GENRE_KNOWLEDGE };