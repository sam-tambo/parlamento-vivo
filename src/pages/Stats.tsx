import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  CartesianGrid, PieChart, Pie, AreaChart, Area, LineChart, Line,
} from "recharts";
import { Archive, FileText, Mic } from "lucide-react";
import {
  usePartyStats,
  useFillerTrend,
  usePoliticians,
  useTopFillerWords,
  useGlobalStats,
  useDeputyActivity,
  useSessions,
} from "@/lib/queries";
import { PARTY_COLORS } from "@/lib/mock-data";
import { CATEGORY_COLORS, CATEGORY_LABELS, FILLER_CATALOG, gradeFillerRate } from "@/lib/filler-words";
import { PartyBadge } from "@/components/PartyBadge";

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
  const { data: globalStats } = useGlobalStats();
  const { data: darActivity = [] } = useDeputyActivity();
  const { data: sessions = [] } = useSessions();

  const active = politicians.filter(p => p.total_speeches > 0);
  const totalFillers = politicians.reduce((s, p) => s + p.total_filler_count, 0);
  const totalMinutes = Math.round(politicians.reduce((s, p) => s + p.total_speaking_seconds, 0) / 60);

  const { fillerByParty = [], speakingByParty = [] } = partyStats ?? {};

  // Most active deputies
  const topDeputies = [...active]
    .sort((a, b) => b.total_speaking_seconds - a.total_speaking_seconds)
    .slice(0, 10)
    .map(p => ({
      name: p.name.split(" ").slice(-1)[0],
      fullName: p.name,
      party: p.party,
      id: p.id,
      minutes: Math.round(p.total_speaking_seconds / 60),
    }));

  // Filler leaderboard
  const fillerLeaderboard = [...active]
    .sort((a, b) => b.average_filler_ratio - a.average_filler_ratio)
    .slice(0, 10)
    .map(p => ({
      name: p.name.split(" ").slice(-1)[0],
      fullName: p.name,
      party: p.party,
      id: p.id,
      ratio: Math.round(p.average_filler_ratio * 1000) / 10,
    }));

  return (
    <div className="container py-8 sm:py-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Estatisticas</h1>
      <p className="text-muted-foreground mb-8">
        Dados agregados sobre a atividade parlamentar portuguesa.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
        {[
          { label: "Sessoes processadas", value: globalStats?.sessions ?? 0 },
          { label: "Total intervencoes", value: globalStats?.interventions ?? 0 },
          { label: "Total votacoes", value: globalStats?.votes ?? 0 },
          { label: "Minutos de discurso", value: totalMinutes },
        ].map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="glass-card rounded-xl p-5"
          >
            <p className="text-2xl sm:text-3xl font-bold font-mono">
              {typeof card.value === "number" ? card.value.toLocaleString("pt-PT") : card.value}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{card.label}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Most active deputies */}
        {topDeputies.length > 0 && (
          <div className="glass-card rounded-xl p-6">
            <h3 className="font-semibold mb-4">Deputados mais ativos (tempo)</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topDeputies} layout="vertical">
                <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={11} unit=" min" />
                <YAxis type="category" dataKey="name" stroke="hsl(220 15% 55%)" fontSize={11} width={70} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v: number) => [`${v} min`, "Tempo"]}
                  labelFormatter={(label) => {
                    const d = topDeputies.find(d => d.name === label);
                    return d ? `${d.fullName} (${d.party})` : label;
                  }}
                />
                <Bar dataKey="minutes" radius={[0, 4, 4, 0]}>
                  {topDeputies.map(entry => (
                    <Cell key={entry.id} fill={PARTY_COLORS[entry.party] ?? "#888"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Speaking time by party */}
        {speakingByParty.length > 0 && (
          <div className="glass-card rounded-xl p-6">
            <h3 className="font-semibold mb-4">Tempo de discurso por partido (min)</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={speakingByParty} layout="vertical">
                <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={11} />
                <YAxis type="category" dataKey="party" stroke="hsl(220 15% 55%)" fontSize={12} width={50} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="totalMinutes" radius={[0, 4, 4, 0]}>
                  {speakingByParty.map(entry => (
                    <Cell key={entry.party} fill={PARTY_COLORS[entry.party] ?? "#888"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Filler leaderboard */}
        {fillerLeaderboard.length > 0 && (
          <div className="glass-card rounded-xl p-6">
            <h3 className="font-semibold mb-1">Ranking de enchimentos</h3>
            <p className="text-xs text-muted-foreground mb-4">% de palavras de enchimento por deputado</p>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={fillerLeaderboard} layout="vertical">
                <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={11} unit="%" />
                <YAxis type="category" dataKey="name" stroke="hsl(220 15% 55%)" fontSize={11} width={70} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v: number) => [`${v}%`, "Racio"]}
                  labelFormatter={(label) => {
                    const d = fillerLeaderboard.find(d => d.name === label);
                    return d ? `${d.fullName} (${d.party})` : label;
                  }}
                />
                <Bar dataKey="ratio" radius={[0, 4, 4, 0]}>
                  {fillerLeaderboard.map(entry => (
                    <Cell key={entry.id} fill={PARTY_COLORS[entry.party] ?? "#888"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Filler by party */}
        {fillerByParty.length > 0 && (
          <div className="glass-card rounded-xl p-6">
            <h3 className="font-semibold mb-4">Racio de enchimento por partido</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={fillerByParty} layout="vertical">
                <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={11} unit="%" />
                <YAxis type="category" dataKey="party" stroke="hsl(220 15% 55%)" fontSize={12} width={50} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`${Number(v).toFixed(1)}%`, "Media"]} />
                <Bar dataKey="avgFillerRatio" radius={[0, 4, 4, 0]}>
                  {fillerByParty.map(entry => (
                    <Cell key={entry.party} fill={PARTY_COLORS[entry.party] ?? "#888"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Filler trend */}
        {trend.length > 0 && (
          <div className="glass-card rounded-xl p-6">
            <h3 className="font-semibold mb-1">Racio de enchimento ao longo do tempo</h3>
            <p className="text-xs text-muted-foreground mb-4">% por sessao</p>
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
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`${Number(v).toFixed(2)}%`, "Racio"]} />
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
        )}

        {/* Top filler words */}
        {topWords.length > 0 && (
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
        )}
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
