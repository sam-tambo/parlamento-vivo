/**
 * hls-proxy — CORS proxy for ARTV / Canal Parlamento HLS streams
 * ==============================================================
 * The ARTV CDN may not emit Access-Control-Allow-Origin headers, which
 * prevents hls.js from fetching playlists and segments cross-origin.
 * This edge function proxies all HLS traffic server-side and adds the
 * required CORS headers so the browser player works without restriction.
 *
 * For .m3u8 playlists we also rewrite relative + absolute segment URLs
 * so every subsequent segment request goes through this proxy too.
 *
 * Usage (called by hls.js via xhrSetup / fetchSetup):
 *   GET /functions/v1/hls-proxy?url=<encoded_artv_url>
 *
 * Security: only URLs matching ALLOWED_HOSTS are proxied.
 */

const ALLOWED_HOSTS = [
  // LiveExtend CDN — the actual ARTV/Canal Parlamento streaming provider
  "livextend.cloud",
  // Parliament own infrastructure
  "livepd3.parlamento.pt",
  "streaming.parlamento.pt",
  "canal.parlamento.pt",
  "parlamento.pt",
  // RTP CDN (ARTV is an RTP group channel)
  "streaming.rtp.pt",
  "rdmedia.rtp.pt",
  // Akamai / generic CDN edges
  "akamaized.net",
  "akamaihd.net",
  "edgekey.net",
  "cloudfront.net",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range",
};

function isAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

/**
 * Rewrite an .m3u8 playlist so all segment URLs point through this proxy.
 * Handles both absolute URLs and relative paths.
 */
function rewritePlaylist(text: string, baseUrl: string, proxyBase: string): string {
  const base = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);

  return text
    .split("\n")
    .map((line) => {
      const t = line.trim();
      // Skip comment / tag lines and empty lines
      if (!t || t.startsWith("#")) return line;

      // Build absolute URL for this segment / child playlist
      const absolute = t.startsWith("http") ? t : base + t;

      // Rewrite to go through proxy
      return `${proxyBase}?url=${encodeURIComponent(absolute)}`;
    })
    .join("\n");
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get("url");

  if (!target) {
    return new Response("Missing ?url= parameter", { status: 400, headers: CORS });
  }

  if (!isAllowed(target)) {
    return new Response("URL host not in allowlist", { status: 403, headers: CORS });
  }

  // Forward the request to the CDN
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer": "https://canal.parlamento.pt/",
        "Origin": "https://canal.parlamento.pt",
        // Forward Range header for partial content (needed for some CDNs)
        ...(req.headers.get("Range") ? { Range: req.headers.get("Range")! } : {}),
      },
      redirect: "follow",
    });
  } catch (e) {
    return new Response(`Upstream fetch failed: ${e}`, { status: 502, headers: CORS });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const isPlaylist =
    target.includes(".m3u8") ||
    contentType.includes("mpegurl") ||
    contentType.includes("x-mpegurl");

  // Build response headers (copy upstream + add CORS)
  const responseHeaders = new Headers(CORS);
  for (const [k, v] of upstream.headers.entries()) {
    // Don't copy headers that conflict with CORS or cause issues
    if (["access-control-allow-origin", "content-encoding"].includes(k.toLowerCase())) continue;
    responseHeaders.set(k, v);
  }
  responseHeaders.set("content-type", contentType || "application/octet-stream");

  if (isPlaylist) {
    // Rewrite playlist URLs so subsequent requests also go through us
    const text = await upstream.text();

    // Derive the base URL for this proxy instance
    const proxyBase = `${reqUrl.origin}/functions/v1/hls-proxy`;
    const rewritten = rewritePlaylist(text, target, proxyBase);

    responseHeaders.set("content-type", "application/vnd.apple.mpegurl");
    responseHeaders.delete("content-length"); // length changed after rewrite

    return new Response(rewritten, {
      status: upstream.status,
      headers: responseHeaders,
    });
  }

  // Raw binary (TS segments, keys, etc.) — stream straight through
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
});
