import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { mockStatsByParty, mockStatsOverTime, mockPoliticians, PARTY_COLORS } from "@/lib/mock-data";
import { motion } from "framer-motion";

const Stats = () => {
  const topOffenders = [...mockPoliticians].sort((a, b) => b.times_caught - a.times_caught).slice(0, 5);
  const totalDetections = mockPoliticians.reduce((sum, p) => sum + p.times_caught, 0);

  const statsCards = [
    { label: "Total de deteções", value: totalDetections },
    { label: "Deputados apanhados", value: mockPoliticians.length },
    { label: "Partidos representados", value: new Set(mockPoliticians.map(p => p.party)).size },
    { label: "Média por deputado", value: (totalDetections / mockPoliticians.length).toFixed(1) },
  ];

  return (
    <div className="container py-8 sm:py-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Estatísticas</h1>
      <p className="text-muted-foreground mb-8">Dados agregados sobre o uso de telemóveis no parlamento.</p>

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
        {/* By day */}
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-4">Deteções por dia da semana</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={mockStatsOverTime}>
              <XAxis dataKey="date" stroke="hsl(220 15% 55%)" fontSize={12} />
              <YAxis stroke="hsl(220 15% 55%)" fontSize={12} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(222 40% 10%)", border: "1px solid hsl(222 25% 18%)", borderRadius: "8px" }}
                labelStyle={{ color: "hsl(45 30% 92%)" }}
              />
              <Bar dataKey="detections" fill="hsl(45 80% 55%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By party */}
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-4">Deteções por partido</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={mockStatsByParty} layout="vertical">
              <XAxis type="number" stroke="hsl(220 15% 55%)" fontSize={12} />
              <YAxis type="category" dataKey="party" stroke="hsl(220 15% 55%)" fontSize={12} width={40} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(222 40% 10%)", border: "1px solid hsl(222 25% 18%)", borderRadius: "8px" }}
                labelStyle={{ color: "hsl(45 30% 92%)" }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {mockStatsByParty.map((entry) => (
                  <Cell key={entry.party} fill={PARTY_COLORS[entry.party] || "hsl(45 80% 55%)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top offenders */}
        <div className="glass-card rounded-xl p-6 lg:col-span-2">
          <h3 className="font-semibold mb-4">Piores infratores</h3>
          <div className="space-y-3">
            {topOffenders.map((p, i) => (
              <div key={p.id} className="flex items-center gap-4">
                <span className="text-sm font-mono text-muted-foreground w-6">{i + 1}.</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{p.name}</span>
                    <span className="text-xs" style={{ color: PARTY_COLORS[p.party] }}>{p.party}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${(p.times_caught / topOffenders[0].times_caught) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="font-mono text-sm font-bold text-primary">{p.times_caught}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Stats;
