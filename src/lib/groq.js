import Groq from "groq-sdk";

const apiKey = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";

const groq = new Groq({
  apiKey,
  dangerouslyAllowBrowser: true,
});

export function difficultyFromTier(tier) {
  const order = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'goat'];
  const idx = order.indexOf(tier?.toLowerCase() || 'bronze');
  if (idx <= 1) return 'easy';
  if (idx <= 3) return 'medium';
  if (idx <= 5) return 'hard';
  return 'very_hard';
}

const SOLO_DIFFICULTY_PROMPTS = {
  easy: 'Generate 1 simple instruction and 2 simple restrictions. Keep them basic — hi-hat pattern changes, simple 808 slides, snare placements. Must be detectable just by listening.',
  medium: 'Generate 1 instruction and 2 restrictions. Mix drum variations, bass slides, arrangement tweaks. Nothing complex — just clearly hearable constraints.',
  hard: 'Generate 1 instruction and 2 restrictions. Slightly tighter constraints like specific drum fills, filter sweeps, or call-and-response sections. Must be hearable in the final track.',
  expert: 'Generate 1 instruction and 2 restrictions. More specific: polyrhythmic accents, precise FX automation, dynamic contrasts. Still audibly verifiable — no theoretical rules.',
  impossible: 'Generate 1 instruction and 2 restrictions. Creative but extreme: unusual accent patterns, extreme dynamics, layered rhythmic shifts. Must still be detectable by ear alone.',
};

export async function generateBattlePrompt({
  genre = '',
  mode = 'ranked',
  tier = 'bronze',
  difficulty = 'medium',
  loopTitle = '',
  loopBpm = '',
  loopKey = '',
} = {}) {
  if (!apiKey) throw new Error("Missing VITE_GROQ_API_KEY");

  let systemPrompt;
  let userMessage;

  if (mode === 'ranked') {
    const diffLabel = difficultyFromTier(tier);
    systemPrompt = `You are a battle prompt generator for RUNDATBEAT. Generate a beat battle challenge.

The challenge is based on this loop:
Title: ${loopTitle}
BPM: ${loopBpm}
Key: ${loopKey}
Genre: ${genre}

Generate 1 instruction and 2 restrictions for ${diffLabel} difficulty (tier: ${tier}).
Instruction = creative direction. Restrictions = simple audio constraints that are detectable just by listening. Nothing visual or theoretical — just drum patterns, bass slides, FX placement, arrangement rules you can hear in the track.

Generate a title ending with TYPE BEAT.
Generate a short flavor text / mood description.

Return ONLY raw valid JSON with keys: instruction (string), restrictions (array of 2 strings), title (string), flavor_text (string). No markdown, no backticks.`;
    userMessage = `Create a ranked battle challenge for tier ${tier} using a ${genre} loop. Include 1 instruction and 2 restrictions for ${diffLabel} difficulty. Restrictions must be simple and hearable — drum patterns, bass slides, FX, arrangement choices.`;
  } else if (mode === 'solo') {
    const directive = SOLO_DIFFICULTY_PROMPTS[difficulty] || SOLO_DIFFICULTY_PROMPTS.medium;
    systemPrompt = `You are a practice session generator for RUNDATBEAT. 

Given a ${genre} loop, generate challenges for a producer to practice with.

${directive}

Generate a title ending with TYPE BEAT.
Generate a short flavor text.

Return ONLY raw valid JSON with keys: instruction (string), restrictions (array of 2 strings), title (string), flavor_text (string). No markdown, no backticks.`;
    userMessage = `Create a solo practice session for ${genre}. Include 1 instruction and 2 restrictions at ${difficulty} difficulty and a title ending with TYPE BEAT. Restrictions must be simple and hearable — drum patterns, bass slides, FX, arrangement choices.`;
  } else {
    systemPrompt = `You are a battle prompt generator for RUNDATBEAT. 

Given a ${genre} loop, generate a room battle challenge.

Generate 1 instruction and 2 restrictions. Restrictions must be simple audio constraints detectable just by listening — drum patterns, bass slides, FX placement, arrangement rules.
Generate a title that ends with TYPE BEAT.
Generate a short flavor text.

Return ONLY raw valid JSON with keys: instruction (string), restrictions (array of 2 strings), title (string), flavor_text (string). No markdown, no backticks.`;
    userMessage = `Create a room battle challenge for genre ${genre}. Include 1 instruction and 2 restrictions. Keep restrictions simple and hearable — drum patterns, bass slides, FX, arrangement choices.`;
  }

  const completion = await groq.chat.completions.create({
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
