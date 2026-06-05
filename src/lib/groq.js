import Groq from "groq-sdk";

const apiKey = import.meta.env.VITE_GROQ_API_KEY;

const groq = new Groq({
  apiKey,
  dangerouslyAllowBrowser: true,
});

export async function generateBattlePrompt({
  genre = "",
  bpm = "",
  mood = "",
  restrictions = "",
  reference_artists = "",
  directive = "",
  mode = "quick",
} = {}) {
  if (!apiKey) {
    throw new Error("Missing VITE_GROQ_API_KEY");
  }

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",

    response_format: {
      type: "json_object",
    },

    messages: [
      {
        role: "system",
        content: `
You are a battle brief generator for RUNDATBEAT, a competitive producer platform for FL Studio beatmakers.

Your job is to generate one randomized, highly specific battle brief per request.

GENRE POOL (pick one at random, weight toward less common ones):
trap, rap, hiphop, edm, jersey club, perc40, tdf, jerk, drill, rage, pluggnb, experimental underground club

BPM RANGES:
- trap/rap/hiphop: 140–160
- drill: 138–145
- jersey club / tdf / jerk: 130–160
- edm: 120–140
- rage / pluggnb: 150–170
- perc40 / experimental: 90–150

RULES:
- title: punchy, max 5 words
- genre: one from the pool above
- bpm: genre-appropriate
- mood: one evocative word or short phrase
- restrictions: 1–2 hard creative limitations
- reference_artists: 3–4 artists with mostly known ones with sounds who can be found easily on yotube
- flavor_text: one atmospheric sentence

Return ONLY valid JSON.

{
  "title": "...",
  "genre": "...",
  "bpm": 140,
  "mood": "...",
  "restrictions": "...",
  "reference_artists": ["...", "...", "..."],
  "flavor_text": "..."
}
        `,
      },
      {
        role: "user",
        content:
          directive ||
          `Generate a ${mode} battle prompt for a ${genre} beat at ${bpm} BPM with a ${mood} mood. Restrictions hint: ${restrictions}. Reference artists: ${reference_artists}.`,
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || "";

  try {
    return {
      json: JSON.parse(raw),
      raw,
    };
  } catch {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      return {
        json: JSON.parse(cleaned),
        raw,
      };
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (match) {
        try {
          return {
            json: JSON.parse(match[0]),
            raw,
          };
        } catch {}
      }

      const error = new Error("Failed to parse Groq response as JSON");
      error.raw = raw;
      throw error;
    }
  }
}