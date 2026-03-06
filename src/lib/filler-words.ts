/**
 * Portuguese parliamentary filler-word detection engine
 * ======================================================
 * Catalog covers four categories ordered longest-first so multi-word phrases
 * always match before their component single words.
 *
 * Matching is accent-insensitive and case-insensitive (see accentStrip()).
 * Positions in the stripped string map 1:1 to the original because each
 * Portuguese accented character decomposes (NFD) to base + combining accent;
 * after removing the combining accents the base chars stay at the same index.
 */

export type FillerCategory = "hesitation" | "connector" | "filler" | "staller";

export interface FillerWord {
  word:     string;
  category: FillerCategory;
  severity: "low" | "medium" | "high";
}

export const FILLER_CATALOG: FillerWord[] = [
  // ── Stallers — multi-word delay/hedging phrases (longest first) ──────────
  { word: "como é que eu hei de dizer", category: "staller", severity: "high"   },
  { word: "a verdade é que",            category: "staller", severity: "high"   },
  { word: "como é que se diz",          category: "staller", severity: "high"   },
  { word: "é preciso dizer",            category: "staller", severity: "high"   },
  { word: "tenho de dizer",             category: "staller", severity: "high"   },
  { word: "se me permitem",             category: "staller", severity: "medium" },
  { word: "não é verdade",              category: "staller", severity: "medium" },
  { word: "vamos lá ver",               category: "staller", severity: "medium" },
  { word: "como é óbvio",               category: "staller", severity: "high"   },
  { word: "devo dizer",                 category: "staller", severity: "medium" },
  { word: "quero dizer",                category: "staller", severity: "medium" },
  { word: "como sabem",                 category: "staller", severity: "medium" },
  { word: "dito isto",                  category: "staller", severity: "medium" },
  { word: "de qualquer forma",          category: "staller", severity: "high"   },
  { word: "de alguma forma",            category: "staller", severity: "high"   },
  { word: "de certa forma",             category: "staller", severity: "high"   },
  { word: "de alguma maneira",          category: "staller", severity: "high"   },
  { word: "de certa maneira",           category: "staller", severity: "medium" },
  { word: "de algum modo",              category: "staller", severity: "medium" },
  { word: "por assim dizer",            category: "staller", severity: "high"   },
  { word: "digamos assim",              category: "staller", severity: "high"   },
  { word: "como direi",                 category: "staller", severity: "high"   },
  { word: "está a ver",                 category: "staller", severity: "medium" },
  { word: "se calhar",                  category: "staller", severity: "medium" },
  { word: "no fundo",                   category: "staller", severity: "medium" },
  { word: "por acaso",                  category: "staller", severity: "low"    },
  { word: "repare-se",                  category: "staller", severity: "medium" },
  { word: "olhe que",                   category: "staller", severity: "medium" },
  { word: "pois bem",                   category: "staller", severity: "medium" },
  { word: "pois é",                     category: "staller", severity: "low"    },
  { word: "ora bem",                    category: "staller", severity: "low"    },
  { word: "não é",                      category: "staller", severity: "low"    },

  // ── Connectors — discourse markers overused as padding ───────────────────
  { word: "ou seja",                    category: "connector", severity: "high"   },
  { word: "quer dizer",                 category: "connector", severity: "medium" },
  { word: "isto é",                     category: "connector", severity: "medium" },
  { word: "de facto",                   category: "connector", severity: "medium" },
  { word: "na verdade",                 category: "connector", severity: "medium" },
  { word: "e então",                    category: "connector", severity: "low"    },
  { word: "portanto",                   category: "connector", severity: "high"   },
  { word: "assim",                      category: "connector", severity: "low"    },
  { word: "então",                      category: "connector", severity: "low"    },
  { word: "depois",                     category: "connector", severity: "low"    },

  // ── Hesitation — pauses disguised as words or sounds ─────────────────────
  { word: "digamos",                    category: "hesitation", severity: "medium" },
  { word: "humm",                       category: "hesitation", severity: "low"    },
  { word: "uhm",                        category: "hesitation", severity: "low"    },
  { word: "ahm",                        category: "hesitation", severity: "low"    },
  { word: "ehm",                        category: "hesitation", severity: "low"    },
  { word: "mmm",                        category: "hesitation", severity: "low"    },
  { word: "hum",                        category: "hesitation", severity: "low"    },
  { word: "bem",                        category: "hesitation", severity: "low"    },
  { word: "ora",                        category: "hesitation", severity: "low"    },
  { word: "pois",                       category: "hesitation", severity: "low"    },
  { word: "bom",                        category: "hesitation", severity: "low"    },
  { word: "ah",                         category: "hesitation", severity: "low"    },
  { word: "eh",                         category: "hesitation", severity: "low"    },
  { word: "hm",                         category: "hesitation", severity: "low"    },
  { word: "uh",                         category: "hesitation", severity: "low"    },
  { word: "um",                         category: "hesitation", severity: "low"    },

  // ── True fillers — semantically empty words used as verbal tics ──────────
  { word: "fundamentalmente",           category: "filler", severity: "high"   },
  { word: "essencialmente",             category: "filler", severity: "high"   },
  { word: "honestamente",               category: "filler", severity: "medium" },
  { word: "sinceramente",               category: "filler", severity: "medium" },
  { word: "eventualmente",              category: "filler", severity: "medium" },
  { word: "evidentemente",              category: "filler", severity: "medium" },
  { word: "nomeadamente",               category: "filler", severity: "medium" },
  { word: "francamente",                category: "filler", severity: "medium" },
  { word: "basicamente",                category: "filler", severity: "high"   },
  { word: "efetivamente",               category: "filler", severity: "medium" },
  { word: "obviamente",                 category: "filler", severity: "medium" },
  { word: "naturalmente",               category: "filler", severity: "low"    },
  { word: "certamente",                 category: "filler", severity: "low"    },
  { word: "exatamente",                 category: "filler", severity: "low"    },
  { word: "percebem",                   category: "filler", severity: "medium" },
  { word: "percebe",                    category: "filler", severity: "medium" },
  { word: "repare",                     category: "filler", severity: "medium" },
  { word: "pronto",                     category: "filler", severity: "high"   },
  { word: "enfim",                      category: "filler", severity: "medium" },
  { word: "claro",                      category: "filler", severity: "low"    },
  { word: "olhe",                       category: "filler", severity: "medium" },
  { word: "tipo",                       category: "filler", severity: "medium" },
  { word: "ok",                         category: "filler", severity: "medium" },
];

// ── Colour palette ────────────────────────────────────────────────────────────
export const CATEGORY_COLORS: Record<FillerCategory, string> = {
  hesitation: "hsl(200 80% 55%)",   // blue
  connector:  "hsl(45  80% 55%)",   // amber
  filler:     "hsl(10  80% 55%)",   // red-orange
  staller:    "hsl(280 70% 55%)",   // purple
};

export const CATEGORY_LABELS: Record<FillerCategory, string> = {
  hesitation: "Hesitação",
  connector:  "Conector",
  filler:     "Enchimento",
  staller:    "Atraso",
};

export interface TextSegment {
  text:        string;
  isFiller:    boolean;
  fillerWord?: FillerWord;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Strip diacritics and lowercase for accent-insensitive comparison. */
function accentStrip(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Regex that matches a (normalized) filler word as a whole token.
 * \b is avoided because JS \w is ASCII-only and misses accented Portuguese
 * chars; instead we require the match to be preceded/followed by a
 * non-lowercase-ASCII char (space, punctuation, digit, or string edge).
 */
function fillerRegex(normWord: string): RegExp {
  const esc = normWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|(?<=[^a-z]))${esc}(?=[^a-z]|$)`, "gi");
}

// Pre-sort once (longest first) for greedy, non-overlapping matching.
const SORTED_CATALOG = [...FILLER_CATALOG].sort((a, b) => b.word.length - a.word.length);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Split a transcript into filler and non-filler segments for inline rendering.
 * Case- and accent-insensitive.  Multi-word phrases win over single words.
 */
export function segmentTranscript(text: string): TextSegment[] {
  if (!text) return [{ text: "", isFiller: false }];

  const normText = accentStrip(text);
  const hits: Array<{ start: number; end: number; fw: FillerWord }> = [];

  for (const fw of SORTED_CATALOG) {
    const re = fillerRegex(accentStrip(fw.word));
    let m: RegExpExecArray | null;
    while ((m = re.exec(normText)) !== null) {
      const start = m.index;
      const end   = start + m[0].length;
      if (!hits.some(h => start < h.end && end > h.start)) {
        hits.push({ start, end, fw });
      }
    }
  }

  hits.sort((a, b) => a.start - b.start);

  // Slice from the ORIGINAL text using positions from the normalized string —
  // valid because accent-stripped positions are 1:1 with original positions.
  const segs: TextSegment[] = [];
  let pos = 0;
  for (const { start, end, fw } of hits) {
    if (pos < start) segs.push({ text: text.slice(pos, start), isFiller: false });
    segs.push({ text: text.slice(start, end), isFiller: true, fillerWord: fw });
    pos = end;
  }
  if (pos < text.length) segs.push({ text: text.slice(pos), isFiller: false });

  return segs.length ? segs : [{ text, isFiller: false }];
}

/** Count filler occurrences per word; overlapping ranges are never double-counted. */
export function countFillers(text: string): Record<string, number> {
  if (!text) return {};

  const normText = accentStrip(text);
  const result: Record<string, number> = {};
  const consumed = new Uint8Array(normText.length);

  for (const fw of SORTED_CATALOG) {
    const re = fillerRegex(accentStrip(fw.word));
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(normText)) !== null) {
      const start = m.index, end = start + m[0].length;
      if (!consumed.subarray(start, end).some(Boolean)) {
        count++;
        consumed.fill(1, start, end);
      }
    }
    if (count > 0) result[fw.word] = count;
  }
  return result;
}

/**
 * Detect immediate word repetitions — "nós nós nós", "ou seja ou seja".
 * Returns each repeated token once (lowercased).
 */
export function detectRepetitions(text: string): string[] {
  const words    = text.trim().split(/\s+/);
  const repeated = new Set<string>();

  for (let i = 0; i + 1 < words.length; i++) {
    const clean = (w: string) => w.toLowerCase().replace(/[^\p{L}]/gu, "");
    const a = clean(words[i]);
    const b = clean(words[i + 1]);
    if (a && a === b && a.length > 2) repeated.add(a);

    // Two-word repetitions ("ou seja ou seja")
    if (i + 3 < words.length) {
      const w0 = words[i].toLowerCase(), w1 = words[i + 1].toLowerCase();
      const w2 = words[i + 2].toLowerCase(), w3 = words[i + 3].toLowerCase();
      if (w0 === w2 && w1 === w3) repeated.add(`${w0} ${w1}`);
    }
  }
  return [...repeated];
}

/** Grade a filler ratio (0–1) with a label and colour. */
export function gradeFillerRate(ratio: number): { label: string; color: string } {
  const pct = ratio * 100;
  if (pct < 1)  return { label: "Excelente",  color: "hsl(145 60% 45%)" };
  if (pct < 3)  return { label: "Bom",         color: "hsl(160 50% 45%)" };
  if (pct < 5)  return { label: "Aceitável",   color: "hsl(45  80% 55%)" };
  if (pct < 8)  return { label: "Preocupante", color: "hsl(25  90% 55%)" };
  return              { label: "Crítico",      color: "hsl(0   70% 50%)" };
}

/** Aggregate per-word filler counts into per-category totals. */
export function categorizeFillers(
  detail: Record<string, number>
): Record<FillerCategory, number> {
  const agg: Record<FillerCategory, number> = {
    hesitation: 0, connector: 0, filler: 0, staller: 0,
  };
  for (const [word, count] of Object.entries(detail)) {
    const cat = FILLER_CATALOG.find(f => f.word === word)?.category;
    if (cat) agg[cat] += count;
  }
  return agg;
}
