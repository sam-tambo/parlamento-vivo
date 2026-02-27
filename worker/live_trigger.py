#!/usr/bin/env python3
"""
live_trigger.py — GitHub Actions orchestrator for Plenário live transcription
==============================================================================
Runs every 5 minutes (via GitHub Actions cron).  Does exactly three things:

  1. Try yt-dlp to find the live ARTV HLS stream URL
  2. Upsert today's live session in Lovable Cloud with that URL
  3. POST to the `transcribe` Lovable edge function with the URL
     → edge function downloads segments, calls HF Whisper, detects fillers,
       inserts into transcript_events, fires Realtime to the UI

Required GitHub Actions secret (Settings → Secrets → Actions):
  LOVABLE_SERVICE_KEY  <service_role key — Lovable Cloud → project settings → API>

The Lovable Cloud project URL is already embedded in this file.
No other secrets or accounts needed — Lovable Cloud provides everything.

No Python packages beyond the stdlib and yt-dlp are needed.

Usage:
  pip install yt-dlp
  LOVABLE_SERVICE_KEY=... python worker/live_trigger.py
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta

# ─── Config ───────────────────────────────────────────────────────────────────

ARTV_URL      = "https://canal.parlamento.pt/plenario"

# Lovable Cloud project URL (not secret — same value as VITE_SUPABASE_URL in .env).
# Override with LOVABLE_URL env var if you ever migrate to a different project.
SUPABASE_URL  = os.environ.get("LOVABLE_URL", "https://ugyvgtzsvhmcohnooxqp.supabase.co").rstrip("/")

# Service-role key from Lovable Cloud → project settings → API → service_role
SERVICE_KEY   = os.environ.get("LOVABLE_SERVICE_KEY", "")

LISBON = timezone(timedelta(hours=0))   # WET (winter); WEST = +1 in summer
# GitHub Actions cron already gates on weekday + hour; no need to re-check here

# ─── HTTP helpers ─────────────────────────────────────────────────────────────

def _headers(extra: dict | None = None) -> dict:
    h = {
        "apikey":        SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type":  "application/json",
    }
    if extra:
        h.update(extra)
    return h


def _req(method: str, path: str, data: dict | None = None, extra_headers: dict | None = None):
    url  = SUPABASE_URL + path
    body = json.dumps(data).encode() if data else None
    req  = urllib.request.Request(url, data=body, method=method, headers=_headers(extra_headers))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode("utf-8", errors="replace")
        print(f"[trigger] {method} {path} → HTTP {e.code}: {detail}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[trigger] {method} {path} failed: {e}", file=sys.stderr)
        return None


def rest_get(path: str):
    return _req("GET", path)


def rest_post(path: str, data: dict, prefer: str | None = None):
    extra = {"Prefer": prefer} if prefer else None
    return _req("POST", path, data, extra)


def rest_patch(path: str, data: dict):
    return _req("PATCH", path, data)


# ─── HLS discovery ────────────────────────────────────────────────────────────

def find_hls_url() -> str | None:
    """
    Use yt-dlp to extract the live HLS stream URL from the ARTV Plenário page.
    yt-dlp handles JS-rendered pages for many sites and can discover HLS playlists
    even without a browser (it uses the site's API endpoints directly).
    """
    for fmt in ["best[protocol=m3u8_native]", "best[protocol=m3u8]", "best"]:
        try:
            r = subprocess.run(
                ["yt-dlp", "--get-url", "-f", fmt, "--no-warnings", ARTV_URL],
                capture_output=True, text=True, timeout=90,
            )
            for line in r.stdout.strip().splitlines():
                line = line.strip()
                if line.startswith("http") and (".m3u8" in line or "stream" in line.lower()):
                    return line
        except FileNotFoundError:
            print("[trigger] yt-dlp not found — install with: pip install yt-dlp", file=sys.stderr)
            return None
        except subprocess.TimeoutExpired:
            print("[trigger] yt-dlp timed out", file=sys.stderr)
            return None
        except Exception as e:
            print(f"[trigger] yt-dlp error: {e}", file=sys.stderr)

    # Fallback: try streamlink
    try:
        r = subprocess.run(
            ["streamlink", "--stream-url", ARTV_URL, "best"],
            capture_output=True, text=True, timeout=60,
        )
        url = r.stdout.strip()
        if url.startswith("http"):
            return url
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[trigger] streamlink error: {e}", file=sys.stderr)

    return None


# ─── Session management ───────────────────────────────────────────────────────

def lisbon_today() -> str:
    """Return today's date in Lisbon time (WET/WEST) as YYYY-MM-DD."""
    # Portugal is UTC+0 (WET) in winter, UTC+1 (WEST) in summer.
    # We use utcnow and add 1h as a safe approximation (errs on the later side).
    now = datetime.now(timezone.utc) + timedelta(hours=1)
    return now.strftime("%Y-%m-%d")


def upsert_session(today: str, hls_url: str) -> str | None:
    """Return the session ID for today, creating it if needed."""
    sessions = rest_get(
        f"/rest/v1/sessions"
        f"?status=eq.live&date=eq.{today}&select=id,artv_stream_url&limit=1"
    )

    if sessions:
        s = sessions[0]
        if s.get("artv_stream_url") != hls_url:
            rest_patch(f"/rest/v1/sessions?id=eq.{s['id']}", {"artv_stream_url": hls_url})
            print(f"[trigger] Updated HLS URL for session {s['id']}")
        else:
            print(f"[trigger] Reusing session {s['id']}")
        return s["id"]

    # Create new session for today
    now_utc  = datetime.now(timezone.utc)
    # Approximate Lisbon time for start_time field
    now_lisbon = (now_utc + timedelta(hours=1)).strftime("%H:%M:%S")

    result = rest_post(
        "/rest/v1/sessions",
        {
            "date":              today,
            "status":            "live",
            "artv_stream_url":   hls_url,
            "start_time":        now_lisbon,
            "transcript_status": "processing",
        },
        prefer="return=representation",
    )
    if result and isinstance(result, list) and result:
        sid = result[0]["id"]
        print(f"[trigger] Created session {sid} for {today}")
        return sid

    print("[trigger] Failed to create session", file=sys.stderr)
    return None


# ─── Transcription call ───────────────────────────────────────────────────────

def trigger_transcription(session_id: str, hls_url: str) -> bool:
    """
    Call the deployed Supabase `transcribe` edge function.
    It will:  fetch HLS segments → HF Whisper → filler detection → transcript_events
    """
    fn_url = f"{SUPABASE_URL}/functions/v1/transcribe"
    body   = json.dumps({"m3u8_url": hls_url, "segment_count": 5}).encode()
    req    = urllib.request.Request(
        fn_url, data=body, method="POST",
        headers={
            **_headers(),
            "x-session-id": session_id,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            result = json.loads(r.read())
            words   = result.get("total_words", 0)
            fillers = result.get("filler_count", 0)
            ratio   = round(fillers / max(words, 1) * 100, 1)
            preview = str(result.get("text", ""))[:100]
            print(f"[trigger] OK — {words} words, {fillers} fillers ({ratio}%)")
            print(f"[trigger] '{preview}…'")
            return True

    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode("utf-8", errors="replace")
        if e.code == 503:
            print("[trigger] HF model loading (503) — will succeed next run", file=sys.stderr)
            return True   # don't fail the workflow; this is expected on cold start
        print(f"[trigger] transcribe HTTP {e.code}: {detail}", file=sys.stderr)

    except Exception as e:
        print(f"[trigger] transcribe call failed: {e}", file=sys.stderr)

    return False


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if not SERVICE_KEY:
        print("ERROR: Set LOVABLE_SERVICE_KEY (Lovable Cloud → project settings → API → service_role)", file=sys.stderr)
        sys.exit(1)

    today = lisbon_today()
    print(f"[trigger] {datetime.now(timezone.utc).isoformat()} | date={today}")

    # 1. Find HLS URL
    print(f"[trigger] Searching for ARTV live stream…")
    hls_url = find_hls_url()

    if not hls_url:
        print("[trigger] No stream found — parliament may not be in session today")
        sys.exit(0)   # not an error; cron will try again in 5 min

    print(f"[trigger] HLS: {hls_url[:80]}…")

    # 2. Upsert session
    session_id = upsert_session(today, hls_url)
    if not session_id:
        sys.exit(1)

    # 3. Trigger transcription chunk
    ok = trigger_transcription(session_id, hls_url)
    sys.exit(0 if ok else 1)
