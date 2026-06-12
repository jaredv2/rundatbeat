import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MOCK_SAMPLES: Record<string, Array<{
  id: number;
  title: string;
  bpm: number;
  key: string;
  genre: string;
  duration: string;
  mp3_url: string;
  waveform_url: string;
  detail_url: string;
  uploader: string;
  tags: string[];
}>> = {
  trap: [
    { id: 1001, title: "Dark Alley Midnight", bpm: 140, key: "Am", genre: "trap", duration: "0:32", mp3_url: "https://cdn.loopaudiotrack.com/samples/trap_dark_alley.mp3", waveform_url: "https://cdn.loopaudiotrack.com/waveforms/trap_dark_alley.png", detail_url: "https://looperman.com/loops/trap/dark-alley-midnight", uploader: "BeatSmith", tags: ["dark", "cinematic", "heavy"] },
    { id: 1002, title: "Shadow Realm", bpm: 145, key: "Cm", genre: "trap", duration: "0:28", mp3_url: "https://cdn.loopaudiotrack.com/samples/trap_shadow_realm.mp3", waveform_url: "https://cdn.loopaudiotrack.com/waveforms/trap_shadow_realm.png", detail_url: "https://looperman.com/loops/trap/shadow-realm", uploader: "NightOwlBeats", tags: ["menacing", "808", "dark"] },
    { id: 1003, title: "Cold Furnace", bpm: 150, key: "Dm", genre: "trap", duration: "0:35", mp3_url: "https://cdn.loopaudiotrack.com/samples/trap_cold_furnace.mp3", waveform_url: "https://cdn.loopaudiotrack.com/waveforms/trap_cold_furnace.png", detail_url: "https://looperman.com/loops/trap/cold-furnace", uploader: "FrostBeats", tags: ["cold", "melodic", "atmospheric"] },
  ],
  drill: [
    { id: 2001, title: "East End Slides", bpm: 142, key: "Gm", genre: "drill", duration: "0:30", mp3_url: "https://cdn.loopaudiotrack.com/samples/drill_east_end.mp3", waveform_url: "https://cdn.loopaudiotrack.com/waveforms/drill_east_end.png", detail_url: "https://looperman.com/loops/drill/east-end-slides", uploader: "UKWavey", tags: ["sliding", "grimy", "uk"] },
    { id: 2002, title: "Basement Frequencies", bpm: 144, key: "Bbm", genre: "drill", duration: "0:33", mp3_url: "https://cdn.loopaudiotrack.com/samples/drill_basement.mp3", waveform_url: "https://cdn.loopaudiotrack.com/waveforms/drill_basement.png", detail_url: "https://looperman.com/loops/drill/basement-frequencies", uploader: "DrillNinja", tags: ["bass", "cold", "off-beat"] },
    { id: 2003, title: "Nocturnal Pattern", bpm: 140, key: "Em", genre: "drill", duration: "0:29", mp3_url: "https://cdn.loopaudiotrack.com/samples/drill_nocturnal.mp3", waveform_url: "https://cdn.loopaudiotrack.com/waveforms/drill_nocturnal.png", detail_url: "https://looperman.com/loops/drill/nocturnal-pattern", uploader: "WaveCollector", tags: ["nocturnal", "sliding", "melodic"] },
  ],
  jersey_club: [
    { id: 3001, title: "Bounce Floor", bpm: 135, key: "Fm", genre: "jersey_club", duration: "0:26", mp3_url: "https://cdn.loopaudiotrack.com/samples/jc_bounce_floor.mp3", waveform_url: "https://cdn.loopaudiotrack.com/waveforms/jc_bounce_floor.png", detail_url: "https://looperman.com/loops/jersey_club/bounce-floor", uploader: "ClubKing", tags: ["bounce", "club", "energetic"] },
    { id: 3002, title: "Late Night Groove", bpm: 140, key: "Am", genre: "jersey_club", duration: "0:31", mp3_url: "https://cdn.loopaudiotrack.com/samples/jc_late_night.mp3", waveform_url: "https://cdn.loopaudiotrack.com/waveforms/jc_late_night.png", detail_url: "https://looperman.com/loops/jersey_club/late-night-groove", uploader: "GrooveMaster", tags: ["groove", "bouncy", "late-night"] },
  ],
  jerk: [
    { id: 4001, title: "West Coast Bounce", bpm: 150, key: "Cm", genre: "jerk", duration: "0:27", mp3_url: "https://cdn.loopaudiotrack.com/samples/jerk_west_coast.mp3", waveform_url: "https://cdn.loopaudiotrack.com/waveforms/jerk_west_coast.png", detail_url: "https://looperman.com/loops/jerk/west-coast-bounce", uploader: "WestSideProd", tags: ["bounce", "west-coast", "rhythmic"] },
    { id: 4002, title: "Youthful Energy", bpm: 145, key: "Dm", genre: "jerk", duration: "0:30", mp3_url: "https://cdn.loopaudiotrack.com/samples/jerk_youthful.mp3", waveform_url: "https://cdn.loopaudiotrack.com/waveforms/jerk_youthful.png", detail_url: "https://looperman.com/loops/jerk/youthful-energy", uploader: "FreshBeats", tags: ["youthful", "confident", "bright"] },
  ],
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const genre = url.searchParams.get("genre") || "trap";

    const loopermanUrl = Deno.env.get("LOOPERMAN_API_URL");

    if (loopermanUrl) {
      // Real Looperman API
      const res = await fetch(`${loopermanUrl}/challenge?genre=${encodeURIComponent(genre)}`);
      if (!res.ok) throw new Error(`Looperman API returned ${res.status}`);
      const sample = await res.json();
      return new Response(JSON.stringify(sample), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mock data fallback
    const pool = MOCK_SAMPLES[genre] || MOCK_SAMPLES.trap;
    const sample = pool[Math.floor(Math.random() * pool.length)];

    return new Response(JSON.stringify(sample), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
