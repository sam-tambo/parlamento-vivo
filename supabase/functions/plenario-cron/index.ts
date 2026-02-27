/**
 * Supabase Edge Function: plenario-cron
 * ======================================
 * Called every ~30–60 seconds (via pg_cron, Supabase scheduler, or GitHub Actions).
 * Drives the serverless transcription loop for the ARTV Plenário live stream.
 *
 * Flow per invocation:
 *   1. Find / create today's live session
 *   2. Resolve the ARTV HLS stream URL (from DB or via multi-strategy discovery)
 *   3. Fetch the HLS playlist → identify NEW segments since last run
 *      (tracked via sessions.last_hls_sequence to avoid re-processing)
 *   4. Send new segments to the `transcribe` function in ~30s batches
 *   5. Update session stats + cursor
 *
 * HLS URL discovery order (first that returns a valid .m3u8):
 *   A. sessions.artv_stream_url already set (from previous run / Python worker)
 *   B. Known ARTV / Canal Parlamento CDN URL candidates
 *   C. Fetch canal.parlamento.pt/plenario page source → regex for .m3u8
 *
 * Secrets required (all auto-injected by Supabase):
 *   HF_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

// ─── ARTV / Canal Parlamento HLS URL candidates ────────────────────────────────
//
// The Parliament's live linear channel is served through their own CDN.
// We try these in order; the first to return a valid playlist wins and is
// cached in sessions.artv_stream_url for subsequent invocations.
//
// URLs updated as the CDN changes — checked against canal.parlamento.pt 2025-26.
const ARTV_URL_CANDIDATES: string[] = [
  // Direct HLS — Parliamentary TV CDN (most reliable)
  "https://livepd3.parlamento.pt/artv/live.m3u8",
  "https://livepd3.parlamento.pt/plenario/live.m3u8",
  // RTP CDN — ARTV is an RTP network channel
  "https://streaming.rtp.pt/liverepeater/smil:artv.smil/playlist.m3u8",
  "https://cdn-rtve.akamaized.net/artv/live.m3u8",
  // Canal Parlamento sub-paths sometimes used for plenario sessions
  "https://livepd3.parlamento.pt/canal/live.m3u8",
  "https://streaming.parlamento.pt/artv/live.m3u8",
];

const ARTV_PAGES = [
  "https://canal.parlamento.pt/plenario",
  "https://canal.parlamento.pt",
];

// MPEG-TS segment duration in seconds; used to estimate how many segments = 30s
const ASSUMED_SEGMENT_DURATION_S = 6;
// Target chunk duration to send to transcribe in one call (~30 s)
const TARGET_CHUNK_S = 30;
const SEGMENTS_PER_CHUNK = Math.round(TARGET_CHUNK_S / ASSUMED_SEGMENT_DURATION_S); // = 5

// ─── HLS URL resolution ────────────────────────────────────────────────────────

/**
 * Try a URL: returns it if the playlist response is valid, null otherwise.
 */
async function probeHlsUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ParlamentoVivo/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const text = await r.text();
    // A valid HLS master or media playlist starts with #EXTM3U
    if (text.trimStart().startsWith("#EXTM3U")) return url;
  } catch { /* timeout / network error */ }
  return null;
}

/**
 * If url points to a master playlist (lists renditions), follow it to the
 * highest-bandwidth media playlist.
 */
async function resolveToMediaPlaylist(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ParlamentoVivo/1.0)" },
  });
  const text = await r.text();
  const base = url.substring(0, url.lastIndexOf("/") + 1);

  // If it contains #EXT-X-STREAM-INF it's a master; pick highest bandwidth
  if (text.includes("#EXT-X-STREAM-INF")) {
    const lines = text.split("\n");
    let bestBw = -1, bestUrl = "";
    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
      const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
      const bw = bwMatch ? parseInt(bwMatch[1]) : 0;
      const next = lines[i + 1].trim();
      if (next && bw > bestBw) { bestBw = bw; bestUrl = next; }
    }
    if (bestUrl) {
      return bestUrl.startsWith("http") ? bestUrl : base + bestUrl;
    }
  }
  return url; // already a media playlist
}

/**
 * Extract an HLS URL from a page's HTML/JS source (catches string literals).
 */
async function discoverFromPage(pageUrl: string): Promise<string | null> {
  try {
    const r = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const html = await r.text();

    // Explicit .m3u8 anywhere in the source (covers inline JS player configs)
    const m = html.match(/(https?:\/\/[^\s"'`<>\\]+\.m3u8[^\s"'`<>\\]*)/);
    if (m) return m[1];

    // Broader pattern: URLs containing /live, /hls, /stream, /artv
    const m2 = html.match(/(https?:\/\/[^\s"'`<>\\]*\/(?:live|hls|stream|artv)[^\s"'`<>\\]*)/i);
    if (m2) {
      const candidate = m2[1];
      const probed = await probeHlsUrl(candidate);
      if (probed) return probed;
    }
  } catch (e) {
    console.warn(`[cron] Page discovery failed for ${pageUrl}:`, e);
  }
  return null;
}

async function findArtvHlsUrl(storedUrl: string | null): Promise<string | null> {
  // A. Use stored URL if it's already a working HLS URL
  if (storedUrl && storedUrl.includes(".m3u8")) {
    const ok = await probeHlsUrl(storedUrl);
    if (ok) return storedUrl;
    console.warn("[cron] Stored HLS URL no longer valid, re-discovering…");
  }

  // B. Try known CDN candidates in parallel (fast, ~8s timeout each)
  const results = await Promise.all(ARTV_URL_CANDIDATES.map(probeHlsUrl));
  for (let i = 0; i < results.length; i++) {
    if (results[i]) {
      console.log(`[cron] Found live HLS at candidate[${i}]: ${ARTV_URL_CANDIDATES[i]}`);
      return ARTV_URL_CANDIDATES[i];
    }
  }

  // C. Fall back to page scraping (slower — JS player may embed URL in source)
  for (const page of ARTV_PAGES) {
    const url = await discoverFromPage(page);
    if (url) {
      console.log(`[cron] Discovered HLS from page ${page}: ${url.slice(0, 80)}`);
      return url;
    }
  }

  return null;
}

// ─── HLS playlist parsing ──────────────────────────────────────────────────────

interface HlsPlaylist {
  sequence: number;          // EXT-X-MEDIA-SEQUENCE
  segments: string[];        // absolute URLs of .ts segments (newest last)
  isEndList: boolean;        // EXT-X-ENDLIST present → stream ended
}

async function fetchPlaylist(m3u8Url: string): Promise<HlsPlaylist | null> {
  try {
    const r = await fetch(m3u8Url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ParlamentoVivo/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const text = await r.text();
    const base = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);

    let sequence = 0;
    const seqMatch = text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
    if (seqMatch) sequence = parseInt(seqMatch[1]);

    const segments = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((url) => (url.startsWith("http") ? url : base + url));

    const isEndList = text.includes("#EXT-X-ENDLIST");
    return { sequence, segments, isEndList };
  } catch (e) {
    console.error("[cron] Failed to fetch playlist:", e);
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isParliamentHours(): boolean {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Lisbon" })
  );
  const day = now.getDay(); // 0=Sun … 6=Sat
  const hr = now.getHours();
  return day >= 1 && day <= 5 && hr >= 9 && hr < 21;
}

function lisbonToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
}

function lisbonTime(): string {
  return new Date().toLocaleTimeString("pt-PT", {
    timeZone: "Europe/Lisbon",
    hour12: false,
  });
}

// ─── Main handler ──────────────────────────────────────────────────────────────

const CORS = { "Access-Control-Allow-Origin": "*" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── 1. Parliament hours gate ──────────────────────────────────────────────
  if (!isParliamentHours()) {
    return Response.json({ skipped: true, reason: "outside parliament hours" }, { headers: CORS });
  }

  const today = lisbonToday();

  // ── 2. Find or create today's live session ────────────────────────────────
  const { data: existing } = await supabase
    .from("sessions")
    .select("id, artv_stream_url, last_hls_sequence, last_hls_segment, total_filler_count, total_speaking_minutes")
    .eq("status", "live")
    .eq("date", today)
    .order("created_at", { ascending: false })
    .limit(1);

  let session = existing?.[0] ?? null;

  if (!session) {
    const { data: created, error } = await supabase
      .from("sessions")
      .insert({
        date:              today,
        status:            "live",
        artv_stream_url:   null,
        start_time:        lisbonTime(),
        transcript_status: "processing",
        last_hls_sequence: null,
      })
      .select()
      .single();

    if (error || !created) {
      return Response.json({ error: "Could not create session", detail: error?.message }, { status: 500, headers: CORS });
    }
    session = created;
    console.log(`[cron] Created session ${session.id} for ${today}`);
  }

  // ── 3. Resolve HLS URL ────────────────────────────────────────────────────
  // live_trigger.py may supply a pre-discovered URL in the request body
  let bodyHlsHint: string | null = null;
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = await req.clone().json() as Record<string, unknown>;
      if (typeof body.hls_url === "string" && body.hls_url.includes(".m3u8")) {
        bodyHlsHint = body.hls_url;
      }
    }
  } catch { /* ignore parse errors */ }

  const hlsUrl = await findArtvHlsUrl(bodyHlsHint ?? session.artv_stream_url ?? null);

  if (!hlsUrl) {
    console.warn("[cron] Could not find ARTV live stream — no session today or stream down");
    return Response.json({
      session_id: session.id,
      waiting:    true,
      message:    "ARTV live stream not found. Parliament may not be in session.",
    }, { headers: CORS });
  }

  // Persist discovered URL if it changed
  if (hlsUrl !== session.artv_stream_url) {
    await supabase
      .from("sessions")
      .update({ artv_stream_url: hlsUrl, transcript_status: "processing" })
      .eq("id", session.id);
    console.log(`[cron] Stored HLS URL: ${hlsUrl.slice(0, 80)}`);
  }

  // Follow master → media playlist if needed
  const mediaUrl = await resolveToMediaPlaylist(hlsUrl).catch(() => hlsUrl);

  // ── 4. Fetch playlist and find NEW segments ───────────────────────────────
  const playlist = await fetchPlaylist(mediaUrl);
  if (!playlist || playlist.segments.length === 0) {
    return Response.json({ session_id: session.id, error: "Empty or invalid playlist" }, { headers: CORS });
  }

  const lastSeq = session.last_hls_sequence ?? -1;
  // Absolute sequence number of the first segment in the current playlist window
  const windowStart = playlist.sequence;
  // Total segments available
  const total = playlist.segments.length;

  // Which segments are new? (sequence > lastSeq)
  // Segment at index i has absolute sequence = windowStart + i
  let newStart = 0;
  if (lastSeq >= windowStart) {
    newStart = Math.min(lastSeq - windowStart + 1, total);
  }

  const newSegments = playlist.segments.slice(newStart);

  if (newSegments.length === 0) {
    console.log(`[cron] No new segments (last_seq=${lastSeq}, window=[${windowStart}…${windowStart + total - 1}])`);
    return Response.json({ session_id: session.id, new_segments: 0 }, { headers: CORS });
  }

  console.log(`[cron] ${newSegments.length} new segments (seq ${windowStart + newStart}…${windowStart + total - 1})`);

  // ── 5. Transcribe in ~30-second batches ───────────────────────────────────
  let totalWords = 0, totalFillers = 0, chunksProcessed = 0;
  const newAbsoluteSeq = windowStart + total - 1; // last segment's sequence number

  for (let i = 0; i < newSegments.length; i += SEGMENTS_PER_CHUNK) {
    const batch = newSegments.slice(i, i + SEGMENTS_PER_CHUNK);
    if (batch.length === 0) break;

    try {
      const resp = await fetch(`${FUNCTIONS_URL}/transcribe`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "x-session-id":  session.id,
        },
        body: JSON.stringify({
          segment_urls:  batch,           // explicit list — no more "last N" ambiguity
          segment_count: batch.length,    // fallback if m3u8_url path used
          m3u8_url:      mediaUrl,        // kept for backwards compat
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (resp.ok) {
        const result = await resp.json() as Record<string, unknown>;
        totalWords   += (result.total_words   as number) ?? 0;
        totalFillers += (result.filler_count  as number) ?? 0;
        chunksProcessed++;
        console.log(
          `[cron] chunk ${chunksProcessed}: "${(result.text as string)?.slice(0, 60)}…" ` +
          `(${result.total_words}w, ${result.filler_count}f)`
        );
      } else if (resp.status === 503) {
        console.warn("[cron] HF model loading (503) — will retry next invocation");
        break;
      } else {
        console.warn(`[cron] transcribe returned ${resp.status}`);
      }
    } catch (e) {
      console.error("[cron] transcribe call failed:", e);
    }
  }

  // ── 6. Update session cursor + aggregates ─────────────────────────────────
  const minutesAdded = (newSegments.length * ASSUMED_SEGMENT_DURATION_S) / 60;

  await supabase
    .from("sessions")
    .update({
      last_hls_sequence:     newAbsoluteSeq,
      last_hls_segment:      newSegments[newSegments.length - 1],
      total_filler_count:    (session.total_filler_count    ?? 0) + totalFillers,
      total_speaking_minutes: parseFloat(((session.total_speaking_minutes ?? 0) + minutesAdded).toFixed(2)),
    })
    .eq("id", session.id);

  return Response.json({
    session_id:      session.id,
    new_segments:    newSegments.length,
    chunks_sent:     chunksProcessed,
    total_words:     totalWords,
    total_fillers:   totalFillers,
  }, { headers: CORS });
});
