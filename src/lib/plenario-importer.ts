/**
 * Browser-side plenário importer
 * ================================
 * Runs entirely in the browser — no edge function deployment required.
 *
 * Data flow:
 *   1. Query dados.parlamento.pt CKAN API for intervention records
 *   2. Group records by session date
 *   3. Find/create session rows in Supabase
 *   4. Match speaker names to politicians (fuzzy)
 *   5. Run Portuguese filler-word detection
 *   6. Insert speeches via Supabase client
 *
 * The CKAN REST API at dados.parlamento.pt is public and supports CORS,
 * so no proxy is needed from the browser.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Legislaturas catalogue ───────────────────────────────────────────────────

export interface LegislaturaInfo {
  code: string;     // e.g. "XVII"
  label: string;    // human-readable
  start: string;    // YYYY-MM-DD approx
  end: string | null; // null = ongoing
}

export const LEGISLATURAS: LegislaturaInfo[] = [
  { code: "XVII", label: "XVII Legislatura",  start: "2024-03-10", end: null          },
  { code: "XVI",  label: "XVI Legislatura",   start: "2022-03-29", end: "2024-03-09"  },
  { code: "XV",   label: "XV Legislatura",    start: "2019-10-25", end: "2022-03-28"  },
  { code: "XIV",  label: "XIV Legislatura",   start: "2015-10-23", end: "2019-10-24"  },
  { code: "XIII", label: "XIII Legislatura",  start: "2011-06-20", end: "2015-10-22"  },
];

// ─── Filler word catalog ──────────────────────────────────────────────────────

const FILLER_CATALOG = [
  "como direi", "de certa forma", "de alguma maneira", "por assim dizer",
  "de certa maneira", "de algum modo",
  "portanto", "ou seja", "de facto", "na verdade",
  "quer dizer", "digamos", "basicamente", "efetivamente",
  "pronto", "enfim", "olhe", "tipo", "ok", "bem", "ora", "pois",
  "assim", "então", "depois", "exatamente", "claro",
  "obviamente", "naturalmente", "certamente", "ah", "eh", "hm",
].sort((a, b) => b.length - a.length);

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
  return { count: Object.values(words).reduce((s, n) => s + n, 0), words };
}

// ─── CKAN API helpers ─────────────────────────────────────────────────────────

const CKAN = "https://dados.parlamento.pt/api/3/action";

interface CkanRecord { [key: string]: unknown }
interface CkanResult  { success: boolean; result: { records: CkanRecord[]; total: number } }

async function ckanFetch<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${CKAN}/${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    return await r.json() as T;
  } catch { return null; }
}

/** Dynamically discover the resource ID for plenary interventions */
async function findInterventionsResource(legislatura: string): Promise<string | null> {
  const queries = [
    `interven%C3%A7%C3%B5es+plen%C3%A1rio+${legislatura}`,
    `intervencoes+plenario`,
    `diario+republica+plenario`,
    `atividade+plenario`,
  ];
  for (const q of queries) {
    const data = await ckanFetch<{
      success: boolean;
      result: { results: Array<{ name: string; title: string; resources: Array<{ id: string; name: string; datastore_active: boolean }> }> };
    }>(`package_search?q=${q}&rows=20`);
    if (!data?.result?.results) continue;
    for (const pkg of data.result.results) {
      for (const res of pkg.resources ?? []) {
        if (!res.datastore_active) continue;
        if (/intervenc|plen[aá]rio/i.test(res.name + pkg.title)) return res.id;
      }
    }
  }
  return null;
}

export interface RawSpeech {
  date: string;
  speakerName: string;
  party?: string;
  text: string;
}

/** Map a CKAN record to our internal format, trying many field name variants */
function mapRecord(record: CkanRecord): RawSpeech | null {
  // Date
  const dateKey = Object.keys(record).find(k => /^(data|date|Data|Date)$/.test(k));
  if (!dateKey) return null;
  const raw = String(record[dateKey] ?? "");
  let date = "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw))         date = raw.slice(0, 10);
  else if (/^\d{2}[-/]\d{2}[-/]\d{4}/.test(raw)) {
    const [d, m, y] = raw.split(/[-/]/);
    date = `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  if (!date) return null;

  // Speaker
  const nameKey = Object.keys(record).find(k =>
    /^(orador|nome|interveniente|deputado|speaker|NomeDepOrador|nome_deputado)$/i.test(k)
  );
  const speakerName = nameKey ? String(record[nameKey]).trim() : "";
  if (!speakerName || speakerName.length < 2) return null;

  // Party
  const partyKey = Object.keys(record).find(k => /^(partido|party|gp|grupo)$/i.test(k));
  const party = partyKey ? String(record[partyKey]).trim() : undefined;

  // Text
  const textKey = Object.keys(record).find(k =>
    /^(texto|text|interven|discurso|speech|conteudo)$/i.test(k)
  );
  const text = textKey ? String(record[textKey]).trim() : "";
  if (!text || text.length < 15) return null;

  return { date, speakerName, party, text };
}

/** Fetch a batch of speeches from CKAN datastore */
async function fetchCkanBatch(
  resourceId: string,
  legislatura: string,
  offset: number,
  limit: number,
): Promise<{ speeches: RawSpeech[]; total: number }> {
  const legFilters = encodeURIComponent(JSON.stringify({ leg: legislatura }));
  const path = `datastore_search?resource_id=${resourceId}&limit=${limit}&offset=${offset}&filters=${legFilters}`;
  const data = await ckanFetch<CkanResult>(path);

  if (!data?.result?.records?.length) {
    // Try without filter — fetch all and filter client-side
    const all = await ckanFetch<CkanResult>(
      `datastore_search?resource_id=${resourceId}&limit=${limit}&offset=${offset}`
    );
    if (!all?.result?.records) return { speeches: [], total: 0 };

    // Check if there's a leg field
    const sample = all.result.records[0] ?? {};
    const legKey = Object.keys(sample).find(k => /leg|legislatura/i.test(k));

    const filtered = legKey
      ? all.result.records.filter(r => String(r[legKey]).toUpperCase() === legislatura.toUpperCase())
      : all.result.records;

    return {
      speeches: filtered.map(mapRecord).filter((s): s is RawSpeech => s !== null),
      total: all.result.total,
    };
  }

  return {
    speeches: data.result.records.map(mapRecord).filter((s): s is RawSpeech => s !== null),
    total: data.result.total,
  };
}

// ─── Speaker → politician matching ───────────────────────────────────────────

const matchCache = new Map<string, string | null>();

async function matchPolitician(
  supabase: SupabaseClient,
  speakerName: string,
  party?: string,
): Promise<string | null> {
  const key = `${speakerName}|${party ?? ""}`;
  if (matchCache.has(key)) return matchCache.get(key)!;

  const clean = speakerName
    .replace(/^(?:O\s+|A\s+)?(?:Sr[aª]?\.|Senhor[a]?|Deputad[ao]|Ministr[ao]|Secretári[ao]|Presidente|Dr\.?|Eng\.?)\s*/i, "")
    .replace(/\s+/g, " ").trim();

  if (clean.length < 3) { matchCache.set(key, null); return null; }

  // Exact match
  const { data: exact } = await supabase
    .from("politicians")
    .select("id, party")
    .ilike("name", clean)
    .limit(1)
    .maybeSingle();
  if (exact) { matchCache.set(key, exact.id as string); return exact.id as string; }

  // Word-by-word fuzzy
  const SKIP = new Set(["para", "pela", "pelo", "como", "mais", "sobre", "entre", "que"]);
  const words = clean.split(/\s+/).filter(w => w.length > 3 && !SKIP.has(w.toLowerCase()));

  for (const word of words) {
    const { data: hits } = await supabase
      .from("politicians")
      .select("id, name, party")
      .ilike("name", `%${word}%`)
      .limit(5);
    if (!hits?.length) continue;

    // Prefer party match
    if (party) {
      const pm = hits.find(h =>
        (h.party as string).toUpperCase().includes(party.toUpperCase()) ||
        party.toUpperCase().includes((h.party as string).toUpperCase())
      );
      if (pm) { matchCache.set(key, pm.id as string); return pm.id as string; }
    }

    // Prefer most name-word overlap
    const best = hits.reduce<{ id: string; score: number } | null>((acc, h) => {
      const score = words.filter(w => (h.name as string).toLowerCase().includes(w.toLowerCase())).length;
      return (!acc || score > acc.score) ? { id: h.id as string, score } : acc;
    }, null);
    if (best?.score) { matchCache.set(key, best.id); return best.id; }
  }

  matchCache.set(key, null);
  return null;
}

// ─── Session helpers ──────────────────────────────────────────────────────────

const sessionCache = new Map<string, string>();

async function findOrCreateSession(
  supabase: SupabaseClient,
  date: string,
  legislatura: string,
): Promise<string | null> {
  if (!date) return null;
  if (sessionCache.has(date)) return sessionCache.get(date)!;

  // Check existing
  const { data: ex } = await supabase
    .from("sessions")
    .select("id")
    .eq("date", date)
    .limit(1)
    .maybeSingle();
  if (ex) { sessionCache.set(date, ex.id as string); return ex.id as string; }

  // Try inserting with new columns (migration 011), fall back to basic
  const fullPayload = { date, legislatura, status: "completed", transcript_status: "completed" };
  const { data: c1, error: e1 } = await supabase.from("sessions").insert(fullPayload).select("id").single();
  if (!e1 && c1) { sessionCache.set(date, c1.id as string); return c1.id as string; }

  // Fallback without new columns
  const { data: c2 } = await supabase
    .from("sessions")
    .insert({ date, status: "completed", transcript_status: "completed" })
    .select("id")
    .single();
  if (c2) { sessionCache.set(date, c2.id as string); return c2.id as string; }

  return null;
}

// ─── Progress types ───────────────────────────────────────────────────────────

export interface ImportProgress {
  legislatura: string;
  status: "idle" | "running" | "done" | "error";
  speechesInserted: number;
  sessionsCreated: number;
  totalFetched: number;
  error?: string;
}

export type ProgressCallback = (update: ImportProgress) => void;

// ─── Main export: import one legislatura in batches ──────────────────────────

const BATCH = 200;  // records per CKAN request

export async function importLegislatura(
  supabase: SupabaseClient,
  legislatura: string,
  onProgress: ProgressCallback,
  signal?: AbortSignal,
): Promise<ImportProgress> {
  matchCache.clear();
  sessionCache.clear();

  const progress: ImportProgress = {
    legislatura,
    status: "running",
    speechesInserted: 0,
    sessionsCreated: 0,
    totalFetched: 0,
  };

  onProgress({ ...progress });

  try {
    // 1. Find the CKAN resource
    const resourceId = await findInterventionsResource(legislatura);
    if (!resourceId) {
      return {
        ...progress,
        status: "error",
        error: `Nenhum dataset encontrado no dados.parlamento.pt para ${legislatura}`,
      };
    }

    // 2. Paginate through all records
    let offset = 0;
    let totalRecords = Infinity;

    while (offset < totalRecords) {
      if (signal?.aborted) break;

      const { speeches, total } = await fetchCkanBatch(resourceId, legislatura, offset, BATCH);
      totalRecords = total || (speeches.length < BATCH ? offset + speeches.length : Infinity);
      offset += BATCH;
      progress.totalFetched += speeches.length;

      // 3. Process each speech
      for (const speech of speeches) {
        if (signal?.aborted) break;

        const sessionId = await findOrCreateSession(supabase, speech.date, legislatura);
        if (!sessionId) continue;

        // Count as new session only on first time we create it
        if (!sessionCache.has(speech.date)) progress.sessionsCreated++;

        const politicianId = await matchPolitician(supabase, speech.speakerName, speech.party);
        const { count, words } = detectFillers(speech.text);
        const totalWords = speech.text.split(/\s+/).filter(Boolean).length;

        const payload: Record<string, unknown> = {
          session_id: sessionId,
          speaking_duration_seconds: 0,
          filler_word_count: count,
          total_word_count: totalWords,
          filler_ratio: totalWords > 0 ? count / totalWords : 0,
          transcript_excerpt: speech.text.slice(0, 500),
          filler_words_detail: words,
        };
        if (politicianId) payload.politician_id = politicianId;

        const { error } = await supabase.from("speeches").insert(payload);
        if (!error) {
          progress.speechesInserted++;
          onProgress({ ...progress });
        }
      }

      // No more records
      if (speeches.length < BATCH || speeches.length === 0) break;
    }

    progress.status = signal?.aborted ? "error" : "done";
    if (signal?.aborted) progress.error = "Cancelado";
    onProgress({ ...progress });
    return progress;

  } catch (err) {
    const error = String(err);
    const result: ImportProgress = { ...progress, status: "error", error };
    onProgress(result);
    return result;
  }
}
