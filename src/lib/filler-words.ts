// Portuguese parliamentary filler words detection engine

export type FillerCategory = "hesitation" | "connector" | "filler" | "staller";

export interface FillerWord {
  word: string;
  category: FillerCategory;
  severity: "low" | "medium" | "high";
}

export const FILLER_CATALOG: FillerWord[] = [
  // Hesitation — pauses disguised as words
  { word: "digamos", category: "hesitation", severity: "medium" },
  { word: "quer dizer", category: "hesitation", severity: "medium" },
  { word: "bem", category: "hesitation", severity: "low" },
  { word: "ora", category: "hesitation", severity: "low" },
  { word: "pois", category: "hesitation", severity: "low" },
  { word: "ah", category: "hesitation", severity: "low" },
  { word: "eh", category: "hesitation", severity: "low" },
  { word: "hm", category: "hesitation", severity: "low" },

  // Connectors used repetitively as fillers
  { word: "portanto", category: "connector", severity: "high" },
  { word: "ou seja", category: "connector", severity: "high" },
  { word: "de facto", category: "connector", severity: "medium" },
  { word: "na verdade", category: "connector", severity: "medium" },
  { word: "assim", category: "connector", severity: "low" },
  { word: "então", category: "connector", severity: "low" },
  { word: "depois", category: "connector", severity: "low" },

  // True filler words
  { word: "pronto", category: "filler", severity: "high" },
  { word: "basicamente", category: "filler", severity: "high" },
  { word: "efetivamente", category: "filler", severity: "medium" },
  { word: "tipo", category: "filler", severity: "medium" },
  { word: "ok", category: "filler", severity: "medium" },
  { word: "olhe", category: "filler", severity: "medium" },
  { word: "enfim", category: "filler", severity: "medium" },
  { word: "exatamente", category: "filler", severity: "low" },
  { word: "claro", category: "filler", severity: "low" },
  { word: "obviamente", category: "filler", severity: "medium" },
  { word: "naturalmente", category: "filler", severity: "low" },
  { word: "certamente", category: "filler", severity: "low" },

  // Stallers — multi-word delay phrases
  { word: "como direi", category: "staller", severity: "high" },
  { word: "de certa forma", category: "staller", severity: "high" },
  { word: "de alguma maneira", category: "staller", severity: "high" },
  { word: "por assim dizer", category: "staller", severity: "high" },
  { word: "de certa maneira", category: "staller", severity: "medium" },
  { word: "de algum modo", category: "staller", severity: "medium" },
];

export const CATEGORY_COLORS: Record<FillerCategory, string> = {
  hesitation: "hsl(200 80% 55%)",
  connector:  "hsl(45 80% 55%)",
  filler:     "hsl(10 80% 55%)",
  staller:    "hsl(280 70% 55%)",
};

export const CATEGORY_LABELS: Record<FillerCategory, string> = {
  hesitation: "Hesitação",
  connector:  "Conector",
  filler:     "Enchimento",
  staller:    "Atraso",
};

export interface TextSegment {
  text: string;
  isFiller: boolean;
  fillerWord?: FillerWord;
}

/** Split a transcript into filler and non-filler segments for inline highlighting */
export function segmentTranscript(text: string): TextSegment[] {
  if (!text) return [{ text: "", isFiller: false }];

  const sorted = [...FILLER_CATALOG].sort((a, b) => b.word.length - a.word.length);
  const escaped = sorted.map(f => f.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");

  return text
    .split(pattern)
    .filter(p => p !== "")
    .map(part => {
      const match = sorted.find(f => f.word.toLowerCase() === part.toLowerCase());
      return match
        ? { text: part, isFiller: true, fillerWord: match }
        : { text: part, isFiller: false };
    });
}

/** Count filler word occurrences in text, returns { word: count } */
export function countFillers(text: string): Record<string, number> {
  const result: Record<string, number> = {};
  const sorted = [...FILLER_CATALOG].sort((a, b) => b.word.length - a.word.length);
  let remaining = text.toLowerCase();

  for (const filler of sorted) {
    const regex = new RegExp(filler.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = remaining.match(regex);
    if (matches && matches.length > 0) {
      result[filler.word] = matches.length;
      remaining = remaining.replace(regex, " ".repeat(filler.word.length));
    }
  }
  return result;
}

/** Grade a filler ratio (0-1) with a label and color */
export function gradeFillerRate(ratio: number): { label: string; color: string } {
  const pct = ratio * 100;
  if (pct < 1)  return { label: "Excelente", color: "hsl(145 60% 45%)" };
  if (pct < 3)  return { label: "Bom",        color: "hsl(160 50% 45%)" };
  if (pct < 5)  return { label: "Aceitável",  color: "hsl(45 80% 55%)"  };
  if (pct < 8)  return { label: "Preocupante",color: "hsl(25 90% 55%)"  };
  return            { label: "Crítico",     color: "hsl(0 70% 50%)"    };
}

/** Aggregate filler categories from a detail record */
export function categorizeFillers(detail: Record<string, number>): Record<FillerCategory, number> {
  const agg: Record<FillerCategory, number> = { hesitation: 0, connector: 0, filler: 0, staller: 0 };
  for (const [word, count] of Object.entries(detail)) {
    const cat = FILLER_CATALOG.find(f => f.word === word)?.category;
    if (cat) agg[cat] += count;
  }
  return agg;
}
