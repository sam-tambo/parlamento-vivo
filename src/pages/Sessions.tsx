import { useState } from "react";
import { motion } from "framer-motion";
import { Archive, Filter, ChevronDown } from "lucide-react";
import { SessionCard } from "@/components/SessionCard";
import { useSessions } from "@/lib/queries";
import type { SessionFull } from "@/lib/queries";

const LEGISLATURAS = ["XVII", "XVI", "XV", "XIV"] as const;

export default function Sessions() {
  const [leg, setLeg] = useState<string>("XVII");
  const { data: sessions, isLoading } = useSessions(leg, 100);

  const analyzed  = sessions?.filter(s => s.analysis_status === "analyzed").length ?? 0;
  const total     = sessions?.length ?? 0;

  // Map SessionFull → SessionCardData
  const sessionCards = (sessions ?? []).map(s => ({
    id:                 s.id,
    date:               s.date,
    session_number:     s.session_number,
    legislatura:        s.legislatura,
    dar_url:            s.dar_url,
    summary_pt:         s.summary_pt,
    analysis_status:    s.analysis_status,
    deputies_present:   s.deputies_present,
  }));

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl py-8 space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="flex items-center gap-2 text-primary">
            <Archive className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wider">Parlamento Aberto</span>
          </div>
          <h1 className="text-3xl font-bold">Sessões Plenárias</h1>
          <p className="text-muted-foreground">
            Arquivo de sessões com intervenções, votações e análise por IA
          </p>
        </motion.div>

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-secondary/50">
            {LEGISLATURAS.map(l => (
              <button
                key={l}
                onClick={() => setLeg(l)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  leg === l
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            <span>{analyzed}/{total} analisadas</span>
          </div>
        </div>

        {/* Session list */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="glass-card rounded-xl h-28 animate-pulse" />
            ))}
          </div>
        ) : sessionCards.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Archive className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">Nenhuma sessão encontrada</p>
            <p className="text-sm mt-1">
              Execute <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">python dar_scraper.py run --leg {leg}</code> para importar sessões
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sessionCards.map((s, i) => (
              <SessionCard key={s.id} session={s} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
