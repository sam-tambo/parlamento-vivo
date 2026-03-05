import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, Mic, Vote, BarChart3, ExternalLink,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { AIDisclaimer } from "@/components/AIDisclaimer";
import { PartyBadge } from "@/components/PartyBadge";
import {
  useDeputyProfile,
  useDeputyInterventions,
  useDeputyVoteDissidences,
} from "@/lib/queries";
import { gradeFillerRate } from "@/lib/filler-words";
import { PARTY_COLORS } from "@/lib/mock-data";

function InterventionItem({ iv }: {
  iv: { id: string; text: string; word_count: number | null; filler_word_count: number; type: string; session_id: string; session_date?: string };
}) {
  const [open, setOpen] = useState(false);
  const wc = iv.word_count ?? 0;
  const fc = iv.filler_word_count ?? 0;

  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <button
        className="w-full text-left p-3 flex items-start gap-3 hover:bg-accent/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mb-1">
            <Badge variant="outline" className="text-[10px] px-1 py-0 capitalize">
              {iv.type?.replace(/_/g, " ")}
            </Badge>
            {iv.session_date && (
              <Link
                to={`/sessao/${iv.session_id}`}
                onClick={e => e.stopPropagation()}
                className="hover:text-primary"
              >
                {new Date(iv.session_date + "T12:00:00").toLocaleDateString("pt-PT", {
                  day: "numeric", month: "short",
                })}
              </Link>
            )}
            <span>{wc} palavras</span>
            {fc > 0 && <span className="text-primary">{fc} enchimentos</span>}
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {iv.text.slice(0, 200)}
          </p>
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        }
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-border/30 bg-secondary/20">
          <p className="text-sm leading-relaxed">{iv.text}</p>
        </div>
      )}
    </div>
  );
}

export default function DeputyDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: deputy, isLoading } = useDeputyProfile(id);
  const { data: interventions = [] } = useDeputyInterventions(deputy?.name);
  const { data: dissidences } = useDeputyVoteDissidences(deputy?.name);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="space-y-3 w-full max-w-2xl px-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card rounded-xl h-20 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!deputy) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center">
        <div>
          <p className="text-muted-foreground text-lg">Deputado não encontrado</p>
          <Link to="/deputados" className="text-primary text-sm hover:underline mt-2 block">
            ← Voltar aos deputados
          </Link>
        </div>
      </div>
    );
  }

  const color = PARTY_COLORS[deputy.party] ?? "#888";
  const initials = deputy.name.split(" ").map(n => n[0]).join("").slice(0, 2);
  const grade = gradeFillerRate(deputy.average_filler_ratio);
  const fillerPer1000 = deputy.total_words > 0
    ? Math.round(deputy.total_filler_count / deputy.total_words * 1000)
    : 0;
  const discipline = dissidences && dissidences.total_votes > 0
    ? Math.round((1 - dissidences.dissidences / dissidences.total_votes) * 100)
    : null;

  // Count distinct sessions from interventions
  const sessionsActive = new Set(interventions.map(iv => iv.session_id)).size;

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl py-6 space-y-6">
        {/* Back */}
        <Link
          to="/deputados"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Deputados
        </Link>

        {/* Profile header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6"
        >
          <div className="flex items-center gap-4 mb-4">
            <Avatar className="h-16 w-16 border-2" style={{ borderColor: color }}>
              {deputy.photo_url && <AvatarImage src={deputy.photo_url} alt={deputy.name} />}
              <AvatarFallback className="bg-secondary text-lg font-bold">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-xl font-bold">{deputy.full_name ?? deputy.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <PartyBadge party={deputy.party} size="md" />
                {deputy.constituency && (
                  <span className="text-xs text-muted-foreground">{deputy.constituency}</span>
                )}
              </div>
            </div>
            {deputy.parlamento_url && (
              <a
                href={deputy.parlamento_url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-muted-foreground hover:text-primary"
                title="Perfil no parlamento.pt"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center bg-secondary/50 rounded-xl p-3">
              <p className="text-xl font-bold">{interventions.length || deputy.total_speeches}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Intervenções</p>
            </div>
            <div className="text-center bg-secondary/50 rounded-xl p-3">
              <p className="text-xl font-bold">{deputy.total_words.toLocaleString("pt-PT")}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Palavras</p>
            </div>
            <div className="text-center bg-secondary/50 rounded-xl p-3">
              <p className="text-xl font-bold">{sessionsActive || "—"}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Sessões</p>
            </div>
            {discipline !== null && (
              <div className="text-center bg-secondary/50 rounded-xl p-3">
                <p className="text-xl font-bold">{discipline}%</p>
                <p className="text-[10px] text-muted-foreground uppercase">Disciplina</p>
              </div>
            )}
          </div>
        </motion.div>

        {/* Communication quality — filler words section */}
        {deputy.total_speeches > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card rounded-2xl p-5 space-y-3"
          >
            <h2 className="font-semibold flex items-center gap-2">
              <Mic className="h-4 w-4 text-primary" />
              Qualidade da Comunicação
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Enchimentos por 1000 palavras</span>
                <span className="font-mono font-bold text-lg" style={{ color: grade.color }}>
                  {fillerPer1000}
                </span>
              </div>
              <Progress
                value={Math.min(fillerPer1000 / 2, 100)}
                className="h-2"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Racio: {(deputy.average_filler_ratio * 100).toFixed(1)}%</span>
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0"
                  style={{ borderColor: grade.color + "80", color: grade.color }}
                >
                  {grade.label}
                </Badge>
              </div>
            </div>
          </motion.div>
        )}

        {/* Dissidences */}
        {dissidences && dissidences.dissidences > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="glass-card rounded-2xl p-5 space-y-2"
          >
            <h2 className="font-semibold flex items-center gap-2">
              <Vote className="h-4 w-4 text-primary" />
              Registo de Votação
            </h2>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-sm">
                Votou contra a posição do partido em{" "}
                <span className="font-bold text-amber-500">{dissidences.dissidences}</span>{" "}
                {dissidences.dissidences === 1 ? "votação" : "votações"}
              </p>
            </div>
          </motion.div>
        )}

        {/* Recent interventions */}
        {interventions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-3"
          >
            <h2 className="font-semibold flex items-center gap-2">
              <Mic className="h-4 w-4 text-primary" />
              Intervenções Recentes ({interventions.length})
            </h2>
            <div className="space-y-2">
              {interventions.map(iv => (
                <InterventionItem key={iv.id} iv={iv} />
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
