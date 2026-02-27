/**
 * Supabase Edge Function: transcribe
 * ==================================
 * Full serverless pipeline for one ~30-second audio chunk:
 *
 *   1. Receive audio:
 *        POST /functions/v1/transcribe
 *        Body: multipart/form-data  { audio: <file> }
 *        OR    application/json     { audio_url: "https://..." }
 *        OR    application/octet-stream  (raw audio bytes)
 *
 *   2. If audio_url provided: fetch the bytes server-side
 *      (keeps HLS segment URLs off the client)
 *
 *   3. Call HF Inference API → openai/whisper-large-v3
 *
 *   4. Run Portuguese filler-word detection (same catalog as src/lib/filler-words.ts)
 *
 *   5. Insert row into transcript_events (triggers Supabase Realtime to the UI)
 *
 *   6. Return { text, filler_count, filler_words, total_words }
 *
 * Called by:
 *   - plenario-cron edge function (every 30 s, serverless loop)
 *   - Python ai_worker.py (can POST pre-captured WAV chunks)
 *   - Future: browser MediaRecorder for live microphone capture
 *
 * Secrets required (set in Supabase dashboard → Settings → Edge Functions):
 *   HF_TOKEN             — HuggingFace token with Whisper access
 *   SUPABASE_URL         — auto-injected by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

// ─── Filler word catalog (mirrors src/lib/filler-words.ts) ───────────────────

const FILLER_CATALOG: string[] = [
  // stallers (longest first for greedy match)
  "como direi", "de certa forma", "de alguma maneira", "por assim dizer",
  "de certa maneira", "de algum modo",
  // connectors
  "portanto", "ou seja", "de facto", "na verdade",
  // hesitation / filler
  "quer dizer", "digamos", "basicamente", "efetivamente",
  "pronto", "enfim", "olhe", "tipo", "ok", "bem", "ora", "pois",
  "assim", "então", "depois", "exatamente", "claro",
  "obviamente", "naturalmente", "certamente", "ah", "eh", "hm",
].sort((a, b) => b.length - a.length); // longest first

function detectFillers(text: string): { count: number; words: Record<string, number> } {
  let remaining = text.toLowerCase();
  const words: Record<string, number> = {};

  for (const filler of FILLER_CATALOG) {
    const escaped = filler.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    const hits = remaining.match(re);
    if (hits?.length) {
      words[filler] = hits.length;
      remaining = remaining.replace(re, " ".repeat(filler.length));
    }
  }

  const count = Object.values(words).reduce((s, n) => s + n, 0);
  return { count, words };
}

// ─── HF Whisper API ──────────────────────────────────────────────────────────

const WHISPER_MODEL = "openai/whisper-large-v3";
const HF_API = `https://api-inference.huggingface.co/models/${WHISPER_MODEL}`;

// HF Inference API accepts audio in the request body.
// We send raw bytes + let it auto-detect the format.
async function transcribeWithHF(
  audioBytes: Uint8Array,
  hfToken: string,
): Promise<string> {
  const resp = await fetch(HF_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hfToken}`,
      "Content-Type": "application/octet-stream",
      // Ask Whisper to return the full text (not streaming)
      "X-Wait-For-Model": "true",
    },
    body: audioBytes,
  });

  if (!resp.ok) {
    const err = await resp.text();
    // Model may be loading — retry hint included in response
    throw new Error(`HF API ${resp.status}: ${err.slice(0, 300)}`);
  }

  const json = await resp.json();
  // Response shape: { text: "..." }  or  [{ text: "..." }]
  if (typeof json?.text === "string") return json.text.trim();
  if (Array.isArray(json) && json[0]?.text) return json[0].text.trim();
  throw new Error(`Unexpected HF response: ${JSON.stringify(json).slice(0, 200)}`);
}

// ─── HLS audio fetcher ───────────────────────────────────────────────────────

/**
 * Given a .m3u8 playlist URL, fetch the last `segmentCount` .ts segments
 * and return them concatenated as a Uint8Array.
 *
 * MPEG-TS segments are sent directly to HF Whisper, which accepts them.
 */
async function fetchHLSChunk(
  m3u8Url: string,
  segmentCount: number = 5,
): Promise<Uint8Array> {
  const playlistResp = await fetch(m3u8Url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ParlamentoVivo/1.0)" },
  });
  if (!playlistResp.ok) throw new Error(`M3U8 fetch failed: ${playlistResp.status}`);

  const playlist = await playlistResp.text();
  const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);

  const segmentUrls = playlist
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .slice(-segmentCount)
    .map((url) => (url.startsWith("http") ? url : baseUrl + url));

  if (segmentUrls.length === 0) throw new Error("No segments found in playlist");

  const buffers = await Promise.all(
    segmentUrls.map((url) =>
      fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ParlamentoVivo/1.0)" },
      }).then((r) => {
        if (!r.ok) throw new Error(`Segment fetch failed: ${r.status} ${url}`);
        return r.arrayBuffer();
      })
    )
  );

  const total = buffers.reduce((s, b) => s + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    out.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return out;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, x-session-id, x-politician-id",
      },
    });
  }

  const HF_TOKEN = Deno.env.get("HF_TOKEN") ?? "";
  if (!HF_TOKEN) {
    return Response.json({ error: "HF_TOKEN not configured" }, { status: 500 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Parse session / politician from headers ──────────────────────────────
  const sessionId    = req.headers.get("x-session-id")    ?? null;
  const politicianId = req.headers.get("x-politician-id") ?? null;

  try {
    // ── Acquire audio bytes ─────────────────────────────────────────────────
    let audioBytes: Uint8Array;
    const ct = req.headers.get("content-type") ?? "";

    if (ct.includes("application/json")) {
      // Caller passed { audio_url, m3u8_url, segment_count? }
      const body = await req.json();

      if (body.m3u8_url) {
        console.log(`[transcribe] Fetching HLS from ${body.m3u8_url}`);
        audioBytes = await fetchHLSChunk(body.m3u8_url, body.segment_count ?? 5);
      } else if (body.audio_url) {
        console.log(`[transcribe] Fetching audio from ${body.audio_url}`);
        const r = await fetch(body.audio_url);
        if (!r.ok) throw new Error(`audio_url fetch failed: ${r.status}`);
        audioBytes = new Uint8Array(await r.arrayBuffer());
      } else {
        return Response.json({ error: "Provide m3u8_url or audio_url" }, { status: 400 });
      }
    } else if (ct.includes("multipart/form-data")) {
      const form  = await req.formData();
      const file  = form.get("audio") as File | null;
      if (!file) return Response.json({ error: "No audio field in form" }, { status: 400 });
      audioBytes = new Uint8Array(await file.arrayBuffer());
    } else {
      // Raw bytes (application/octet-stream or audio/*)
      audioBytes = new Uint8Array(await req.arrayBuffer());
    }

    console.log(`[transcribe] Audio size: ${audioBytes.byteLength} bytes`);

    // ── Transcribe ──────────────────────────────────────────────────────────
    const startMs = Date.now();
    let text: string;
    try {
      text = await transcribeWithHF(audioBytes, HF_TOKEN);
    } catch (e) {
      // Model loading — tell the caller to retry
      return Response.json({ error: String(e), retry_after: 20 }, { status: 503 });
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`[transcribe] HF took ${elapsed}s → "${text.slice(0, 80)}…"`);

    if (!text) {
      return Response.json({ text: "", filler_count: 0, filler_words: {}, total_words: 0 });
    }

    // ── Filler detection ────────────────────────────────────────────────────
    const { count: fillerCount, words: fillerWords } = detectFillers(text);
    const totalWords = text.split(/\s+/).filter(Boolean).length;

    console.log(
      `[transcribe] ${totalWords} words, ${fillerCount} fillers ` +
      `(${((fillerCount / Math.max(totalWords, 1)) * 100).toFixed(1)}%)`
    );

    // ── Persist to transcript_events ────────────────────────────────────────
    if (sessionId) {
      const { error } = await supabase.from("transcript_events").insert({
        session_id:         sessionId,
        politician_id:      politicianId,
        text_segment:       text,
        filler_count:       fillerCount,
        total_words:        totalWords,
        filler_words_found: fillerWords,
        duration_seconds:   null,
      });
      if (error) console.error("[transcribe] Supabase insert error:", error.message);
    }

    return Response.json({
      text,
      filler_count:  fillerCount,
      filler_words:  fillerWords,
      total_words:   totalWords,
      elapsed_s:     parseFloat(elapsed),
    });
  } catch (err) {
    console.error("[transcribe] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
