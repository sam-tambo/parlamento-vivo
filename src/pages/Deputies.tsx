import { useState } from "react";
import { motion } from "framer-motion";
import { Users, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PartyBadge } from "@/components/PartyBadge";
import { usePoliticians } from "@/lib/queries";
import { PARTIES, PARTY_COLORS } from "@/lib/mock-data";

type SortMode = "active" | "speeches" | "name";

export default function Deputies() {
  const [selectedParty, setSelectedParty] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("active");
  const [search, setSearch] = useState("");
  const { data: politicians = [], isLoading } = usePoliticians();

  const getSorted = () => {
    const list = [...politicians];
    switch (sortMode) {
      case "active":   return list.sort((a, b) => b.total_speaking_seconds - a.total_speaking_seconds);
      case "speeches": return list.sort((a, b) => b.total_speeches - a.total_speeches);
      case "name":     return list.sort((a, b) => a.name.localeCompare(b.name, "pt"));
    }
  };

  const sorted = getSorted();
  let filtered = selectedParty ? sorted.filter(p => p.party === selectedParty) : sorted;
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(p => p.name.toLowerCase().includes(q));
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-8 space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 text-primary mb-1">
            <Users className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wider">Deputados</span>
          </div>
          <h1 className="text-3xl font-bold">Deputados da Assembleia</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {politicians.length} deputados — clique para ver o perfil completo
          </p>
        </div>

        {/* Search + filters */}
        <div className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Procurar deputado..."
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div className="flex flex-wrap gap-2">
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
                style={selectedParty === party ? { background: PARTY_COLORS[party], borderColor: PARTY_COLORS[party] } : undefined}
              >
                {party}
              </Button>
            ))}
          </div>

          <div className="flex gap-2">
            {(["active", "speeches", "name"] as SortMode[]).map(mode => (
              <Button
                key={mode}
                variant={sortMode === mode ? "default" : "ghost"}
                size="sm"
                className="text-xs"
                onClick={() => setSortMode(mode)}
              >
                {{ active: "Mais tempo", speeches: "Mais intervenções", name: "A-Z" }[mode]}
              </Button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="glass-card rounded-xl h-28 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((p, i) => {
              const initials = p.name.split(" ").map(n => n[0]).join("").slice(0, 2);
              const color = PARTY_COLORS[p.party] ?? "#888";
              const minutes = Math.round(p.total_speaking_seconds / 60);

              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.015, 0.5) }}
                >
                  <Link
                    to={`/deputado/${p.id}`}
                    className="glass-card rounded-xl p-4 hover:border-primary/20 transition-all block"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar className="h-10 w-10 border-2 shrink-0" style={{ borderColor: color }}>
                        {p.photo_url && <AvatarImage src={p.photo_url} alt={p.name} />}
                        <AvatarFallback className="bg-secondary text-xs font-bold">{initials}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{p.name}</p>
                        <PartyBadge party={p.party} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center text-xs">
                      <div className="bg-secondary/50 rounded p-1.5">
                        <p className="text-muted-foreground">Intervenções</p>
                        <p className="font-mono font-semibold">{p.total_speeches}</p>
                      </div>
                      <div className="bg-secondary/50 rounded p-1.5">
                        <p className="text-muted-foreground">Tempo</p>
                        <p className="font-mono font-semibold">{minutes > 0 ? `${minutes} min` : "—"}</p>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}

        {filtered.length === 0 && !isLoading && (
          <div className="text-center py-16 text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>Nenhum deputado encontrado</p>
          </div>
        )}
      </div>
    </div>
  );
}
