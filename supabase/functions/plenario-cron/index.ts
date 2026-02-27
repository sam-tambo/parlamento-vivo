/**
 * Supabase Edge Function: plenario-cron
 * ======================================
 * Scheduled trigger (via pg_cron or Supabase cron) that drives the
 * serverless transcription loop for the ARTV Plenário live stream.
 *
 * Flow every 30 seconds:
 *   1. Look up the active live session in `sessions` table
 *   2. If none → check whether parliament is in session (weekday 10:00–19:00)
 *      and create one with the known ARTV HLS URL
 *   3. Fetch the latest HLS segments from the stored stream URL
 *   4. POST to the `transcribe` edge function (which calls HF Whisper + stores results)
 *   5. Update session stats (total words, filler count, duration)
 *
 * The HLS URL is discovered once (by the Python worker or manually) and
 * stored in sessions.artv_stream_url. Everything after that is serverless.
 *
 * HOW TO TRIGGER:
 *   Option A — Supabase cron (Dashboard → Edge Functions → Schedules):
 *     Schedule: every 30 seconds  →  POST /functions/v1/plenario-cron
 *
 *   Option B — pg_cron (see migration 004_cron.sql):
 *     SELECT cron.schedule('plenario-loop', '30 seconds', $$ ... $$);
 *
 *   Option C — External cron (GitHub Actions, Render.com cron job, etc.):
 *     curl -X POST https://<project>.supabase.co/functions/v1/plenario-cron \
 *          -H "Authorization: Bearer <anon-key>"
 *
 * Secrets required:
 *   HF_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (all auto-available)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const ARTV_PLENARIO = "https://canal.parlamento.pt/plenario";

// Parliament typically sits Mon–Fri, 10:00–19:30 Lisbon time
// Outside these hours we skip processing to avoid empty audio errors
function isParliamentHours(): boolean {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Lisbon" })
  );
  const day  = now.getDay();   // 0=Sun, 6=Sat
  const hour = now.getHours();
  return day >= 1 && day <= 5 && hour >= 9 && hour < 20;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // Edge functions are served under /functions/v1/ on the same project URL
  const FUNCTIONS_URL   = `${SUPABASE_URL}/functions/v1`;

  // ── 1. Check parliament hours ─────────────────────────────────────────────
  if (!isParliamentHours()) {
    return Response.json({ skipped: true, reason: "outside parliament hours" });
  }

  // ── 2. Find or create active session ─────────────────────────────────────
  // Use Lisbon local date, not UTC, so the session date matches the parliament calendar
  const today = new Date()
    .toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" }); // "2026-02-27" format

  let { data: sessions } = await supabase
    .from("sessions")
    .select("id, artv_stream_url, total_filler_count, total_speaking_minutes")
    .eq("status", "live")
    .eq("date", today)
    .order("created_at", { ascending: false })
    .limit(1);

  let session = sessions?.[0] ?? null;

  if (!session) {
    // No live session today — create one.
    // The stream URL should be discovered by the Python worker or set manually.
    // We store ARTV_PLENARIO as a placeholder; the real HLS URL comes from
    // the worker after it runs `python scraper.py` once.
    const { data: newSession, error } = await supabase
      .from("sessions")
      .insert({
        date:              today,
        status:            "live",
        artv_stream_url:   ARTV_PLENARIO,
        start_time:        new Date().toLocaleTimeString("pt-PT", { timeZone: "Europe/Lisbon", hour12: false }),
        transcript_status: "processing",
      })
      .select()
      .single();

    if (error || !newSession) {
      return Response.json({ error: "Could not create session", detail: error?.message }, { status: 500 });
    }
    session = newSession;
    console.log(`[cron] Created session ${session.id} for ${today}`);
  }

  const streamUrl = session.artv_stream_url;

  // If the stored URL is just the landing page (not an HLS URL), we can't
  // process audio yet. Return a clear message so operators know to run the
  // Python scraper once to discover the real HLS URL.
  if (!streamUrl || !streamUrl.includes(".m3u8")) {
    return Response.json({
      session_id: session.id,
      waiting:    true,
      message:    "HLS URL not yet discovered. Run: python worker/scraper.py once to find it, then update sessions.artv_stream_url.",
    });
  }

  // ── 3. Call the transcribe edge function ──────────────────────────────────
  console.log(`[cron] Sending HLS chunk to transcribe function …`);
  const transcribeResp = await fetch(`${FUNCTIONS_URL}/transcribe`, {
    method:  "POST",
    headers: {
      "Content-Type":     "application/json",
      "Authorization":    `Bearer ${SERVICE_KEY}`,
      "x-session-id":     session.id,
    },
    body: JSON.stringify({
      m3u8_url:      streamUrl,
      segment_count: 5,          // ~30 seconds (5 × 6s segments)
    }),
  });

  let result: Record<string, unknown> = {};
  if (transcribeResp.ok) {
    result = await transcribeResp.json();
  } else {
    const body = await transcribeResp.text();
    // 503 = model loading; will be ready next invocation
    console.warn(`[cron] transcribe returned ${transcribeResp.status}: ${body.slice(0, 200)}`);
    return Response.json({ session_id: session.id, status: transcribeResp.status, body: body.slice(0, 200) });
  }

  // ── 4. Update session aggregates ──────────────────────────────────────────
  const newFillers   = (session.total_filler_count    ?? 0) + ((result.filler_count as number) ?? 0);
  const newMinutes   = (session.total_speaking_minutes ?? 0) + (30 / 60); // ~30s chunk

  await supabase
    .from("sessions")
    .update({
      total_filler_count:    newFillers,
      total_speaking_minutes: parseFloat(newMinutes.toFixed(2)),
    })
    .eq("id", session.id);

  console.log(
    `[cron] Done. Session ${session.id} | ` +
    `words=${result.total_words} fillers=${result.filler_count} (${((((result.filler_count as number) ?? 0) / Math.max((result.total_words as number) ?? 1, 1)) * 100).toFixed(1)}%)`
  );

  return Response.json({
    session_id:    session.id,
    text_preview:  (result.text as string)?.slice(0, 100),
    filler_count:  result.filler_count,
    filler_words:  result.filler_words,
    total_words:   result.total_words,
    elapsed_s:     result.elapsed_s,
  });
});
