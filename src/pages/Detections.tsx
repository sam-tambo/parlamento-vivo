import { useState } from "react";
import { DetectionCard } from "@/components/DetectionCard";
import { mockDetections, PARTIES } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const Detections = () => {
  const [selectedParty, setSelectedParty] = useState<string | null>(null);

  const filtered = selectedParty
    ? mockDetections.filter(d => d.politician.party === selectedParty)
    : mockDetections;

  return (
    <div className="container py-8 sm:py-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Deteções</h1>
      <p className="text-muted-foreground mb-8">Todas as vezes que deputados foram apanhados ao telemóvel.</p>

      {/* Filters */}
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

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((d, i) => (
          <DetectionCard key={d.id} {...d} index={i} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <p>Nenhuma deteção encontrada para este filtro.</p>
        </div>
      )}
    </div>
  );
};

export default Detections;
