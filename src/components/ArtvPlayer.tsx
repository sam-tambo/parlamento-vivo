/**
 * ArtvPlayer — live HLS player for ARTV / Canal Parlamento
 * =========================================================
 * Loads the ARTV HLS stream from the LiveExtend CDN, routing every
 * request (playlist + TS segments) through our hls-proxy edge function.
 *
 * Audio capture notes:
 *   - <video muted> is required for Chrome/Firefox autoplay policy.
 *   - The parent's onReady callback calls startCapture(), which sets
 *     video.muted = false *before* calling captureStream(). Chrome only
 *     initialises the audio decoder pipeline when the video is unmuted.
 *   - onReadyRef: keeps the onReady prop fresh inside useEffect closures
 *     so stale-closure bugs don't cause captureStream to get the wrong
 *     sessionId or the wrong video reference.
 *   - onPlaying listener is NOT removed after first call so re-plays
 *     (seek, rebuffer, manual play after autoplay-block) also trigger
 *     the parent capture logic. The parent's captureActiveRef guards
 *     against starting capture twice.
 *
 * Fallback chain:
 *   1. hls.js + hls-proxy  (Chrome / Firefox / Edge)
 *   2. Native <video> HLS  (Safari — built-in decoder, no proxy needed)
 *   3. Error UI            (retry button + link to canal.parlamento.pt)
 */

import Hls from "hls.js";
import { useRef, useEffect, useState, useCallback, useLayoutEffect } from "react";
import { Loader2, ExternalLink, WifiOff, RefreshCw, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Confirmed stream URLs (iptv-org/iptv pt.m3u — community-maintained) ──────
const ARTV_PRIMARY =
  "https://playout172.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8";

const ARTV_FALLBACKS = [
  "https://playout175.livextend.cloud/livenlin4/_definst_/2liveartvpub2/playlist.m3u8",
  "https://playout173.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8",
  "https://playout174.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8",
];

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

/** Wrap a CDN URL through our Supabase CORS proxy */
const PROXY = (url: string) =>
  `${SUPABASE_URL}/functions/v1/hls-proxy?url=${encodeURIComponent(url)}`;

type Status = "loading" | "playing" | "paused" | "error";

interface ArtvPlayerProps {
  /** Override URL from sessions.artv_stream_url (cached by plenario-cron). */
  streamUrl?: string | null;
  onStatus?: (s: "loading" | "playing" | "error") => void;
  /** Called every time the video element starts/resumes playing.
   *  Parent guards against duplicate capture starts with captureActiveRef. */
  onReady?: (video: HTMLVideoElement) => void;
}

export function ArtvPlayer({ streamUrl, onStatus, onReady }: ArtvPlayerProps) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const hlsRef    = useRef<Hls | null>(null);

  // Keep the latest onReady prop in a ref so the playing-event listener
  // always calls the current prop, not the one captured at mount time.
  const onReadyRef = useRef(onReady);
  useLayoutEffect(() => { onReadyRef.current = onReady; });

  const [status,  setStatus]  = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);

  // Prefer session-cached URL (kept fresh by plenario-cron), fall back to hardcoded
  const url = (streamUrl && streamUrl.includes(".m3u8"))
    ? streamUrl
    : ARTV_PRIMARY;

  const updateStatus = useCallback((s: Status) => {
    setStatus(s);
    // Expose only the 3 public states to the parent
    if (s !== "paused") onStatus?.(s as "loading" | "playing" | "error");
  }, [onStatus]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    updateStatus("loading");

    // ── Shared playing-event handler ──────────────────────────────────────────
    // Fires on every play() call (including after autoplay-block, seek,
    // rebuffer). Not removed so re-plays also call onReady. Parent's
    // captureActiveRef prevents duplicate capture starts.
    const onPlaying = () => {
      onReadyRef.current?.(video);
    };
    video.addEventListener("playing", onPlaying);

    // ── hls.js (Chrome / Firefox / Edge) ─────────────────────────────────────
    if (Hls.isSupported()) {
      const hls = new Hls({
        xhrSetup(xhr, reqUrl) {
          if (reqUrl.startsWith(SUPABASE_URL)) return; // already proxied
          if (reqUrl.startsWith("http") && !reqUrl.includes(window.location.host)) {
            xhr.open("GET", PROXY(reqUrl), true);
          }
        },
        maxBufferLength:       20,
        liveSyncDurationCount: 3,
        enableWorker:          true,
        lowLatencyMode:        false,
      });

      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        updateStatus("playing");
        // muted=true guarantees autoplay is allowed in all browsers.
        // startCapture() will unmute the video before calling captureStream().
        video.play().catch(() => {
          // Even muted autoplay can be blocked in some strict browser configs.
          // Show "click to play" overlay; onPlaying fires when user clicks.
          updateStatus("paused");
        });
      });

      const PROXIED_FALLBACKS = ARTV_FALLBACKS.map((u) => u);
      const DIRECT_FALLBACKS  = [url, ...ARTV_FALLBACKS];
      let fallbackIdx  = 0;
      let directMode   = false;

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;

        console.warn("[artv] fatal error:", data.type, data.details);

        if (!directMode && fallbackIdx < PROXIED_FALLBACKS.length) {
          const next = PROXIED_FALLBACKS[fallbackIdx++];
          console.log("[artv] trying proxied fallback:", next);
          hls.stopLoad();
          hls.loadSource(next);
          hls.startLoad();
        } else if (!directMode) {
          directMode  = true;
          fallbackIdx = 0;
          const directUrl = DIRECT_FALLBACKS[fallbackIdx++];
          console.log("[artv] trying direct CDN:", directUrl);
          hls.stopLoad();
          hls.destroy();
          const hlsDirect = new Hls({ maxBufferLength: 20, liveSyncDurationCount: 3 });
          hlsRef.current = hlsDirect;
          hlsDirect.loadSource(directUrl);
          hlsDirect.attachMedia(video);
          hlsDirect.on(Hls.Events.MANIFEST_PARSED, () => {
            updateStatus("playing");
            video.play().catch(() => updateStatus("paused"));
          });
          hlsDirect.on(Hls.Events.ERROR, (_e, d) => {
            if (!d.fatal) return;
            if (fallbackIdx < DIRECT_FALLBACKS.length) {
              const next = DIRECT_FALLBACKS[fallbackIdx++];
              console.log("[artv] trying direct fallback:", next);
              hlsDirect.stopLoad();
              hlsDirect.loadSource(next);
              hlsDirect.startLoad();
            } else {
              updateStatus("error");
            }
          });
        } else {
          updateStatus("error");
        }
      });

      return () => {
        video.removeEventListener("playing", onPlaying);
        hls.destroy();
        hlsRef.current = null;
      };
    }

    // ── Safari native HLS ─────────────────────────────────────────────────────
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;

      const onMeta  = () => {
        updateStatus("playing");
        video.play().catch(() => updateStatus("paused"));
      };
      const onError = () => updateStatus("error");

      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("error",          onError);

      return () => {
        video.removeEventListener("playing",         onPlaying);
        video.removeEventListener("loadedmetadata",  onMeta);
        video.removeEventListener("error",           onError);
      };
    }

    // Neither supported → error
    video.removeEventListener("playing", onPlaying);
    updateStatus("error");
  }, [url, attempt, updateStatus]);

  const retry = () => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    setAttempt(n => n + 1);
  };

  return (
    <div className="relative bg-black" style={{ paddingTop: "56.25%" }}>
      {/* <video muted> allows autoplay without user gesture.
          startCapture() unmutes it before calling captureStream(). */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full"
        controls
        muted
        playsInline
        style={{ display: status === "error" ? "none" : "block" }}
      />

      {/* Loading overlay */}
      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-white/60">A ligar ao stream ARTV…</p>
        </div>
      )}

      {/* Autoplay-blocked overlay — user must click to enable audio */}
      {status === "paused" && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 cursor-pointer hover:bg-black/40 transition-colors"
          onClick={() => videoRef.current?.play()}
        >
          <PlayCircle className="h-16 w-16 text-white opacity-80" />
          <p className="text-sm text-white/70">Clique para reproduzir com áudio</p>
        </div>
      )}

      {/* Error overlay */}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/90 p-6 text-center">
          <WifiOff className="h-10 w-10 text-white/30" />
          <div className="space-y-1">
            <p className="font-semibold text-white">Stream não disponível</p>
            <p className="text-sm text-white/50">
              O Parlamento pode não estar em transmissão, ou o CDN devolveu um erro.
            </p>
          </div>
          <div className="flex gap-3 flex-wrap justify-center">
            <Button
              variant="outline"
              onClick={retry}
              className="gap-2 border-white/20 text-white hover:bg-white/10"
            >
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </Button>
            <a
              href="https://canal.parlamento.pt"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                variant="outline"
                className="gap-2 border-white/20 text-white hover:bg-white/10"
              >
                <ExternalLink className="h-4 w-4" /> Abrir canal.parlamento.pt
              </Button>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
