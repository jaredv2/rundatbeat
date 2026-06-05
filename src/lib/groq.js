import Groq from 'groq-sdk';

const key = import.meta.env.VITE_GROQ_API_KEY;

export async function generateBattlePrompt({
  genre = '',
  bpm = '',
  mood = '',
  restrictions = '',
  reference_artists = '',
  directive = '',
  mode = 'quick',
} = {}) {
  if (!key) throw new Error('Missing VITE_GROQ_API_KEY');

  const groq = new Groq({ apiKey: key, dangerouslyAllowBrowser: true });
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content:
          'You are an AI battle director for RUNDATBEAT, a competitive producer beat battle game. Generate one fair, specific battle brief for 4 producers. The battle title must identify the beat type and must end with "TYPE BEAT". Examples: "JERSEY DEMON TYPE BEAT", "DARK TDF TYPE BEAT", "PLUGGNB ICE TYPE BEAT". Favor current beat lanes: trap, rap, hiphop, edm, jersey club, perc40, tdf, jerk, drill, rage, pluggnb, detroit, sample drill, and experimental underground club. Choose a realistic BPM for the lane. Restrictions must be usable in FL Studio and judgeable: drum bounce, sound design, melody range, sample limits, arrangement, mix, or transition constraints. If mode is ranked, make the prompt tighter and more skill-testing while staying fair. Return only a raw JSON object with these exact fields: title (string, max 6 words, uppercase, ending in TYPE BEAT), genre (string), bpm (number), mood (string), restrictions (string, exactly 2 concrete producer directives separated by semicolons), reference_artists (array of 2-3 artist names), flavor_text (string, one sentence that explains the sonic target and energy). No explanation, no markdown, no backticks, raw JSON only.',
      },
      {
        role: 'user',
        content: directive || `Generate a ${mode} battle prompt for a ${genre} beat at ${bpm} BPM with a ${mood} mood. Restrictions hint: ${restrictions}. Reference artists: ${reference_artists}. The title must match the beat type and end with TYPE BEAT.`,
      },
    ],
  });

  const text = completion.choices?.[0]?.message?.content?.trim() || '';
  try {
    return { json: JSON.parse(text), raw: text };
  } catch {
    const error = new Error(`GROQ PARSE ERROR - RAW RESPONSE: ${text}`);
    error.raw = text;
    throw error;
  }
}
