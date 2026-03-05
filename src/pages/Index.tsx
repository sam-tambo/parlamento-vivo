import { motion } from "framer-motion";
import { ArrowRight, Search, FileText, Vote, Mic, CheckCircle, XCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AIDisclaimer } from "@/components/AIDisclaimer";
import { useSessions, useLatestVotes, useGlobalStats } from "@/lib/queries";
import { PARTY_COLORS } from "@/lib/mock-data";

const MOMENT_ICONS: Record<string, string> = {
  confrontation: "\uD83D\uDD25",
  heated_exchange: "\uD83D\uDD25",
  party_split: "\uD83D\uDD00",
  mic_cutoff: "\u23F0",
  dissident_vote: "\u26A0\uFE0F",
  dissent: "\u26A0\uFE0F",
  unanimous: "\uD83E\uDD1D",
  record_filler: "\uD83D\uDDE3\uFE0F",
};

export default function Index() {
  const { data: sessions = [] } = useSessions("XVII", 1);
  const { data: latestVotes = [] } = useLatestVotes(10);
  const { data: stats } = useGlobalStats();
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const latestSession = sessions[0];
  const notableMoments = (latestSession?.notable_moments ?? []) as Array<{
    type: string; description: string; deputies_involved?: string[];
  }>;
  const keyDecisions = (latestSession?.key_decisions ?? []) as Array<{
    description: string; result: string; significance?: string;
  }>;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim().length >= 3) {
      navigate(`/pesquisa?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <div className="min-h-screen">
      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-16 sm:py-20">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="container relative max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-10"
          >
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-[1.15] mb-4">
              O que aconteceu no{" "}
              <span className="text-primary">Parlamento</span>
            </h1>
            <p className="text-base sm:text-lg text-muted-foreground max-w-lg mx-auto">
              Democracia portuguesa explicada em 2 minutos.
              Sessões, votações e intervenções — tudo aberto.
            </p>
          </motion.div>

          {/* Search bar */}
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            onSubmit={handleSearch}
            className="relative max-w-xl mx-auto mb-12"
          >
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Pesquisar no parlamento..."
              className="w-full pl-11 pr-4 py-3 rounded-xl bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </motion.form>

          {/* Quick stats bar */}
          {stats && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="grid grid-cols-3 gap-3 max-w-md mx-auto"
            >
              {[
                { icon: FileText, label: "sessões",      value: stats.sessions },
                { icon: Mic,      label: "intervenções",  value: stats.interventions },
                { icon: Vote,     label: "votações",      value: stats.votes },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="glass-card rounded-xl px-3 py-3 text-center">
                  <Icon className="h-4 w-4 text-primary mx-auto mb-1" />
                  <p className="text-xl font-bold font-mono">{value.toLocaleString("pt-PT")}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
                </div>
              ))}
            </motion.div>
          )}
        </div>
      </section>

      {/* ── Última sessão — hero card ───────────────────────── */}
      {latestSession?.summary_pt && (
        <section className="py-8 border-t border-border/40">
          <div className="container max-w-3xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Última Sessão</h2>
              <Link to="/sessoes">
                <Button variant="ghost" size="sm" className="gap-1.5 text-primary text-xs">
                  Todas as sessões <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
            <Link to={`/sessao/${latestSession.id}`}>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card rounded-xl p-5 hover:border-primary/30 transition-all group"
              >
                <div className="flex items-center gap-2 mb-3">
                  {latestSession.session_number && (
                    <span className="text-xs font-mono text-muted-foreground">
                      DAR I {latestSession.legislatura} nº{latestSession.session_number}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(latestSession.date + "T12:00:00").toLocaleDateString("pt-PT", {
                      weekday: "long", day: "numeric", month: "long", year: "numeric",
                    })}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground mb-3">
                  {latestSession.summary_pt}
                </p>
                <div className="flex items-center gap-2 text-xs text-primary font-medium">
                  Ler mais <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                </div>
                <div className="mt-3">
                  <AIDisclaimer />
                </div>
              </motion.div>
            </Link>
          </div>
        </section>
      )}

      {/* ── Key decisions ───────────────────────────────────── */}
      {keyDecisions.length > 0 && (
        <section className="py-8 border-t border-border/40">
          <div className="container max-w-3xl">
            <h2 className="text-lg font-bold mb-4">Decisões Principais</h2>
            <div className="space-y-2">
              {keyDecisions.slice(0, 5).map((d, i) => {
                const approved = d.result === "aprovado";
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="glass-card rounded-lg p-3 flex items-start gap-3"
                  >
                    {approved
                      ? <CheckCircle className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />
                      : <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{d.description}</p>
                      {d.significance && (
                        <p className="text-xs text-muted-foreground mt-0.5">{d.significance}</p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 capitalize shrink-0"
                      style={{
                        borderColor: approved ? "#4CAF50" : "#F44336",
                        color: approved ? "#4CAF50" : "#F44336",
                      }}
                    >
                      {d.result}
                    </Badge>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Votações recentes — horizontal scroll strip ──── */}
      {latestVotes.length > 0 && (
        <section className="py-8 border-t border-border/40">
          <div className="container">
            <h2 className="text-lg font-bold mb-4">Votações Recentes</h2>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x">
              {latestVotes.map((v, i) => {
                const isApproved = v.result === "aprovado";
                return (
                  <motion.div
                    key={v.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <Link
                      to={`/sessao/${v.session_id}`}
                      className="glass-card rounded-xl p-4 min-w-[260px] max-w-[300px] shrink-0 snap-start hover:border-primary/30 transition-all block"
                    >
                      <div className="flex items-start gap-2 mb-2">
                        {v.initiative_reference && (
                          <span className="text-[10px] font-mono text-muted-foreground truncate">
                            {v.initiative_reference}
                          </span>
                        )}
                        <Badge
                          variant="outline"
                          className="ml-auto text-[10px] px-1.5 py-0 capitalize shrink-0"
                          style={{
                            borderColor: isApproved ? "#4CAF50" : "#F44336",
                            color: isApproved ? "#4CAF50" : "#F44336",
                          }}
                        >
                          {v.result === "aprovado" ? "Aprovado" : v.result === "rejeitado" ? "Rejeitado" : v.result ?? "?"}
                        </Badge>
                      </div>
                      <p className="text-xs font-medium leading-snug line-clamp-2 mb-3">
                        {v.description ?? "Votação"}
                      </p>
                      {/* Party dots — solid = favor, faded = against */}
                      <div className="flex gap-1 flex-wrap">
                        {(v.favor ?? []).map(p => (
                          <span
                            key={`f-${p}`}
                            className="h-2.5 w-2.5 rounded-full"
                            title={`${p} — A favor`}
                            style={{ background: PARTY_COLORS[p] ?? "#888" }}
                          />
                        ))}
                        {(v.against ?? []).map(p => (
                          <span
                            key={`a-${p}`}
                            className="h-2.5 w-2.5 rounded-full opacity-30"
                            title={`${p} — Contra`}
                            style={{ background: PARTY_COLORS[p] ?? "#888" }}
                          />
                        ))}
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Destaques — notable moments ─────────────────── */}
      {notableMoments.length > 0 && (
        <section className="py-8 border-t border-border/40">
          <div className="container max-w-3xl">
            <h2 className="text-lg font-bold mb-4">Destaques</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {notableMoments.slice(0, 6).map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="glass-card rounded-xl p-4"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-lg shrink-0" aria-hidden>
                      {MOMENT_ICONS[m.type] ?? "\uD83D\uDCCC"}
                    </span>
                    <div className="min-w-0">
                      <Badge variant="outline" className="text-[10px] px-1 py-0 mb-1 capitalize">
                        {m.type?.replace(/_/g, " ")}
                      </Badge>
                      <p className="text-sm text-muted-foreground leading-snug">
                        {m.description}
                      </p>
                      {m.deputies_involved && m.deputies_involved.length > 0 && (
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          {m.deputies_involved.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="border-t border-border/50 py-8 mt-8">
        <div className="container text-center text-xs text-muted-foreground space-y-1">
          <p>Parlamento Vivo — Transparência parlamentar para todos.</p>
          <p>
            Fonte:{" "}
            <a
              href="https://www.parlamento.pt"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              parlamento.pt
            </a>
            {" "}&middot; Dados processados por IA, não representam posições oficiais.
          </p>
        </div>
      </footer>
    </div>
  );
}
