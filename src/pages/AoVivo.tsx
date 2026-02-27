import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radio, Mic, MicOff, ExternalLink, Zap, Clock, AlertCircle, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PARTY_COLORS, mockPoliticians } from "@/lib/mock-data";
import { segmentTranscript, gradeFillerRate, CATEGORY_COLORS, FILLER_CATALOG, countFillers } from "@/lib/filler-words";
import { useActiveSession, useTranscriptEvents, useTranscriptRealtime, type TranscriptEvent } from "@/lib/queries";

// ─── Demo simulation data ───────────────────────────────────────────────────
const DEMO_EVENTS: Omit<TranscriptEvent, "id" | "created_at">[] = [
  {
    session_id: "demo",
    politician_id: mockPoliticians[2].id,
    text_segment: "Senhor Presidente, portanto, nós temos aqui um problema que é, digamos, bastante complexo e que, basicamente, precisa de uma solução urgente. Ou seja, não podemos continuar a ignorar estes dados.",
    filler_count: 5,
    total_words: 38,
    filler_words_found: { portanto: 1, digamos: 1, basicamente: 1, "ou seja": 1 },
    start_seconds: 0,
    duration_seconds: 28,
    politician: mockPoliticians[2] as any,
  },
  {
    session_id: "demo",
    politician_id: mockPoliticians[0].id,
    text_segment: "Portanto, quero deixar claro que esta proposta, na verdade, vai ao encontro daquilo que todos nós queremos para o país. Os dados são inequívocos e a solução é necessária.",
    filler_count: 2,
    total_words: 34,
    filler_words_found: { portanto: 1, "na verdade": 1 },
    start_seconds: 30,
    duration_seconds: 26,
    politician: mockPoliticians[0] as any,
  },
  {
    session_id: "demo",
    politician_id: mockPoliticians[5].id,
    text_segment: "Bem, eu acho que, tipo, precisamos de olhar para isto de outra forma. Pronto, não podemos continuar a adiar decisões que são, efetivamente, urgentes e que afetam milhões de cidadãos.",
    filler_count: 5,
    total_words: 36,
    filler_words_found: { bem: 1, tipo: 1, pronto: 1, efetivamente: 1 },
    start_seconds: 58,
    duration_seconds: 30,
    politician: mockPoliticians[5] as any,
  },
  {
    session_id: "demo",
    politician_id: mockPoliticians[3].id,
    text_segment: "A nossa posição é clara: o mercado livre deve ser protegido e as regulamentações devem ser proporcionais aos objetivos que se pretendem alcançar. Não há alternativa responsável.",
    filler_count: 0,
    total_words: 32,
    filler_words_found: {},
    start_seconds: 90,
    duration_seconds: 29,
    politician: mockPoliticians[3] as any,
  },
  {
    session_id: "demo",
    politician_id: mockPoliticians[8].id,
    text_segment: "Portanto, digamos que, tipo, esta questão é, basicamente, uma questão de princípio. Portanto, nós não podemos, enfim, aceitar esta proposta de certa forma sem garantias claras.",
    filler_count: 8,
    total_words: 35,
    filler_words_found: { portanto: 2, digamos: 1, tipo: 1, basicamente: 1, enfim: 1, "de certa forma": 1 },
    start_seconds: 121,
    duration_seconds: 31,
    politician: mockPoliticians[8] as any,
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

interface LiveEvent extends TranscriptEvent {
  id: string;
  created_at: string;
}

export default function AoVivo() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoIndex, setDemoIndex] = useState(0);
  const [micActive, setMicActive] = useState(false);
  const [sessionStats, setSessionStats] = useState({
    totalFillers: 0,
    totalWords: 0,
    duration: 0,
    eventCount: 0,
  });
  const feedRef = useRef<HTMLDivElement>(null);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenIds = useRef(new Set<string>());
  const micActiveRef = useRef(false);
  const recognitionRef = useRef<any>(null);

  const { data: activeSession } = useActiveSession();

  // Load existing events for the current session on mount / session change
  const { data: existingEvents } = useTranscriptEvents(activeSession?.id);
  useEffect(() => {
    if (!existingEvents?.length) return;
    const fresh = existingEvents.filter(ev => ev.id && !seenIds.current.has(ev.id));
    if (!fresh.length) return;
    for (const ev of fresh) seenIds.current.add(ev.id!);
    const liveOnes = fresh.map(ev => ({ ...ev, id: ev.id! })) as LiveEvent[];
    setEvents(prev =>
      [...liveOnes, ...prev]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 60)
    );
    setSessionStats(s => {
      let { totalFillers, totalWords, duration, eventCount } = s;
      for (const ev of fresh) {
        totalFillers += ev.filler_count;
        totalWords += ev.total_words;
        duration += ev.duration_seconds ?? 30;
        eventCount++;
      }
      return { totalFillers, totalWords, duration, eventCount };
    });
  }, [existingEvents]);

  // Supabase Realtime handler (deduplicated)
  const handleNewEvent = useCallback((ev: TranscriptEvent) => {
    const id = ev.id ?? crypto.randomUUID();
    if (seenIds.current.has(id)) return;
    seenIds.current.add(id);
    const live: LiveEvent = { ...ev, id, created_at: ev.created_at ?? new Date().toISOString() };
    setEvents(prev => [live, ...prev].slice(0, 60));
    setSessionStats(s => ({
      totalFillers: s.totalFillers + ev.filler_count,
      totalWords: s.totalWords + ev.total_words,
      duration: s.duration + (ev.duration_seconds ?? 30),
      eventCount: s.eventCount + 1,
    }));
  }, []);

  useTranscriptRealtime(handleNewEvent, activeSession?.id);

  // Auto-scroll to top when new event arrives
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [events.length]);

  // Demo mode
  const startDemo = () => {
    setDemoRunning(true);
    setIsDemoMode(true);
    setEvents([]);
    setSessionStats({ totalFillers: 0, totalWords: 0, duration: 0, eventCount: 0 });
    setDemoIndex(0);
  };

  useEffect(() => {
    if (!demoRunning) {
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
      return;
    }
    let idx = demoIndex;
    const inject = () => {
      const ev = DEMO_EVENTS[idx % DEMO_EVENTS.length];
      const live: LiveEvent = {
        ...ev,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      };
      handleNewEvent(live as any);
      idx++;
      setDemoIndex(idx);
    };
    inject(); // immediate first event
    demoIntervalRef.current = setInterval(inject, 6000);
    return () => { if (demoIntervalRef.current) clearInterval(demoIntervalRef.current); };
  }, [demoRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopDemo = () => {
    setDemoRunning(false);
    if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
  };

  // ─── Browser microphone transcription (Web Speech API) ────────────────────
  const startMic = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Reconhecimento de voz não disponível. Usa o Google Chrome ou Microsoft Edge.");
      return;
    }
    const r = new SR();
    r.lang = "pt-PT";
    r.continuous = true;
    r.interimResults = false;
    r.maxAlternatives = 1;

    r.onresult = (e: any) => {
      const last = e.results[e.results.length - 1];
      if (!last.isFinal) return;
      const text = last[0].transcript.trim();
      if (!text) return;
      const fw = countFillers(text);
      const fc = Object.values(fw).reduce((a: number, b: number) => a + b, 0);
      handleNewEvent({
        id: crypto.randomUUID(),
        session_id: activeSession?.id ?? null,
        politician_id: null,
        text_segment: text,
        filler_count: fc,
        total_words: text.split(/\s+/).filter(Boolean).length,
        filler_words_found: fw,
        start_seconds: null,
        duration_seconds: null,
        created_at: new Date().toISOString(),
      });
    };

    r.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "audio-capture") {
        micActiveRef.current = false;
        setMicActive(false);
      }
    };

    r.onend = () => {
      if (micActiveRef.current) r.start(); // auto-restart to keep listening
    };

    recognitionRef.current = r;
    r.start();
    micActiveRef.current = true;
    setMicActive(true);
  }, [activeSession?.id, handleNewEvent]);

  const stopMic = useCallback(() => {
    micActiveRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setMicActive(false);
  }, []);

  const isLive = !!activeSession || demoRunning || micActive;
  const fillerRate = sessionStats.totalWords > 0 ? sessionStats.totalFillers / sessionStats.totalWords : 0;
  const grade = gradeFillerRate(fillerRate);
  const currentSpeaker = events[0]?.politician ?? null;

  return (
    <div className="container py-6 sm:py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-3xl sm:text-4xl font-bold">Plenário Ao Vivo</h1>
            {isLive && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                {isDemoMode ? "DEMO" : micActive ? "MICROFONE" : "AO VIVO"}
              </span>
            )}
          </div>
          <p className="text-muted-foreground">
            Transcrição em tempo real da sessão plenária · Fonte:{" "}
            <a
              href="https://canal.parlamento.pt/plenario"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              ARTV Plenário <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Live microphone button */}
          {!micActive ? (
            <Button onClick={startMic} className="gap-2" variant={activeSession && !demoRunning ? "default" : "outline"}>
              <Mic className="h-4 w-4" /> Ouvir Microfone
            </Button>
          ) : (
            <Button onClick={stopMic} variant="destructive" className="gap-2">
              <MicOff className="h-4 w-4" /> Parar Microfone
            </Button>
          )}

          {/* Demo mode button */}
          {!demoRunning ? (
            <Button onClick={startDemo} className="gap-2" variant="outline">
              <Play className="h-4 w-4" /> Modo Demo
            </Button>
          ) : (
            <Button onClick={stopDemo} variant="destructive" className="gap-2">
              <MicOff className="h-4 w-4" /> Parar Demo
            </Button>
          )}

          <a
            href="https://canal.parlamento.pt/plenario"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" className="gap-2">
              <Radio className="h-4 w-4" /> Ver Stream
            </Button>
          </a>
        </div>
      </div>

      {/* Status banner when no live session and no demo */}
      {!isLive && events.length === 0 && (
        <div className="glass-card rounded-xl p-6 mb-8 border-amber-500/20 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-amber-300">Nenhuma sessão ativa de momento</p>
              <p className="text-sm text-muted-foreground mt-1">
                O worker de IA não está a transmitir dados. Clica em <strong>Modo Demo</strong> para ver uma simulação,
                ou liga o worker Python a apontar para{" "}
                <code className="text-xs bg-secondary px-1 rounded">canal.parlamento.pt/plenario</code>.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─ Live feed ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Current speaker card */}
          {currentSpeaker && (
            <motion.div
              key={currentSpeaker.id}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card rounded-xl p-4 border-primary/20 bg-primary/5"
            >
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">A falar agora</p>
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12 border-2" style={{ borderColor: PARTY_COLORS[currentSpeaker.party] }}>
                  <AvatarFallback className="bg-secondary font-bold">
                    {currentSpeaker.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-lg leading-tight">{currentSpeaker.name}</p>
                  <p className="text-sm" style={{ color: PARTY_COLORS[currentSpeaker.party] }}>
                    {currentSpeaker.party}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-1.5 text-primary">
                  <Mic className="h-4 w-4 animate-pulse" />
                  <span className="text-sm font-semibold">Ativo</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Microphone active indicator */}
          {micActive && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card rounded-xl p-3 border-green-500/30 bg-green-500/5 flex items-center gap-2"
            >
              <Mic className="h-4 w-4 text-green-400 animate-pulse shrink-0" />
              <p className="text-xs text-green-300">
                A ouvir via microfone — coloca o dispositivo perto da fonte de áudio do stream
              </p>
            </motion.div>
          )}

          {/* Transcript feed */}
          <div
            ref={feedRef}
            className="space-y-3 max-h-[600px] overflow-y-auto pr-1"
            style={{ scrollbarWidth: "thin" }}
          >
            <AnimatePresence initial={false}>
              {events.length === 0 && (
                <div className="glass-card rounded-xl p-10 text-center text-muted-foreground">
                  <Radio className="h-8 w-8 mx-auto mb-3 opacity-40" />
                  <p>À espera de transcrições…</p>
                </div>
              )}
              {events.map((ev, i) => (
                <TranscriptBlock key={ev.id} event={ev} isNewest={i === 0} />
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* ─ Stats sidebar ─────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Session stats */}
          <div className="glass-card rounded-xl p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> Sessão de Hoje
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <StatCell label="Enchimentos" value={sessionStats.totalFillers} color="text-primary" />
              <StatCell label="Palavras" value={sessionStats.totalWords} />
              <StatCell
                label="Rácio"
                value={`${(fillerRate * 100).toFixed(1)}%`}
                color="text-primary"
              />
              <StatCell
                label="Qualidade"
                value={sessionStats.totalWords > 0 ? grade.label : "—"}
                color={sessionStats.totalWords > 0 ? undefined : "text-muted-foreground"}
                style={sessionStats.totalWords > 0 ? { color: grade.color } : undefined}
              />
            </div>

            {sessionStats.totalWords > 0 && (
              <div>
                <Progress
                  value={Math.min(fillerRate * 100 * 12, 100)}
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {(fillerRate * 100).toFixed(1)}% de enchimento · meta: &lt;5%
                </p>
              </div>
            )}

            <div className="pt-2 border-t border-border/40">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {sessionStats.duration > 0
                  ? `${Math.floor(sessionStats.duration / 60)} min de discurso`
                  : "Sem dados ainda"}
              </div>
            </div>
          </div>

          {/* Top speakers this session */}
          {events.length > 0 && <SessionSpeakersCard events={events} />}

          {/* Worker info */}
          <div className="glass-card rounded-xl p-5">
            <h3 className="font-semibold mb-3 text-sm">Como ligar o worker</h3>
            <pre className="text-xs bg-secondary/60 rounded-lg p-3 overflow-x-auto leading-relaxed text-muted-foreground">
{`cd worker/
pip install -r requirements.txt
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
python ai_worker.py`}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              O worker captura o stream ARTV Plenário, transcreve com Whisper e envia aqui em tempo real.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TranscriptBlock({ event, isNewest }: { event: LiveEvent; isNewest: boolean }) {
  const segments = segmentTranscript(event.text_segment);
  const fillerRatio = event.total_words > 0 ? event.filler_count / event.total_words : 0;
  const politician = event.politician;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className={`glass-card rounded-xl p-4 ${isNewest ? "border-primary/30 bg-primary/3" : ""}`}
    >
      <div className="flex items-center gap-2 mb-2">
        {politician ? (
          <>
            <Avatar className="h-6 w-6 border" style={{ borderColor: PARTY_COLORS[politician.party] }}>
              <AvatarFallback className="text-[10px] bg-secondary">
                {politician.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-semibold">{politician.name}</span>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4"
              style={{ borderColor: PARTY_COLORS[politician.party], color: PARTY_COLORS[politician.party] }}
            >
              {politician.party}
            </Badge>
          </>
        ) : (
          <span className="text-xs text-muted-foreground italic">Orador desconhecido</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {event.filler_count > 0 && (
            <span className="text-xs text-primary font-mono font-semibold">
              {event.filler_count} enchim.
            </span>
          )}
          <span className="text-xs text-muted-foreground font-mono">
            {(fillerRatio * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <p className="text-sm leading-relaxed">
        {segments.map((seg, i) =>
          seg.isFiller && seg.fillerWord ? (
            <mark
              key={i}
              className="rounded px-0.5 font-medium"
              style={{
                backgroundColor: CATEGORY_COLORS[seg.fillerWord.category] + "30",
                color: CATEGORY_COLORS[seg.fillerWord.category],
              }}
              title={`${seg.fillerWord.category} · ${seg.fillerWord.severity}`}
            >
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </p>

      <p className="text-[10px] text-muted-foreground mt-2">
        {new Date(event.created_at).toLocaleTimeString("pt-PT")}
        {event.duration_seconds ? ` · ${Math.round(event.duration_seconds)}s` : ""}
        {" · "}
        {event.total_words} palavras
      </p>
    </motion.div>
  );
}

function StatCell({
  label,
  value,
  color,
  style,
}: {
  label: string;
  value: string | number;
  color?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="bg-secondary/40 rounded-lg p-3 text-center">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={`font-mono font-bold text-lg leading-tight ${color ?? ""}`} style={style}>
        {value}
      </p>
    </div>
  );
}

function SessionSpeakersCard({ events }: { events: LiveEvent[] }) {
  const speakerMap: Record<string, { name: string; party: string; fillers: number; words: number }> = {};

  for (const ev of events) {
    if (!ev.politician) continue;
    const key = ev.politician.id;
    if (!speakerMap[key]) {
      speakerMap[key] = { name: ev.politician.name, party: ev.politician.party, fillers: 0, words: 0 };
    }
    speakerMap[key].fillers += ev.filler_count;
    speakerMap[key].words += ev.total_words;
  }

  const speakers = Object.values(speakerMap).sort((a, b) => b.words - a.words);
  if (speakers.length === 0) return null;

  return (
    <div className="glass-card rounded-xl p-5">
      <h3 className="font-semibold mb-3 text-sm">Oradores nesta sessão</h3>
      <div className="space-y-2.5">
        {speakers.slice(0, 6).map(sp => {
          const rate = sp.words > 0 ? (sp.fillers / sp.words) * 100 : 0;
          return (
            <div key={sp.name} className="flex items-center gap-2">
              <Avatar className="h-6 w-6 border shrink-0" style={{ borderColor: PARTY_COLORS[sp.party] }}>
                <AvatarFallback className="text-[10px] bg-secondary">
                  {sp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{sp.name.split(" ")[0]}</p>
                <Progress value={Math.min(rate * 12, 100)} className="h-1 mt-0.5" />
              </div>
              <span className="text-xs font-mono text-primary shrink-0">{rate.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
