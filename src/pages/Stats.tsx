import { motion } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  CartesianGrid, PieChart, Pie, AreaChart, Area,
} from "recharts";
import { Archive, FileText, Mic } from "lucide-react";
import {
  usePartyStats,
  useFillerTrend,
  usePoliticians,
  useTopFillerWords,
  useSessions,
  useDeputyActivity,
} from "@/lib/queries";
import { PARTY_COLORS } from "@/lib/mock-data";
import { CATEGORY_COLORS, CATEGORY_LABELS, FILLER_CATALOG, gradeFillerRate } from "@/lib/filler-words";

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "hsl(222 40% 10%)",
    border: "1px solid hsl(222 25% 18%)",
    borderRadius: "8px",
    fontSize: 12,
  },
  labelStyle: { color: "hsl(45 30% 92%)" },
};

export default function Stats() {
  const { data: politicians = [] } = usePoliticians();
  const { data: partyStats } = usePartyStats();
  const { data: trend = [] } = useFillerTrend();
  const { data: topWords = [] } = useTopFillerWords();
  const { data: sessions = [] } = useSessions("XVII", 200);
  const { data: darActivity = [] } = useDeputyActivity();

  const active = politicians.filter(p => p.total_speeches > 0);
  const silent = politicians.filter(p => p.total_speeches === 0);

  const totalFillers = politicians.reduce((s, p) => s + p.total_filler_count, 0);
  const totalSpeeches = politicians.reduce((s, p) => s + p.total_speeches, 0);
  const totalMinutes = Math.round(politicians.reduce((s, p) => s + p.total_speaking_seconds, 0) / 60);
  const avgRatio = active.length > 0
    ? (active.reduce((s, p) => s + p.average_filler_ratio, 0) / active.length * 100).toFixed(1)
    : "0";
  const grade = gradeFillerRate(parseFloat(avgRatio) / 100);

  const categories = (["hesitation", "connector", "filler", "staller"] as const).map(cat => ({
    name: CATEGORY_LABELS[cat],
    value: FILLER_CATALOG.filter(f => f.category === cat).length,
    fill: CATEGORY_COLORS[cat],
  }));

  const { fillerByParty = [], speakingByParty = [] } = partyStats ?? {};

  const statsCards = [
    { label: "Total enchimentos",    value: totalFillers  },
    { label: "Discursos analisados", value: totalSpeeches },
    { label: "Minutos de discurso",  value: totalMinutes  },
    { label: "Rácio médio",          value: `${avgRatio}%`, colorOverride: grade.color },
  ];

  return (
    <div className="container py-8 sm:py-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Estatísticas</h1>
      <p className="text-muted-foreground mb-8">
        Dados agregados sobre a qualidade do discurso parlamentar português.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
        {statsCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="glass-card rounded-xl p-5"
          >
            <p
              className="text-2xl sm:text-3xl font-bold font-mono text-gradient-gold"
              style={card.colorOverride ? { color: card.colorOverride, backgroundImage: "none" } : undefined}
            >
              {card.value}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{card.label}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Filler trend */}
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-1">Rácio de enchimento ao longo do tempo</h3>
          <p className="text-xs text-muted-foreground mb-4">% por sessão · meta &lt;5%</p>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="gradFiller" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="hsl(45 80% 55%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(45 80% 55%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 18%)" />
              <XAxis dataKey="date" stroke="hsl(220 15% 55%)" fontSize={11} />
              <YAxis stroke="hsl(220 15% 55%)" fontSize={11} unit="%" />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${Number(v).toFixed(2)}%`, "Rácio"]} />
              <Area
                type="monotone"
                dataKey="fillerRatio"
                stroke="hsl(45 80% 55%)"
                fill="url(#gradFiller)"
                strokeWidth={2}
                dot={{ fill: "hsl(45 80% 55%)", r: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Category distribution pie */}
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-1">Palavras monitorizadas por categoria</h3>
          <p className="text-xs text-muted-foreground mb-4">Distribuição do catálogo de enchimentos</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={categories}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
                fontSize={11}
              >
                {categories.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Filler by party */}
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-4">Rácio de enchimento por partido</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={fillerByParty} layout="vertical">
              <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={11} unit="%" />
              <YAxis type="category" dataKey="party" stroke="hsl(220 15% 55%)" fontSize={12} width={40} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${Number(v).toFixed(1)}%`, "Média"]} />
              <Bar dataKey="avgFillerRatio" radius={[0, 4, 4, 0]}>
                {fillerByParty.map(entry => (
                  <Cell key={entry.party} fill={PARTY_COLORS[entry.party] ?? "hsl(45 80% 55%)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top filler words */}
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-4">Palavras de enchimento mais usadas</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={topWords.slice(0, 10)} layout="vertical">
              <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={11} />
              <YAxis type="category" dataKey="word" stroke="hsl(220 15% 55%)" fontSize={11} width={90} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {topWords.slice(0, 10).map((w, i) => {
                  const cat = FILLER_CATALOG.find(f => f.word === w.word)?.category ?? "filler";
                  return <Cell key={i} fill={CATEGORY_COLORS[cat]} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Speaking time by party */}
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-4">Tempo de discurso por partido (min)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={speakingByParty} layout="vertical">
              <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={11} />
              <YAxis type="category" dataKey="party" stroke="hsl(220 15% 55%)" fontSize={12} width={40} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="totalMinutes" radius={[0, 4, 4, 0]}>
                {speakingByParty.map(entry => (
                  <Cell key={entry.party} fill={PARTY_COLORS[entry.party] ?? "hsl(45 80% 55%)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Active vs Silent */}
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-4">Deputados ativos vs. silenciosos</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm text-muted-foreground mb-3">Mais ativos</h4>
              <div className="space-y-3">
                {[...active]
                  .sort((a, b) => b.total_speaking_seconds - a.total_speaking_seconds)
                  .slice(0, 5)
                  .map((p, i) => {
                    const maxSecs = politicians.reduce((m, pp) => Math.max(m, pp.total_speaking_seconds), 1);
                    return (
                      <div key={p.id} className="flex items-center gap-3">
                        <span className="text-sm font-mono text-muted-foreground w-4">{i + 1}.</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm truncate">{p.name}</span>
                            <span className="text-xs shrink-0" style={{ color: PARTY_COLORS[p.party] }}>{p.party}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${(p.total_speaking_seconds / maxSecs) * 100}%` }}
                            />
                          </div>
                        </div>
                        <span className="font-mono text-xs shrink-0">{Math.round(p.total_speaking_seconds / 60)} min</span>
                      </div>
                    );
                  })}
              </div>
            </div>
            <div>
              <h4 className="text-sm text-muted-foreground mb-3">Silenciosos ({silent.length})</h4>
              {silent.length > 0 ? (
                <div className="space-y-2">
                  {silent.slice(0, 8).map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-sm">
                      <span className="font-medium truncate">{p.name}</span>
                      <span className="text-xs ml-auto shrink-0" style={{ color: PARTY_COLORS[p.party] }}>{p.party}</span>
                    </div>
                  ))}
                  {silent.length > 8 && (
                    <p className="text-xs text-muted-foreground">+{silent.length - 8} mais</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Todos os deputados participaram.</p>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* ── Parlamento Aberto — DAR Archive Stats ─────────────── */}
      {(sessions.length > 0 || darActivity.length > 0) && (
        <div className="mt-12">
          <div className="flex items-center gap-2 mb-6">
            <Archive className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold">Arquivo Parlamento Aberto</h2>
          </div>

          {/* DAR summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              {
                icon: Archive,
                label: "Sessões importadas",
                value: sessions.length,
              },
              {
                icon: FileText,
                label: "Sessões analisadas (IA)",
                value: sessions.filter(s => s.analysis_status === "analyzed").length,
              },
              {
                icon: Mic,
                label: "Intervenções totais",
                value: darActivity.reduce((s, a) => s + a.total_interventions, 0).toLocaleString("pt-PT"),
              },
              {
                icon: FileText,
                label: "Palavras transcritas",
                value: (() => {
                  const w = darActivity.reduce((s, a) => s + a.total_words, 0);
                  return w > 1_000_000
                    ? `${(w / 1_000_000).toFixed(1)}M`
                    : w > 1_000 ? `${(w / 1_000).toFixed(0)}k` : String(w);
                })(),
              },
            ].map((card, i) => (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                className="glass-card rounded-xl p-5"
              >
                <card.icon className="h-4 w-4 text-primary mb-2" />
                <p className="text-2xl sm:text-3xl font-bold font-mono text-gradient-gold">
                  {card.value}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{card.label}</p>
              </motion.div>
            ))}
          </div>

          {/* Top speakers by interventions (DAR data) */}
          {darActivity.length > 0 && (
            <div className="glass-card rounded-xl p-6">
              <h3 className="font-semibold mb-4">
                Top 10 oradores — intervenções no arquivo DAR
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={[...darActivity]
                    .sort((a, b) => b.total_interventions - a.total_interventions)
                    .slice(0, 10)
                    .map(a => ({
                      name: a.name.split(" ").slice(-1)[0],
                      party: a.party,
                      interventions: a.total_interventions,
                      mic_cutoffs: a.mic_cutoffs,
                    }))}
                  layout="vertical"
                  margin={{ left: 70, right: 50 }}
                >
                  <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={11} />
                  <YAxis type="category" dataKey="name" stroke="hsl(220 15% 55%)" fontSize={11} width={65} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(v: number, name: string) => [v, name === "interventions" ? "Intervenções" : "Mic cortado"]}
                  />
                  <Bar dataKey="interventions" radius={[0, 4, 4, 0]} maxBarSize={18}>
                    {[...darActivity]
                      .sort((a, b) => b.total_interventions - a.total_interventions)
                      .slice(0, 10)
                      .map((a, i) => (
                        <Cell key={i} fill={PARTY_COLORS[a.party] ?? "hsl(45 80% 55%)"} fillOpacity={0.85} />
                      ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
