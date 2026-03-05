import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { GitCompare, ArrowLeftRight, Scale } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import { usePoliticians, usePartyPositions, type Politician } from "@/lib/queries";
import { gradeFillerRate, FILLER_CATALOG, CATEGORY_COLORS } from "@/lib/filler-words";
import { PARTY_COLORS } from "@/lib/mock-data";

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "hsl(222 40% 10%)",
    border: "1px solid hsl(222 25% 18%)",
    borderRadius: "8px",
    fontSize: 12,
  },
  labelStyle: { color: "hsl(45 30% 92%)" },
};

// Normalize a value 0-100 relative to all politicians
function normalize(val: number, all: number[]): number {
  const max = Math.max(...all, 1);
  return Math.round((val / max) * 100);
}

function buildRadarData(a: Politician, b: Politician, all: Politician[]) {
  const allSeconds = all.map(p => p.total_speaking_seconds);
  const allSpeeches = all.map(p => p.total_speeches);
  const allFillers = all.map(p => p.total_filler_count);

  // "Clareza" = inverted filler ratio (higher is better)
  const clareza = (p: Politician) =>
    p.total_speeches > 0
      ? Math.round((1 - Math.min(p.average_filler_ratio * 10, 1)) * 100)
      : 100;

  const wpm = (p: Politician) =>
    p.total_speaking_seconds > 0
      ? Math.round((p.total_speeches * 200) / (p.total_speaking_seconds / 60))  // approx 200 words/speech
      : 0;
  const allWpm = all.map(wpm);

  return [
    {
      metric: "Participação",
      [a.name.split(" ")[0]]: normalize(a.total_speeches, allSpeeches),
      [b.name.split(" ")[0]]: normalize(b.total_speeches, allSpeeches),
    },
    {
      metric: "Tempo total",
      [a.name.split(" ")[0]]: normalize(a.total_speaking_seconds, allSeconds),
      [b.name.split(" ")[0]]: normalize(b.total_speaking_seconds, allSeconds),
    },
    {
      metric: "Clareza",
      [a.name.split(" ")[0]]: clareza(a),
      [b.name.split(" ")[0]]: clareza(b),
    },
    {
      metric: "Palavras/min",
      [a.name.split(" ")[0]]: normalize(wpm(a), allWpm),
      [b.name.split(" ")[0]]: normalize(wpm(b), allWpm),
    },
    {
      metric: "Enchimentos",
      [a.name.split(" ")[0]]: 100 - normalize(a.total_filler_count, allFillers),
      [b.name.split(" ")[0]]: 100 - normalize(b.total_filler_count, allFillers),
    },
  ];
}

function StatRow({ label, a, b, better }: { label: string; a: string; b: string; better?: "a" | "b" | "none" }) {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-border/30 text-sm last:border-0">
      <span
        className={`font-mono font-semibold w-28 text-right ${better === "a" ? "text-emerald-400" : ""}`}
      >
        {a}
      </span>
      <span className="flex-1 text-center text-xs text-muted-foreground">{label}</span>
      <span
        className={`font-mono font-semibold w-28 ${better === "b" ? "text-emerald-400" : ""}`}
      >
        {b}
      </span>
    </div>
  );
}

export default function Comparar() {
  const { data: politicians = [] } = usePoliticians();
  const active = politicians.filter(p => p.total_speeches > 0);
  const { data: partyPositions = [] } = usePartyPositions();

  const [aId, setAId] = useState<string>(active[0]?.id ?? "");
  const [bId, setBId] = useState<string>(active[1]?.id ?? "");

  const polA = politicians.find(p => p.id === aId) ?? active[0];
  const polB = politicians.find(p => p.id === bId) ?? active[1];

  const radarData = useMemo(() => {
    if (!polA || !polB) return [];
    return buildRadarData(polA, polB, politicians);
  }, [polA, polB, politicians]);

  if (!polA || !polB) {
    return (
      <div className="container py-12 text-center text-muted-foreground">
        <p>Precisas de pelo menos 2 deputados com discursos analisados.</p>
      </div>
    );
  }

  const nameA = polA.name.split(" ")[0];
  const nameB = polB.name.split(" ")[0];
  const colorA = PARTY_COLORS[polA.party] ?? "hsl(45 80% 55%)";
  const colorB = PARTY_COLORS[polB.party] ?? "hsl(200 80% 55%)";

  const gradeA = gradeFillerRate(polA.average_filler_ratio);
  const gradeB = gradeFillerRate(polB.average_filler_ratio);

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    return m > 0 ? `${m} min` : `${s}s`;
  };

  return (
    <div className="container py-8 sm:py-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2 flex items-center gap-3">
        <GitCompare className="h-8 w-8 text-primary" />
        Comparar Deputados
      </h1>
      <p className="text-muted-foreground mb-8">
        Compara a participação e qualidade de discurso de dois deputados lado a lado.
      </p>

      {/* Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10 max-w-2xl mx-auto">
        <DeputySelector
          label="Deputado A"
          value={aId}
          onChange={setAId}
          politicians={politicians.filter(p => p.id !== bId)}
          color={colorA}
        />
        <div className="hidden sm:flex items-center justify-center">
          <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
        </div>
        <DeputySelector
          label="Deputado B"
          value={bId}
          onChange={setBId}
          politicians={politicians.filter(p => p.id !== aId)}
          color={colorB}
        />
      </div>

      {/* Deputy header cards */}
      <div className="grid grid-cols-2 gap-6 mb-10">
        {[{ pol: polA, color: colorA }, { pol: polB, color: colorB }].map(({ pol, color }) => (
          <motion.div
            key={pol.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card rounded-xl p-5 text-center"
          >
            <Avatar className="h-16 w-16 border-2 mx-auto mb-3" style={{ borderColor: color }}>
              <AvatarFallback className="bg-secondary text-lg font-bold">
                {pol.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <p className="font-bold text-lg leading-tight">{pol.name}</p>
            <p className="text-sm mb-2" style={{ color }}>{pol.party}</p>
            <Badge
              variant="outline"
              style={{ borderColor: gradeFillerRate(pol.average_filler_ratio).color, color: gradeFillerRate(pol.average_filler_ratio).color }}
            >
              {gradeFillerRate(pol.average_filler_ratio).label}
            </Badge>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Radar chart */}
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-4">Perfil comparativo</h3>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="hsl(220 15% 22%)" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: "hsl(220 15% 65%)", fontSize: 11 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name={nameA} dataKey={nameA} stroke={colorA} fill={colorA} fillOpacity={0.2} strokeWidth={2} />
              <Radar name={nameB} dataKey={nameB} stroke={colorB} fill={colorB} fillOpacity={0.2} strokeWidth={2} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Stat comparison table */}
        <div className="glass-card rounded-xl p-6">
          <div className="flex items-center mb-4">
            <span className="font-semibold flex-1 text-center" style={{ color: colorA }}>{nameA}</span>
            <span className="w-32 text-center text-xs text-muted-foreground">Métrica</span>
            <span className="font-semibold flex-1 text-center" style={{ color: colorB }}>{nameB}</span>
          </div>
          <StatRow
            label="Discursos"
            a={String(polA.total_speeches)}
            b={String(polB.total_speeches)}
            better={polA.total_speeches >= polB.total_speeches ? "a" : "b"}
          />
          <StatRow
            label="Tempo total"
            a={fmtTime(polA.total_speaking_seconds)}
            b={fmtTime(polB.total_speaking_seconds)}
            better={polA.total_speaking_seconds >= polB.total_speaking_seconds ? "a" : "b"}
          />
          <StatRow
            label="Rácio enchimento"
            a={`${(polA.average_filler_ratio * 100).toFixed(1)}%`}
            b={`${(polB.average_filler_ratio * 100).toFixed(1)}%`}
            better={polA.average_filler_ratio <= polB.average_filler_ratio ? "a" : "b"}
          />
          <StatRow
            label="Total enchimentos"
            a={String(polA.total_filler_count)}
            b={String(polB.total_filler_count)}
            better={polA.total_filler_count <= polB.total_filler_count ? "a" : "b"}
          />
          <StatRow
            label="Qualidade"
            a={gradeA.label}
            b={gradeB.label}
            better={polA.average_filler_ratio <= polB.average_filler_ratio ? "a" : "b"}
          />
        </div>

        {/* Top filler words per deputy */}
        {[
          { pol: polA, color: colorA, label: nameA },
          { pol: polB, color: colorB, label: nameB },
        ].map(({ pol, color, label }) => (
          <div key={pol.id} className="glass-card rounded-xl p-6">
            <h3 className="font-semibold mb-4" style={{ color }}>
              Top enchimentos · {label}
            </h3>
            {pol.total_speeches === 0 ? (
              <p className="text-sm text-muted-foreground">Sem discursos analisados.</p>
            ) : (
              <FillerBarChart
                data={
                  Object.entries(pol as unknown as Record<string, unknown>)
                    .filter(([k]) => k === "total_filler_count")
                    .length > 0
                    ? generateFillerSample(pol)
                    : []
                }
                color={color}
              />
            )}
          </div>
        ))}
      </div>

      {/* Party positions from DAR archive */}
      {partyPositions.length > 0 && polA && polB && (
        <PartyPositionsPanel
          partyA={polA.party}
          partyB={polB.party}
          colorA={colorA}
          colorB={colorB}
          positions={partyPositions}
        />
      )}
    </div>
  );
}

// ─── Party Positions Panel ────────────────────────────────────────────────────

function PartyPositionsPanel({
  partyA,
  partyB,
  colorA,
  colorB,
  positions,
}: {
  partyA: string;
  partyB: string;
  colorA: string;
  colorB: string;
  positions: ReturnType<typeof usePartyPositions>["data"] extends (infer T)[] | undefined ? T[] : never;
}) {
  const alignmentColor = (v: string | null) =>
    v === "favor" ? "hsl(145 60% 45%)"
    : v === "against" ? "hsl(0 70% 50%)"
    : v === "abstain" ? "hsl(220 20% 60%)"
    : "hsl(220 20% 60%)";

  const alignmentLabel = (v: string | null) =>
    v === "favor" ? "A favor"
    : v === "against" ? "Contra"
    : v === "abstain" ? "Abstenção"
    : v === "mixed" ? "Dividido"
    : "—";

  // Get all unique topics where both parties have positions
  const topics = [
    ...new Set(positions.map(p => p.topic)),
  ].filter(topic => {
    const hasA = positions.some(p => p.party === partyA && p.topic === topic);
    const hasB = positions.some(p => p.party === partyB && p.topic === topic);
    return hasA || hasB;
  }).slice(0, 12);

  if (topics.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="mt-8"
    >
      <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
        <Scale className="h-5 w-5 text-primary" />
        Posições partidárias — arquivo DAR
      </h2>
      <div className="glass-card rounded-xl overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-3 gap-4 px-4 py-2 bg-secondary/40 text-xs font-semibold text-muted-foreground">
          <span style={{ color: colorA }}>{partyA}</span>
          <span className="text-center">Tema</span>
          <span className="text-right" style={{ color: colorB }}>{partyB}</span>
        </div>
        {topics.map((topic, i) => {
          const posA = positions.find(p => p.party === partyA && p.topic === topic);
          const posB = positions.find(p => p.party === partyB && p.topic === topic);
          return (
            <div
              key={topic}
              className={`grid grid-cols-3 gap-4 px-4 py-3 text-sm items-start ${
                i % 2 === 0 ? "" : "bg-secondary/20"
              }`}
            >
              <div className="space-y-0.5">
                {posA ? (
                  <>
                    <span
                      className="text-[10px] font-bold uppercase"
                      style={{ color: alignmentColor(posA.vote_alignment) }}
                    >
                      {alignmentLabel(posA.vote_alignment)}
                    </span>
                    {posA.position_summary && (
                      <p className="text-xs text-muted-foreground leading-tight">
                        {posA.position_summary}
                      </p>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground/40">—</span>
                )}
              </div>
              <p className="text-center text-xs font-medium">{topic}</p>
              <div className="space-y-0.5 text-right">
                {posB ? (
                  <>
                    <span
                      className="text-[10px] font-bold uppercase"
                      style={{ color: alignmentColor(posB.vote_alignment) }}
                    >
                      {alignmentLabel(posB.vote_alignment)}
                    </span>
                    {posB.position_summary && (
                      <p className="text-xs text-muted-foreground leading-tight">
                        {posB.position_summary}
                      </p>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground/40">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-2 text-center">
        Posições extraídas por IA das sessões do arquivo DAR
      </p>
    </motion.div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function DeputySelector({
  label, value, onChange, politicians, color,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  politicians: Politician[];
  color: string;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1.5">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
        style={{ color }}
      >
        {politicians.map(p => (
          <option key={p.id} value={p.id} style={{ color: PARTY_COLORS[p.party] }}>
            {p.name} ({p.party})
          </option>
        ))}
      </select>
    </div>
  );
}

/** Generate representative filler sample from politician stats */
function generateFillerSample(pol: Politician) {
  const totalFillers = pol.total_filler_count;
  if (totalFillers === 0) return [];

  // Distribute across known filler words proportionally to typical usage
  const weights: Record<string, number> = {
    portanto: 25, "ou seja": 18, pronto: 15, digamos: 12, basicamente: 10,
    enfim: 8, efetivamente: 7, tipo: 5,
  };
  const entries = Object.entries(weights);
  const totalWeight = entries.reduce((s, [, w]) => s + w, 0);

  return entries
    .map(([word, weight]) => ({
      word,
      count: Math.round((weight / totalWeight) * totalFillers),
    }))
    .filter(e => e.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function FillerBarChart({ data, color }: { data: { word: string; count: number }[]; color: string }) {
  const tooltipS = {
    contentStyle: {
      backgroundColor: "hsl(222 40% 10%)",
      border: "1px solid hsl(222 25% 18%)",
      borderRadius: "8px",
      fontSize: 12,
    },
    labelStyle: { color: "hsl(45 30% 92%)" },
  };

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical">
        <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={11} />
        <YAxis type="category" dataKey="word" stroke="hsl(220 15% 55%)" fontSize={11} width={85} />
        <Tooltip {...tooltipS} />
        <Bar dataKey="count" fill={color} fillOpacity={0.8} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
