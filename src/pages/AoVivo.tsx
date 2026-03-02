import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radio, ExternalLink, Zap, Clock, Tv2,
  Wifi, WifiOff, CheckCircle2, AlertCircle, Server, Mic,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PARTY_COLORS } from "@/lib/mock-data";
import { segmentTranscript, gradeFillerRate, CATEGORY_COLORS } from "@/lib/filler-words";
import { useActiveSession, useTranscriptEvents, useTranscriptRealtime, type TranscriptEvent } from "@/lib/queries";
import { ArtvPlayer } from "@/components/ArtvPlayer";

// ─── Supabase credentials (public anon key — safe to expose) ────────────────
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ─── Audio MIME type detection ───────────────────────────────────────────────
function bestAudioMime(): string {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

interface LiveEvent extends TranscriptEvent {
  id: string;
  created_at: string;
}

type CronState = "idle" | "starting" | "running" | "ok" | "waiting" | "error";

// ─── Main component ──────────────────────────────────────────────────────────

export default function AoVivo() {
  const [events, setEvents]             = useState<LiveEvent[]>([]);
  const [cronState, setCronState]       = useState<CronState>("idle");
  const [cronMsg, setCronMsg]           = useState<string>("A aguardar vídeo…");
  const [videoReady, setVideoReady]     = useState(false);
  const [sessionStats, setSessionStats] = useState({ totalFillers: 0, totalWords: 0, duration: 0, eventCount: 0 });

  const feedRef          = useRef<HTMLDivElement>(null);
  const seenIds          = useRef(new Set<string>());
  const captureActiveRef = useRef(false);
  const recorderRef      = useRef<MediaRecorder | null>(null);
  const audioStreamRef   = useRef<MediaStream | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const captureVideoRef  = useRef<HTMLVideoElement | null>(null);

  // Always-fresh session ID — updated whenever useActiveSession resolves/changes.
  // Using a ref prevents stale-closure bugs in the sendChunk/recordChunk chain.
  const sessionIdRef = useRef<string | undefined>(undefined);

  const { data: activeSession } = useActiveSession();
  const { data: existingEvents } = useTranscriptEvents(activeSession?.id);

  // Keep sessionIdRef in sync with the latest DB session
  useEffect(() => {
    sessionIdRef.current = activeSession?.id;
  }, [activeSession?.id]);

  // ── handleNewEvent (deduped) ─────────────────────────────────────────────
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

  // ── Send one 30-second audio chunk to the transcribe edge function ────────
  //
  // Reads sessionId from sessionIdRef (never stale, updated by effect above).
  // Retries automatically on HTTP 503 (HuggingFace model loading).
  const sendChunk = useCallback(async (blob: Blob) => {
    if (!blob.size) {
      // Audio track exists but produced zero data — most likely the video mute
      // state prevented the capture pipeline from initialising. Stop the chain
      // so the user can click "Tentar novamente" to restart with a fresh stream.
      setCronState("error");
      setCronMsg("Sem dados de áudio — ative o som no vídeo e clique «Tentar novamente»");
      captureActiveRef.current = false;
      return;
    }

    const sessionId = sessionIdRef.current; // always fresh

    setCronState("running");
    setCronMsg("A transcrever com Whisper…");

    const form = new FormData();
    form.append("audio", blob, "chunk.webm");

    const headers: Record<string, string> = {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    };
    if (sessionId) headers["x-session-id"] = sessionId;

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/transcribe`, {
          method:  "POST",
          headers,
          body:    form,
          signal:  AbortSignal.timeout(90_000),
        });

        if (!resp.ok) {
          const body = await resp.json().catch(() => null) as Record<string, unknown> | null;
          const msg  = String(body?.error ?? `HTTP ${resp.status}`);

          // 503 = HF model still loading → retry with delay
          if (resp.status === 503) {
            const retryAfter = Number(body?.retry_after ?? 20);
            if (attempt < MAX_RETRIES) {
              setCronMsg(`Modelo a carregar — nova tentativa em ${retryAfter} s…`);
              await new Promise<void>(r => setTimeout(r, retryAfter * 1000));
              continue;
            }
          }

          // 502 = HF endpoint error (410 gone, wrong URL, etc.) — non-retryable
          setCronState("error");
          if (msg.includes("HF_TOKEN") || msg.includes("token") || msg.includes("auth")) {
            setCronMsg("⚠️ HF_TOKEN inválido ou sem permissões — verifique em Lovable → Secrets");
          } else if (msg.includes("endpoint gone") || msg.includes("410") || resp.status === 502) {
            setCronMsg("Endpoint HF indisponível — o modelo foi migrado; a tentar alternativas automaticamente…");
          } else {
            setCronMsg(`Erro Whisper: ${msg.slice(0, 120)}`);
          }
          return;
        }

        const r = await resp.json() as {
          text: string;
          filler_count: number;
          total_words:  number;
          filler_words: Record<string, number>;
        };

        if (!r.text?.trim()) {
          setCronState("ok");
          setCronMsg("✓ Sem fala detectada — próximo chunk em 30 s");
          return;
        }

        setCronState("ok");
        setCronMsg(`✓ ${r.total_words} palavras · ${r.filler_count} enchimentos`);

        handleNewEvent({
          id:                 crypto.randomUUID(),
          session_id:         sessionId ?? "live",
          text_segment:       r.text,
          filler_count:       r.filler_count,
          total_words:        r.total_words,
          filler_words_found: r.filler_words ?? {},
          politician_id:      null,
          politician:         null,
          start_seconds:      null,
          duration_seconds:   30,
          created_at:         new Date().toISOString(),
        } as any);
        return; // success

      } catch (e) {
        if (!captureActiveRef.current) return; // intentionally stopped
        if (attempt >= MAX_RETRIES) {
          setCronState("error");
          setCronMsg("Erro de ligação com o servidor de transcrição");
          console.error("[capture] sendChunk error:", e);
        }
      }
    }
  }, [handleNewEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Record one 30-second chunk, send it, queue the next ──────────────────
  const recordChunk = useCallback((stream: MediaStream) => {
    if (!captureActiveRef.current) return;

    // Safety check: if the stream's tracks ended (e.g., CDN reconnect), restart.
    const liveTracks = stream.getAudioTracks().filter(t => t.readyState === "live");
    if (!liveTracks.length) {
      setCronState("error");
      setCronMsg("Pista de áudio encerrada — clique «Tentar novamente» para reconectar");
      captureActiveRef.current = false;
      return;
    }

    const mimeType = bestAudioMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      setCronState("error");
      setCronMsg(`MediaRecorder não iniciado: ${(e as Error)?.message ?? e}`);
      captureActiveRef.current = false;
      return;
    }

    const chunks: Blob[] = [];

    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onerror = (e) => {
      console.error("[capture] MediaRecorder error:", e);
      setCronState("error");
      setCronMsg("Erro no MediaRecorder — clique «Tentar novamente»");
      captureActiveRef.current = false;
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      sendChunk(blob).then(() => {
        if (captureActiveRef.current) recordChunk(stream);
      });
    };

    try {
      rec.start();
    } catch (e) {
      setCronState("error");
      setCronMsg(`Não foi possível iniciar a gravação: ${(e as Error)?.message ?? e}`);
      captureActiveRef.current = false;
      return;
    }

    recorderRef.current = rec;
    setTimeout(() => { if (rec.state === "recording") rec.stop(); }, 30_000);
  }, [sendChunk]);

  // ── Start browser audio capture from the <video> element ─────────────────
  //
  // Strategy:
  //   1. Unmute video (Chrome won't expose audio tracks for muted MSE video).
  //   2. Wait 400 ms for the browser audio pipeline to initialise.
  //   3. captureStream() — simplest, works on Chrome/Firefox.
  //   4. Web Audio API fallback — createMediaElementSource() works because
  //      hls.js sets video.src to a blob:// MediaSource URL (same-origin),
  //      so there's no CORS taint regardless of CDN origin.
  const startCapture = useCallback(async (video: HTMLVideoElement) => {
    if (captureActiveRef.current) return; // already running

    // Set flag IMMEDIATELY — prevents a second concurrent call during the
    // async unmute-wait below (the "playing" event can fire multiple times).
    captureActiveRef.current = true;

    setCronState("starting");
    setCronMsg("A iniciar captura de áudio…");

    try {
      // 1. Unmute — Chrome skips the audio decoder for muted MSE video.
      //    Setting muted=false via JS is always allowed (no user-gesture needed).
      video.muted = false;

      // 2. Give the audio pipeline 600 ms to initialise after unmuting.
      await new Promise<void>(r => setTimeout(r, 600));

      let audioStream: MediaStream | null = null;

      // 3. Attempt: captureStream()
      if (typeof (video as any).captureStream === "function") {
        const captured = (video as any).captureStream() as MediaStream;
        const tracks   = captured.getAudioTracks();
        // Only use tracks that are actually live — "ended" tracks produce no data.
        const liveTracks = tracks.filter(t => t.readyState === "live");
        if (liveTracks.length) {
          audioStream = new MediaStream(liveTracks);
          console.log("[capture] captureStream() OK —", liveTracks.length, "live audio track(s)");
        } else if (tracks.length) {
          console.warn("[capture] captureStream() tracks not live:", tracks.map(t => `${t.label}:${t.readyState}`));
        } else {
          console.warn("[capture] captureStream() returned no audio tracks — trying Web Audio API");
        }
      }

      // 4. Fallback: Web Audio API
      //    Works because hls.js sets video.src = blob:// (same-origin MediaSource).
      if (!audioStream) {
        const AudioCtx =
          window.AudioContext ??
          ((window as any).webkitAudioContext as typeof AudioContext | undefined);

        if (AudioCtx) {
          const ctx    = new AudioCtx();
          audioCtxRef.current = ctx;
          // Resume the context — Chrome suspends AudioContext until a user gesture.
          if (ctx.state === "suspended") {
            await ctx.resume().catch(() => {});
          }
          const source = ctx.createMediaElementSource(video);
          source.connect(ctx.destination);               // keep speakers working
          const dest   = ctx.createMediaStreamDestination();
          source.connect(dest);                          // also route to recorder
          audioStream  = dest.stream;
          console.log("[capture] Web Audio API OK — state:", ctx.state, "—", audioStream.getAudioTracks().length, "track(s)");
        }
      }

      if (!audioStream || !audioStream.getAudioTracks().length) {
        captureActiveRef.current = false; // reset so retry button works
        setCronState("error");
        setCronMsg(
          "Sem pista de áudio — use Chrome/Firefox e certifique-se que o vídeo está a reproduzir"
        );
        return;
      }

      audioStreamRef.current = audioStream;
      // captureActiveRef.current is already true (set at the start)

      setCronState("running");
      setCronMsg("Captura ativa — primeiro resultado em ~30 s");
      recordChunk(audioStream);

    } catch (e) {
      captureActiveRef.current = false; // reset so retry button works
      const msg = (e as Error)?.message ?? String(e);
      console.error("[capture] startCapture error:", e);
      setCronState("error");

      if (msg.toLowerCase().includes("not allowed") || msg.includes("origin") || msg.includes("taint")) {
        setCronMsg("Erro de segurança do browser — recarregue a página e clique no vídeo primeiro");
      } else {
        setCronMsg(`Erro ao capturar áudio: ${msg.slice(0, 100)}`);
      }
    }
  }, [recordChunk]);

  // ── onReady callback passed to ArtvPlayer ─────────────────────────────────
  // Stores the video element and auto-starts capture.
  // captureActiveRef.current prevents duplicate starts when onPlaying fires
  // multiple times (rebuffer, seek, manual play after autoplay-block).
  const handleVideoReady = useCallback((video: HTMLVideoElement) => {
    captureVideoRef.current = video;
    setVideoReady(true);
    startCapture(video);
  }, [startCapture]);

  // ── Manual capture trigger (retry button) ────────────────────────────────
  const handleManualCapture = useCallback(async () => {
    const video = captureVideoRef.current;
    if (!video) {
      setCronState("error");
      setCronMsg("Vídeo ainda não está pronto — aguarde o início do stream");
      return;
    }
    // Signal stop FIRST so the old recorder's onstop callback sees
    // captureActiveRef = false and doesn't interfere with the new capture.
    captureActiveRef.current = false;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      // Allow onstop to fire and complete before we restart.
      await new Promise<void>(r => setTimeout(r, 150));
    }
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    await startCapture(video);
  }, [startCapture]);

  // ── Trigger server-side transcription pipeline directly ──────────────────
  // Calls plenario-cron which discovers the HLS stream and transcribes it
  // server-side (no browser audio capture needed). Results appear via Realtime.
  const handleTriggerServer = useCallback(async () => {
    setCronState("running");
    setCronMsg("A acionar pipeline do servidor…");
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/plenario-cron`, {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body:   "{}",
        signal: AbortSignal.timeout(120_000),
      });
      const r = await resp.json() as any;

      if (r.skipped) {
        setCronState("waiting");
        setCronMsg(`Servidor: ${r.reason ?? "fora do horário parlamentar (08–22 Lisboa)"}`);
      } else if (r.waiting) {
        setCronState("waiting");
        setCronMsg("Servidor: stream não disponível — Parlamento pode não estar em sessão");
      } else if (!resp.ok) {
        setCronState("error");
        setCronMsg(`Erro servidor: ${r.error ?? `HTTP ${resp.status}`}`);
      } else {
        setCronState("ok");
        setCronMsg(
          `✓ Servidor: ${r.new_segments ?? 0} segmentos · ${r.total_words ?? 0} palavras · ${r.total_fillers ?? 0} enchimentos`
        );
      }
    } catch (e) {
      setCronState("error");
      setCronMsg("Erro ao contactar o servidor de transcrição");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stop capture on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      captureActiveRef.current = false;
      recorderRef.current?.stop();
      audioCtxRef.current?.close();
    };
  }, []);

  // ── Load historical events ─────────────────────────────────────────────────
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

  // ── Supabase Realtime ──────────────────────────────────────────────────────
  useTranscriptRealtime(handleNewEvent, activeSession?.id);

  // ── Auto-scroll feed ──────────────────────────────────────────────────────
  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [events.length]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const isCapturing    = captureActiveRef.current || cronState === "running" || cronState === "starting";
  const isLive         = isCapturing || !!activeSession;
  const fillerRate     = sessionStats.totalWords > 0 ? sessionStats.totalFillers / sessionStats.totalWords : 0;
  const grade          = gradeFillerRate(fillerRate);
  const currentSpeaker = events[0]?.politician ?? null;

  // Status icon
  const cronStatusIcon = {
    idle:     <Wifi className="h-3.5 w-3.5 text-muted-foreground" />,
    starting: <Wifi className="h-3.5 w-3.5 text-primary animate-pulse" />,
    running:  <Wifi className="h-3.5 w-3.5 text-primary animate-pulse" />,
    ok:       <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />,
    waiting:  <Clock className="h-3.5 w-3.5 text-amber-400" />,
    error:    <AlertCircle className="h-3.5 w-3.5 text-red-400" />,
  }[cronState];

  // Human-readable status bar message (replaces confusing "A aguardar…")
  const statusBarMsg = isCapturing
    ? "A capturar áudio do browser · enviando para Whisper large-v3…"
    : captureActiveRef.current
    ? "Captura ativa · resultados a cada 30 s"
    : videoReady
    ? "Vídeo pronto · clique em «Iniciar Captura» ou aguarde o início automático"
    : "A aguardar início do stream…";

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="container py-6 sm:py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-3xl sm:text-4xl font-bold">Plenário Ao Vivo</h1>
            {isLive && (
              <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                isCapturing
                  ? "bg-primary/15 border border-primary/30 text-primary"
                  : "bg-red-500/15 border border-red-500/30 text-red-400"
              }`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                {isCapturing ? "A CAPTURAR" : "AO VIVO"}
              </span>
            )}
          </div>
          <p className="text-muted-foreground">
            Stream direto da ARTV · transcrição automática por IA · detecção de enchimentos
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <a href="https://canal.parlamento.pt" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="gap-2">
              <ExternalLink className="h-4 w-4" /> ARTV
            </Button>
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─ Left column ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* ── Video + capture panel ─────────────────────────────────────── */}
          <div className="glass-card rounded-xl overflow-hidden">
            {/* Title bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/40">
              <div className="flex items-center gap-2">
                <Tv2 className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Canal Parlamento — Ao Vivo</span>
              </div>

              {/* Capture controls */}
              <div className="flex items-center gap-2">
                {/* Status message */}
                <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground max-w-[260px] truncate">
                  {cronStatusIcon}
                  {cronMsg}
                </span>

                {/* Manual capture / retry button */}
                {videoReady && (cronState === "idle" || cronState === "error") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-7 text-xs border-primary/40 text-primary hover:bg-primary/10 shrink-0"
                    onClick={handleManualCapture}
                  >
                    <Mic className="h-3 w-3" />
                    {cronState === "error" ? "Tentar novamente" : "Iniciar Captura"}
                  </Button>
                )}

                {/* Server-side pipeline trigger */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 h-7 text-xs text-muted-foreground shrink-0"
                  title="Acionar transcrição no servidor (plenario-cron)"
                  onClick={handleTriggerServer}
                >
                  <Server className="h-3 w-3" />
                  <span className="hidden sm:inline">Servidor</span>
                </Button>
              </div>
            </div>

            {/* hls.js player */}
            <ArtvPlayer
              streamUrl={activeSession?.artv_stream_url}
              onReady={handleVideoReady}
            />

            {/* Status bar */}
            <div className="px-4 py-2 text-xs text-muted-foreground flex items-center justify-between border-t border-border/40">
              <span>{statusBarMsg}</span>
              <a
                href="https://canal.parlamento.pt"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-primary transition-colors shrink-0 ml-2"
              >
                <ExternalLink className="h-3 w-3" /> canal.parlamento.pt
              </a>
            </div>
          </div>

          {/* ── Current speaker ───────────────────────────────────────────── */}
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
                  <p className="text-sm" style={{ color: PARTY_COLORS[currentSpeaker.party] }}>{currentSpeaker.party}</p>
                </div>
                <div className="ml-auto flex items-center gap-1.5 text-primary">
                  <Radio className="h-4 w-4 animate-pulse" />
                  <span className="text-sm font-semibold">Ativo</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Transcript feed ───────────────────────────────────────────── */}
          <div ref={feedRef} className="space-y-3 max-h-[500px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
            <AnimatePresence initial={false}>
              {events.length === 0 && (
                <div className="glass-card rounded-xl p-10 text-center text-muted-foreground">
                  <Radio className="h-8 w-8 mx-auto mb-3 opacity-40" />
                  <p>À espera de transcrições…</p>
                  <p className="text-xs mt-2 opacity-60">
                    O Whisper processa chunks de 30 s — os primeiros resultados aparecem em ~30–60 s
                  </p>
                  {!videoReady && (
                    <p className="text-xs mt-1 opacity-60">
                      Em alternativa, clique em <strong>Servidor</strong> para acionar a transcrição pelo servidor
                    </p>
                  )}
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
              <li>Stream ARTV via <strong>LiveExtend CDN</strong> · hls.js + proxy</li>
              <li>Browser capta áudio do vídeo com <strong>MediaRecorder</strong></li>
              <li>Chunk de 30 s enviado para <strong>Whisper large-v3</strong></li>
              <li>Enchimentos detectados e pontuados por categoria</li>
              <li>Resultados em tempo real via <strong>Supabase Realtime</strong></li>
              <li><strong>Servidor</strong>: pipeline paralelo via pg_cron, sem browser</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TranscriptBlock({ event, isNewest }: { event: LiveEvent; isNewest: boolean }) {
  const segments    = segmentTranscript(event.text_segment);
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
