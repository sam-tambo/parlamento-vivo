import { useState } from "react";
import { motion } from "framer-motion";
import { Search, SlidersHorizontal } from "lucide-react";
import { SpeechCard } from "@/components/SpeechCard";
import { useSpeeches } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PARTIES } from "@/lib/mock-data";

type SortMode = "recent" | "filler_high" | "filler_low" | "longest";

export default function Speeches() {
  const [selectedParty, setSelectedParty] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [search, setSearch] = useState("");

  const { data: speeches = [], isLoading } = useSpeeches(selectedParty);

  const sorted = [...speeches].sort((a, b) => {
    if (sortMode === "recent")     return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (sortMode === "filler_high") return b.filler_ratio - a.filler_ratio;
    if (sortMode === "filler_low")  return a.filler_ratio - b.filler_ratio;
    if (sortMode === "longest")    return b.speaking_duration_seconds - a.speaking_duration_seconds;
    return 0;
  });

  const filtered = search.trim()
    ? sorted.filter(s =>
        s.politician.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.transcript_excerpt ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : sorted;

  return (
    <div className="container py-8 sm:py-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Discursos</h1>
      <p className="text-muted-foreground mb-8">
        Análise de cada intervenção no plenário — tempo, palavras e enchimento.
      </p>

      {/* Search + Sort */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar deputado ou excerto…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          {(["recent", "filler_high", "filler_low", "longest"] as SortMode[]).map(mode => (
            <Button
              key={mode}
              variant={sortMode === mode ? "default" : "outline"}
              size="sm"
              onClick={() => setSortMode(mode)}
            >
              {{
                recent:     "Recentes",
                filler_high:"+ Enchimento",
                filler_low: "- Enchimento",
                longest:    "Mais longos",
              }[mode]}
            </Button>
          ))}
        </div>
      </div>

      {/* Party filters */}
      <div className="flex flex-wrap gap-2 mb-8">
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

      {/* Results count */}
      <p className="text-xs text-muted-foreground mb-4">
        {filtered.length} discurso{filtered.length !== 1 ? "s" : ""}
        {search ? ` para "${search}"` : ""}
        {selectedParty ? ` · ${selectedParty}` : ""}
      </p>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass-card rounded-xl h-52 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((s, i) => (
            <SpeechCard
              key={s.id}
              politician={s.politician}
              session_date={s.session_date ?? ""}
              speaking_duration_seconds={s.speaking_duration_seconds}
              filler_word_count={s.filler_word_count}
              total_word_count={s.total_word_count}
              filler_ratio={s.filler_ratio}
              transcript_excerpt={s.transcript_excerpt ?? undefined}
              filler_words_detail={s.filler_words_detail ?? undefined}
              index={i}
            />
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <p>Nenhum discurso encontrado.</p>
        </div>
      )}
    </div>
  );
}
