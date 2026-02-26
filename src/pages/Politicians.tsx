import { useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Clock, MessageSquare } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { mockPoliticians, PARTIES, PARTY_COLORS } from "@/lib/mock-data";

type SortMode = "filler" | "active" | "silent";

const Politicians = () => {
  const [selectedParty, setSelectedParty] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("filler");

  const getSorted = () => {
    const list = [...mockPoliticians];
    switch (sortMode) {
      case "filler": return list.sort((a, b) => b.average_filler_ratio - a.average_filler_ratio);
      case "active": return list.sort((a, b) => b.total_speaking_seconds - a.total_speaking_seconds);
      case "silent": return list.sort((a, b) => a.total_speaking_seconds - b.total_speaking_seconds);
    }
  };

  const sorted = getSorted();
  const filtered = selectedParty ? sorted.filter(p => p.party === selectedParty) : sorted;
  const top3 = sorted.slice(0, 3);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    return m > 0 ? `${m} min` : `${secs}s`;
  };

  const podiumLabel = sortMode === "filler" ? "Mais enchimento" : sortMode === "active" ? "Mais ativos" : "Mais silenciosos";

  return (
    <div className="container py-8 sm:py-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Deputados</h1>
      <p className="text-muted-foreground mb-8">Ranking dos deputados por participação e qualidade de discurso.</p>

      {/* Sort toggles */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Button variant={sortMode === "filler" ? "default" : "outline"} size="sm" onClick={() => setSortMode("filler")}>
          Mais enchimento
        </Button>
        <Button variant={sortMode === "active" ? "default" : "outline"} size="sm" onClick={() => setSortMode("active")}>
          Mais ativos
        </Button>
        <Button variant={sortMode === "silent" ? "default" : "outline"} size="sm" onClick={() => setSortMode("silent")}>
          Mais silenciosos
        </Button>
      </div>

      {/* Podium */}
      <div className="grid grid-cols-3 gap-4 mb-12 max-w-lg mx-auto">
        {[1, 0, 2].map((idx, pos) => {
          const p = top3[idx];
          if (!p) return null;
          const rank = idx + 1;
          const heights = ["h-32", "h-24", "h-20"];
          const val = sortMode === "filler" ? `${(p.average_filler_ratio * 100).toFixed(1)}%` : formatTime(p.total_speaking_seconds);
          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: pos * 0.15 }}
              className="flex flex-col items-center"
            >
              <Avatar className="h-14 w-14 mb-2 border-2" style={{ borderColor: PARTY_COLORS[p.party] }}>
                <AvatarFallback className="bg-secondary text-sm font-bold">
                  {p.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <p className="text-xs font-semibold text-center truncate w-full">{p.name.split(" ")[0]}</p>
              <p className="text-xs text-primary font-mono mb-2">{val}</p>
              <div className={`w-full ${heights[idx]} rounded-t-lg flex items-start justify-center pt-2 ${rank === 1 ? "bg-primary/20 border border-primary/30" : "bg-secondary"}`}>
                <Trophy className={`h-5 w-5 ${rank === 1 ? "text-primary" : "text-muted-foreground"}`} />
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Party filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Button variant={selectedParty === null ? "default" : "outline"} size="sm" onClick={() => setSelectedParty(null)}>
          Todos
        </Button>
        {PARTIES.map(party => (
          <Button key={party} variant={selectedParty === party ? "default" : "outline"} size="sm" onClick={() => setSelectedParty(party)}>
            {party}
          </Button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map((p, i) => {
          const initials = p.name.split(" ").map(n => n[0]).join("").slice(0, 2);
          const fillerPct = (p.average_filler_ratio * 100).toFixed(1);
          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="glass-card rounded-xl p-4 hover:border-primary/20 transition-colors"
            >
              <div className="flex items-center gap-3 mb-3">
                <Avatar className="h-10 w-10 border-2" style={{ borderColor: PARTY_COLORS[p.party] }}>
                  <AvatarFallback className="bg-secondary text-xs font-bold">{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{p.name}</p>
                  <p className="text-xs" style={{ color: PARTY_COLORS[p.party] }}>{p.party}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <p className="text-muted-foreground">Tempo</p>
                  <p className="font-mono font-semibold">{formatTime(p.total_speaking_seconds)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Discursos</p>
                  <p className="font-mono font-semibold">{p.total_speeches}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Enchim.</p>
                  <p className="font-mono font-semibold text-primary">{fillerPct}%</p>
                </div>
              </div>
              {p.total_speeches > 0 && (
                <div className="mt-2">
                  <Progress value={Math.min(parseFloat(fillerPct) * 10, 100)} className="h-1" />
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default Politicians;
