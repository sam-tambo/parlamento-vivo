/**
 * Browser-side plenário importer
 * ================================
 * Runs entirely in the browser — no edge function deployment required.
 *
 * Data sources (tried in order):
 *   1. dados.parlamento.pt CKAN API — discovers CSV/XLS resources and
 *      downloads them directly (datastore not required)
 *   2. Known dataset slugs on dados.parlamento.pt — tried by name pattern
 *   3. parlamento.pt REST API — session/intervention endpoints
 *   4. parlamento.pt DAR HTML — session dates from the plenary listing
 *      (no speech text, but creates session records for the legislatura)
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Legislaturas catalogue ───────────────────────────────────────────────────

export interface LegislaturaInfo {
  code: string;
  label: string;
  start: string;      // YYYY-MM-DD
  end: string | null; // null = ongoing
  romNum: string;     // roman numeral used in API calls
}

export const LEGISLATURAS: LegislaturaInfo[] = [
  { code: "XVII", label: "XVII Legislatura", start: "2024-03-10", end: null,         romNum: "XVII" },
  { code: "XVI",  label: "XVI Legislatura",  start: "2022-03-29", end: "2024-03-09", romNum: "XVI"  },
  { code: "XV",   label: "XV Legislatura",   start: "2019-10-25", end: "2022-03-28", romNum: "XV"   },
  { code: "XIV",  label: "XIV Legislatura",  start: "2015-10-23", end: "2019-10-24", romNum: "XIV"  },
  { code: "XIII", label: "XIII Legislatura", start: "2011-06-20", end: "2015-10-22", romNum: "XIII" },
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

export function detectFillers(text: string): { count: number; words: Record<string, number> } {
  let remaining = text.toLowerCase();
  const words: Record<string, number> = {};
  for (const filler of FILLER_CATALOG) {
    const esc = filler.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${esc}\\b`, "gi");
    const hits = remaining.match(re);
    if (hits?.length) {
      words[filler] = hits.length;
      remaining = remaining.replace(re, " ".repeat(filler.length));
    }
  }
  return { count: Object.values(words).reduce((s, n) => s + n, 0), words };
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function safeFetch(url: string, timeoutMs = 20_000): Promise<Response | null> {
  try {
    const r = await fetch(url, {
      headers: { Accept: "*/*", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok ? r : null;
  } catch { return null; }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const r = await safeFetch(url);
  if (!r) return null;
  try { return await r.json() as T; } catch { return null; }
}

async function fetchText(url: string, timeoutMs = 60_000): Promise<string | null> {
  const r = await safeFetch(url, timeoutMs);
  if (!r) return null;
  try { return await r.text(); } catch { return null; }
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

/** Parse a semicolon- or comma-delimited CSV into an array of row objects */
function parseCSV(raw: string): Record<string, string>[] {
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detect delimiter: semicolon wins if header has more ';' than ','
  const sep = (lines[0].split(";").length >= lines[0].split(",").length) ? ";" : ",";

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let field = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { field += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === sep && !inQ) {
        out.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }
    out.push(field.trim());
    return out;
  };

  const headers = parseLine(lines[0]).map(h => h.replace(/^\uFEFF/, "")); // strip BOM
  return lines.slice(1).map(line => {
    const vals = parseLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
}

// ─── Raw speech type ──────────────────────────────────────────────────────────

export interface RawSpeech {
  date: string;       // YYYY-MM-DD
  speakerName: string;
  party?: string;
  text: string;
}

/** Normalise various date string formats → YYYY-MM-DD */
function normaliseDate(raw: string): string {
  if (!raw) return "";
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{2}[-/]\d{2}[-/]\d{4}/.test(s)) {
    const [d, m, y] = s.split(/[-/]/);
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  try { return new Date(s).toISOString().slice(0, 10); } catch { return ""; }
}

/** Map a record (from CSV or CKAN datastore) to RawSpeech */
function mapRecord(row: Record<string, string | unknown>): RawSpeech | null {
  const str = (v: unknown) => String(v ?? "").trim();

  // Date — try many field name variants
  const dateKey = Object.keys(row).find(k =>
    /^(data|date|DataSessao|data_sessao|DataPublicacao|DataReuniao)$/i.test(k)
  );
  const date = dateKey ? normaliseDate(str(row[dateKey])) : "";
  if (!date) return null;

  // Speaker name
  const nameKey = Object.keys(row).find(k =>
    /^(orador|nome|autor|interveniente|deputado|NomeDepOrador|NomeOrador|nome_orador|nome_deputado|speaker)$/i.test(k)
  );
  const speakerName = nameKey ? str(row[nameKey]) : "";
  if (!speakerName || speakerName.length < 2) return null;

  // Party
  const partyKey = Object.keys(row).find(k => /^(partido|party|GP|grupo_parlamentar|gp)$/i.test(k));
  const party = partyKey ? str(row[partyKey]) || undefined : undefined;

  // Speech text
  const textKey = Object.keys(row).find(k =>
    /^(texto|text|intervencao|interven|discurso|conteudo|TextoInterv|Texto)$/i.test(k)
  );
  const text = textKey ? str(row[textKey]) : "";
  if (!text || text.length < 15) return null;

  return { date, speakerName, party, text };
}

// ─── CKAN discovery ───────────────────────────────────────────────────────────

const CKAN = "https://dados.parlamento.pt/api/3/action";

interface CkanResource {
  id: string;
  name: string;
  format: string;
  url: string;
  datastore_active: boolean;
  description?: string;
}
interface CkanPackage {
  name: string;
  title: string;
  resources: CkanResource[];
}

type FoundResource =
  | { kind: "datastore"; id: string }
  | { kind: "csv";       url: string };

/** Returns all candidate packages from CKAN for a broad search term */
async function ckanSearch(q: string): Promise<CkanPackage[]> {
  const data = await fetchJson<{
    success: boolean;
    result: { results: CkanPackage[] };
  }>(`${CKAN}/package_search?q=${q}&rows=30&sort=score+desc`);
  return data?.result?.results ?? [];
}

/** Pick the best resource from a list (datastore > CSV > XLS > any) */
function pickResource(resources: CkanResource[]): FoundResource | null {
  // 1. datastore resource (fastest API)
  const ds = resources.find(r => r.datastore_active);
  if (ds) return { kind: "datastore", id: ds.id };

  // 2. CSV download
  const csv = resources.find(r => /csv/i.test(r.format) && r.url);
  if (csv) return { kind: "csv", url: csv.url };

  // 3. XLS/XLSX (will try to fetch as CSV)
  const xls = resources.find(r => /xls/i.test(r.format) && r.url);
  if (xls) return { kind: "csv", url: xls.url };

  // 4. Any resource with a download URL
  const any = resources.find(r => r.url);
  if (any) return { kind: "csv", url: any.url };

  return null;
}

const KNOWN_SLUGS = [
  // Most likely based on CKAN conventions for PT parliament
  "interv-pleno-dal",
  "intervencoes-plenario",
  "intervencoes-em-plenario",
  "atividade-parlamentar-plenario",
  "interven-plenario",
  "dai-plenario",
  "dar-plenario",
  "atividade-parlamentar-intervencoes-plenario",
  "discursos-plenario",
  "sessoes-plenarias",
  "sessoes-plenario",
  "reunioes-plenarias",
  "destaques-plenario",
];

const PLENARY_RE = /plen|interven|discur|sessao|reuni|dar[^e]/i;

async function findResource(legislatura: string): Promise<FoundResource | null> {
  // 1. Try known slugs directly (package_show is faster than search)
  for (const slug of KNOWN_SLUGS) {
    const pkg = await fetchJson<{ success: boolean; result: CkanPackage }>(
      `${CKAN}/package_show?id=${slug}`
    );
    if (pkg?.success && pkg.result?.resources?.length) {
      const found = pickResource(pkg.result.resources);
      if (found) { console.log(`[importer] CKAN hit: ${slug}`); return found; }
    }
  }

  // 2. Enumerate ALL packages and filter by name (most thorough)
  const allPkgs = await fetchJson<{ success: boolean; result: string[] }>(
    `${CKAN}/package_list`
  );
  if (allPkgs?.success && allPkgs.result?.length) {
    const candidates = allPkgs.result.filter(n => PLENARY_RE.test(n));
    console.log(`[importer] CKAN package_list: ${candidates.length} candidate(s):`, candidates);
    for (const slug of candidates) {
      const pkg = await fetchJson<{ success: boolean; result: CkanPackage }>(
        `${CKAN}/package_show?id=${slug}`
      );
      if (pkg?.success && pkg.result?.resources?.length) {
        const found = pickResource(pkg.result.resources);
        if (found) { console.log(`[importer] package_list hit: ${slug}`); return found; }
      }
    }
    // If no resource in plenary-named packages, try the first package with any downloadable resource
    // (sometimes the portal has one big dataset with all interventions)
    for (const slug of allPkgs.result) {
      const pkg = await fetchJson<{ success: boolean; result: CkanPackage }>(
        `${CKAN}/package_show?id=${slug}`
      );
      if (pkg?.success && pkg.result?.resources?.length) {
        const label = (pkg.result.name + " " + pkg.result.title).toLowerCase();
        if (!PLENARY_RE.test(label)) continue;
        const found = pickResource(pkg.result.resources);
        if (found) { console.log(`[importer] package_list full hit: ${slug}`); return found; }
      }
    }
  }

  // 3. Full-text search with multiple query terms
  const searchTerms = [
    "intervencoes+plenario",
    "plenario",
    "atividade+parlamentar",
    "DAR",
  ];

  for (const term of searchTerms) {
    const pkgs = await ckanSearch(term);
    for (const pkg of pkgs) {
      const label = (pkg.name + " " + pkg.title).toLowerCase();
      if (!PLENARY_RE.test(label)) continue;
      const found = pickResource(pkg.resources ?? []);
      if (found) { console.log(`[importer] CKAN search hit: ${pkg.name}`); return found; }
    }
  }

  return null;
}

// ─── Fetch speeches from a found resource ────────────────────────────────────

async function speechesFromDatastore(
  id: string,
  legislatura: string,
  offset: number,
  limit: number,
): Promise<{ speeches: RawSpeech[]; total: number }> {
  // Try with legislatura filter first
  for (const filters of [
    `{"leg":"${legislatura}"}`,
    `{"legislatura":"${legislatura}"}`,
    `{"Legislatura":"${legislatura}"}`,
    "{}",
  ]) {
    const url = `${CKAN}/datastore_search?resource_id=${id}&limit=${limit}&offset=${offset}&filters=${encodeURIComponent(filters)}`;
    const data = await fetchJson<{ success: boolean; result: { records: Record<string, unknown>[]; total: number } }>(url);
    if (!data?.result?.records) continue;

    let records = data.result.records;
    if (filters === "{}") {
      // Filter client-side by legislatura
      const legKey = Object.keys(records[0] ?? {}).find(k => /leg|legislatura/i.test(k));
      if (legKey) records = records.filter(r => String(r[legKey]).toUpperCase() === legislatura.toUpperCase());
    }
    if (!records.length) continue;

    return {
      speeches: records
        .map(r => mapRecord(r as Record<string, string>))
        .filter((s): s is RawSpeech => s !== null),
      total: data.result.total,
    };
  }
  return { speeches: [], total: 0 };
}

async function speechesFromCsv(
  csvUrl: string,
  legislatura: string,
): Promise<RawSpeech[]> {
  console.log(`[importer] Downloading CSV: ${csvUrl}`);
  const text = await fetchText(csvUrl, 120_000);
  if (!text) return [];

  const rows = parseCSV(text);
  console.log(`[importer] CSV rows: ${rows.length}`);

  // Find the legislatura column
  const legKey = Object.keys(rows[0] ?? {}).find(k => /leg|legislatura/i.test(k));

  const filtered = legKey
    ? rows.filter(r => String(r[legKey] ?? "").toUpperCase() === legislatura.toUpperCase())
    : rows; // if no leg column, use all rows

  return filtered
    .map(mapRecord)
    .filter((s): s is RawSpeech => s !== null);
}

// ─── Fallback: parliament.pt REST API ─────────────────────────────────────────
// Even if CKAN has no speech text, we can discover session dates and
// create session records in the DB from the parliament's own API.

async function sessionDatesFromParliamentApi(legislatura: string): Promise<string[]> {
  // Try several known parliament.pt API endpoints for session/DAR publications
  const endpoints = [
    `https://www.parlamento.pt/API/ApiActDar/GetDarPublicacoes?type=DAR1S&leg=${legislatura}`,
    `https://www.parlamento.pt/API/ApiActDar/GetDarPublicacoes?type=DAR1S&legislatura=${legislatura}`,
    `https://app.parlamento.pt/api/DAR/publicacoes?tipo=DAR1S&leg=${legislatura}`,
    `https://www.parlamento.pt/API/ApiSDAR/GetPublicacoesDar?tipo=DAR1S&leg=${legislatura}`,
    `https://www.parlamento.pt/API/ApiSDAR/GetPublicacoesDar?tipo=I+Serie&legislatura=${legislatura}`,
  ];
  for (const url of endpoints) {
    const raw = await fetchJson<unknown>(url);
    // Could be { result: [...] } or just [...]
    const arr = Array.isArray(raw) ? raw : (raw as Record<string,unknown>)?.result
      ?? (raw as Record<string,unknown>)?.data ?? null;
    if (!Array.isArray(arr) || !arr.length) continue;
    const dates = arr
      .map((p: unknown) => {
        const pub = p as Record<string, unknown>;
        const raw = pub.data ?? pub.dataPublicacao ?? pub.DataPublicacao
          ?? pub.DataSessao ?? pub.dataSessao ?? pub.date ?? "";
        return normaliseDate(String(raw));
      })
      .filter(Boolean);
    if (dates.length) {
      console.log(`[importer] Parliament API ${url}: ${dates.length} sessions`);
      return [...new Set(dates)]; // deduplicate
    }
  }
  return [];
}

// ─── Speaker → politician matching ───────────────────────────────────────────

const matchCache = new Map<string, string | null>();

async function matchPolitician(
  sb: SupabaseClient,
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
  const { data: exact } = await sb.from("politicians").select("id, party").ilike("name", clean).limit(1).maybeSingle();
  if (exact) { matchCache.set(key, exact.id as string); return exact.id as string; }

  // Fuzzy word match
  const SKIP = new Set(["para", "pela", "pelo", "como", "mais", "sobre", "entre", "que"]);
  const words = clean.split(/\s+/).filter(w => w.length > 3 && !SKIP.has(w.toLowerCase()));

  for (const word of words) {
    const { data: hits } = await sb.from("politicians").select("id, name, party").ilike("name", `%${word}%`).limit(5);
    if (!hits?.length) continue;

    if (party) {
      const pm = hits.find(h =>
        (h.party as string).toUpperCase().includes(party.toUpperCase()) ||
        party.toUpperCase().includes((h.party as string).toUpperCase())
      );
      if (pm) { matchCache.set(key, pm.id as string); return pm.id as string; }
    }

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
  sb: SupabaseClient,
  date: string,
  legislatura: string,
): Promise<string | null> {
  if (!date) return null;
  if (sessionCache.has(date)) return sessionCache.get(date)!;

  const { data: ex } = await sb.from("sessions").select("id").eq("date", date).limit(1).maybeSingle();
  if (ex) { sessionCache.set(date, ex.id as string); return ex.id as string; }

  // Try with new columns (migration 011), fall back to basic
  for (const payload of [
    { date, legislatura, status: "completed", transcript_status: "completed" },
    { date,              status: "completed", transcript_status: "completed" },
  ]) {
    const { data: c, error: e } = await sb.from("sessions").insert(payload).select("id").single();
    if (!e && c) { sessionCache.set(date, c.id as string); return c.id as string; }
    // Bail on first attempt only if it's NOT a column-not-found error
    if (e && e.code !== "42703" && !e.message.includes("column")) break;
  }
  return null;
}

// ─── Progress types ───────────────────────────────────────────────────────────

export interface ImportProgress {
  legislatura: string;
  status: "idle" | "running" | "done" | "error";
  speechesInserted: number;
  sessionsCreated: number;
  totalFetched: number;
  source?: string;
  error?: string;
}
export type ProgressCallback = (p: ImportProgress) => void;

// ─── Main export ──────────────────────────────────────────────────────────────

export async function importLegislatura(
  sb: SupabaseClient,
  legislatura: string,
  onProgress: ProgressCallback,
  signal?: AbortSignal,
): Promise<ImportProgress> {
  matchCache.clear();
  sessionCache.clear();

  const prog: ImportProgress = {
    legislatura,
    status: "running",
    speechesInserted: 0,
    sessionsCreated: 0,
    totalFetched: 0,
  };
  onProgress({ ...prog });

  const upsertSpeeches = async (speeches: RawSpeech[]) => {
    for (const sp of speeches) {
      if (signal?.aborted) break;
      const sessionId = await findOrCreateSession(sb, sp.date, legislatura);
      if (!sessionId) continue;
      if (!sessionCache.has(sp.date)) prog.sessionsCreated++;

      const polId = await matchPolitician(sb, sp.speakerName, sp.party);
      const { count, words } = detectFillers(sp.text);
      const total = sp.text.split(/\s+/).filter(Boolean).length;

      const payload: Record<string, unknown> = {
        session_id: sessionId,
        speaking_duration_seconds: 0,
        filler_word_count: count,
        total_word_count: total,
        filler_ratio: total > 0 ? count / total : 0,
        transcript_excerpt: sp.text.slice(0, 500),
        filler_words_detail: words,
      };
      if (polId) payload.politician_id = polId;

      const { error } = await sb.from("speeches").insert(payload);
      if (!error) {
        prog.speechesInserted++;
        prog.totalFetched++;
        onProgress({ ...prog });
      }
    }
  };

  try {
    // ── Strategy 1: CKAN ─────────────────────────────────────────────────────
    const resource = await findResource(legislatura);

    if (resource) {
      if (resource.kind === "datastore") {
        prog.source = "dados.parlamento.pt (datastore)";
        onProgress({ ...prog });
        let offset = 0;
        let total = Infinity;
        while (offset < total) {
          if (signal?.aborted) break;
          const { speeches, total: t } = await speechesFromDatastore(resource.id, legislatura, offset, 200);
          if (!speeches.length) break;
          total = t;
          offset += 200;
          await upsertSpeeches(speeches);
          if (speeches.length < 200) break;
        }
      } else {
        prog.source = "dados.parlamento.pt (CSV)";
        onProgress({ ...prog });
        const speeches = await speechesFromCsv(resource.url, legislatura);
        prog.totalFetched = speeches.length;
        onProgress({ ...prog });
        await upsertSpeeches(speeches);
      }
    }

    // ── Strategy 2: parliament.pt API (session dates only) ───────────────────
    // Even when CKAN has no speech text, we can still create session records.
    if (prog.sessionsCreated === 0 && !signal?.aborted) {
      prog.source = "parlamento.pt (datas de sessão)";
      onProgress({ ...prog });
      const dates = await sessionDatesFromParliamentApi(legislatura);
      for (const date of dates) {
        if (signal?.aborted) break;
        const id = await findOrCreateSession(sb, date, legislatura);
        if (id) prog.sessionsCreated++;
      }
      onProgress({ ...prog });
    }

    if (prog.speechesInserted === 0 && prog.sessionsCreated === 0 && !signal?.aborted) {
      return {
        ...prog,
        status: "error",
        error:
          "Não foi possível obter dados desta legislatura. " +
          "O dados.parlamento.pt pode não ter intervenções disponíveis para este período, " +
          "ou a API pode estar temporariamente indisponível.",
      };
    }

    prog.status = signal?.aborted ? "error" : "done";
    if (signal?.aborted) prog.error = "Cancelado";
    onProgress({ ...prog });
    return { ...prog };

  } catch (err) {
    const result = { ...prog, status: "error" as const, error: String(err) };
    onProgress(result);
    return result;
  }
}
