import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, Calendar, FileText, Users, Mic, Vote as VoteIcon,
  ChevronDown, ChevronUp, AlertTriangle, Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { VoteBreakdown } from "@/components/VoteBreakdown";
import { SpeakerTimeline } from "@/components/SpeakerTimeline";
import { DissidentAlert } from "@/components/DissidentAlert";
import { useSession, useInterventions, useVotes } from "@/lib/queries";
import { segmentTranscript } from "@/lib/filler-words";
import { PARTY_COLORS } from "@/lib/mock-data";

function InterventionRow({ iv, defaultOpen = false }: {
  iv: ReturnType<typeof useInterventions>["data"] extends (infer T)[] | undefined ? T : never;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const segments = open ? segmentTranscript(iv.text) : [];
  const party = iv.party ?? "?";
  const wc = iv.word_count ?? 0;
  const fc = iv.filler_word_count ?? 0;
  const fillerPct = wc > 0 ? Math.round(fc / wc * 100) : 0;

  return (
    <div className="border border-border/40 rounded-xl overflow-hidden">
      <button
        className="w-full text-left p-3 flex items-start gap-3 hover:bg-accent/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div
          className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
          style={{ background: PARTY_COLORS[party] ?? "hsl(var(--primary))" }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{iv.deputy_name}</span>
            <span
              className="text-[10px] font-bold"
              style={{ color: PARTY_COLORS[party] ?? "hsl(var(--muted-foreground))" }}
            >
              {party}
            </span>
            {iv.was_mic_cutoff && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500/60 text-amber-500">
                ⚠ mic cortado
              </Badge>
            )}
            {iv.applause_from?.length ? (
              <Badge variant="outline" className="text-[10px] px-1 py-0 border-green-500/50 text-green-500">
                👏 {iv.applause_from.join(", ")}
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
            <span>{wc} palavras</span>
            {fc > 0 && <span className="text-primary">{fc} enchimentos ({fillerPct}%)</span>}
          </div>
          {!open && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-1 italic">
              {iv.text.slice(0, 120)}…
            </p>
          )}
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border/30 bg-secondary/20">
          <p className="text-sm leading-relaxed">
            {segments.map((seg, i) =>
              seg.isFiller ? (
                <mark
                  key={i}
                  title={`${seg.fillerWord?.category} — ${seg.fillerWord?.severity}`}
                  className="bg-primary/20 text-primary rounded px-0.5 cursor-help"
                >
                  {seg.text}
                </mark>
              ) : (
                <span key={i}>{seg.text}</span>
              )
            )}
          </p>
        </div>
      )}
    </div>
  );
}

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: session, isLoading: loadingSession } = useSession(id);
  const { data: interventions = [] } = useInterventions(id);
  const { data: votes = [] } = useVotes(id);

  const [showFullSummaryEn, setShowFullSummaryEn] = useState(false);

  if (loadingSession) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="space-y-3 w-full max-w-2xl px-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-center">
        <div>
          <p className="text-muted-foreground text-lg">Sessão não encontrada</p>
          <Link to="/sessoes" className="text-primary text-sm hover:underline mt-2 block">
            ← Voltar às sessões
          </Link>
        </div>
      </div>
    );
  }

  const dateStr = new Date(session.date + "T12:00:00").toLocaleDateString("pt-PT", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  // Gather all dissidents across votes
  const allDissidents = votes.flatMap(v =>
    (v.dissidents ?? []).map(d => ({ ...d, voteDescription: v.description ?? undefined }))
  );

  const keyDecisions = (session.key_decisions ?? []) as Array<{ description: string; result: string; significance?: string }>;
  const notableMoments = (session.notable_moments ?? []) as Array<{ type: string; description: string; deputies_involved?: string[] }>;

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl py-6 space-y-6">
        {/* Back link */}
        <Link
          to="/sessoes"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Sessões
        </Link>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-5 space-y-3"
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              {session.session_number && (
                <p className="text-xs font-mono text-muted-foreground">
                  DAR I {session.legislatura} nº{session.session_number}
                </p>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span className="capitalize">{dateStr}</span>
              </div>
              {session.president_name && (
                <p className="text-xs text-muted-foreground">
                  Presidência: {session.president_name}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {session.deputies_present && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary rounded-lg px-2 py-1">
                  <Users className="h-3 w-3" />
                  {session.deputies_present} deputados
                </div>
              )}
              {session.dar_url && (
                <a
                  href={session.dar_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline bg-primary/10 rounded-lg px-2 py-1"
                >
                  <FileText className="h-3 w-3" />
                  DAR PDF
                </a>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div className="text-center bg-secondary/50 rounded-xl p-3">
              <p className="text-2xl font-bold">{interventions.length}</p>
              <p className="text-xs text-muted-foreground">Intervenções</p>
            </div>
            <div className="text-center bg-secondary/50 rounded-xl p-3">
              <p className="text-2xl font-bold">{votes.length}</p>
              <p className="text-xs text-muted-foreground">Votações</p>
            </div>
            <div className="text-center bg-secondary/50 rounded-xl p-3">
              <p className="text-2xl font-bold text-primary">
                {interventions.reduce((s, iv) => s + (iv.filler_word_count ?? 0), 0)}
              </p>
              <p className="text-xs text-muted-foreground">Enchimentos</p>
            </div>
          </div>
        </motion.div>

        {/* AI Summary */}
        {(session.summary_pt || session.analysis_status === "analyzed") && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card rounded-2xl p-5 space-y-3"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Resumo da Sessão</h2>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-auto">IA</Badge>
            </div>
            {session.summary_pt ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {session.summary_pt}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground/60 italic">Resumo em geração…</p>
            )}
            {session.summary_en && (
              <div className="border-t border-border/40 pt-3">
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowFullSummaryEn(o => !o)}
                >
                  {showFullSummaryEn ? "Ocultar versão em inglês" : "Ver em inglês"}
                </button>
                {showFullSummaryEn && (
                  <p className="text-sm leading-relaxed text-muted-foreground mt-2 italic">
                    {session.summary_en}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* Key Decisions */}
        {keyDecisions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="glass-card rounded-2xl p-5 space-y-3"
          >
            <h2 className="font-semibold flex items-center gap-2">
              <VoteIcon className="h-4 w-4 text-primary" />
              Decisões Principais
            </h2>
            <div className="space-y-2">
              {keyDecisions.map((d, i) => (
                <div key={i} className="flex items-start gap-2.5 text-sm">
                  <span
                    className="mt-0.5 flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase"
                    style={{
                      background: d.result === "aprovado" ? "hsl(145 60% 45% / 0.15)" : "hsl(0 70% 50% / 0.15)",
                      color:      d.result === "aprovado" ? "hsl(145 60% 45%)" : "hsl(0 70% 50%)",
                    }}
                  >
                    {d.result}
                  </span>
                  <div>
                    <p className="font-medium">{d.description}</p>
                    {d.significance && (
                      <p className="text-xs text-muted-foreground mt-0.5">{d.significance}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Notable Moments */}
        {notableMoments.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="glass-card rounded-2xl p-5 space-y-3"
          >
            <h2 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Momentos Notáveis
            </h2>
            <div className="space-y-2">
              {notableMoments.map((m, i) => (
                <div key={i} className="text-sm border-l-2 border-amber-500/40 pl-3">
                  <Badge variant="outline" className="text-[10px] px-1 py-0 mb-1 capitalize border-amber-500/50 text-amber-500">
                    {m.type?.replace(/_/g, " ")}
                  </Badge>
                  <p className="text-muted-foreground">{m.description}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Dissidents */}
        {allDissidents.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <DissidentAlert dissidents={allDissidents} />
          </motion.div>
        )}

        {/* Speaker Timeline */}
        {interventions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22 }}
            className="glass-card rounded-2xl p-5"
          >
            <h2 className="font-semibold flex items-center gap-2 mb-4">
              <Mic className="h-4 w-4 text-primary" />
              Tempo de Antena
            </h2>
            <SpeakerTimeline interventions={interventions} />
          </motion.div>
        )}

        {/* Votes */}
        {votes.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24 }}
            className="space-y-3"
          >
            <h2 className="font-semibold flex items-center gap-2">
              <VoteIcon className="h-4 w-4 text-primary" />
              Votações ({votes.length})
            </h2>
            {votes.map(v => (
              <VoteBreakdown key={v.id} vote={v} />
            ))}
          </motion.div>
        )}

        {/* Interventions feed */}
        {interventions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.26 }}
            className="space-y-3"
          >
            <h2 className="font-semibold flex items-center gap-2">
              <Mic className="h-4 w-4 text-primary" />
              Intervenções ({interventions.length})
            </h2>
            <div className="space-y-2">
              {interventions.map((iv, i) => (
                <InterventionRow key={iv.id} iv={iv} defaultOpen={i === 0} />
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
