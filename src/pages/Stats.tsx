import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line } from "recharts";
import { mockFillerRankByParty, mockSpeakingByParty, mockFillerTrend, mockTopFillerWords, mockPoliticians, PARTY_COLORS } from "@/lib/mock-data";
import { motion } from "framer-motion";

const Stats = () => {
  const totalFillers = mockPoliticians.reduce((s, p) => s + p.total_filler_count, 0);
  const totalSpeeches = mockPoliticians.reduce((s, p) => s + p.total_speeches, 0);
  const totalMinutes = Math.round(mockPoliticians.reduce((s, p) => s + p.total_speaking_seconds, 0) / 60);
  const activePols = mockPoliticians.filter(p => p.total_speeches > 0);
  const silentPols = mockPoliticians.filter(p => p.total_speeches === 0);
  const avgRatio = activePols.length > 0
    ? (activePols.reduce((s, p) => s + p.average_filler_ratio, 0) / activePols.length * 100).toFixed(1)
    : "0";

  const statsCards = [
    { label: "Total de enchimentos", value: totalFillers },
    { label: "Discursos analisados", value: totalSpeeches },
    { label: "Minutos de discurso", value: totalMinutes },
    { label: "Rácio médio de enchim.", value: `${avgRatio}%` },
  ];

  const tooltipStyle = {
    contentStyle: { backgroundColor: "hsl(222 40% 10%)", border: "1px solid hsl(222 25% 18%)", borderRadius: "8px" },
    labelStyle: { color: "hsl(45 30% 92%)" },
  };

  return (
    <div className="container py-8 sm:py-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Estatísticas</h1>
      <p className="text-muted-foreground mb-8">Dados agregados sobre a qualidade do discurso parlamentar.</p>

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
            <p className="text-2xl sm:text-3xl font-bold text-gradient-gold font-mono">{card.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{card.label}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Filler trend */}
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-4">Rácio de enchimento por dia</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={mockFillerTrend}>
              <XAxis dataKey="date" stroke="hsl(220 15% 55%)" fontSize={12} />
              <YAxis stroke="hsl(220 15% 55%)" fontSize={12} unit="%" />
              <Tooltip {...tooltipStyle} />
              <Line type="monotone" dataKey="fillerRatio" stroke="hsl(45 80% 55%)" strokeWidth={2} dot={{ fill: "hsl(45 80% 55%)" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Filler by party */}
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-4">Rácio de enchimento por partido</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={mockFillerRankByParty} layout="vertical">
              <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={12} unit="%" />
              <YAxis type="category" dataKey="party" stroke="hsl(220 15% 55%)" fontSize={12} width={40} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="avgFillerRatio" radius={[0, 4, 4, 0]}>
                {mockFillerRankByParty.map((entry) => (
                  <Cell key={entry.party} fill={PARTY_COLORS[entry.party] || "hsl(45 80% 55%)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top filler words */}
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-4">Palavras de enchimento mais usadas</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={mockTopFillerWords} layout="vertical">
              <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={12} />
              <YAxis type="category" dataKey="word" stroke="hsl(220 15% 55%)" fontSize={11} width={90} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="count" fill="hsl(45 80% 55%)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Speaking time by party */}
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-4">Tempo de discurso por partido (min)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={mockSpeakingByParty} layout="vertical">
              <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={12} />
              <YAxis type="category" dataKey="party" stroke="hsl(220 15% 55%)" fontSize={12} width={40} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="totalMinutes" radius={[0, 4, 4, 0]}>
                {mockSpeakingByParty.map((entry) => (
                  <Cell key={entry.party} fill={PARTY_COLORS[entry.party] || "hsl(45 80% 55%)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Silent vs Active */}
        <div className="glass-card rounded-xl p-6 lg:col-span-2">
          <h3 className="font-semibold mb-4">Deputados mais ativos vs. silenciosos</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm text-muted-foreground mb-3">🎤 Mais ativos</h4>
              <div className="space-y-3">
                {[...mockPoliticians].sort((a, b) => b.total_speaking_seconds - a.total_speaking_seconds).slice(0, 5).map((p, i) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <span className="text-sm font-mono text-muted-foreground w-5">{i + 1}.</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{p.name}</span>
                        <span className="text-xs" style={{ color: PARTY_COLORS[p.party] }}>{p.party}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(p.total_speaking_seconds / mockPoliticians.reduce((max, pp) => Math.max(max, pp.total_speaking_seconds), 1)) * 100}%` }} />
                      </div>
                    </div>
                    <span className="font-mono text-xs">{Math.round(p.total_speaking_seconds / 60)} min</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm text-muted-foreground mb-3">🤫 Silenciosos ({silentPols.length})</h4>
              {silentPols.length > 0 ? (
                <div className="space-y-2">
                  {silentPols.map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs" style={{ color: PARTY_COLORS[p.party] }}>{p.party}</span>
                      <span className="text-xs text-muted-foreground ml-auto">0 discursos</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Todos os deputados participaram.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Stats;
