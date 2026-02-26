import { useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, TrendingUp, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend, Treemap,
} from "recharts";
import {
  FILLER_CATALOG,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type FillerCategory,
} from "@/lib/filler-words";
import { usePoliticians, useTopFillerWords } from "@/lib/queries";
import { PARTY_COLORS } from "@/lib/mock-data";

const CATEGORIES: FillerCategory[] = ["hesitation", "connector", "filler", "staller"];

const SEVERITY_LABELS = { low: "Baixo", medium: "Médio", high: "Alto" };
const SEVERITY_COLORS = {
  low:    "hsl(145 60% 45%)",
  medium: "hsl(45 80% 55%)",
  high:   "hsl(10 80% 55%)",
};

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "hsl(222 40% 10%)",
    border: "1px solid hsl(222 25% 18%)",
    borderRadius: "8px",
    fontSize: 12,
  },
  labelStyle: { color: "hsl(45 30% 92%)" },
};

// Custom treemap cell
function TreemapCell(props: any) {
  const { x, y, width, height, name, value, category } = props;
  if (width < 30 || height < 20) return null;
  const color = CATEGORY_COLORS[(category as FillerCategory) ?? "filler"];
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={color + "30"} stroke={color} strokeWidth={1} rx={4} />
      {width > 60 && height > 30 && (
        <>
          <text x={x + width / 2} y={y + height / 2 - 6} textAnchor="middle" fill={color} fontSize={Math.min(13, width / 6)} fontWeight={600}>
            {name}
          </text>
          <text x={x + width / 2} y={y + height / 2 + 10} textAnchor="middle" fill={color + "aa"} fontSize={10}>
            {value}×
          </text>
        </>
      )}
    </g>
  );
}

export default function FillerWords() {
  const { data: topWords = [] } = useTopFillerWords();
  const { data: politicians = [] } = usePoliticians();
  const [activeCategory, setActiveCategory] = useState<FillerCategory | "all">("all");

  // Category breakdown for pie
  const pieData = CATEGORIES.map(cat => ({
    name: CATEGORY_LABELS[cat],
    value: FILLER_CATALOG.filter(f => f.category === cat).length,
    fill: CATEGORY_COLORS[cat],
  }));

  // Filtered catalog
  const filteredCatalog =
    activeCategory === "all"
      ? FILLER_CATALOG
      : FILLER_CATALOG.filter(f => f.category === activeCategory);

  // Treemap data enriched with category
  const treemapData = topWords.map(w => {
    const cat = FILLER_CATALOG.find(f => f.word === w.word)?.category ?? "filler";
    return { name: w.word, size: w.count, category: cat, value: w.count };
  });

  // Deputy filler ranking
  const deputyRanking = [...politicians]
    .filter(p => p.total_speeches > 0)
    .sort((a, b) => b.average_filler_ratio - a.average_filler_ratio)
    .slice(0, 10);

  return (
    <div className="container py-8 sm:py-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Palavras de Enchimento</h1>
      <p className="text-muted-foreground mb-8">
        Catálogo das {FILLER_CATALOG.length} palavras e expressões monitorizadas + rankings por deputado.
      </p>

      <Tabs defaultValue="catalog">
        <TabsList className="mb-8">
          <TabsTrigger value="catalog" className="gap-2">
            <BookOpen className="h-3.5 w-3.5" /> Catálogo
          </TabsTrigger>
          <TabsTrigger value="cloud" className="gap-2">
            <TrendingUp className="h-3.5 w-3.5" /> Nuvem
          </TabsTrigger>
          <TabsTrigger value="ranking" className="gap-2">
            <Users className="h-3.5 w-3.5" /> Ranking
          </TabsTrigger>
        </TabsList>

        {/* ─── Catalog tab ─── */}
        <TabsContent value="catalog" className="space-y-8">
          {/* Category filter */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                activeCategory === "all"
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "border-border/50 text-muted-foreground hover:border-primary/20"
              }`}
            >
              Todas ({FILLER_CATALOG.length})
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  activeCategory === cat
                    ? "border-transparent"
                    : "border-border/50 text-muted-foreground hover:border-primary/20"
                }`}
                style={
                  activeCategory === cat
                    ? { backgroundColor: CATEGORY_COLORS[cat] + "20", borderColor: CATEGORY_COLORS[cat] + "60", color: CATEGORY_COLORS[cat] }
                    : {}
                }
              >
                {CATEGORY_LABELS[cat]} ({FILLER_CATALOG.filter(f => f.category === cat).length})
              </button>
            ))}
          </div>

          {/* Catalog grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredCatalog.map((fw, i) => (
              <motion.div
                key={fw.word}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className="glass-card rounded-xl p-4 flex items-start gap-3"
              >
                <div
                  className="h-2 w-2 rounded-full mt-2 shrink-0"
                  style={{ backgroundColor: CATEGORY_COLORS[fw.category] }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold font-mono text-base">{fw.word}</p>
                  <p className="text-xs mt-1" style={{ color: CATEGORY_COLORS[fw.category] }}>
                    {CATEGORY_LABELS[fw.category]}
                  </p>
                  <div className="mt-2">
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 h-4"
                      style={{ borderColor: SEVERITY_COLORS[fw.severity] + "80", color: SEVERITY_COLORS[fw.severity] }}
                    >
                      {SEVERITY_LABELS[fw.severity]}
                    </Badge>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Category pie */}
          <div className="glass-card rounded-xl p-6">
            <h3 className="font-semibold mb-4">Distribuição por categoria</h3>
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 shrink-0">
                {CATEGORIES.map(cat => (
                  <div key={cat} className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
                    <span className="text-muted-foreground">{CATEGORY_LABELS[cat]}</span>
                    <span className="font-semibold ml-auto pl-4">
                      {FILLER_CATALOG.filter(f => f.category === cat).length}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ─── Word cloud tab ─── */}
        <TabsContent value="cloud" className="space-y-6">
          {treemapData.length > 0 ? (
            <div className="glass-card rounded-xl p-6">
              <h3 className="font-semibold mb-1">Nuvem de enchimentos</h3>
              <p className="text-xs text-muted-foreground mb-4">Tamanho proporcional ao nº de ocorrências detectadas</p>
              <ResponsiveContainer width="100%" height={360}>
                <Treemap
                  data={treemapData}
                  dataKey="size"
                  nameKey="name"
                  aspectRatio={4 / 3}
                  content={<TreemapCell />}
                />
              </ResponsiveContainer>

              {/* Legend */}
              <div className="flex flex-wrap gap-3 mt-4 justify-center">
                {CATEGORIES.map(cat => (
                  <div key={cat} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
                    {CATEGORY_LABELS[cat]}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState msg="Sem dados de ocorrências ainda. Conecta o worker de IA ou usa dados reais." />
          )}

          {/* Top 15 bar */}
          <div className="glass-card rounded-xl p-6">
            <h3 className="font-semibold mb-4">Top 15 mais ditas</h3>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={topWords.slice(0, 15)} layout="vertical">
                <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={11} />
                <YAxis type="category" dataKey="word" stroke="hsl(220 15% 55%)" fontSize={11} width={110} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {topWords.slice(0, 15).map((w, i) => {
                    const cat = FILLER_CATALOG.find(f => f.word === w.word)?.category ?? "filler";
                    return <Cell key={i} fill={CATEGORY_COLORS[cat]} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </TabsContent>

        {/* ─── Deputy ranking tab ─── */}
        <TabsContent value="ranking">
          {deputyRanking.length === 0 ? (
            <EmptyState msg="Sem dados de deputados. O worker de IA populará estes dados automaticamente." />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Deputados com maior rácio de enchimento (discursos analisados pela IA)
              </p>
              {deputyRanking.map((p, i) => {
                const fillerPct = (p.average_filler_ratio * 100).toFixed(1);
                const color = PARTY_COLORS[p.party] ?? "hsl(45 80% 55%)";
                return (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="glass-card rounded-xl p-4 flex items-center gap-4"
                  >
                    <span className="text-2xl font-bold font-mono text-muted-foreground w-8 shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">{p.name}</span>
                        <span className="text-xs font-medium" style={{ color }}>{p.party}</span>
                      </div>
                      <div className="h-2 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${Math.min(parseFloat(fillerPct) * 10, 100)}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono font-bold text-lg text-primary">{fillerPct}%</p>
                      <p className="text-xs text-muted-foreground">{p.total_speeches} discursos</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="glass-card rounded-xl p-12 text-center text-muted-foreground">
      <BookOpen className="h-8 w-8 mx-auto mb-3 opacity-40" />
      <p className="text-sm max-w-sm mx-auto">{msg}</p>
    </div>
  );
}
