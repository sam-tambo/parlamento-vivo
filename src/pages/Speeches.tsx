import { useState } from "react";
import { SpeechCard } from "@/components/SpeechCard";
import { mockSpeeches, PARTIES } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";

const Speeches = () => {
  const [selectedParty, setSelectedParty] = useState<string | null>(null);

  const filtered = selectedParty
    ? mockSpeeches.filter(s => s.politician.party === selectedParty)
    : mockSpeeches;

  return (
    <div className="container py-8 sm:py-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Discursos</h1>
      <p className="text-muted-foreground mb-8">Análise de cada intervenção no plenário — tempo, palavras e enchimento.</p>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-8">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((s, i) => (
          <SpeechCard key={s.id} {...s} index={i} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <p>Nenhum discurso encontrado para este filtro.</p>
        </div>
      )}
    </div>
  );
};

export default Speeches;
