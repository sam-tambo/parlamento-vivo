/**
 * ArtvPlayer — live HLS player for ARTV / Canal Parlamento
 * =========================================================
 * Loads the ARTV HLS stream from the LiveExtend CDN, routing every
 * request (playlist + TS segments) through our hls-proxy edge function.
 * The proxy adds the Referer/Origin headers the CDN requires, rewrites
 * all segment URLs so subsequent requests also stay proxied, and adds
 * CORS headers so hls.js can read the responses cross-origin.
 *
 * Why not an iframe?
 *   canal.parlamento.pt's player JS does not initialise inside a cross-
 *   origin iframe — it checks window.top and aborts, leaving a black screen.
 *
 * Fallback chain:
 *   1. hls.js + hls-proxy  (Chrome / Firefox / Edge)
 *   2. Native <video> HLS  (Safari — built-in decoder, no proxy needed)
 *   3. Error UI            (retry button + link to canal.parlamento.pt)
 */

import Hls from "hls.js";
import { useRef, useEffect, useState, useCallback } from "react";
import { Loader2, ExternalLink, WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Confirmed stream URLs (iptv-org/iptv pt.m3u — community-maintained) ──────
const ARTV_PRIMARY =
  "https://playout172.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8";

// Alternative playout nodes on the same CDN — tried sequentially on fatal error
const ARTV_FALLBACKS = [
  "https://playout175.livextend.cloud/livenlin4/_definst_/2liveartvpub2/playlist.m3u8",
  "https://playout173.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8",
  "https://playout174.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8",
];

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

/** Wrap a CDN URL through our Supabase CORS proxy */
const PROXY = (url: string) =>
  `${SUPABASE_URL}/functions/v1/hls-proxy?url=${encodeURIComponent(url)}`;

type Status = "loading" | "playing" | "error";

interface ArtvPlayerProps {
  /** Override URL from sessions.artv_stream_url (cached by plenario-cron). */
  streamUrl?: string | null;
  onStatus?: (s: Status) => void;
}

export function ArtvPlayer({ streamUrl, onStatus }: ArtvPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef   = useRef<Hls | null>(null);

  const [status,  setStatus]  = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);

  // Prefer session-cached URL (kept fresh by plenario-cron), fall back to hardcoded
  const url = (streamUrl && streamUrl.includes(".m3u8"))
    ? streamUrl
    : ARTV_PRIMARY;

  const updateStatus = useCallback((s: Status) => {
    setStatus(s);
    onStatus?.(s);
  }, [onStatus]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    updateStatus("loading");

    // ── hls.js (Chrome / Firefox / Edge) ─────────────────────────────────────
    if (Hls.isSupported()) {
      const hls = new Hls({
        // xhrSetup intercepts EVERY request hls.js makes — both the .m3u8
        // playlist fetch and every subsequent TS segment fetch — and wraps
        // them through our hls-proxy so the CDN sees the right Referer/Origin.
        xhrSetup(xhr, reqUrl) {
          if (
            reqUrl.startsWith("http") &&
            !reqUrl.includes(window.location.host)
          ) {
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
        // Muted autoplay is allowed; unmute is user-initiated via controls
        video.play().catch(() => {});
      });

      let fallbackIdx = 0;
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return; // non-fatal: hls.js self-heals

        console.warn("[artv] fatal error:", data.type, data.details);

        if (fallbackIdx < ARTV_FALLBACKS.length) {
          const next = ARTV_FALLBACKS[fallbackIdx++];
          console.log("[artv] trying fallback node:", next);
          hls.stopLoad();
          hls.loadSource(next);
          hls.startLoad();
        } else {
          updateStatus("error");
        }
      });

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    // ── Safari native HLS ─────────────────────────────────────────────────────
    // Safari decodes HLS inside <video> natively — no XHR interception needed.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;

      const onMeta  = () => { updateStatus("playing"); video.play().catch(() => {}); };
      const onError = () => updateStatus("error");

      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("error",          onError);

      return () => {
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("error",          onError);
      };
    }

    // Neither supported → error immediately
    updateStatus("error");
  }, [url, attempt, updateStatus]);

  const retry = () => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    setAttempt(n => n + 1);
  };

  return (
    <div className="relative bg-black" style={{ paddingTop: "56.25%" }}>
      {/* <video> is always in the DOM so hls.js can attach to it */}
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
