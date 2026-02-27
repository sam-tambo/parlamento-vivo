/**
 * Supabase Edge Function: plenario-cron
 * ======================================
 * Triggered every minute by pg_cron (migration 007).
 * Fully serverless — no browser, no GitHub Actions, no server required.
 *
 * Pipeline per invocation:
 *   1. Find / create today's live session in Supabase
 *   2. Resolve the ARTV HLS stream URL (5-stage discovery, cached in DB)
 *   3. Parse the HLS playlist → find NEW segments since last run (cursor)
 *   4. Send new segments to `transcribe` in ~30-second batches
 *   5. Update session stats + cursor so next invocation skips processed segments
 *
 * HLS URL discovery (in order, first working URL wins):
 *   A. sessions.artv_stream_url already valid  (cached from prior run)
 *   B. canal.parlamento.pt API endpoints        (JSON, no JS required)
 *   C. Next.js __NEXT_DATA__ in page HTML       (catches embedded player config)
 *   D. Regex scan of full page HTML/JS bundle   (catches any string literal)
 *   E. Known CDN URL candidates                 (direct probe, parallel)
 *
 * Secrets auto-injected by Supabase:
 *   HF_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSUMED_SEGMENT_S  = 6;   // typical MPEG-TS segment duration
const TARGET_CHUNK_S     = 30;  // send ~30s of audio per transcribe call
const SEGMENTS_PER_CHUNK = Math.round(TARGET_CHUNK_S / ASSUMED_SEGMENT_S); // 5

// Looser hours gate: 08:00–22:00 Lisbon time covers all plenary sessions
// including late-night debates, plus evening replays on the linear channel.
const SESSION_START_HOUR = 8;
const SESSION_END_HOUR   = 22;

// ─── Browser-like request headers ────────────────────────────────────────────
// Some CDNs and streaming servers reject requests that don't look like a
// browser fetching from the parliament website.

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
  "Referer": "https://canal.parlamento.pt/",
  "Origin": "https://canal.parlamento.pt",
};

const HLS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ParlamentoVivo/1.0)",
  "Referer": "https://canal.parlamento.pt/",
  "Origin": "https://canal.parlamento.pt",
};

// ─── Stage E: known CDN candidates ────────────────────────────────────────────
// These are direct-probe fallbacks for when page discovery fails.
// List ordered by likelihood based on Portuguese parliament infrastructure.

const HLS_CANDIDATES: string[] = [
  // ── LiveExtend CDN — the actual ARTV/Canal Parlamento provider ──────────
  // Confirmed via public IPTV repositories (iptv-org/iptv, LITUATUI/M3UPT).
  "https://playout172.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8",
  "https://playout175.livextend.cloud/livenlin4/_definst_/2liveartvpub2/playlist.m3u8",
  "https://playout172.livextend.cloud/livenlin4/_definst_/2liveartvpub2/playlist.m3u8",
  "https://playout175.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8",
  // Additional playout nodes that LiveExtend uses (load balanced)
  "https://playout173.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8",
  "https://playout174.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8",
  "https://playout176.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8",
  // ── Parliament own infrastructure (fallback) ──────────────────────────
  "https://livepd3.parlamento.pt/artv/live.m3u8",
  "https://livepd3.parlamento.pt/plenario/live.m3u8",
  "https://livepd3.parlamento.pt/canal/live.m3u8",
  "https://streaming.parlamento.pt/artv/live.m3u8",
  // ── RTP CDN (ARTV is distributed via RTP infrastructure) ─────────────
  "https://streaming.rtp.pt/liverepeater/smil:artv.smil/playlist.m3u8",
  "https://rdmedia.rtp.pt/artv/index.m3u8",
  "https://rdmedia.rtp.pt/liverepeater/smil:artv.smil/playlist.m3u8",
];

// ─── Stage B: JSON API endpoints to probe ─────────────────────────────────────

const API_ENDPOINTS: string[] = [
  "https://canal.parlamento.pt/api/lives",
  "https://canal.parlamento.pt/api/lives/plenario",
  "https://canal.parlamento.pt/api/player/live",
  "https://canal.parlamento.pt/api/stream",
  "https://canal.parlamento.pt/api/sessions/live",
];

// ─── HLS URL discovery ────────────────────────────────────────────────────────

async function probeHls(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: HLS_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const text = await r.text();
    return text.trimStart().startsWith("#EXTM3U") ? url : null;
  } catch { return null; }
}

/**
 * Stage B.5: fetch actively-maintained public IPTV playlists.
 * iptv-org/iptv and LITUATUI/M3UPT are community-curated and updated
 * whenever streams change — far more reliable than any URL we can guess.
 */
async function discoverFromIptvPlaylist(): Promise<string | null> {
  const playlists = [
    // iptv-org/iptv — largest public IPTV repo, Portugal streams
    "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/pt.m3u",
    // LITUATUI/M3UPT — Portuguese-specific, actively maintained
    "https://raw.githubusercontent.com/LITUATUI/M3UPT/main/M3U/M3UPT.m3u8",
  ];

  for (const playlistUrl of playlists) {
    try {
      const r = await fetch(playlistUrl, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const text = await r.text();
      const lines = text.split("\n");

      for (let i = 0; i < lines.length - 1; i++) {
        const meta = lines[i];
        // Look for ARTV / Canal Parlamento entry in EXTINF metadata line
        if (!/artv|parlamento/i.test(meta)) continue;
        // The URL is on the next non-empty line
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const url = lines[j].trim();
          if (!url || url.startsWith("#")) continue;
          if (!url.startsWith("http")) continue;
          const valid = await probeHls(url, 10000);
          if (valid) {
            console.log(`[cron] IPTV playlist hit (${playlistUrl}): ${url}`);
            return url;
          }
          break; // URL line found but not valid — move to next EXTINF
        }
      }
    } catch { /* try next */ }
  }
  return null;
}

/** Stage B: try JSON API endpoints for a stream URL */
async function discoverFromApi(): Promise<string | null> {
  for (const endpoint of API_ENDPOINTS) {
    try {
      const r = await fetch(endpoint, {
        headers: { ...BROWSER_HEADERS, "Accept": "application/json" },
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) continue;
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("json")) continue;
      const data = await r.json();
      const json = JSON.stringify(data);
      // Extract any .m3u8 URL from the JSON payload
      const m = json.match(/(https?:\\?\/\\?\/[^"'\\]+\.m3u8[^"'\\]*)/);
      if (m) {
        const url = m[1].replace(/\\\//g, "/");
        const valid = await probeHls(url);
        if (valid) { console.log(`[cron] API hit: ${endpoint} → ${url}`); return url; }
      }
      // Also look for generic stream/hls/src fields
      const urlMatch = json.match(/"(?:url|src|hls|stream|hlsUrl|streamUrl)"\s*:\s*"(https?:[^"]+)"/i);
      if (urlMatch) {
        const url = urlMatch[1].replace(/\\\//g, "/");
        const valid = await probeHls(url);
        if (valid) { console.log(`[cron] API field hit: ${url}`); return url; }
      }
    } catch { /* try next */ }
  }
  return null;
}

/** Stage C: extract from Next.js __NEXT_DATA__ embedded in page HTML */
function extractFromNextData(html: string): string | null {
  const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([^<]{10,})<\/script>/i);
  if (!m) return null;
  try {
    const json = JSON.stringify(JSON.parse(m[1]));
    const u = json.match(/(https?:\\?\/\\?\/[^"'\\]+\.m3u8[^"'\\]*)/);
    if (u) return u[1].replace(/\\\//g, "/");
  } catch { /* malformed JSON */ }
  return null;
}

/** Stage D: broad regex scan of the full page source */
function extractFromHtml(html: string, pageUrl: string): string | null {
  const base = pageUrl.replace(/\/[^/]*$/, "/");

  // Patterns seen in common video players (JWPlayer, VideoJS, HLS.js configs)
  const patterns = [
    /(https?:\/\/[^\s"'`<>\\]+\.m3u8[^\s"'`<>\\]*)/,
    /["'`](?:file|src|url|hls|source|hlsUrl|streamUrl|videoUrl)\s*["'`]?\s*:\s*["'`](https?:[^"'`]+\.m3u8[^"'`]*)/i,
    /(?:file|src|url|source)\s*=\s*["'](https?:[^"']+\.m3u8[^"']*)/i,
    /(https?:\/\/[^\s"'<>]+\/(?:live|hls|stream|artv)[^\s"'<>]*(?:\.m3u8|\/playlist)[^\s"'<>]*)/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const raw = m[m.length - 1]; // last capture group = the URL
      const url = raw.startsWith("http") ? raw : base + raw;
      return url;
    }
  }
  return null;
}

/** Fetch a page with browser headers, follow iframe src if needed */
async function fetchPage(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

/** Full 5-stage ARTV HLS URL discovery */
async function findArtvHlsUrl(stored: string | null): Promise<string | null> {
  // A. Use cached URL if still valid
  if (stored?.includes(".m3u8")) {
    const ok = await probeHls(stored);
    if (ok) return stored;
    console.warn("[cron] Cached HLS URL expired, re-discovering…");
  }

  // B. IPTV playlist (community-maintained, most reliable external source)
  const iptvUrl = await discoverFromIptvPlaylist();
  if (iptvUrl) return iptvUrl;

  // B2. JSON API probes (fast, no HTML parsing needed)
  const apiUrl = await discoverFromApi();
  if (apiUrl) return apiUrl;

  // C+D. Scrape HTML of the two main pages
  const pagesToScrape = [
    "https://canal.parlamento.pt/plenario",
    "https://canal.parlamento.pt",
  ];

  for (const pageUrl of pagesToScrape) {
    const html = await fetchPage(pageUrl);
    if (!html) continue;

    // C. Next.js __NEXT_DATA__ (fast parse, reliable if Next.js is used)
    const nextUrl = extractFromNextData(html);
    if (nextUrl) {
      const ok = await probeHls(nextUrl);
      if (ok) { console.log(`[cron] Next.js data hit: ${nextUrl}`); return nextUrl; }
    }

    // D. Full HTML regex scan
    const htmlUrl = extractFromHtml(html, pageUrl);
    if (htmlUrl) {
      const ok = await probeHls(htmlUrl);
      if (ok) { console.log(`[cron] HTML scan hit: ${htmlUrl}`); return htmlUrl; }
    }

    // D2. Also scan any inline <script src="..."> chunks that might embed the player
    const scriptSrcs = [...html.matchAll(/src=["'](https?:[^"']+\.js[^"']*)/gi)]
      .map(m => m[1])
      .filter(s => /player|video|stream|hls/i.test(s))
      .slice(0, 3); // limit to avoid too many requests

    for (const scriptSrc of scriptSrcs) {
      const js = await fetchPage(scriptSrc);
      if (!js) continue;
      const jsUrl = extractFromHtml(js, scriptSrc);
      if (jsUrl) {
        const ok = await probeHls(jsUrl);
        if (ok) { console.log(`[cron] JS bundle hit: ${jsUrl}`); return jsUrl; }
      }
    }
  }

  // E. Parallel probe of all known CDN candidates (last resort)
  console.log("[cron] Probing CDN candidates in parallel…");
  const results = await Promise.all(HLS_CANDIDATES.map(u => probeHls(u)));
  for (let i = 0; i < results.length; i++) {
    if (results[i]) {
      console.log(`[cron] CDN candidate hit: ${HLS_CANDIDATES[i]}`);
      return HLS_CANDIDATES[i];
    }
  }

  return null;
}

// ─── Speaker identification ───────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * Try to discover who is currently speaking by probing canal.parlamento.pt
 * API endpoints that may expose live session / agenda data.
 *
 * Returns the matching politician's UUID (from our DB), or null.
 * This is a best-effort hint: transcribe will fall back to text extraction
 * if we return null here.
 */
async function fetchCurrentSpeaker(
  supabase: SupabaseClient,
): Promise<string | null> {
  // Endpoints that may expose current speaker info
  const endpoints = [
    "https://canal.parlamento.pt/api/lives",
    "https://canal.parlamento.pt/api/lives/plenario",
    "https://canal.parlamento.pt/api/player/live",
    "https://canal.parlamento.pt/api/sessions/current",
  ];

  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, {
        headers: { ...BROWSER_HEADERS, Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) continue;
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("json")) continue;

      const data = await r.json();
      const json = JSON.stringify(data);

      // Extract value of any speaker-ish field
      const m = json.match(
        /"(?:speaker|orador|interveniente|deputado|author|nome|name)"\s*:\s*"([^"]{3,})"/i,
      );
      if (!m) continue;

      const speakerName = m[1].trim();
      if (!speakerName) continue;

      console.log(`[cron] API speaker hint: "${speakerName}" (from ${ep})`);

      // Fuzzy match against politicians (name / full_name)
      const words = speakerName.split(/\s+/).filter((w: string) => w.length > 3);
      for (const word of words) {
        const { data: pol } = await supabase
          .from("politicians")
          .select("id, name")
          .or(`name.ilike.%${word}%,full_name.ilike.%${word}%`)
          .limit(1)
          .single();
        if (pol) {
          console.log(`[cron] Matched politician: ${pol.name}`);
          return pol.id as string;
        }
      }
    } catch { /* try next endpoint */ }
  }

  return null;
}

// ─── HLS playlist helpers ─────────────────────────────────────────────────────

interface HlsPlaylist {
  sequence: number;
  segments: string[];
  isEndList: boolean;
}

async function fetchPlaylist(url: string): Promise<HlsPlaylist | null> {
  try {
    const r = await fetch(url, { headers: HLS_HEADERS, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const text = await r.text();
    const base = url.substring(0, url.lastIndexOf("/") + 1);

    const seqM = text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
    const sequence = seqM ? parseInt(seqM[1]) : 0;

    const segments = text.split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#"))
      .map(u => u.startsWith("http") ? u : base + u);

    return { sequence, segments, isEndList: text.includes("#EXT-X-ENDLIST") };
  } catch { return null; }
}

async function resolveMediaPlaylist(url: string): Promise<string> {
  try {
    const r = await fetch(url, { headers: HLS_HEADERS });
    const text = await r.text();
    const base = url.substring(0, url.lastIndexOf("/") + 1);
    if (!text.includes("#EXT-X-STREAM-INF")) return url;
    const lines = text.split("\n");
    let bestBw = -1, bestUrl = "";
    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
      const bw = parseInt(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] ?? "0");
      const next = lines[i + 1].trim();
      if (next && bw > bestBw) { bestBw = bw; bestUrl = next; }
    }
    if (bestUrl) return bestUrl.startsWith("http") ? bestUrl : base + bestUrl;
  } catch { /* */ }
  return url;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function lisbonNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Lisbon" }));
}

function lisbonToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
}

function isWithinBroadcastHours(): boolean {
  const h = lisbonNow().getHours();
  return h >= SESSION_START_HOUR && h < SESSION_END_HOUR;
}

// Full CORS headers required for browser-initiated requests.
// Access-Control-Allow-Headers MUST list every header the browser sends
// in the preflight Access-Control-Request-Headers — omitting any one of
// them causes the preflight to fail with a network error (no HTTP status).
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
  const supabase      = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Broadcast hours gate ──────────────────────────────────────────────────
  if (!isWithinBroadcastHours()) {
    return Response.json({ skipped: true, reason: "outside broadcast hours (08–22 Lisbon)" }, { headers: CORS });
  }

  const today = lisbonToday();

  // ── Find or create today's session ───────────────────────────────────────
  const { data: existing } = await supabase
    .from("sessions")
    .select("id, artv_stream_url, last_hls_sequence, total_filler_count, total_speaking_minutes")
    .eq("status", "live")
    .eq("date", today)
    .order("created_at", { ascending: false })
    .limit(1);

  let session = existing?.[0] ?? null;

  if (!session) {
    const { data: created, error } = await supabase
      .from("sessions")
      .insert({
        date: today,
        status: "live",
        transcript_status: "processing",
        start_time: lisbonNow().toTimeString().slice(0, 8),
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

  // ── Accept HLS hint from request body (live_trigger.py passes this) ──────
  let bodyHint: string | null = null;
  try {
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      const b = await req.clone().json() as Record<string, unknown>;
      if (typeof b.hls_url === "string" && b.hls_url.includes(".m3u8")) bodyHint = b.hls_url;
    }
  } catch { /* */ }

  // ── Resolve HLS URL (5-stage discovery) ──────────────────────────────────
  const hlsUrl = await findArtvHlsUrl(bodyHint ?? session.artv_stream_url ?? null);

  if (!hlsUrl) {
    console.warn("[cron] Stream not found — parliament may not be broadcasting");
    // Mark session as waiting (not error — will retry next minute)
    await supabase.from("sessions").update({ transcript_status: "pending" }).eq("id", session.id);
    return Response.json({ session_id: session.id, waiting: true, message: "Stream not available" }, { headers: CORS });
  }

  // Cache the discovered URL
  if (hlsUrl !== session.artv_stream_url) {
    await supabase.from("sessions").update({ artv_stream_url: hlsUrl, transcript_status: "processing" }).eq("id", session.id);
  }

  // ── Parse playlist → find new segments ───────────────────────────────────
  const mediaUrl = await resolveMediaPlaylist(hlsUrl);
  const playlist = await fetchPlaylist(mediaUrl);

  if (!playlist || !playlist.segments.length) {
    return Response.json({ session_id: session.id, error: "Empty playlist" }, { headers: CORS });
  }

  const lastSeq     = session.last_hls_sequence ?? -1;
  const windowStart = playlist.sequence;
  const newStart    = lastSeq >= windowStart ? Math.min(lastSeq - windowStart + 1, playlist.segments.length) : 0;
  const newSegments = playlist.segments.slice(newStart);

  if (!newSegments.length) {
    console.log(`[cron] No new segments (cursor=${lastSeq})`);
    return Response.json({ session_id: session.id, new_segments: 0 }, { headers: CORS });
  }

  console.log(`[cron] ${newSegments.length} new segments to transcribe`);

  // ── Identify current speaker (best-effort, doesn't block if null) ─────────
  const currentSpeakerId = await fetchCurrentSpeaker(supabase);
  if (currentSpeakerId) {
    console.log(`[cron] Current speaker hint: ${currentSpeakerId}`);
  }

  // ── Send to transcribe in ~30s batches ────────────────────────────────────
  let totalWords = 0, totalFillers = 0, chunksOk = 0;

  for (let i = 0; i < newSegments.length; i += SEGMENTS_PER_CHUNK) {
    const batch = newSegments.slice(i, i + SEGMENTS_PER_CHUNK);
    try {
      const transcribeHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "x-session-id": session.id,
      };
      if (currentSpeakerId) transcribeHeaders["x-politician-id"] = currentSpeakerId;

      const resp = await fetch(`${FUNCTIONS_URL}/transcribe`, {
        method: "POST",
        headers: transcribeHeaders,
        body: JSON.stringify({ segment_urls: batch, m3u8_url: mediaUrl }),
        signal: AbortSignal.timeout(120_000),
      });
      if (resp.ok) {
        const r = await resp.json() as Record<string, unknown>;
        totalWords   += (r.total_words   as number) ?? 0;
        totalFillers += (r.filler_count  as number) ?? 0;
        chunksOk++;
        console.log(`[cron] chunk ${chunksOk}: "${(r.text as string)?.slice(0, 60)}" (${r.total_words}w ${r.filler_count}f)`);
      } else if (resp.status === 503) {
        console.warn("[cron] HF model loading, will retry next invocation");
        break;
      }
    } catch (e) { console.error("[cron] transcribe error:", e); }
  }

  // ── Update cursor + session stats ─────────────────────────────────────────
  const newCursor   = windowStart + playlist.segments.length - 1;
  const minsAdded   = parseFloat(((newSegments.length * ASSUMED_SEGMENT_S) / 60).toFixed(2));

  await supabase.from("sessions").update({
    last_hls_sequence:      newCursor,
    last_hls_segment:       newSegments[newSegments.length - 1],
    total_filler_count:     (session.total_filler_count    ?? 0) + totalFillers,
    total_speaking_minutes: parseFloat(((session.total_speaking_minutes ?? 0) + minsAdded).toFixed(2)),
  }).eq("id", session.id);

  return Response.json({
    session_id: session.id,
    hls_url: hlsUrl,
    new_segments: newSegments.length,
    chunks_sent: chunksOk,
    total_words: totalWords,
    total_fillers: totalFillers,
  }, { headers: CORS });
});
