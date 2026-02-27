import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radio, ExternalLink, Zap, Clock, AlertCircle, Play, Tv2, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PARTY_COLORS, mockPoliticians } from "@/lib/mock-data";
import { segmentTranscript, gradeFillerRate, CATEGORY_COLORS, countFillers } from "@/lib/filler-words";
import { useActiveSession, useTranscriptEvents, useTranscriptRealtime, type TranscriptEvent } from "@/lib/queries";
import LiveStreamPlayer, { type PlayerStatus, type TranscribeResult } from "@/components/LiveStreamPlayer";

// ─── Supabase credentials (public anon key — safe to expose) ────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ─── Known ARTV HLS URL candidates ───────────────────────────────────────────
// LiveExtend is the actual CDN used by canal.parlamento.pt (confirmed via
// public IPTV repositories iptv-org/iptv and LITUATUI/M3UPT).
// Multiple playout nodes and path variants are tried in order.
const ARTV_HLS_CANDIDATES = [
  // LiveExtend CDN — primary (confirmed working)
  "https://playout172.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8",
  "https://playout175.livextend.cloud/livenlin4/_definst_/2liveartvpub2/playlist.m3u8",
  "https://playout172.livextend.cloud/livenlin4/_definst_/2liveartvpub2/playlist.m3u8",
  "https://playout175.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8",
  // Parliament own infrastructure (fallback)
  "https://livepd3.parlamento.pt/artv/live.m3u8",
  "https://livepd3.parlamento.pt/plenario/live.m3u8",
  // RTP CDN (ARTV is an RTP group channel)
  "https://streaming.rtp.pt/liverepeater/smil:artv.smil/playlist.m3u8",
  "https://rdmedia.rtp.pt/artv/index.m3u8",
];

// ─── Demo simulation data ────────────────────────────────────────────────────
const DEMO_EVENTS: Omit<TranscriptEvent, "id" | "created_at">[] = [
  {
    session_id: "demo",
    politician_id: mockPoliticians[2].id,
    text_segment: "Senhor Presidente, portanto, nós temos aqui um problema que é, digamos, bastante complexo e que, basicamente, precisa de uma solução urgente. Ou seja, não podemos continuar a ignorar estes dados.",
    filler_count: 5, total_words: 38,
    filler_words_found: { portanto: 1, digamos: 1, basicamente: 1, "ou seja": 1 },
    start_seconds: 0, duration_seconds: 28, politician: mockPoliticians[2] as any,
  },
  {
    session_id: "demo",
    politician_id: mockPoliticians[0].id,
    text_segment: "Portanto, quero deixar claro que esta proposta, na verdade, vai ao encontro daquilo que todos nós queremos para o país. Os dados são inequívocos e a solução é necessária.",
    filler_count: 2, total_words: 34,
    filler_words_found: { portanto: 1, "na verdade": 1 },
    start_seconds: 30, duration_seconds: 26, politician: mockPoliticians[0] as any,
  },
  {
    session_id: "demo",
    politician_id: mockPoliticians[5].id,
    text_segment: "Bem, eu acho que, tipo, precisamos de olhar para isto de outra forma. Pronto, não podemos continuar a adiar decisões que são, efetivamente, urgentes e que afetam milhões de cidadãos.",
    filler_count: 5, total_words: 36,
    filler_words_found: { bem: 1, tipo: 1, pronto: 1, efetivamente: 1 },
    start_seconds: 58, duration_seconds: 30, politician: mockPoliticians[5] as any,
  },
  {
    session_id: "demo",
    politician_id: mockPoliticians[3].id,
    text_segment: "A nossa posição é clara: o mercado livre deve ser protegido e as regulamentações devem ser proporcionais aos objetivos que se pretendem alcançar. Não há alternativa responsável.",
    filler_count: 0, total_words: 32, filler_words_found: {},
    start_seconds: 90, duration_seconds: 29, politician: mockPoliticians[3] as any,
  },
  {
    session_id: "demo",
    politician_id: mockPoliticians[8].id,
    text_segment: "Portanto, digamos que, tipo, esta questão é, basicamente, uma questão de princípio. Portanto, nós não podemos, enfim, aceitar esta proposta de certa forma sem garantias claras.",
    filler_count: 8, total_words: 35,
    filler_words_found: { portanto: 2, digamos: 1, tipo: 1, basicamente: 1, enfim: 1, "de certa forma": 1 },
    start_seconds: 121, duration_seconds: 31, politician: mockPoliticians[8] as any,
  },
];

interface LiveEvent extends TranscriptEvent {
  id: string;
  created_at: string;
}

// ─── Probe HLS candidate URLs directly from the browser ─────────────────────
async function probeHlsCandidates(candidates: string[]): Promise<string | null> {
  for (const url of candidates) {
    try {
      // Use our CORS proxy so the HEAD request succeeds cross-origin
      const proxied = `${SUPABASE_URL}/functions/v1/hls-proxy?url=${encodeURIComponent(url)}`;
      const r = await fetch(proxied, { method: "GET", signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const text = await r.text();
        if (text.trimStart().startsWith("#EXTM3U")) return url;
      }
    } catch { /* try next */ }
  }
  return null;
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function AoVivo() {
  const [events, setEvents]           = useState<LiveEvent[]>([]);
  const [isDemoMode, setIsDemoMode]   = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoIndex, setDemoIndex]     = useState(0);
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>("idle");
  const [hlsUrl, setHlsUrl]           = useState<string | null>(null);
  const [sessionStats, setSessionStats] = useState({
    totalFillers: 0, totalWords: 0, duration: 0, eventCount: 0,
  });
  const feedRef = useRef<HTMLDivElement>(null);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenIds = useRef(new Set<string>());

  const { data: activeSession } = useActiveSession();
  const { data: existingEvents } = useTranscriptEvents(activeSession?.id);

  // ── Resolve HLS URL: DB first, then probe candidates ─────────────────────
  useEffect(() => {
    if (activeSession?.artv_stream_url?.includes(".m3u8")) {
      setHlsUrl(activeSession.artv_stream_url);
      return;
    }
    // No URL stored yet — probe known candidates
    probeHlsCandidates(ARTV_HLS_CANDIDATES).then((url) => {
      if (url) setHlsUrl(url);
    });
  }, [activeSession?.artv_stream_url]);

  // ── Load historical events on mount ──────────────────────────────────────
  useEffect(() => {
    if (!existingEvents?.length) return;
    const fresh = existingEvents.filter(ev => ev.id && !seenIds.current.has(ev.id));
    if (!fresh.length) return;
    for (const ev of fresh) seenIds.current.add(ev.id!);
    setEvents(prev =>
      [...fresh.map(ev => ({ ...ev, id: ev.id! })) as LiveEvent[], ...prev]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 60)
    );
    setSessionStats(s => {
      let { totalFillers, totalWords, duration, eventCount } = s;
      for (const ev of fresh) {
        totalFillers += ev.filler_count; totalWords += ev.total_words;
        duration += ev.duration_seconds ?? 30; eventCount++;
      }
      return { totalFillers, totalWords, duration, eventCount };
    });
  }, [existingEvents]);

  // ── Supabase Realtime (deduped) ───────────────────────────────────────────
  const handleNewEvent = useCallback((ev: TranscriptEvent) => {
    const id = ev.id ?? crypto.randomUUID();
    if (seenIds.current.has(id)) return;
    seenIds.current.add(id);
    const live: LiveEvent = { ...ev, id, created_at: ev.created_at ?? new Date().toISOString() };
    setEvents(prev => [live, ...prev].slice(0, 60));
    setSessionStats(s => ({
      totalFillers: s.totalFillers + ev.filler_count,
      totalWords:   s.totalWords   + ev.total_words,
      duration:     s.duration     + (ev.duration_seconds ?? 30),
      eventCount:   s.eventCount   + 1,
    }));
  }, []);

  useTranscriptRealtime(handleNewEvent, activeSession?.id);

  // ── Handle transcription results from the stream player ──────────────────
  const handleTranscribeResult = useCallback((result: TranscribeResult) => {
    // The `transcribe` edge function already inserted into the DB (if sessionId was passed).
    // We inject a synthetic event locally so the feed updates instantly,
    // before Realtime fires (typically <1s behind).
    const fw = result.filler_words ?? {};
    const fc = result.filler_count ?? Object.values(fw).reduce((a: number, b: number) => a + b, 0);
    handleNewEvent({
      id: crypto.randomUUID(),
      session_id:         activeSession?.id ?? null,
      politician_id:      null,
      text_segment:       result.text,
      filler_count:       fc,
      total_words:        result.total_words,
      filler_words_found: fw,
      start_seconds:      null,
      duration_seconds:   30,
      created_at:         new Date().toISOString(),
    });
  }, [activeSession?.id, handleNewEvent]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [events.length]);

  // ── Demo mode ─────────────────────────────────────────────────────────────
  const startDemo = () => {
    setDemoRunning(true); setIsDemoMode(true);
    setEvents([]); setSessionStats({ totalFillers: 0, totalWords: 0, duration: 0, eventCount: 0 });
    setDemoIndex(0);
  };

  useEffect(() => {
    if (!demoRunning) { demoIntervalRef.current && clearInterval(demoIntervalRef.current); return; }
    let idx = demoIndex;
    const inject = () => {
      const ev = DEMO_EVENTS[idx % DEMO_EVENTS.length];
      handleNewEvent({ ...ev, id: crypto.randomUUID(), created_at: new Date().toISOString() } as any);
      idx++; setDemoIndex(idx);
    };
    inject();
    demoIntervalRef.current = setInterval(inject, 6000);
    return () => { demoIntervalRef.current && clearInterval(demoIntervalRef.current); };
  }, [demoRunning]); // eslint-disable-line

  const stopDemo = () => { setDemoRunning(false); demoIntervalRef.current && clearInterval(demoIntervalRef.current); };

  // ── Derived state ─────────────────────────────────────────────────────────
  const isCapturing  = playerStatus === "capturing" || playerStatus === "playing";
  const isLive       = isCapturing || !!activeSession || demoRunning;
  const fillerRate   = sessionStats.totalWords > 0 ? sessionStats.totalFillers / sessionStats.totalWords : 0;
  const grade        = gradeFillerRate(fillerRate);
  const currentSpeaker = events[0]?.politician ?? null;

  const statusLabel = {
    idle:      "PARADO",
    loading:   "A LIGAR…",
    playing:   "AO VIVO",
    capturing: "A CAPTURAR",
    error:     "ERRO",
  }[playerStatus];

  const statusColor = {
    idle:      "text-muted-foreground",
    loading:   "text-amber-400",
    playing:   "text-green-400",
    capturing: "text-primary",
    error:     "text-red-400",
  }[playerStatus];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="container py-6 sm:py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-3xl sm:text-4xl font-bold">Plenário Ao Vivo</h1>
            {isLive && (
              <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/15 border border-red-500/30 text-xs font-semibold ${isDemoMode ? "text-amber-400" : "text-red-400"}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                {isDemoMode ? "DEMO" : statusLabel}
              </span>
            )}
          </div>
          <p className="text-muted-foreground">
            Stream direto da ARTV · captura de áudio automática · transcrição por IA
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!demoRunning ? (
            <Button onClick={startDemo} variant="outline" className="gap-2">
              <Play className="h-4 w-4" /> Demo
            </Button>
          ) : (
            <Button onClick={stopDemo} variant="destructive" className="gap-2">
              <WifiOff className="h-4 w-4" /> Parar Demo
            </Button>
          )}
          <a href="https://canal.parlamento.pt/plenario" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="gap-2">
              <ExternalLink className="h-4 w-4" /> ARTV
            </Button>
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─ Left column: player + feed ──────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Embedded stream player */}
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/40">
              <div className="flex items-center gap-2">
                <Tv2 className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Canal Parlamento — Plenário</span>
              </div>
              <div className={`flex items-center gap-1.5 text-xs font-semibold ${statusColor}`}>
                {isCapturing ? (
                  <Wifi className="h-3.5 w-3.5 animate-pulse" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5" />
                )}
                {statusLabel}
              </div>
            </div>

            <LiveStreamPlayer
              hlsUrl={hlsUrl}
              sessionId={activeSession?.id ?? null}
              supabaseUrl={SUPABASE_URL}
              anonKey={SUPABASE_ANON_KEY}
              onResult={handleTranscribeResult}
              onStatus={setPlayerStatus}
            />

            {/* Capture status bar */}
            <div className="px-4 py-2 text-xs text-muted-foreground flex items-center justify-between border-t border-border/40">
              <span>
                {playerStatus === "idle" && "Carrega Play para iniciar a captura de áudio"}
                {playerStatus === "loading" && "A carregar stream…"}
                {playerStatus === "playing" && "Stream ativo · a acumular áudio para transcrição…"}
                {playerStatus === "capturing" && "A enviar chunk de 30s para Whisper…"}
                {playerStatus === "error" && "Erro a ligar ao stream. O parlamento pode não estar em sessão."}
              </span>
              {hlsUrl && (
                <span className="opacity-50 truncate max-w-[200px]" title={hlsUrl}>
                  {new URL(hlsUrl).hostname}
                </span>
              )}
            </div>
          </div>

          {/* No stream warning */}
          {!hlsUrl && playerStatus !== "loading" && (
            <div className="glass-card rounded-xl p-4 border-amber-500/20 bg-amber-500/5 flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-amber-300">Stream não encontrado</p>
                <p className="text-muted-foreground mt-0.5">
                  O parlamento pode não estar em sessão, ou o URL do stream ainda não foi descoberto.
                  O cron (<code>plenario-cron</code>) actualiza o URL automaticamente quando a sessão começa.
                </p>
              </div>
            </div>
          )}

          {/* Current speaker */}
          {currentSpeaker && (
            <motion.div
              key={currentSpeaker.id}
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
              className="glass-card rounded-xl p-4 border-primary/20 bg-primary/5"
            >
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">A falar agora</p>
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12 border-2" style={{ borderColor: PARTY_COLORS[currentSpeaker.party] }}>
                  {currentSpeaker.photo_url && <AvatarImage src={currentSpeaker.photo_url} alt={currentSpeaker.name} />}
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
                  <Radio className="h-4 w-4 animate-pulse" />
                  <span className="text-sm font-semibold">Ativo</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Transcript feed */}
          <div ref={feedRef} className="space-y-3 max-h-[500px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
            <AnimatePresence initial={false}>
              {events.length === 0 && (
                <div className="glass-card rounded-xl p-10 text-center text-muted-foreground">
                  <Radio className="h-8 w-8 mx-auto mb-3 opacity-40" />
                  <p>À espera de transcrições…</p>
                  <p className="text-xs mt-2 opacity-60">O Whisper processa chunks de 30s — os primeiros resultados aparecem em ~30–60s</p>
                </div>
              )}
              {events.map((ev, i) => <TranscriptBlock key={ev.id} event={ev} isNewest={i === 0} />)}
            </AnimatePresence>
          </div>
        </div>

        {/* ─ Right column: stats ─────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="glass-card rounded-xl p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> Sessão de Hoje
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <StatCell label="Enchimentos" value={sessionStats.totalFillers} color="text-primary" />
              <StatCell label="Palavras"     value={sessionStats.totalWords} />
              <StatCell label="Rácio"        value={`${(fillerRate * 100).toFixed(1)}%`} color="text-primary" />
              <StatCell
                label="Qualidade"
                value={sessionStats.totalWords > 0 ? grade.label : "—"}
                style={sessionStats.totalWords > 0 ? { color: grade.color } : undefined}
              />
            </div>
            {sessionStats.totalWords > 0 && (
              <div>
                <Progress value={Math.min(fillerRate * 100 * 12, 100)} className="h-2" />
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

          {events.length > 0 && <SessionSpeakersCard events={events} />}

          {/* How it works */}
          <div className="glass-card rounded-xl p-5">
            <h3 className="font-semibold mb-2 text-sm">Como funciona</h3>
            <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
              <li>Stream ARTV carregado via <strong>hls.js</strong></li>
              <li><code>captureStream()</code> capta áudio do vídeo</li>
              <li><strong>AudioContext</strong> acumula 30s de PCM a 16 kHz</li>
              <li>WAV enviado ao <strong>Whisper</strong> via edge function</li>
              <li>Enchimentos detectados e exibidos em tempo real</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TranscriptBlock({ event, isNewest }: { event: LiveEvent; isNewest: boolean }) {
  const segments  = segmentTranscript(event.text_segment);
  const fillerRatio = event.total_words > 0 ? event.filler_count / event.total_words : 0;
  const politician  = event.politician;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className={`glass-card rounded-xl p-4 ${isNewest ? "border-primary/30 bg-primary/3" : ""}`}
    >
      <div className="flex items-center gap-2 mb-2">
        {politician ? (
          <>
            <Avatar className="h-6 w-6 border" style={{ borderColor: PARTY_COLORS[politician.party] }}>
              {politician.photo_url && <AvatarImage src={politician.photo_url} alt={politician.name} />}
              <AvatarFallback className="text-[10px] bg-secondary">
                {politician.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-semibold">{politician.name}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4"
              style={{ borderColor: PARTY_COLORS[politician.party], color: PARTY_COLORS[politician.party] }}>
              {politician.party}
            </Badge>
          </>
        ) : (
          <span className="text-xs text-muted-foreground italic">Orador não identificado</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {event.filler_count > 0 && (
            <span className="text-xs text-primary font-mono font-semibold">{event.filler_count} enchim.</span>
          )}
          <span className="text-xs text-muted-foreground font-mono">{(fillerRatio * 100).toFixed(0)}%</span>
        </div>
      </div>

      <p className="text-sm leading-relaxed">
        {segments.map((seg, i) =>
          seg.isFiller && seg.fillerWord ? (
            <mark key={i} className="rounded px-0.5 font-medium"
              style={{ backgroundColor: CATEGORY_COLORS[seg.fillerWord.category] + "30", color: CATEGORY_COLORS[seg.fillerWord.category] }}
              title={`${seg.fillerWord.category} · ${seg.fillerWord.severity}`}>
              {seg.text}
            </mark>
          ) : <span key={i}>{seg.text}</span>
        )}
      </p>

      <p className="text-[10px] text-muted-foreground mt-2">
        {new Date(event.created_at).toLocaleTimeString("pt-PT")}
        {event.duration_seconds ? ` · ${Math.round(event.duration_seconds)}s` : ""}
        {" · "}{event.total_words} palavras
      </p>
    </motion.div>
  );
}

function StatCell({ label, value, color, style }: {
  label: string; value: string | number; color?: string; style?: React.CSSProperties;
}) {
  return (
    <div className="bg-secondary/40 rounded-lg p-3 text-center">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={`font-mono font-bold text-lg leading-tight ${color ?? ""}`} style={style}>{value}</p>
    </div>
  );
}

function SessionSpeakersCard({ events }: { events: LiveEvent[] }) {
  const speakerMap: Record<string, { name: string; party: string; fillers: number; words: number }> = {};
  for (const ev of events) {
    if (!ev.politician) continue;
    const key = ev.politician.id;
    if (!speakerMap[key]) speakerMap[key] = { name: ev.politician.name, party: ev.politician.party, fillers: 0, words: 0 };
    speakerMap[key].fillers += ev.filler_count;
    speakerMap[key].words   += ev.total_words;
  }
  const speakers = Object.values(speakerMap).sort((a, b) => b.words - a.words);
  if (!speakers.length) return null;

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
