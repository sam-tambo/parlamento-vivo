import { useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Clock, MessageSquare, Users, MicOff } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { usePoliticians } from "@/lib/queries";
import { gradeFillerRate } from "@/lib/filler-words";
import { PARTIES, PARTY_COLORS } from "@/lib/mock-data";

type SortMode = "filler" | "active" | "silent" | "speeches";

const tooltipStyle = {
  contentStyle: { backgroundColor: "hsl(222 40% 10%)", border: "1px solid hsl(222 25% 18%)", borderRadius: "8px", fontSize: 12 },
  labelStyle: { color: "hsl(45 30% 92%)" },
};

export default function Politicians() {
  const [selectedParty, setSelectedParty] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("filler");

  const { data: politicians = [], isLoading } = usePoliticians();

  const getSorted = () => {
    const list = [...politicians];
    switch (sortMode) {
      case "filler":   return list.sort((a, b) => b.average_filler_ratio - a.average_filler_ratio);
      case "active":   return list.sort((a, b) => b.total_speaking_seconds - a.total_speaking_seconds);
      case "speeches": return list.sort((a, b) => b.total_speeches - a.total_speeches);
      case "silent":   return list.sort((a, b) => a.total_speaking_seconds - b.total_speaking_seconds);
    }
  };

  const sorted = getSorted();
  const filtered = selectedParty ? sorted.filter(p => p.party === selectedParty) : sorted;

  const activePols   = politicians.filter(p => p.total_speeches > 0);
  const silentPols   = politicians.filter(p => p.total_speeches === 0);
  const top3 = [...politicians]
    .sort((a, b) => b.average_filler_ratio - a.average_filler_ratio)
    .slice(0, 3);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    return m > 0 ? `${m} min` : `${secs}s`;
  };

  // Party participation chart
  const partyParticipation = PARTIES.map(party => {
    const pols = politicians.filter(p => p.party === party);
    const active = pols.filter(p => p.total_speeches > 0).length;
    return { party, active, total: pols.length };
  }).filter(p => p.total > 0);

  return (
    <div className="container py-8 sm:py-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Participação</h1>
      <p className="text-muted-foreground mb-8">
        Ranking dos deputados — quem fala mais, quem tem mais enchimentos, quem está em silêncio.
      </p>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        {[
          { icon: Users,      label: "Total deputados",  value: politicians.length },
          { icon: MessageSquare, label: "Ativos",        value: activePols.length },
          { icon: MicOff,     label: "Sem discursos",    value: silentPols.length },
          { icon: Trophy,     label: "Mais ativo",       value: activePols.sort((a, b) => b.total_speaking_seconds - a.total_speaking_seconds)[0]?.name.split(" ")[0] ?? "—" },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="glass-card rounded-xl p-4">
            <Icon className="h-4 w-4 text-primary mb-2" />
            <p className="text-lg font-bold font-mono">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {/* Podium */}
      {top3.length >= 3 && (
        <div className="mb-12">
          <h2 className="text-lg font-semibold mb-4 text-muted-foreground">Top 3 enchimentos</h2>
          <div className="flex items-end justify-center gap-4 max-w-md mx-auto">
            {[1, 0, 2].map((idx, pos) => {
              const p = top3[idx];
              if (!p) return null;
              const rank = idx + 1;
              const heights = ["h-36", "h-28", "h-20"];
              const fillerPct = `${(p.average_filler_ratio * 100).toFixed(1)}%`;
              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: pos * 0.15 }}
                  className="flex flex-col items-center flex-1"
                >
                  <Avatar className="h-12 w-12 mb-1 border-2" style={{ borderColor: PARTY_COLORS[p.party] }}>
                    {p.photo_url && <AvatarImage src={p.photo_url} alt={p.name} />}
                    <AvatarFallback className="bg-secondary text-xs font-bold">
                      {p.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <p className="text-xs font-semibold text-center truncate w-full">{p.name.split(" ")[0]}</p>
                  <p className="text-xs text-primary font-mono mb-1">{fillerPct}</p>
                  <div
                    className={`w-full ${heights[idx]} rounded-t-lg flex items-start justify-center pt-2 ${
                      rank === 1 ? "bg-primary/20 border border-primary/30" : "bg-secondary"
                    }`}
                  >
                    <Trophy className={`h-5 w-5 ${rank === 1 ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Party participation chart */}
      {partyParticipation.length > 0 && (
        <div className="glass-card rounded-xl p-6 mb-8">
          <h3 className="font-semibold mb-4">Participação por partido</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={partyParticipation}>
              <XAxis dataKey="party" stroke="hsl(220 15% 55%)" fontSize={12} />
              <YAxis stroke="hsl(220 15% 55%)" fontSize={12} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="active" name="Com discursos" radius={[4, 4, 0, 0]}>
                {partyParticipation.map(entry => (
                  <Cell key={entry.party} fill={PARTY_COLORS[entry.party] ?? "hsl(45 80% 55%)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Sort toggles */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(["filler", "active", "speeches", "silent"] as SortMode[]).map(mode => (
          <Button
            key={mode}
            variant={sortMode === mode ? "default" : "outline"}
            size="sm"
            onClick={() => setSortMode(mode)}
          >
            {{ filler: "Mais enchimento", active: "Mais tempo", speeches: "Mais discursos", silent: "Mais silenciosos" }[mode]}
          </Button>
        ))}
      </div>

      {/* Party filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Button
          variant={selectedParty === null ? "default" : "outline"}
          size="sm"
          onClick={() => setSelectedParty(null)}
        >
          Todos
        </Button>
        {PARTIES.map(party => (
          <Button
            key={party}
            variant={selectedParty === party ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedParty(party)}
          >
            {party}
          </Button>
        ))}
      </div>

      {/* Deputy grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="glass-card rounded-xl h-36 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((p, i) => {
            const initials = p.name.split(" ").map(n => n[0]).join("").slice(0, 2);
            const fillerPct = (p.average_filler_ratio * 100).toFixed(1);
            const grade = gradeFillerRate(p.average_filler_ratio);
            const color = PARTY_COLORS[p.party] ?? "hsl(45 80% 55%)";

            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className="glass-card rounded-xl p-4 hover:border-primary/20 transition-colors"
              >
                <div className="flex items-center gap-3 mb-3">
                  <Avatar className="h-10 w-10 border-2 shrink-0" style={{ borderColor: color }}>
                    {p.photo_url && <AvatarImage src={p.photo_url} alt={p.name} />}
                    <AvatarFallback className="bg-secondary text-xs font-bold">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{p.name}</p>
                    <p className="text-xs font-medium" style={{ color }}>{p.party}</p>
                  </div>
                  {p.total_speeches > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                      style={{ borderColor: grade.color + "80", color: grade.color }}
                    >
                      {grade.label}
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-secondary/50 rounded p-1.5">
                    <p className="text-muted-foreground">Tempo</p>
                    <p className="font-mono font-semibold">{formatTime(p.total_speaking_seconds)}</p>
                  </div>
                  <div className="bg-secondary/50 rounded p-1.5">
                    <p className="text-muted-foreground">Discursos</p>
                    <p className="font-mono font-semibold">{p.total_speeches}</p>
                  </div>
                  <div className="bg-secondary/50 rounded p-1.5">
                    <p className="text-muted-foreground">Enchim.</p>
                    <p className="font-mono font-semibold" style={{ color: grade.color }}>{fillerPct}%</p>
                  </div>
                </div>

                {p.total_speeches > 0 && (
                  <div className="mt-2">
                    <Progress value={Math.min(parseFloat(fillerPct) * 10, 100)} className="h-1.5" />
                  </div>
                )}

                {p.total_speeches === 0 && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <MicOff className="h-3 w-3" />
                    <span>Sem intervenções</span>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Silent deputies section */}
      {silentPols.length > 0 && sortMode !== "silent" && (
        <div className="mt-10 glass-card rounded-xl p-6">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <MicOff className="h-4 w-4 text-muted-foreground" />
            Deputados sem intervenções ({silentPols.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {silentPols.map(p => (
              <Badge
                key={p.id}
                variant="outline"
                className="text-xs"
                style={{ borderColor: PARTY_COLORS[p.party] + "60", color: PARTY_COLORS[p.party] }}
              >
                {p.name} · {p.party}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
