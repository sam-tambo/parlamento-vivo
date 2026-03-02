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

// Model preference: large-v3 → large-v3-turbo (smaller/faster fallback).
// The router.huggingface.co endpoint is the current (2025) Inference Providers
// path; api-inference.huggingface.co returns 410 for many models since HF's
// free-tier migration to the new routing layer.
const WHISPER_MODELS = [
  "openai/whisper-large-v3",
  "openai/whisper-large-v3-turbo",
  "openai/whisper-large-v2",
];

// Try both URL patterns per model:
//   1. New router (Inference Providers, current)
//   2. Old api-inference (legacy, still works for some models)
function hfUrls(model: string): string[] {
  return [
    `https://router.huggingface.co/hf-inference/models/${model}`,
    `https://api-inference.huggingface.co/models/${model}`,
  ];
}

// HF Inference API accepts audio in the request body.
// Content-Type must describe the actual audio format so ffmpeg inside HF
// can decode it. For MPEG-TS (from plenario-cron) and WebM (from browser
// MediaRecorder) we use octet-stream and let HF auto-detect; this mirrors
// what worked reliably before the 2025 router migration.
async function transcribeWithHF(
  audioBytes: Uint8Array,
  hfToken: string,
): Promise<string> {
  const errors: string[] = [];

  for (const model of WHISPER_MODELS) {
    for (const url of hfUrls(model)) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hfToken}`,
            "Content-Type": "audio/mpeg",
            "X-Wait-For-Model": "true",
          },
          body: audioBytes as unknown as BodyInit,
          signal: AbortSignal.timeout(60_000),
        });

        if (resp.status === 503) {
          errors.push(`${model} @ ${url.slice(8, 50)}: 503 model loading`);
          continue;
        }

        if (resp.status === 410 || resp.status === 404) {
          errors.push(`${model} @ ${url.slice(8, 50)}: ${resp.status} endpoint gone`);
          continue;
        }

        if (!resp.ok) {
          const body = await resp.text();
          const detail = body.startsWith("<")
            ? `HTTP ${resp.status} (HTML response — check HF token permissions)`
            : `HTTP ${resp.status}: ${body.slice(0, 200)}`;
          errors.push(`${model}: ${detail}`);
          throw new Error(errors.join(" | "));
        }

        const json = await resp.json();
        if (typeof json?.text === "string") return json.text.trim();
        if (Array.isArray(json) && json[0]?.text) return json[0].text.trim();
        throw new Error(`Unexpected HF response: ${JSON.stringify(json).slice(0, 200)}`);

      } catch (e) {
        if (e instanceof Error && e.message.includes(" | ")) throw e;
        errors.push(`${model} @ ${url.slice(8, 50)}: ${(e as Error)?.message ?? e}`);
      }
    }
  }

  throw new Error(`All HF endpoints failed: ${errors.join(" | ")}`);
}

// ─── HLS audio fetcher ───────────────────────────────────────────────────────

/**
 * Fetch HLS segments and return them concatenated as a Uint8Array.
 *
 * Accepts EITHER:
 *   - segment_urls: string[]  — explicit list (preferred; sent by plenario-cron)
 *   - m3u8Url + segmentCount  — legacy: fetch last N from playlist
 *
 * MPEG-TS segments are sent directly to HF Whisper, which accepts them.
 */
async function fetchHLSChunk(
  m3u8Url: string,
  segmentCount: number = 5,
  explicitUrls?: string[],
): Promise<Uint8Array> {
  let segmentUrls: string[];

  if (explicitUrls && explicitUrls.length > 0) {
    // Preferred path: caller already resolved which segments to use
    segmentUrls = explicitUrls;
  } else {
    // Legacy path: take last N from the playlist (may overlap between calls)
    const playlistResp = await fetch(m3u8Url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ParlamentoVivo/1.0)" },
    });
    if (!playlistResp.ok) throw new Error(`M3U8 fetch failed: ${playlistResp.status}`);

    const playlist = await playlistResp.text();
    const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);

    segmentUrls = playlist
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .slice(-segmentCount)
      .map((url) => (url.startsWith("http") ? url : baseUrl + url));
  }

  if (segmentUrls.length === 0) throw new Error("No segments found in playlist");

  // CDN (livextend.cloud and parlamento.pt) requires Referer + Origin from the
  // parliament website; without them the CDN returns 403 host_not_allowed.
  const CDN_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; ParlamentoVivo/1.0)",
    "Referer":    "https://canal.parlamento.pt/",
    "Origin":     "https://canal.parlamento.pt",
  };

  const buffers = await Promise.all(
    segmentUrls.map((url) =>
      fetch(url, { headers: CDN_HEADERS }).then((r) => {
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

// ─── Speaker identification ───────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * Try to identify the speaker from the transcribed text.
 *
 * Whisper often captures Portuguese parliamentary address forms in the audio:
 *   "A Sr.ª NOME tem a palavra"
 *   "O Deputado NOME diz que…"
 *   "Ministra NOME, …"
 *
 * Extract candidate names from these patterns and fuzzy-match against the
 * `politicians` table (both `name` and `full_name` columns).
 *
 * Returns the matching politician's UUID, or null if none found.
 */
async function identifySpeakerFromText(
  text: string,
  supabase: SupabaseClient,
): Promise<string | null> {
  // Patterns common in Portuguese parliamentary audio
  const patterns = [
    // "O Sr. / A Sr.ª / A Sra. Nome" — most common in plenary
    /(?:O\s+Sr\.|A\s+Sr[aª]\.|A\s+Sra\.|O\s+Senhor|A\s+Senhora)\s+([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][a-záéíóúàâêôãõç]+(?:\s+(?:de\s+|da\s+|do\s+)?[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][a-záéíóúàâêôãõç]+)*)/g,
    // "Deputad[ao] Nome" / "Ministr[ao] Nome" / "Secretári[ao] Nome"
    /(?:Deputad[ao]|Ministr[ao]|Secretári[ao]|Presidente)\s+([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][a-záéíóúàâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][a-záéíóúàâêôãõç]+)*)/g,
  ];

  const candidates = new Set<string>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const name = m[1]?.trim();
      if (name && name.length > 3) candidates.add(name);
    }
  }

  if (!candidates.size) return null;

  for (const candidate of candidates) {
    // Try each significant word (>3 chars) as a sub-string match
    const words = candidate.split(/\s+/).filter((w) => w.length > 3);
    for (const word of words) {
      const { data } = await supabase
        .from("politicians")
        .select("id, name")
        .ilike("name", `%${word}%`)
        .limit(1)
        .maybeSingle();
      if (data) {
        console.log(`[transcribe] Speaker from text: "${(data as any).name}" (matched "${word}")`);
        return (data as any).id as string;
      }
    }
  }

  return null;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-session-id, x-politician-id",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const HF_TOKEN = Deno.env.get("HF_TOKEN") ?? "";
  if (!HF_TOKEN) {
    return Response.json({ error: "HF_TOKEN not configured" }, { status: 500, headers: CORS_HEADERS });
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

      if (body.segment_urls && Array.isArray(body.segment_urls) && body.segment_urls.length > 0) {
        // Preferred: explicit segment URL list from plenario-cron (no duplicate processing)
        console.log(`[transcribe] Fetching ${body.segment_urls.length} explicit segments`);
        audioBytes = await fetchHLSChunk("", 0, body.segment_urls);
      } else if (body.m3u8_url) {
        console.log(`[transcribe] Fetching HLS from ${body.m3u8_url}`);
        audioBytes = await fetchHLSChunk(body.m3u8_url, body.segment_count ?? 5);
      } else if (body.audio_url) {
        console.log(`[transcribe] Fetching audio from ${body.audio_url}`);
        const r = await fetch(body.audio_url);
        if (!r.ok) throw new Error(`audio_url fetch failed: ${r.status}`);
        audioBytes = new Uint8Array(await r.arrayBuffer());
      } else {
        return Response.json({ error: "Provide m3u8_url or audio_url" }, { status: 400, headers: CORS_HEADERS });
      }
    } else if (ct.includes("multipart/form-data")) {
      const form  = await req.formData();
      const file  = form.get("audio") as File | null;
      if (!file) return Response.json({ error: "No audio field in form" }, { status: 400, headers: CORS_HEADERS });
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
      const msg = String(e);
      // Only return 503 (retry) when the model is genuinely loading.
      // 410/404 endpoint-gone errors used to be silently wrapped as 503,
      // which hid the real cause and caused infinite "model loading" loops.
      const isLoading = msg.includes("503") || msg.includes("model loading");
      return Response.json(
        { error: msg, retry_after: isLoading ? 20 : null },
        { status: isLoading ? 503 : 502, headers: CORS_HEADERS },
      );
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`[transcribe] HF took ${elapsed}s → "${text.slice(0, 80)}…"`);

    if (!text) {
      return Response.json({ text: "", filler_count: 0, filler_words: {}, total_words: 0 }, { headers: CORS_HEADERS });
    }

    // ── Filler detection ────────────────────────────────────────────────────
    const { count: fillerCount, words: fillerWords } = detectFillers(text);
    const totalWords = text.split(/\s+/).filter(Boolean).length;

    console.log(
      `[transcribe] ${totalWords} words, ${fillerCount} fillers ` +
      `(${((fillerCount / Math.max(totalWords, 1)) * 100).toFixed(1)}%)`
    );

    // ── Resolve politician: header hint → text extraction → null ────────────
    let resolvedPoliticianId: string | null = politicianId;
    if (!resolvedPoliticianId && text) {
      resolvedPoliticianId = await identifySpeakerFromText(text, supabase as any);
    }
    if (resolvedPoliticianId) {
      console.log(`[transcribe] Attributed to politician ${resolvedPoliticianId}`);
    }

    // ── Persist to transcript_events ────────────────────────────────────────
    if (sessionId) {
      const { error } = await supabase.from("transcript_events").insert({
        session_id:         sessionId,
        politician_id:      resolvedPoliticianId,
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
    }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[transcribe] Error:", err);
    return Response.json({ error: String(err) }, { status: 500, headers: CORS_HEADERS });
  }
});
