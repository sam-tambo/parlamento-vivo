/**
 * Supabase Edge Function: scrape-plenario
 * =========================================
 * Fetches historic plenary session data for a given legislatura (default: XVII)
 * from the Portuguese parliament open-data portal and website, then processes
 * each speech for filler words and stores the results in Supabase.
 *
 * Data sources (tried in order, first working source wins):
 *   A. dados.parlamento.pt CKAN API — structured interventions JSON
 *   B. parlamento.pt API endpoints  — session list + DAR transcript metadata
 *   C. parlamento.pt HTML scraping  — parse session list + DAR HTML transcripts
 *
 * POST body:
 *   {
 *     legislatura?: string;    // e.g. "XVII" (default)
 *     batch_size?:  number;    // sessions per call (default 5)
 *     offset?:      number;    // skip first N sessions (for pagination)
 *     job_id?:      string;    // if provided, update progress on this job row
 *   }
 *
 * Returns:
 *   { total_sessions, sessions_processed, speeches_inserted, errors, done }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

// ─── Filler word catalog (same as transcribe function) ────────────────────────

const FILLER_CATALOG: string[] = [
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionInfo {
  date: string;       // YYYY-MM-DD
  number?: number;    // official session number
  dar_url?: string;   // URL to the DAR publication page or HTML transcript
  title?: string;
}

interface SpeechRecord {
  speaker_name: string;
  party?: string;
  text: string;
  duration_minutes?: number;
}

type SupabaseClient = ReturnType<typeof createClient<any>>;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function fetchHtml(url: string, timeoutMs = 20000): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.5",
        "Referer": "https://www.parlamento.pt/",
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

async function fetchJson<T>(url: string, timeoutMs = 15000): Promise<T | null> {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "application/json",
        "Accept-Language": "pt-PT,pt;q=0.9",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    return await r.json() as T;
  } catch { return null; }
}

// ─── Strategy A: dados.parlamento.pt CKAN open-data API ───────────────────────
// The Portuguese parliament publishes datasets on their CKAN-based portal.
// Plenary interventions are available as structured tabular data.

const CKAN_BASE = "https://dados.parlamento.pt/api/3/action";

interface CkanResource {
  id: string;
  name: string;
  description?: string;
  datastore_active: boolean;
}

interface CkanPackage {
  name: string;
  title: string;
  resources: CkanResource[];
}

interface CkanSearchResult {
  success: boolean;
  result: { count: number; results: CkanPackage[] };
}

interface CkanRecord {
  [key: string]: unknown;
}

interface CkanDatastoreResult {
  success: boolean;
  result: {
    records: CkanRecord[];
    total: number;
    fields: { id: string; type: string }[];
  };
}

async function findInterventionsResource(legislatura: string): Promise<string | null> {
  // Search for datasets about plenary interventions
  const searchTerms = [
    "interven%C3%A7%C3%B5es+plen%C3%A1rio",
    "intervencoes+plenario",
    "diario+assembleia",
    "DAR+intervencoes",
  ];

  for (const term of searchTerms) {
    const data = await fetchJson<CkanSearchResult>(
      `${CKAN_BASE}/package_search?q=${term}&rows=20`
    );
    if (!data?.result?.results) continue;

    for (const pkg of data.result.results) {
      for (const resource of (pkg.resources ?? [])) {
        if (!resource.datastore_active) continue;
        const label = `${resource.name} ${resource.description ?? ""}`.toLowerCase();
        if (/intervenc|plen[aá]rio|DAR/i.test(label)) {
          console.log(`[scrape-plenario] CKAN resource found: ${resource.id} (${resource.name})`);
          return resource.id;
        }
      }
    }
  }
  return null;
}

async function fetchFromCkan(
  resourceId: string,
  legislatura: string,
  offset = 0,
  limit = 500,
): Promise<{ records: CkanRecord[]; total: number }> {
  // Try filtering by legislatura field (various possible field names)
  const filterVariants = [
    `{"leg":"${legislatura}"}`,
    `{"legislatura":"${legislatura}"}`,
    `{"Legislatura":"${legislatura}"}`,
    `{}`, // no filter — fetch all and filter client-side
  ];

  for (const filters of filterVariants) {
    const url = `${CKAN_BASE}/datastore_search?resource_id=${resourceId}&limit=${limit}&offset=${offset}&filters=${encodeURIComponent(filters)}`;
    const data = await fetchJson<CkanDatastoreResult>(url);
    if (!data?.result?.records?.length) continue;

    // Check if records have a legislatura field and filter
    const sample = data.result.records[0];
    const legField = Object.keys(sample).find(k => /leg|legislatura/i.test(k));
    let records = data.result.records;
    if (legField && filters === "{}") {
      records = records.filter(r => String(r[legField]).toUpperCase() === legislatura.toUpperCase());
    }

    if (records.length > 0) {
      console.log(`[scrape-plenario] CKAN: ${records.length} records (offset=${offset})`);
      return { records, total: data.result.total };
    }
  }

  return { records: [], total: 0 };
}

/**
 * Map CKAN record fields to our internal SpeechRecord format.
 * Field names vary between versions of the dataset.
 */
function mapCkanRecord(record: CkanRecord): { date: string; speech: SpeechRecord } | null {
  // Date field
  const dateField = Object.keys(record).find(k => /^(data|date|Data|Date)$/.test(k));
  const rawDate = dateField ? String(record[dateField]) : null;
  if (!rawDate) return null;

  // Parse date (DD-MM-YYYY or YYYY-MM-DD or DD/MM/YYYY)
  let date: string;
  if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
    date = rawDate.slice(0, 10);
  } else if (/^\d{2}[-/]\d{2}[-/]\d{4}/.test(rawDate)) {
    const [d, m, y] = rawDate.split(/[-/]/);
    date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  } else {
    return null;
  }

  // Speaker name
  const nameField = Object.keys(record).find(k =>
    /^(orador|nome|interveniente|deputado|speaker|nome_completo|NomeDepOrador)$/i.test(k)
  );
  const speaker_name = nameField ? String(record[nameField]).trim() : null;
  if (!speaker_name || speaker_name.length < 3) return null;

  // Party
  const partyField = Object.keys(record).find(k => /^(partido|party|GP|grupo)/i.test(k));
  const party = partyField ? String(record[partyField]).trim() : undefined;

  // Speech text
  const textField = Object.keys(record).find(k =>
    /^(texto|text|interven|discurso|speech|conteudo)/i.test(k)
  );
  const text = textField ? String(record[textField]).trim() : null;
  if (!text || text.length < 10) return null;

  return { date, speech: { speaker_name, party, text } };
}

// ─── Strategy B: parlamento.pt REST API ──────────────────────────────────────
// The parliament website uses internal JSON API endpoints.

interface DarPublication {
  id?: number | string;
  numero?: number | string;
  data?: string;
  dataPublicacao?: string;
  titulo?: string;
  url?: string;
  linkPdf?: string;
  linkHtml?: string;
}

async function fetchDarPublicationsFromApi(legislatura: string): Promise<SessionInfo[]> {
  // Try several known/guessed API patterns
  const endpoints = [
    `https://www.parlamento.pt/API/ApiActDar/GetDarPublicacoes?type=DAR1S&leg=${legislatura}`,
    `https://app.parlamento.pt/api/DAR/publicacoes?tipo=DAR1S&leg=${legislatura}`,
    `https://www.parlamento.pt/DAR/api/publicacoes?tipo=1S&legislatura=${legislatura}`,
  ];

  for (const url of endpoints) {
    const data = await fetchJson<DarPublication[] | { result: DarPublication[] }>(url);
    if (!data) continue;

    const pubs = Array.isArray(data) ? data : (data as { result?: DarPublication[] }).result ?? [];
    if (!pubs.length) continue;

    console.log(`[scrape-plenario] API: ${pubs.length} DAR publications from ${url}`);
    return pubs.map(p => ({
      date: normalizeDate(p.data ?? p.dataPublicacao ?? ""),
      number: typeof p.numero === "number" ? p.numero : parseInt(String(p.numero ?? "0")),
      dar_url: p.linkHtml ?? p.url ?? p.linkPdf ?? undefined,
    })).filter(s => s.date);
  }

  return [];
}

function normalizeDate(raw: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{2}[-/]\d{2}[-/]\d{4}/.test(raw)) {
    const [d, m, y] = raw.split(/[-/]/);
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Try parsing as a date string
  try { return new Date(raw).toISOString().slice(0, 10); } catch { return ""; }
}

// ─── Strategy C: parlamento.pt HTML scraping ─────────────────────────────────

async function fetchSessionListFromWeb(legislatura: string): Promise<SessionInfo[]> {
  // The parliament website lists plenário sessions by legislatura
  const urls = [
    `https://www.parlamento.pt/atividade/sessoes-plenarias?leg=${legislatura}`,
    `https://www.parlamento.pt/atividade/paginas/sessaoplenaria.aspx?leg=${legislatura}`,
    `https://www.parlamento.pt/DAR/Paginas/DAR1SPublicacoes.aspx?leg=${legislatura}`,
  ];

  for (const url of urls) {
    const html = await fetchHtml(url);
    if (!html) continue;

    const sessions = parseSessionListHtml(html, url);
    if (sessions.length > 0) {
      console.log(`[scrape-plenario] Web: ${sessions.length} sessions from ${url}`);
      return sessions;
    }
  }

  // Last resort: known URL pattern for XVII Legislatura session listing
  // Fallback produces a synthetic list of known session dates
  console.warn("[scrape-plenario] Could not fetch session list from website");
  return [];
}

function parseSessionListHtml(html: string, baseUrl: string): SessionInfo[] {
  const sessions: SessionInfo[] = [];
  const seen = new Set<string>();

  // Pattern 1: links to individual DAR/session pages with a date
  const patterns = [
    // <a href="...DAR1SDetalhe.aspx?ID=1234">...</a> near a date
    /href="([^"]*(?:DAR1SDetalhe|SessaoPlenaria|sessao-plenaria)[^"]*ID=(\d+)[^"]*)"[^>]*>/gi,
    // Links with a date visible in the URL or nearby text
    /href="([^"]*(?:plen[aá]rio|sessao)[^"]*)"[^>]*>[\s\S]{0,200}?(\d{2}[/-]\d{2}[/-]\d{4})/gi,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      let href = m[1];
      if (!href.startsWith("http")) {
        const base = new URL(baseUrl);
        href = `${base.origin}${href.startsWith("/") ? "" : "/"}${href}`;
      }

      // Try to extract date from nearby context
      const ctx = html.substring(Math.max(0, m.index - 200), m.index + 200);
      const dateM = ctx.match(/(\d{2}[/-]\d{2}[/-]\d{4})/);
      const date = dateM ? normalizeDate(dateM[1]) : "";

      if (!seen.has(href)) {
        seen.add(href);
        sessions.push({ date, dar_url: href });
      }
    }
  }

  // Pattern 2: date-only entries (no explicit link to transcript)
  if (sessions.length === 0) {
    const dateRe = /(\d{2}[/-]\d{2}[/-]\d{4})/g;
    let dm;
    while ((dm = dateRe.exec(html)) !== null) {
      const date = normalizeDate(dm[1]);
      if (date && !seen.has(date)) {
        seen.add(date);
        sessions.push({ date });
      }
    }
  }

  return sessions.filter(s => s.date).slice(0, 500);
}

// ─── DAR transcript parsing ───────────────────────────────────────────────────

async function fetchTranscriptSpeeches(session: SessionInfo): Promise<SpeechRecord[]> {
  if (!session.dar_url) return [];

  const html = await fetchHtml(session.dar_url, 30000);
  if (!html) return [];

  return parseTranscriptHtml(html);
}

function parseTranscriptHtml(html: string): SpeechRecord[] {
  const speeches: SpeechRecord[] = [];

  // Strip HTML tags for text extraction
  const stripTags = (s: string) =>
    s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
     .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
     .replace(/\s{2,}/g, " ").trim();

  // ── Pattern 1: Speaker label followed by text ─────────────────────────────
  // <b>O Sr. NOME (PARTY):</b> — text text text
  // <b>A Sr.ª NOME (PARTY):</b> — text text text
  const speakerBlockRe =
    /<b[^>]*>\s*(?:O\s+Sr\.|A\s+Sr[aª]\.|O\s+Senhor|A\s+Senhora|Presidente|Ministr[ao])\s+([^(<\n]{3,80})(?:\s*\(([^)]{2,20})\))?\s*:<\/b>([\s\S]{20,3000}?)(?=<b[^>]*>(?:O\s+Sr\.|A\s+Sr[aª]\.|O\s+Senhor|A\s+Senhora|Presidente|Ministr[ao])|$)/gi;

  let m;
  while ((m = speakerBlockRe.exec(html)) !== null) {
    const speaker_name = stripTags(m[1]).trim();
    const party = m[2]?.trim() || undefined;
    const text = stripTags(m[3]).trim();
    if (speaker_name && text.length > 20) {
      speeches.push({ speaker_name, party, text });
    }
  }

  if (speeches.length > 0) return speeches;

  // ── Pattern 2: Named div blocks ───────────────────────────────────────────
  // <div class="nomeOrador">NAME</div>...<div class="texto">TEXT</div>
  const divSpeakerRe = /<div[^>]*class="[^"]*(?:nomeOrador|nome-orador|OradorTitulo|orador)[^"]*"[^>]*>([\s\S]{2,100}?)<\/div>([\s\S]{0,2000}?)<div[^>]*class="[^"]*(?:texto|Texto|speech|intervencao)[^"]*"[^>]*>([\s\S]{20,5000}?)<\/div>/gi;

  while ((m = divSpeakerRe.exec(html)) !== null) {
    const speaker_name = stripTags(m[1]).trim();
    const text = stripTags(m[3]).trim();
    if (speaker_name && text.length > 20) {
      speeches.push({ speaker_name, text });
    }
  }

  if (speeches.length > 0) return speeches;

  // ── Pattern 3: Broad fallback — "CAPS NAME (PARTY):" blocks ──────────────
  // Portuguese parliamentary style: ALL CAPS name followed by colon
  const capsRe = /([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][A-ZÁÉÍÓÚÀÂÊÔÃÕÇ\s]{5,50}?)\s*(?:\(([A-Z]{1,10})\))?\s*—\s*((?:[^—]{20,1000}?)?)(?=[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ]{5}|$)/g;
  while ((m = capsRe.exec(html)) !== null) {
    const speaker_name = m[1].trim();
    const party = m[2]?.trim() || undefined;
    const text = m[3].trim();
    if (speaker_name && text.length > 20) {
      speeches.push({ speaker_name, party, text });
    }
  }

  return speeches;
}

// ─── Speaker → politician matching ───────────────────────────────────────────

// In-memory cache per invocation to avoid N queries for recurring speakers
const speakerCache = new Map<string, string | null>();

async function matchPolitician(
  supabase: SupabaseClient,
  speakerName: string,
  party?: string,
): Promise<string | null> {
  const cacheKey = `${speakerName}|${party ?? ""}`;
  if (speakerCache.has(cacheKey)) return speakerCache.get(cacheKey)!;

  // Clean up the name: remove titles (Sr., Sra., Deputado, Ministr*, etc.)
  const clean = speakerName
    .replace(/^(?:O\s+|A\s+)?(?:Sr[aª]?\.|Senhor[a]?|Deputad[ao]|Ministr[ao]|Secretári[ao]|Presidente|Dr\.?|Eng\.?)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean || clean.length < 3) {
    speakerCache.set(cacheKey, null);
    return null;
  }

  // Strategy 1: exact name match (case-insensitive)
  const { data: exact } = await supabase
    .from("politicians")
    .select("id, name, party")
    .ilike("name", clean)
    .limit(1)
    .maybeSingle();

  if (exact) {
    speakerCache.set(cacheKey, exact.id as string);
    return exact.id as string;
  }

  // Strategy 2: fuzzy — try each significant word (>3 chars, not a particle)
  const PARTICLES = new Set(["para", "pela", "pelo", "como", "mais", "sobre", "entre"]);
  const words = clean.split(/\s+/).filter(w => w.length > 3 && !PARTICLES.has(w.toLowerCase()));

  for (const word of words) {
    let q = supabase
      .from("politicians")
      .select("id, name, party")
      .ilike("name", `%${word}%`)
      .limit(5);

    // If party hint available, bias toward it (but don't require it)
    const { data: matches } = await q;
    if (!matches?.length) continue;

    // Prefer party match when available
    if (party) {
      const partyMatch = matches.find(p =>
        (p.party as string).toUpperCase().includes(party.toUpperCase()) ||
        party.toUpperCase().includes((p.party as string).toUpperCase())
      );
      if (partyMatch) {
        speakerCache.set(cacheKey, partyMatch.id as string);
        return partyMatch.id as string;
      }
    }

    // Prefer matches where more words from the name overlap
    const best = matches.reduce<{ id: string; score: number } | null>((acc, pol) => {
      const polName = (pol.name as string).toLowerCase();
      const score = words.filter(w => polName.includes(w.toLowerCase())).length;
      return !acc || score > acc.score ? { id: pol.id as string, score } : acc;
    }, null);

    if (best && best.score > 0) {
      speakerCache.set(cacheKey, best.id);
      return best.id;
    }
  }

  speakerCache.set(cacheKey, null);
  return null;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function findOrCreateSession(
  supabase: SupabaseClient,
  date: string,
  legislatura: string,
  darUrl?: string,
  sessionNumber?: number,
): Promise<string | null> {
  if (!date) return null;

  // Look for existing session on this date (don't filter by legislatura —
  // the column may not yet exist in the live DB before migration 011 runs)
  const { data: existing } = await supabase
    .from("sessions")
    .select("id")
    .eq("date", date)
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id as string;

  // Create new historic session — try with new columns first,
  // fall back to basic columns if migration 011 hasn't run yet.
  const fullPayload = {
    date,
    legislatura,
    status: "completed",
    transcript_status: "completed",
    dar_url: darUrl ?? null,
    session_number: sessionNumber ?? null,
  };

  const { data: created, error } = await supabase
    .from("sessions")
    .insert(fullPayload)
    .select("id")
    .single();

  if (!error) return created.id as string;

  // If error mentions unknown columns (migration 011 not yet applied), retry
  // without the new columns so speeches can still be stored.
  if (
    error.message.includes("legislatura") ||
    error.message.includes("dar_url") ||
    error.message.includes("session_number") ||
    error.message.includes("column") ||
    error.code === "42703"  // PostgreSQL: undefined_column
  ) {
    const { data: fallback, error: e2 } = await supabase
      .from("sessions")
      .insert({ date, status: "completed", transcript_status: "completed" })
      .select("id")
      .single();
    if (!e2 && fallback) return fallback.id as string;
    console.error(`[scrape-plenario] Session fallback insert failed:`, e2?.message);
    return null;
  }

  console.error(`[scrape-plenario] Error creating session for ${date}:`, error.message);
  return null;
}

async function insertSpeech(
  supabase: SupabaseClient,
  sessionId: string,
  politicianId: string | null,
  speech: SpeechRecord,
): Promise<boolean> {
  const { count, words } = detectFillers(speech.text);
  const totalWords = speech.text.split(/\s+/).filter(Boolean).length;
  const fillerRatio = totalWords > 0 ? count / totalWords : 0;

  // politician_id may be null when speaker name couldn't be matched.
  // After migration 010 this column is nullable; before that migration,
  // only insert when we have a politician ID to avoid NOT NULL errors.
  const payload: Record<string, unknown> = {
    session_id: sessionId,
    speaking_duration_seconds: (speech.duration_minutes ?? 0) * 60,
    filler_word_count: count,
    total_word_count: totalWords,
    filler_ratio: fillerRatio,
    transcript_excerpt: speech.text.slice(0, 500),
    filler_words_detail: words,
  };
  if (politicianId) payload.politician_id = politicianId;

  const { error } = await supabase.from("speeches").insert(payload);

  if (error) {
    // If politician_id is still NOT NULL in the DB (pre-migration 010) and
    // we have no match, skip this speech silently — nothing we can do yet.
    if (
      error.message.includes("violates not-null") ||
      error.message.includes("null value in column") ||
      error.message.includes("violates foreign key")
    ) {
      return false;
    }
    console.warn("[scrape-plenario] Speech insert error:", error.message);
    return false;
  }
  return true;
}

// ─── Main orchestration ───────────────────────────────────────────────────────

async function processCkanData(
  supabase: SupabaseClient,
  legislatura: string,
  batchSize: number,
  offset: number,
): Promise<{ sessions_processed: number; speeches_inserted: number; total: number; errors: string[] }> {
  const errors: string[] = [];
  let sessions_processed = 0;
  let speeches_inserted = 0;

  // 1. Find resource
  const resourceId = await findInterventionsResource(legislatura);
  if (!resourceId) {
    errors.push("CKAN: no interventions resource found");
    return { sessions_processed, speeches_inserted, total: 0, errors };
  }

  // 2. Fetch batch of records
  const { records, total } = await fetchFromCkan(resourceId, legislatura, offset, batchSize);
  if (!records.length) {
    return { sessions_processed, speeches_inserted, total, errors };
  }

  // 3. Group records by date (each date = one session)
  const byDate = new Map<string, SpeechRecord[]>();
  for (const record of records) {
    const mapped = mapCkanRecord(record);
    if (!mapped) continue;
    if (!byDate.has(mapped.date)) byDate.set(mapped.date, []);
    byDate.get(mapped.date)!.push(mapped.speech);
  }

  // 4. Process each session
  for (const [date, speeches] of byDate) {
    const sessionId = await findOrCreateSession(supabase, date, legislatura);
    if (!sessionId) continue;
    sessions_processed++;

    for (const speech of speeches) {
      const politicianId = await matchPolitician(supabase, speech.speaker_name, speech.party);
      const inserted = await insertSpeech(supabase, sessionId, politicianId, speech);
      if (inserted) speeches_inserted++;
    }
  }

  return { sessions_processed, speeches_inserted, total, errors };
}

async function processWebData(
  supabase: SupabaseClient,
  legislatura: string,
  batchSize: number,
  offset: number,
): Promise<{ sessions_processed: number; speeches_inserted: number; total: number; errors: string[] }> {
  const errors: string[] = [];
  let sessions_processed = 0;
  let speeches_inserted = 0;

  // 1. Fetch session list
  let sessions = await fetchDarPublicationsFromApi(legislatura);
  if (!sessions.length) sessions = await fetchSessionListFromWeb(legislatura);
  if (!sessions.length) {
    errors.push("Web: could not fetch session list from parlamento.pt");
    return { sessions_processed, speeches_inserted, total: 0, errors };
  }

  // Sort by date descending (most recent first for XVII)
  sessions.sort((a, b) => b.date.localeCompare(a.date));
  const total = sessions.length;
  const batch = sessions.slice(offset, offset + batchSize);

  // 2. Process each session in the batch
  for (const session of batch) {
    const sessionId = await findOrCreateSession(
      supabase, session.date, legislatura, session.dar_url, session.number
    );
    if (!sessionId) continue;
    sessions_processed++;

    // 3. Fetch and parse transcript
    const speeches = await fetchTranscriptSpeeches(session);
    console.log(`[scrape-plenario] ${session.date}: ${speeches.length} speeches`);

    // 4. Process each speech
    for (const speech of speeches) {
      const politicianId = await matchPolitician(supabase, speech.speaker_name, speech.party);
      const inserted = await insertSpeech(supabase, sessionId, politicianId, speech);
      if (inserted) speeches_inserted++;
    }
  }

  return { sessions_processed, speeches_inserted, total, errors };
}

// ─── CORS + main handler ──────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const supabase = createClient<any>(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Parse request body
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { /* defaults */ }
    }

    const legislatura = String(body.legislatura ?? "XVII").toUpperCase();
    const batchSize   = Math.min(Number(body.batch_size ?? 5), 20);
    const offset      = Number(body.offset ?? 0);
    const jobId       = body.job_id ? String(body.job_id) : null;

    console.log(`[scrape-plenario] legislatura=${legislatura} batch=${batchSize} offset=${offset}`);

    // Update job status to running — wrap in try/catch because the
    // plenario_import_jobs table may not exist before migration 011 runs.
    if (jobId) {
      try {
        await supabase.from("plenario_import_jobs").update({ status: "running" }).eq("id", jobId);
      } catch { /* table not yet created */ }
    }

    const allErrors: string[] = [];
    let sessions_processed = 0;
    let speeches_inserted  = 0;
    let total_sessions     = 0;

    // ── Try Strategy A: CKAN open data ──────────────────────────────────────
    const ckanResult = await processCkanData(supabase, legislatura, batchSize * 100, offset * 100);
    if (ckanResult.speeches_inserted > 0 || ckanResult.sessions_processed > 0) {
      sessions_processed += ckanResult.sessions_processed;
      speeches_inserted  += ckanResult.speeches_inserted;
      total_sessions      = Math.max(total_sessions, ckanResult.total);
      allErrors.push(...ckanResult.errors);
      console.log(`[scrape-plenario] CKAN: ${sessions_processed} sessions, ${speeches_inserted} speeches`);
    } else {
      allErrors.push(...ckanResult.errors);
    }

    // ── Try Strategy B+C: parliament.pt API + web scraping ─────────────────
    // Run regardless to supplement any CKAN gaps (CKAN might not have all sessions)
    const webResult = await processWebData(supabase, legislatura, batchSize, offset);
    sessions_processed += webResult.sessions_processed;
    speeches_inserted  += webResult.speeches_inserted;
    total_sessions      = Math.max(total_sessions, webResult.total);
    allErrors.push(...webResult.errors);

    // ── Update job progress if job_id provided ───────────────────────────────
    const done = total_sessions > 0 && (offset + batchSize) >= total_sessions;

    if (jobId) {
      try {
        await supabase.from("plenario_import_jobs").update({
          sessions_processed: offset + sessions_processed,
          speeches_inserted,
          total_sessions,
          status: done ? "completed" : allErrors.length > 0 && sessions_processed === 0 ? "error" : "running",
          error_message: allErrors.length > 0 ? allErrors.join("; ") : null,
          completed_at: done ? new Date().toISOString() : null,
        }).eq("id", jobId);
      } catch { /* plenario_import_jobs table not yet created — non-fatal */ }
    }

    return Response.json({
      success: true,
      legislatura,
      sessions_processed,
      speeches_inserted,
      total_sessions,
      done,
      offset,
      next_offset: done ? null : offset + batchSize,
      errors: allErrors.length > 0 ? allErrors : undefined,
    }, { headers: CORS });

  } catch (err) {
    console.error("[scrape-plenario] Fatal error:", err);

    return Response.json(
      { success: false, error: String(err) },
      { status: 500, headers: CORS }
    );
  }
});
