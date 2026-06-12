// Supabase Edge Function: proxy-audio
// Proxies audio requests to Loopazon API with CORS headers.
// Deploy: supabase functions deploy proxy-audio --no-verify-jwt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ALLOWED_ORIGINS = ["https://rundatbeat.vercel.app", "http://localhost:5173"];

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const targetId = url.searchParams.get("id");
  if (!targetId) {
    return new Response(JSON.stringify({ error: "Missing id parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const targetUrl = `https://loops-api-rdb.vercel.app/download/${targetId}`;
    const resp = await fetch(targetUrl, {
      headers: { "User-Agent": "RUNDATBEAT/1.0" },
      redirect: "follow",
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `Upstream returned ${resp.status}` }), {
        status: resp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentType = resp.headers.get("content-type") || "audio/mpeg";
    const contentLength = resp.headers.get("content-length");

    const headers = {
      ...corsHeaders,
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    };
    if (contentLength) headers["Content-Length"] = contentLength;

    return new Response(resp.body, { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
