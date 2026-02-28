/**
 * /plenario — Historic plenário data importer
 *
 * All scraping runs in the browser via the dados.parlamento.pt public API —
 * no edge function deployment needed. The user picks which Legislaturas to
 * import and the page queues them one by one with live progress.
 */

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download, CheckCircle2, AlertCircle, Loader2,
  XCircle, Play, Square, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  LEGISLATURAS,
  importLegislatura,
  type ImportProgress,
} from "@/lib/plenario-importer";
import { usePlenarioSessions } from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────────────────────────────

type JobStatus = "idle" | "queued" | "running" | "done" | "error";

interface LegJob {
  code: string;
  label: string;
  status: JobStatus;
  speechesInserted: number;
  sessionsCreated: number;
  totalFetched: number;
  error?: string;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; cls: string; icon: React.ReactNode }> = {
    idle:    { label: "Pendente",     cls: "bg-border/50 text-muted-foreground",   icon: null },
    queued:  { label: "Na fila",      cls: "bg-yellow-500/15 text-yellow-400",     icon: <Loader2 className="h-3 w-3" /> },
    running: { label: "A importar…",  cls: "bg-blue-500/15 text-blue-400",         icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    done:    { label: "Concluído",    cls: "bg-green-500/15 text-green-400",       icon: <CheckCircle2 className="h-3 w-3" /> },
    error:   { label: "Erro",         cls: "bg-red-500/15 text-red-400",           icon: <AlertCircle className="h-3 w-3" /> },
  };
  const { label, cls, icon } = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${cls}`}>
      {icon}{label}
    </span>
  );
}

// ─── Legislatura row ──────────────────────────────────────────────────────────

function LegRow({
  job,
  sessionCount,
  onQueue,
  onDequeue,
  isGlobalRunning,
}: {
  job: LegJob;
  sessionCount: number;
  onQueue: (code: string) => void;
  onDequeue: (code: string) => void;
  isGlobalRunning: boolean;
}) {
  const info = LEGISLATURAS.find(l => l.code === job.code)!;
  const canAct = job.status === "idle" || job.status === "error";

  return (
    <motion.div
      layout
      className="flex items-center gap-3 sm:gap-4 py-4 border-b border-border/30 last:border-0"
    >
      {/* Leg info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{info.label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {info.start.slice(0, 4)}
          {info.end ? ` – ${info.end.slice(0, 4)}` : " – presente"}
          {sessionCount > 0 && ` · ${sessionCount} sessões importadas`}
        </p>
        {job.error && (
          <p className="text-xs text-red-400 mt-1 truncate">{job.error}</p>
        )}
      </div>

      {/* Stats */}
      {job.status === "running" || job.status === "done" ? (
        <div className="hidden sm:flex gap-4 text-right shrink-0">
          <div>
            <p className="text-sm font-semibold">{job.speechesInserted}</p>
            <p className="text-xs text-muted-foreground">discursos</p>
          </div>
          <div>
            <p className="text-sm font-semibold">{job.totalFetched}</p>
            <p className="text-xs text-muted-foreground">lidos</p>
          </div>
        </div>
      ) : null}

      {/* Badge */}
      <StatusBadge status={job.status} />

      {/* Action button */}
      <div className="shrink-0">
        {job.status === "queued" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDequeue(job.code)}
            className="h-8 w-8 p-0"
            title="Remover da fila"
          >
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </Button>
        ) : canAct ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onQueue(job.code)}
            disabled={isGlobalRunning}
            className="gap-1.5"
          >
            <Play className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Importar</span>
          </Button>
        ) : job.status === "done" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onQueue(job.code)}
            disabled={isGlobalRunning}
            title="Re-importar"
            className="h-8 w-8 p-0"
          >
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        ) : null}
      </div>
    </motion.div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Plenario() {
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);

  // Per-legislatura job state
  const [jobs, setJobs] = useState<LegJob[]>(() =>
    LEGISLATURAS.map(l => ({
      code: l.code,
      label: l.label,
      status: "idle",
      speechesInserted: 0,
      sessionsCreated: 0,
      totalFetched: 0,
    }))
  );

  const [isRunning, setIsRunning] = useState(false);

  // Fetch session counts per legislatura
  const legCodes = LEGISLATURAS.map(l => l.code);
  const sessionQueries = legCodes.map(code =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    usePlenarioSessions(code)
  );

  const sessionCountMap: Record<string, number> = {};
  legCodes.forEach((code, i) => {
    sessionCountMap[code] = sessionQueries[i].data?.length ?? 0;
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const updateJob = useCallback((code: string, patch: Partial<LegJob>) => {
    setJobs(prev => prev.map(j => j.code === code ? { ...j, ...patch } : j));
  }, []);

  const queueJob = useCallback((code: string) => {
    updateJob(code, { status: "queued", error: undefined });
  }, [updateJob]);

  const dequeueJob = useCallback((code: string) => {
    updateJob(code, { status: "idle" });
  }, [updateJob]);

  // ── Queue all legislaturas ───────────────────────────────────────────────────

  const queueAll = useCallback(() => {
    setJobs(prev =>
      prev.map(j =>
        j.status === "idle" || j.status === "error"
          ? { ...j, status: "queued", error: undefined }
          : j
      )
    );
  }, []);

  // ── Stop running job ─────────────────────────────────────────────────────────

  const stopAll = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
    setJobs(prev =>
      prev.map(j =>
        j.status === "running" || j.status === "queued"
          ? { ...j, status: "idle" }
          : j
      )
    );
  }, []);

  // ── Process queue ────────────────────────────────────────────────────────────

  const runQueue = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Process queued jobs one by one
    while (true) {
      if (ctrl.signal.aborted) break;

      // Find next queued job
      let nextCode: string | null = null;
      setJobs(prev => {
        const next = prev.find(j => j.status === "queued");
        nextCode = next?.code ?? null;
        return prev;
      });

      // Read jobs state synchronously via ref trick
      // (setJobs callback runs immediately and sets nextCode)
      if (!nextCode) break;

      const code = nextCode;
      updateJob(code, { status: "running" });

      const result = await importLegislatura(
        supabase,
        code,
        (prog: ImportProgress) => {
          updateJob(code, {
            speechesInserted: prog.speechesInserted,
            sessionsCreated: prog.sessionsCreated,
            totalFetched: prog.totalFetched,
          });
        },
        ctrl.signal,
      );

      updateJob(code, {
        status: result.status === "done" ? "done" : "error",
        speechesInserted: result.speechesInserted,
        sessionsCreated: result.sessionsCreated,
        totalFetched: result.totalFetched,
        error: result.error,
      });

      // Refresh session list after each legislatura
      legCodes.forEach(lc =>
        queryClient.invalidateQueries({ queryKey: ["plenario_sessions", lc] })
      );

      if (ctrl.signal.aborted) break;
    }

    setIsRunning(false);
  }, [isRunning, updateJob, queryClient, legCodes]);

  // Start running whenever items are queued and nothing is running
  const hasQueued = jobs.some(j => j.status === "queued");

  // ── Derived stats ─────────────────────────────────────────────────────────

  const totalSpeeches = jobs.reduce((s, j) => s + j.speechesInserted, 0);
  const totalSessions = Object.values(sessionCountMap).reduce((s, n) => s + n, 0);
  const doneCount     = jobs.filter(j => j.status === "done").length;
  const errorCount    = jobs.filter(j => j.status === "error").length;

  return (
    <div className="container py-8 sm:py-12 max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold mb-1">Plenário</h1>
        <p className="text-muted-foreground">
          Importa dados históricos das sessões plenárias por legislatura.
          Corre directamente no browser via dados.parlamento.pt — não precisa de funções de servidor.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: "Sessões na DB",    value: totalSessions },
          { label: "Discursos na DB",  value: totalSpeeches + " novos" },
          { label: "Legislaturas",     value: `${doneCount} / ${LEGISLATURAS.length}` },
        ].map(s => (
          <div key={s.label} className="glass-card rounded-xl p-4 text-center">
            <p className="text-xl sm:text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mb-6">
        {!isRunning ? (
          <>
            <Button
              onClick={() => { queueAll(); }}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <Download className="h-3.5 w-3.5" />
              Adicionar todas à fila
            </Button>
            {hasQueued && (
              <Button
                onClick={runQueue}
                size="sm"
                className="gap-2"
              >
                <Play className="h-3.5 w-3.5" />
                Iniciar importação
              </Button>
            )}
          </>
        ) : (
          <Button
            onClick={stopAll}
            variant="destructive"
            size="sm"
            className="gap-2"
          >
            <Square className="h-3.5 w-3.5" />
            Parar
          </Button>
        )}

        {errorCount > 0 && (
          <span className="text-xs text-red-400 ml-auto">
            {errorCount} erro{errorCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* How it works — shown before any import */}
      {totalSessions === 0 && !isRunning && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card rounded-xl p-5 mb-6 border border-primary/20 text-sm"
        >
          <p className="font-semibold mb-2">Como funciona</p>
          <ol className="text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Clica em <strong>Importar</strong> numa ou mais legislaturas (ou adiciona todas à fila)</li>
            <li>O browser consulta a API pública do dados.parlamento.pt</li>
            <li>Cada intervenção é analisada para palavras de enchimento</li>
            <li>Os oradores são associados aos deputados na base de dados</li>
            <li>Os discursos ficam disponíveis nas páginas Discursos e Participação</li>
          </ol>
        </motion.div>
      )}

      {/* Legislatura list */}
      <div className="glass-card rounded-xl px-5 py-2">
        <AnimatePresence initial={false}>
          {jobs.map(job => (
            <LegRow
              key={job.code}
              job={job}
              sessionCount={sessionCountMap[job.code] ?? 0}
              onQueue={code => {
                queueJob(code);
                // Auto-start if not already running
                if (!isRunning) {
                  // Delay to let state update propagate
                  setTimeout(() => {
                    setIsRunning(true);
                    const ctrl = new AbortController();
                    abortRef.current = ctrl;
                    importLegislatura(
                      supabase,
                      code,
                      (prog: ImportProgress) => {
                        updateJob(code, {
                          status: prog.status === "running" ? "running" : prog.status,
                          speechesInserted: prog.speechesInserted,
                          sessionsCreated: prog.sessionsCreated,
                          totalFetched: prog.totalFetched,
                          error: prog.error,
                        });
                      },
                      ctrl.signal,
                    ).then(result => {
                      updateJob(code, {
                        status: result.status === "done" ? "done" : "error",
                        speechesInserted: result.speechesInserted,
                        sessionsCreated: result.sessionsCreated,
                        totalFetched: result.totalFetched,
                        error: result.error,
                      });
                      setIsRunning(false);
                      legCodes.forEach(lc =>
                        queryClient.invalidateQueries({ queryKey: ["plenario_sessions", lc] })
                      );
                    });
                  }, 50);
                }
              }}
              onDequeue={dequeueJob}
              isGlobalRunning={isRunning}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Errors explanation */}
      {errorCount > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300"
        >
          <p className="font-semibold mb-1">Sobre os erros</p>
          <p className="text-xs">
            Se recebeu "Nenhum dataset encontrado", o dados.parlamento.pt pode não ter dados
            estruturados para essa legislatura, ou a API pode estar temporariamente indisponível.
            Tente novamente mais tarde ou consulte{" "}
            <a
              href="https://dados.parlamento.pt"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              dados.parlamento.pt
            </a>{" "}
            directamente.
          </p>
        </motion.div>
      )}
    </div>
  );
}
