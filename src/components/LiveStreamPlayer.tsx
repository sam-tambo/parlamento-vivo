/**
 * LiveStreamPlayer
 * ================
 * Embeds the ARTV live HLS stream in a <video> element, then taps its
 * audio output directly through the Web Audio API — no microphone needed.
 *
 * Pipeline:
 *   ARTV HLS  ──► hls.js (MSE) ──► <video> ──► captureStream()
 *                                              ──► AudioContext (16 kHz)
 *                                              ──► ScriptProcessor
 *                                              ──► WAV encoder
 *                                              ──► POST /transcribe  (every 30 s)
 *                                                     │
 *                                                     └─► onResult(text, fillers)
 *
 * The video shows on-screen so the user can follow the session visually.
 * Audio is also played through the speakers while being captured.
 *
 * Props:
 *   hlsUrl       – ARTV live .m3u8 URL (from sessions.artv_stream_url)
 *   sessionId    – Supabase session UUID (sent as x-session-id header)
 *   supabaseUrl  – Supabase project URL (for /functions/v1/... calls)
 *   anonKey      – Supabase anon key (for auth header)
 *   onResult     – called after each transcription chunk
 *   onStatus     – "loading" | "playing" | "capturing" | "error"
 */

import { useEffect, useRef, useCallback, useState } from "react";
import Hls from "hls.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PlayerStatus = "idle" | "loading" | "playing" | "capturing" | "error";

export interface TranscribeResult {
  text: string;
  filler_count: number;
  filler_words: Record<string, number>;
  total_words: number;
}

interface Props {
  hlsUrl: string | null;
  sessionId: string | null;
  supabaseUrl: string;
  anonKey: string;
  onResult: (r: TranscribeResult) => void;
  onStatus: (s: PlayerStatus) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Target audio sample rate for Whisper (must be 16 kHz for best accuracy)
const WHISPER_SAMPLE_RATE = 16_000;

// Capture this many seconds of audio before sending to Whisper
const CHUNK_SECONDS = 30;

// Buffer size for ScriptProcessor (power of 2, affects latency)
const SCRIPT_BUFFER_SIZE = 4096;

// Proxy base — routes CDN requests through our CORS-capable edge function
const PROXY = (url: string) =>
  `/functions/v1/hls-proxy?url=${encodeURIComponent(url)}`;

// ─── WAV encoder (runs in main thread — fast, PCM is already decoded) ────────

function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const numSamples = pcm.length;
  const buf = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);           // sub-chunk size
  view.setUint16(20, 1, true);            // PCM format
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);            // block align
  view.setUint16(34, 16, true);           // bits per sample
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Uint8Array(buf);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function LiveStreamPlayer({
  hlsUrl,
  sessionId,
  supabaseUrl,
  anonKey,
  onResult,
  onStatus,
}: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const hlsRef    = useRef<Hls | null>(null);
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const processorRef  = useRef<ScriptProcessorNode | null>(null);
  const pcmBufferRef  = useRef<Float32Array[]>([]);
  const totalSamplesRef = useRef(0);
  const sendingRef    = useRef(false);

  const [audioLevel, setAudioLevel] = useState(0);

  // ── Transcription sender ──────────────────────────────────────────────────

  const sendChunk = useCallback(
    async (pcm: Float32Array) => {
      if (sendingRef.current) return; // don't overlap sends
      sendingRef.current = true;
      onStatus("capturing");

      try {
        const wav = encodeWav(pcm, WHISPER_SAMPLE_RATE);
        const resp = await fetch(`${supabaseUrl}/functions/v1/transcribe`, {
          method: "POST",
          headers: {
            "Content-Type":  "audio/wav",
            "Authorization": `Bearer ${anonKey}`,
            ...(sessionId ? { "x-session-id": sessionId } : {}),
          },
          body: wav as unknown as BodyInit,
        });

        if (resp.ok) {
          const result: TranscribeResult = await resp.json();
          if (result.text?.trim()) onResult(result);
        } else if (resp.status !== 503) {
          // 503 = HF model loading; silently skip
          console.warn("[player] transcribe error", resp.status, await resp.text());
        }
      } catch (e) {
        console.warn("[player] send failed:", e);
      } finally {
        sendingRef.current = false;
        onStatus("playing");
      }
    },
    [supabaseUrl, anonKey, sessionId, onResult, onStatus]
  );

  // ── Audio capture setup ───────────────────────────────────────────────────

  const startCapture = useCallback((video: HTMLVideoElement) => {
    // Tear down any existing context
    processorRef.current?.disconnect();
    audioCtxRef.current?.close();
    pcmBufferRef.current = [];
    totalSamplesRef.current = 0;

    // captureStream() gives us a real-time MediaStream of the video's output.
    // Because hls.js uses MSE (blob: URL), this is treated as same-origin —
    // no CORS taint, no SecurityError.
    let stream: MediaStream;
    try {
      stream = (video as any).captureStream?.() ?? (video as any).mozCaptureStream?.();
    } catch (e) {
      console.error("[player] captureStream failed:", e);
      onStatus("error");
      return;
    }

    if (!stream) {
      onStatus("error");
      return;
    }

    // AudioContext at Whisper's native sample rate — browser resamples automatically
    const ctx = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE });
    audioCtxRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);

    // Analyser for the VU meter (pure visualisation, no extra latency)
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const levelData = new Uint8Array(analyser.frequencyBinCount);
    const updateLevel = () => {
      analyser.getByteTimeDomainData(levelData);
      let sum = 0;
      for (const v of levelData) sum += Math.abs(v - 128);
      setAudioLevel(Math.min(100, (sum / levelData.length) * 4));
      requestAnimationFrame(updateLevel);
    };
    updateLevel();

    // ScriptProcessor accumulates PCM into our buffer
    const processor = ctx.createScriptProcessor(SCRIPT_BUFFER_SIZE, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      pcmBufferRef.current.push(new Float32Array(data));
      totalSamplesRef.current += data.length;

      if (totalSamplesRef.current >= WHISPER_SAMPLE_RATE * CHUNK_SECONDS) {
        // Flatten all chunks into one buffer and reset
        const combined = new Float32Array(totalSamplesRef.current);
        let offset = 0;
        for (const chunk of pcmBufferRef.current) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        pcmBufferRef.current = [];
        totalSamplesRef.current = 0;

        // Fire-and-forget (sendChunk is async; sendingRef prevents overlaps)
        sendChunk(combined);
      }
    };

    // Graph: source → analyser → processor → destination (speakers)
    source.connect(analyser);
    source.connect(processor);
    processor.connect(ctx.destination); // keeps audio playing through speakers
    analyser.connect(ctx.destination);

    onStatus("playing");
  }, [sendChunk, onStatus]);

  // ── HLS setup ────────────────────────────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    onStatus("loading");

    // Teardown previous hls instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        // Route all HLS requests through our CORS proxy edge function
        xhrSetup(xhr, url) {
          // Only proxy external URLs (skip blob: and same-origin)
          if (url.startsWith("http") && !url.includes(window.location.host)) {
            xhr.open("GET", PROXY(url), true);
          }
        },
        // Prefer lower latency: keep 3 segments in buffer
        maxBufferLength: 20,
        liveSyncDurationCount: 3,
        enableWorker: true,
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().then(() => {
          startCapture(video);
        }).catch(() => {
          // Autoplay blocked — user must click play; we'll start capture then
        });
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.error("[hls] Fatal error:", data);
          onStatus("error");
        }
      });

      hlsRef.current = hls;
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari has native HLS — route through proxy by rewriting the source
      video.src = PROXY(hlsUrl);
      video.play().then(() => startCapture(video)).catch(() => {});
    } else {
      onStatus("error");
    }

    return () => {
      hlsRef.current?.destroy();
      processorRef.current?.disconnect();
      audioCtxRef.current?.close();
    };
  }, [hlsUrl, startCapture, onStatus]);

  // ── Handle play after autoplay block ─────────────────────────────────────

  const handlePlay = () => {
    const video = videoRef.current;
    if (video && audioCtxRef.current?.state === "suspended") {
      audioCtxRef.current.resume();
    }
    if (video && !processorRef.current) {
      startCapture(video);
    }
    onStatus("playing");
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="relative rounded-xl overflow-hidden bg-black">
      <video
        ref={videoRef}
        className="w-full aspect-video"
        playsInline
        controls
        onPlay={handlePlay}
        crossOrigin="anonymous"
      />

      {/* Audio level bar — shows the stream is being captured */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
        <div
          className="h-full bg-green-400 transition-all duration-75"
          style={{ width: `${audioLevel}%` }}
        />
      </div>

      {/* Overlay when no URL */}
      {!hlsUrl && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white text-sm">
          <p className="opacity-60">À espera da URL do stream…</p>
        </div>
      )}
    </div>
  );
}
