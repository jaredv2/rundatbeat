import Groq from "groq-sdk";

const apiKey = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";

const groq = new Groq({
  apiKey,
  dangerouslyAllowBrowser: true,
});

const DIFFICULTY_PROMPTS = {
  easy: [
    'DIFFICULTY: EASY',
    '- Use common well-known genres (trap, drill)',
    '- BPM should be in the most comfortable range for the genre',
    '- Restrictions should be simple (e.g. "catchy melody", "heavy 808s")',
    '- Mood should be straightforward (e.g. "bright", "energetic", "dark", "smooth")',
  ],
  medium: [
    'DIFFICULTY: MEDIUM',
    '- Mix of common and less common genres',
    '- BPM can be slightly outside the standard range',
    '- Restrictions should be simple but slightly more creative (e.g. "switch the melody in the second half", "build tension through the intro")',
    '- Mood can be more abstract but grounded',
  ],
  hard: [
    'DIFFICULTY: HARD',
    '- Favor less common genres (jersey club, jerk)',
    '- BPM should push the edge of the genre range or use an unusual tempo',
    '- Restrictions should be more challenging (e.g. "tropical energy", "vocal chop as the main hook")',
    '- Mood should be unconventional — explore weird, upbeat, chaotic, or euphoric',
  ],
  very_hard: [
    'DIFFICULTY: VERY HARD',
    '- Pick the most challenging genre from the pool',
    '- BPM should be extreme for the genre or use an odd implied tempo',
    '- Restrictions should be creative but still executable (e.g. "blend trap with jazz elements", "complete mood change at the midpoint")',
    '- Mood must be extreme — avant-garde, euphoric, chaotic, or unsettling',
  ],
};

const FLAVOR_EXAMPLES = [
  '"Make a beat with bright synths and a bouncy groove."',
  '"Make a beat that feels like a night drive through the city."',
  '"Make a beat with chaotic energy and an unexpected drop."',
].join(', ');

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
} = {}) {
  if (!apiKey) {
    throw new Error("Missing VITE_GROQ_API_KEY");
  }

  const difficultyLines = DIFFICULTY_PROMPTS[difficulty] || DIFFICULTY_PROMPTS.medium;
  const avoidGenres = recentGenres.length
    ? `\nAVOID these recently used genres: ${recentGenres.join(', ')}. Pick something different.`
    : '';

  const temperature = difficulty === 'very_hard' ? 1.1 : 0.9;

  const systemContent = `
You are a battle brief generator for RUNDATBEAT, a competitive producer platform for FL Studio beatmakers.

Your job is to generate one randomized, highly specific battle brief per request.

GENRE POOL (pick one at random):
trap, jersey club, jerk, drill

BPM RANGES:
- trap: 140–160
- drill: 138–145
- jersey club: 130–150
- jerk: 140–160

RULES:
- title: punchy, max 5 words, must end with TYPE BEAT
- genre: one from the pool above
- bpm: genre-appropriate number
- mood: one evocative word or short phrase. IMPORTANT: vary moods widely — mix dark, uplifting, bright, energetic, ethereal, fun, melancholic, chaotic. Never default to the same mood twice in a row.
- restrictions: exactly 1 simple audible limitation voters can hear. NOT production rules (drum kit, instruments, samples).
- reference_keywords: ALWAYS include exactly 1 YouTube search keyword phrase (NOT an artist name) that describes the target sound, e.g. "hard 808 drill beat". This field is REQUIRED — never omit it.
- flavor_text: write a short simple sentence starting with "Make a beat" describing the vibe in plain words. Keep it short. Examples: ${FLAVOR_EXAMPLES}
${difficultyLines.map(l => `- ${l}`).join('\n')}${avoidGenres}

Return ONLY valid JSON. No markdown, no explanation, no backticks.

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

  // difficulty is always in systemContent regardless of directive
  const userMessage = directive
    || `Generate a ${mode} battle prompt for a ${genre} beat at ${bpm} BPM with a ${mood} mood. Restrictions hint: ${restrictions}. Reference artists: ${reference_artists}.`;

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

export function difficultyFromTier(tier) {
  const order = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'goat'];
  const idx = order.indexOf(tier?.toLowerCase() || 'bronze');
  if (idx <= 1) return 'easy';
  if (idx <= 3) return 'medium';
  if (idx <= 5) return 'hard';
  return 'very_hard';
}