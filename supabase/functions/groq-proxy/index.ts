import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const GROQ_MODEL = "llama-3.3-70b-versatile";
const RATE_LIMIT_PER_MINUTE = 5;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!GROQ_API_KEY) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Authenticate caller
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Rate limit: max N requests per minute per user using in-memory store
  const now = Date.now();
  const windowMs = 60_000;

  // Use Deno KV for simple rate limiting
  const kv = await Deno.openKv();
  const rateKey = ["rate_limit", "groq", user.id];
  const entry = await kv.get<{ count: number; windowStart: number }>(rateKey);

  if (entry.value && now - entry.value.windowStart < windowMs) {
    if (entry.value.count >= RATE_LIMIT_PER_MINUTE) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    await kv.set(rateKey, { count: entry.value.count + 1, windowStart: entry.value.windowStart }, { expireIn: windowMs });
  } else {
    await kv.set(rateKey, { count: 1, windowStart: now }, { expireIn: windowMs });
  }

  // Parse body
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { systemPrompt, userMessage, temperature = 0.9 } = body;
  if (!systemPrompt || !userMessage) {
    return new Response(JSON.stringify({ error: "Missing systemPrompt or userMessage" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Call Groq
  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.text();
      console.error(`[groq-proxy] Groq API error ${groqRes.status}:`, errBody);
      return new Response(JSON.stringify({ error: "AI generation failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const completion = await groqRes.json();
    const raw = completion.choices?.[0]?.message?.content?.trim() || "";

    // Parse JSON response
    const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
    const parsed =
      tryParse(raw) ||
      tryParse(raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim()) ||
      (() => { const m = raw.match(/\{[\s\S]*\}/); return m ? tryParse(m[0]) : null; })();

    if (!parsed) {
      console.error("[groq-proxy] Failed to parse Groq response:", raw.slice(0, 200));
      return new Response(JSON.stringify({ error: "Failed to parse AI response" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ json: parsed, raw }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[groq-proxy] Error:", err.message);
    return new Response(JSON.stringify({ error: "AI generation failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
