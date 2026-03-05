import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, Calendar, FileText, Users, Mic, Vote as VoteIcon,
  ChevronDown, ChevronUp, Sparkles, MessageSquareQuote,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AIDisclaimer } from "@/components/AIDisclaimer";
import { PartyBadge } from "@/components/PartyBadge";
import {
  useSession, useInterventions, useVotes,
  usePartyPositions, useVoteDeclarations,
  type Intervention, type Vote,
} from "@/lib/queries";
import { PARTY_COLORS } from "@/lib/mock-data";

// ─── Collapsible section wrapper ──────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ElementType;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-2xl overflow-hidden"
    >
      <button
        className="w-full flex items-center gap-2 p-5 pb-3 text-left hover:bg-accent/20 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <Icon className="h-4 w-4 text-primary shrink-0" />
        <h2 className="font-semibold flex-1">
          {title}
          {count !== undefined && (
            <span className="text-muted-foreground font-normal text-sm ml-1.5">({count})</span>
          )}
        </h2>
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground" />
        }
      </button>
      {open && <div className="px-5 pb-5 space-y-3">{children}</div>}
    </motion.div>
  );
}

// ─── Vote card ────────────────────────────────────────────────────────────────

function VoteCard({ vote }: { vote: Vote }) {
  const [open, setOpen] = useState(false);
  const favor = vote.favor ?? [];
  const against = vote.against ?? [];
  const abstain = vote.abstain ?? [];
  const dissidents = vote.dissidents ?? [];
  const isApproved = vote.result === "aprovado";

  return (
    <div className="border border-border/40 rounded-xl overflow-hidden">
      <button
        className="w-full text-left p-4 flex items-start gap-3 hover:bg-accent/20 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex-1 min-w-0">
          {vote.initiative_reference && (
            <span className="text-[10px] font-mono text-muted-foreground block mb-0.5">
              {vote.initiative_reference}
            </span>
          )}
          <p className="text-sm font-medium leading-snug">
            {vote.description ?? "Votação"}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 capitalize"
              style={{
                borderColor: isApproved ? "#4CAF50" : "#F44336",
                color: isApproved ? "#4CAF50" : "#F44336",
              }}
            >
              {isApproved ? "Aprovado" : vote.result === "rejeitado" ? "Rejeitado" : vote.result ?? "?"}
            </Badge>
            {dissidents.length > 0 && (
              <span className="text-[10px] text-amber-500 font-medium">
                {dissidents.length} dissidente{dissidents.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        }
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-border/30 pt-3 space-y-3">
          {/* Three columns: Favor / Contra / Abstenção */}
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="space-y-1.5">
              <p className="font-semibold" style={{ color: "#4CAF50" }}>A Favor</p>
              <div className="flex flex-wrap gap-1">
                {favor.length > 0 ? favor.map(p => (
                  <PartyBadge key={p} party={p} />
                )) : <span className="text-muted-foreground/50">—</span>}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="font-semibold" style={{ color: "#F44336" }}>Contra</p>
              <div className="flex flex-wrap gap-1">
                {against.length > 0 ? against.map(p => (
                  <PartyBadge key={p} party={p} />
                )) : <span className="text-muted-foreground/50">—</span>}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="font-semibold text-muted-foreground">Abstenção</p>
              <div className="flex flex-wrap gap-1">
                {abstain.length > 0 ? abstain.map(p => (
                  <PartyBadge key={p} party={p} />
                )) : <span className="text-muted-foreground/50">—</span>}
              </div>
            </div>
          </div>

          {/* Dissident alert */}
          {dissidents.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-amber-500">
                {(() => {
                  const byParty: Record<string, string[]> = {};
                  for (const d of dissidents) {
                    (byParty[d.party] ??= []).push(d.name);
                  }
                  return Object.entries(byParty).map(([party, names]) =>
                    `${names.length} deputado${names.length !== 1 ? "s" : ""} do ${party} ${names.length !== 1 ? "votaram" : "votou"} contra a posição do partido`
                  ).join(". ");
                })()}
              </p>
              <div className="flex flex-wrap gap-1">
                {dissidents.map((d, i) => (
                  <span key={i} className="text-[10px] bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                    {d.name} ({d.party}) → {d.vote}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Intervention row (speaker timeline) ──────────────────────────────────────

function InterventionRow({
  iv,
  defaultOpen = false,
}: {
  iv: Intervention;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const party = iv.party ?? "?";
  const wc = iv.word_count ?? 0;

  const TYPE_LABELS: Record<string, string> = {
    intervencao: "Intervenção",
    pedido_esclarecimento: "Pedido de esclarecimento",
    resposta: "Resposta",
    aparte: "Aparte",
  };

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
            {iv.deputy_id ? (
              <Link
                to={`/deputado/${iv.deputy_id}`}
                onClick={e => e.stopPropagation()}
                className="font-semibold text-sm hover:text-primary transition-colors"
              >
                {iv.deputy_name}
              </Link>
            ) : (
              <span className="font-semibold text-sm">{iv.deputy_name}</span>
            )}
            <PartyBadge party={party} />
            <Badge variant="outline" className="text-[10px] px-1 py-0 capitalize">
              {TYPE_LABELS[iv.type] ?? iv.type?.replace(/_/g, " ")}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
            <span>{wc} palavras</span>
            {iv.applause_from && iv.applause_from.length > 0 && (
              <span title={`Aplausos: ${iv.applause_from.join(", ")}`}>
                👏 {iv.applause_from.join(", ")}
              </span>
            )}
            {iv.protests_from && iv.protests_from.length > 0 && (
              <span title={`Protestos: ${iv.protests_from.join(", ")}`}>
                🗣️ {iv.protests_from.join(", ")}
              </span>
            )}
            {iv.was_mic_cutoff && (
              <span className="text-amber-500" title="Microfone cortado">⏰ mic cortado</span>
            )}
          </div>
          {!open && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">
              {iv.text.slice(0, 200)}
            </p>
          )}
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        }
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border/30 bg-secondary/20">
          <p className="text-sm leading-relaxed whitespace-pre-line">{iv.text}</p>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: session, isLoading: loadingSession } = useSession(id);
  const { data: interventions = [] } = useInterventions(id);
  const { data: votes = [] } = useVotes(id);
  const { data: partyPositions = [] } = usePartyPositions();
  const { data: voteDeclarations = [] } = useVoteDeclarations(id);

  const [showFullSummaryEn, setShowFullSummaryEn] = useState(false);
  const [timelineLimit, setTimelineLimit] = useState(10);

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

  const keyDecisions = (session.key_decisions ?? []) as Array<{
    description: string; result: string; significance?: string;
  }>;
  const notableMoments = (session.notable_moments ?? []) as Array<{
    type: string; description: string; deputies_involved?: string[];
  }>;

  const sessionPositions = partyPositions.filter(pp => pp.session_id === id);
  const positionTopics = [...new Set(sessionPositions.map(pp => pp.topic))];

  const visibleInterventions = interventions.slice(0, timelineLimit);

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl py-6 space-y-5">
        {/* Back link */}
        <Link
          to="/sessoes"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Sessões
        </Link>

        {/* ── 1. HEADER ──────────────────────────────────────── */}
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

          {/* Quick stats */}
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

        {/* ── 2. AI SUMMARY ──────────────────────────────────── */}
        {(session.summary_pt || session.analysis_status === "analyzed") && (
          <Section title="Resumo da Sessão" icon={Sparkles} defaultOpen={true}>
            {session.summary_pt ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {session.summary_pt}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground/60 italic">Resumo em geração…</p>
            )}
            <AIDisclaimer />
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
          </Section>
        )}

        {/* ── 3. KEY DECISIONS ───────────────────────────────── */}
        {keyDecisions.length > 0 && (
          <Section title="Decisões Principais" icon={VoteIcon} count={keyDecisions.length} defaultOpen={true}>
            <div className="space-y-2">
              {keyDecisions.map((d, i) => {
                const approved = d.result === "aprovado";
                return (
                  <div key={i} className="flex items-start gap-2.5 text-sm">
                    <span
                      className="mt-0.5 flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase"
                      style={{
                        background: approved ? "rgba(76,175,80,0.15)" : "rgba(244,67,54,0.15)",
                        color: approved ? "#4CAF50" : "#F44336",
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
                );
              })}
            </div>
          </Section>
        )}

        {/* ── 4. VOTES ───────────────────────────────────────── */}
        {votes.length > 0 && (
          <Section title="Votações" icon={VoteIcon} count={votes.length} defaultOpen={true}>
            <div className="space-y-2">
              {votes.map(v => (
                <VoteCard key={v.id} vote={v} />
              ))}
            </div>
          </Section>
        )}

        {/* ── 5. PARTY POSITIONS ─────────────────────────────── */}
        {sessionPositions.length > 0 && (
          <Section title="Posições dos Partidos" icon={Users} defaultOpen={false}>
            {positionTopics.map(topic => (
              <div key={topic} className="space-y-2">
                <h3 className="text-sm font-medium">{topic}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {sessionPositions
                    .filter(pp => pp.topic === topic)
                    .map(pp => (
                      <div key={pp.id} className="bg-secondary/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <PartyBadge party={pp.party} />
                          {pp.vote_alignment && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 capitalize">
                              {pp.vote_alignment}
                            </Badge>
                          )}
                        </div>
                        {pp.position_summary && (
                          <p className="text-xs text-muted-foreground">{pp.position_summary}</p>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            ))}
            <AIDisclaimer />
          </Section>
        )}

        {/* ── 6. SPEAKER TIMELINE ────────────────────────────── */}
        {interventions.length > 0 && (
          <Section
            title="Linha Temporal de Intervenções"
            icon={Mic}
            count={interventions.length}
            defaultOpen={false}
          >
            <div className="space-y-2">
              {visibleInterventions.map((iv, i) => (
                <InterventionRow key={iv.id} iv={iv} defaultOpen={i === 0} />
              ))}
            </div>
            {interventions.length > timelineLimit && (
              <button
                className="text-sm text-primary hover:underline w-full text-center py-2"
                onClick={() => setTimelineLimit(l => l + 20)}
              >
                Mostrar mais ({interventions.length - timelineLimit} restantes)
              </button>
            )}
          </Section>
        )}

        {/* ── 7. VOTE DECLARATIONS ───────────────────────────── */}
        {voteDeclarations.length > 0 && (
          <Section
            title="Declarações de Voto"
            icon={MessageSquareQuote}
            count={voteDeclarations.length}
            defaultOpen={false}
          >
            <div className="space-y-3">
              {voteDeclarations.map(decl => (
                <VoteDeclarationCard key={decl.id} declaration={decl} />
              ))}
            </div>
          </Section>
        )}

        {/* Notable Moments (bonus, from AI analysis) */}
        {notableMoments.length > 0 && (
          <Section title="Momentos Notáveis" icon={Sparkles} defaultOpen={false}>
            <div className="space-y-2">
              {notableMoments.map((m, i) => (
                <div key={i} className="text-sm border-l-2 border-amber-500/40 pl-3">
                  <Badge variant="outline" className="text-[10px] px-1 py-0 mb-1 capitalize border-amber-500/50 text-amber-500">
                    {m.type?.replace(/_/g, " ")}
                  </Badge>
                  <p className="text-muted-foreground">{m.description}</p>
                  {m.deputies_involved && m.deputies_involved.length > 0 && (
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {m.deputies_involved.join(", ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

// ─── Vote declaration expandable card ─────────────────────────────────────────

function VoteDeclarationCard({ declaration }: {
  declaration: { id: string; deputy_name: string; party: string | null; declaration_text: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <button
        className="w-full text-left p-3 flex items-center gap-3 hover:bg-accent/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="font-semibold text-sm">{declaration.deputy_name}</span>
          {declaration.party && <PartyBadge party={declaration.party} />}
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        }
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-border/30 bg-secondary/20">
          <blockquote className="text-sm leading-relaxed italic text-muted-foreground border-l-2 border-primary/30 pl-3">
            {declaration.declaration_text}
          </blockquote>
        </div>
      )}
    </div>
  );
}
