const log = (msg: string) => console.log(`[room-cleanup] ${msg}`);

Deno.serve(async () => {
  log("disabled — cleanup is now handled client-side by the FSM");
  return new Response(JSON.stringify({ skipped: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
