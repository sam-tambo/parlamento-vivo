import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { Download, RefreshCw, CheckCircle2, AlertCircle, Clock, FileText, Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { usePlenarioSessions, usePlenarioImportJob } from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImportJobRow {
  id: string;
  legislatura: string;
  status: string;
  total_sessions: number;
  sessions_processed: number;
  speeches_inserted: number;
  current_session: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

// ─── Import status card ───────────────────────────────────────────────────────

function ImportStatusCard({ job }: { job: ImportJobRow | null }) {
  if (!job) return null;

  const pct = job.total_sessions > 0
    ? Math.round((job.sessions_processed / job.total_sessions) * 100)
    : null;

  const statusColors: Record<string, string> = {
    pending:   "text-yellow-400",
    running:   "text-blue-400",
    completed: "text-green-400",
    error:     "text-red-400",
  };

  const StatusIcon = job.status === "completed"
    ? CheckCircle2
    : job.status === "error"
    ? AlertCircle
    : Loader2;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5 mb-6 border border-border/50"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <StatusIcon
            className={`h-5 w-5 ${statusColors[job.status] ?? "text-muted-foreground"} ${job.status === "running" ? "animate-spin" : ""}`}
          />
          <div>
            <p className="font-semibold text-sm">
              Importação {job.legislatura} Legislatura
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {job.sessions_processed} sessões · {job.speeches_inserted} discursos importados
              {job.total_sessions > 0 ? ` de ${job.total_sessions} sessões totais` : ""}
            </p>
          </div>
        </div>
        {pct !== null && (
          <span className="text-sm font-mono font-bold text-primary">{pct}%</span>
        )}
      </div>

      {pct !== null && (
        <div className="mt-3 h-1.5 bg-border/50 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      )}

      {job.error_message && (
        <p className="mt-3 text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
          {job.error_message}
        </p>
      )}
      {job.current_session && (
        <p className="mt-2 text-xs text-muted-foreground">
          A processar: {job.current_session}
        </p>
      )}
    </motion.div>
  );
}

// ─── Session row ──────────────────────────────────────────────────────────────

interface SessionRowProps {
  date: string;
  speechCount: number;
  darUrl: string | null;
  sessionNumber: number | null;
}

function SessionRow({ date, speechCount, darUrl, sessionNumber }: SessionRowProps) {
  const formatted = new Date(date + "T12:00:00").toLocaleDateString("pt-PT", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="flex items-center justify-between py-3 border-b border-border/30 last:border-0">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <FileText className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium capitalize">{formatted}</p>
          {sessionNumber && (
            <p className="text-xs text-muted-foreground">Sessão nº {sessionNumber}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-semibold">{speechCount}</p>
          <p className="text-xs text-muted-foreground">discursos</p>
        </div>
        {darUrl && (
          <a
            href={darUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            DAR
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Plenario() {
  const [isImporting, setIsImporting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [importOffset, setImportOffset] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [importDone, setImportDone] = useState(false);

  const queryClient = useQueryClient();
  const { data: sessions = [], isLoading: sessionsLoading } = usePlenarioSessions("XVII");
  const { data: activeJob } = usePlenarioImportJob(activeJobId);

  // Poll job status while running
  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status === "completed" || activeJob.status === "error") {
      setIsImporting(false);
      setImportDone(activeJob.status === "completed");
      queryClient.invalidateQueries({ queryKey: ["plenario_sessions"] });
    }
  }, [activeJob?.status, queryClient]);

  // ── Start import ────────────────────────────────────────────────────────────
  const startImport = useCallback(async () => {
    if (isImporting) return;
    setIsImporting(true);
    setImportError(null);
    setImportDone(false);

    try {
      // Create a job row for progress tracking
      const { data: job, error: jobError } = await supabase
        .from("plenario_import_jobs")
        .insert({ legislatura: "XVII", status: "pending" })
        .select()
        .single();

      if (jobError || !job) throw new Error(jobError?.message ?? "Failed to create job");
      setActiveJobId(job.id);

      // Call the edge function
      const resp = await supabase.functions.invoke("scrape-plenario", {
        body: {
          legislatura: "XVII",
          batch_size: 5,
          offset: importOffset,
          job_id: job.id,
        },
      });

      if (resp.error) throw new Error(resp.error.message);

      const result = resp.data as {
        sessions_processed: number;
        speeches_inserted: number;
        total_sessions: number;
        next_offset: number | null;
        done: boolean;
        errors?: string[];
      };

      if (result.next_offset !== null) {
        setImportOffset(result.next_offset);
      }

      queryClient.invalidateQueries({ queryKey: ["plenario_sessions"] });
    } catch (err) {
      setImportError(String(err));
      setIsImporting(false);
    }
  }, [isImporting, importOffset, queryClient]);

  // ── Counts ──────────────────────────────────────────────────────────────────
  const totalSpeeches = sessions.reduce((s, sess) => s + (sess.speech_count ?? 0), 0);
  const totalSessions = sessions.length;

  return (
    <div className="container py-8 sm:py-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-widest text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              XVII Legislatura
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold">Plenário</h1>
          <p className="text-muted-foreground mt-1">
            Dados históricos das sessões plenárias · 2022–2026
          </p>
        </div>

        <Button
          onClick={startImport}
          disabled={isImporting}
          className="gap-2 shrink-0"
          size="sm"
        >
          {isImporting ? (
            <><Loader2 className="h-4 w-4 animate-spin" />A importar…</>
          ) : importOffset > 0 ? (
            <><RefreshCw className="h-4 w-4" />Continuar importação</>
          ) : (
            <><Download className="h-4 w-4" />Importar dados</>
          )}
        </Button>
      </div>

      {/* Import error */}
      {importError && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 mb-6 text-sm text-red-400"
        >
          <strong>Erro na importação:</strong> {importError}
        </motion.div>
      )}

      {/* Import done */}
      {importDone && !isImporting && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl bg-green-500/10 border border-green-500/20 px-4 py-3 mb-6 text-sm text-green-400 flex items-center gap-2"
        >
          <CheckCircle2 className="h-4 w-4" />
          Importação concluída! Dados processados e guardados.
        </motion.div>
      )}

      {/* Active import job progress */}
      {activeJob && <ImportStatusCard job={activeJob as ImportJobRow} />}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        <div className="glass-card rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Sessões</p>
          <p className="text-2xl font-bold">{totalSessions}</p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Discursos</p>
          <p className="text-2xl font-bold">{totalSpeeches}</p>
        </div>
        <div className="glass-card rounded-xl p-4 col-span-2 sm:col-span-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Legislatura</p>
          <p className="text-2xl font-bold">XVII</p>
        </div>
      </div>

      {/* How it works — shown when no data yet */}
      {!sessionsLoading && totalSessions === 0 && !isImporting && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-6 mb-8 border border-primary/20"
        >
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Download className="h-4 w-4 text-primary" />
            Como funciona a importação
          </h3>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
            <li>Clique em <strong>Importar dados</strong> para iniciar o processo</li>
            <li>O servidor acede ao portal dados.parlamento.pt e ao site da AR</li>
            <li>Cada discurso é analisado para detectar palavras de enchimento</li>
            <li>Os oradores são automaticamente associados aos deputados na base de dados</li>
            <li>Os resultados ficam disponíveis nas páginas Discursos e Participação</li>
          </ol>
          <p className="text-xs text-muted-foreground mt-4">
            A importação processa sessões em lotes de 5. Pode ser necessário clicar várias vezes para
            importar todas as sessões da XVII Legislatura.
          </p>
        </motion.div>
      )}

      {/* Session list */}
      {sessionsLoading ? (
        <div className="glass-card rounded-xl p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 bg-border/30 rounded animate-pulse mb-3" />
          ))}
        </div>
      ) : totalSessions > 0 ? (
        <div className="glass-card rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Sessões importadas
            <span className="text-xs text-muted-foreground font-normal ml-1">
              ({totalSessions})
            </span>
          </h2>
          {sessions.map(sess => (
            <SessionRow
              key={sess.id}
              date={sess.date}
              speechCount={sess.speech_count ?? 0}
              darUrl={sess.dar_url ?? null}
              sessionNumber={sess.session_number ?? null}
            />
          ))}

          {/* Load more */}
          {importOffset > 0 && !importDone && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={startImport}
                disabled={isImporting}
                className="gap-2"
              >
                {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Importar mais sessões
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Clock className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>Nenhuma sessão importada ainda.</p>
          <p className="text-sm mt-1">Clique em "Importar dados" para começar.</p>
        </div>
      )}
    </div>
  );
}
