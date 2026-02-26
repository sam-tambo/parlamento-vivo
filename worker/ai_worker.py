#!/usr/bin/env python3
"""
Parlamento Vivo — AI Speech Analysis Worker
============================================
Connects to the ARTV Plenário live stream OR processes archive footage,
transcribes audio with OpenAI Whisper, detects filler words, and posts
results to Supabase for real-time display.

Modes:
  python ai_worker.py live         # Live stream from canal.parlamento.pt/plenario
  python ai_worker.py archive 2025 # Process 2025 archive sessions
  python ai_worker.py file <path>  # Process a local video/audio file

Requirements: see requirements.txt
"""

import os
import sys
import re
import json
import time
import subprocess
import tempfile
from datetime import datetime, date
from pathlib import Path

# ─── Config ──────────────────────────────────────────────────────────────────

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
ARTV_LIVE_URL        = "https://canal.parlamento.pt/plenario"
WHISPER_MODEL        = os.environ.get("WHISPER_MODEL", "medium")  # base / small / medium / large
CHUNK_SECONDS        = int(os.environ.get("CHUNK_SECONDS", "30"))

# Portuguese parliamentary filler words (must match src/lib/filler-words.ts)
FILLER_CATALOG = [
    # hesitation
    "digamos", "quer dizer", "bem", "ora", "pois", "ah", "eh", "hm",
    # connectors
    "portanto", "ou seja", "de facto", "na verdade", "assim", "então", "depois",
    # fillers
    "pronto", "basicamente", "efetivamente", "tipo", "ok", "olhe", "enfim",
    "exatamente", "claro", "obviamente", "naturalmente", "certamente",
    # stallers
    "como direi", "de certa forma", "de alguma maneira", "por assim dizer",
    "de certa maneira", "de algum modo",
]
# Sort longest first to match multi-word phrases before single words
FILLER_CATALOG.sort(key=len, reverse=True)


# ─── Supabase client (minimal HTTP) ──────────────────────────────────────────

import urllib.request
import urllib.error

def supabase_request(method: str, table: str, data: dict | None = None,
                     query: str = "") -> dict:
    """Minimal Supabase REST API caller — no extra dependencies needed."""
    url = f"{SUPABASE_URL}/rest/v1/{table}{query}"
    headers = {
        "apikey":        SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "return=representation",
    }
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"[supabase] {method} {table} → HTTP {e.code}: {e.read().decode()}")
        return {}


# ─── Filler detection ─────────────────────────────────────────────────────────

def detect_fillers(text: str) -> tuple[int, dict[str, int]]:
    """Return (total_count, {word: count}) for all filler words in text."""
    remaining = text.lower()
    found: dict[str, int] = {}
    for word in FILLER_CATALOG:
        pattern = re.compile(r"\b" + re.escape(word) + r"\b", re.IGNORECASE)
        matches = pattern.findall(remaining)
        if matches:
            found[word] = len(matches)
            remaining = pattern.sub(" " * len(word), remaining)
    return sum(found.values()), found


# ─── Audio capture (live) ────────────────────────────────────────────────────

def get_hls_url(page_url: str) -> str:
    """Extract HLS stream URL from an ARTV page using streamlink."""
    print(f"[worker] Extracting HLS URL from {page_url} …")
    try:
        result = subprocess.run(
            ["streamlink", "--stream-url", page_url, "best"],
            capture_output=True, text=True, timeout=45,
        )
        url = result.stdout.strip()
        if url and url.startswith("http"):
            print(f"[worker] HLS URL: {url[:80]}…")
            return url
    except FileNotFoundError:
        pass  # streamlink not installed; fall back to yt-dlp

    # Fallback: yt-dlp
    result = subprocess.run(
        ["yt-dlp", "-f", "best", "--get-url", page_url],
        capture_output=True, text=True, timeout=45,
    )
    url = result.stdout.strip()
    if url:
        return url

    raise RuntimeError(
        "Could not extract stream URL. Install streamlink or yt-dlp:\n"
        "  pip install streamlink yt-dlp"
    )


def capture_audio_chunk(stream_url: str, output_path: str, duration: int = 30):
    """Capture `duration` seconds of audio from an HLS stream via ffmpeg."""
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", stream_url,
            "-t", str(duration),
            "-vn",          # no video
            "-ar", "16000", # 16 kHz mono — optimal for Whisper
            "-ac", "1",
            "-f", "wav",
            output_path,
        ],
        capture_output=True, check=True,
    )


# ─── Whisper transcription ───────────────────────────────────────────────────

def transcribe(audio_path: str, model) -> str:
    """Transcribe an audio file with Whisper and return the text."""
    result = model.transcribe(audio_path, language="pt", task="transcribe")
    return result["text"].strip()


# ─── Supabase helpers ─────────────────────────────────────────────────────────

def get_or_create_session(session_date: str | None = None) -> str:
    today = session_date or date.today().isoformat()
    rows = supabase_request(
        "GET", "sessions",
        query=f"?date=eq.{today}&status=eq.live&select=id&limit=1",
    )
    if rows:
        return rows[0]["id"]

    result = supabase_request("POST", "sessions", {
        "date": today,
        "status": "live",
        "artv_stream_url": ARTV_LIVE_URL,
        "start_time": datetime.now().strftime("%H:%M:%S"),
        "transcript_status": "processing",
    })
    if isinstance(result, list) and result:
        return result[0]["id"]
    raise RuntimeError("Could not create session in Supabase")


def post_event(session_id: str, politician_id: str | None,
               text: str, filler_count: int, filler_words: dict,
               start_seconds: float, duration: float):
    supabase_request("POST", "transcript_events", {
        "session_id":       session_id,
        "politician_id":    politician_id,
        "text_segment":     text,
        "filler_count":     filler_count,
        "total_words":      len(text.split()),
        "filler_words_found": filler_words,
        "start_seconds":    start_seconds,
        "duration_seconds": duration,
    })


def update_politician_stats(politician_id: str, filler_count: int,
                             duration_seconds: int, word_count: int):
    rows = supabase_request(
        "GET", "politicians",
        query=f"?id=eq.{politician_id}&select=*&limit=1",
    )
    if not rows:
        return
    p = rows[0]
    new_speeches = p["total_speeches"] + 1
    new_fillers  = p["total_filler_count"] + filler_count
    new_seconds  = p["total_speaking_seconds"] + duration_seconds
    total_words  = max(word_count, 1)
    new_ratio    = new_fillers / (new_speeches * max(total_words, 1))

    supabase_request("PATCH", "politicians", {
        "total_speeches":       new_speeches,
        "total_filler_count":   new_fillers,
        "total_speaking_seconds": new_seconds,
        "average_filler_ratio": min(new_ratio, 1.0),
    }, query=f"?id=eq.{politician_id}")


# ─── Mode: LIVE ──────────────────────────────────────────────────────────────

def run_live():
    import whisper  # type: ignore
    print(f"[worker] Loading Whisper model '{WHISPER_MODEL}' …")
    model = whisper.load_model(WHISPER_MODEL)

    stream_url = get_hls_url(ARTV_LIVE_URL)
    session_id = get_or_create_session()
    print(f"[worker] Session ID: {session_id}")
    print(f"[worker] Processing {CHUNK_SECONDS}s chunks. Press Ctrl+C to stop.\n")

    chunk_idx    = 0
    session_start = time.time()

    while True:
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                audio_path = f.name

            print(f"[worker] Chunk {chunk_idx:04d} — capturing {CHUNK_SECONDS}s …", end="", flush=True)
            capture_audio_chunk(stream_url, audio_path, CHUNK_SECONDS)

            print(" transcribing …", end="", flush=True)
            text = transcribe(audio_path, model)
            os.unlink(audio_path)

            if not text:
                print(" (empty)")
                chunk_idx += 1
                continue

            filler_count, filler_words = detect_fillers(text)
            words       = len(text.split())
            ratio       = filler_count / max(words, 1) * 100
            elapsed     = time.time() - session_start

            print(f" {words} words · {filler_count} fillers ({ratio:.1f}%)")
            if filler_count > 0:
                top = sorted(filler_words.items(), key=lambda x: -x[1])[:3]
                print(f"          top: {', '.join(f'{w}×{c}' for w,c in top)}")

            post_event(session_id, None, text, filler_count, filler_words, elapsed, CHUNK_SECONDS)
            chunk_idx += 1

        except KeyboardInterrupt:
            print("\n[worker] Stopping …")
            supabase_request("PATCH", "sessions", {
                "status": "completed",
                "end_time": datetime.now().strftime("%H:%M:%S"),
                "transcript_status": "done",
            }, query=f"?id=eq.{session_id}")
            break
        except Exception as e:
            print(f"\n[worker] Error: {e}")
            time.sleep(5)


# ─── Mode: ARCHIVE ────────────────────────────────────────────────────────────

def run_archive(year: int):
    """
    Process archived sessions from canal.parlamento.pt for a given year.

    The ARTV archive catalogue is at:
      https://canal.parlamento.pt/arquivo?year=YYYY

    Each session URL follows a pattern like:
      https://canal.parlamento.pt/vod/{session-id}

    We use yt-dlp to:
      1. List all available session URLs for the year
      2. Download audio for each
      3. Transcribe and store results
    """
    import whisper  # type: ignore
    print(f"[worker] Loading Whisper model '{WHISPER_MODEL}' …")
    model = whisper.load_model(WHISPER_MODEL)

    archive_url = f"https://canal.parlamento.pt/arquivo?year={year}"
    print(f"[worker] Fetching archive index from {archive_url} …")

    # Get list of session video URLs for the year
    result = subprocess.run(
        ["yt-dlp", "--flat-playlist", "--get-url", archive_url],
        capture_output=True, text=True, timeout=120,
    )
    session_urls = [u.strip() for u in result.stdout.splitlines() if u.strip().startswith("http")]

    if not session_urls:
        # Fallback: construct URLs from known pattern
        print(f"[worker] yt-dlp playlist failed; trying direct page scrape …")
        session_urls = scrape_archive_urls(year)

    print(f"[worker] Found {len(session_urls)} sessions for {year}")

    for i, url in enumerate(session_urls, 1):
        print(f"\n[worker] Session {i}/{len(session_urls)}: {url}")
        try:
            process_archive_session(url, year, model)
            time.sleep(2)  # polite delay between downloads
        except Exception as e:
            print(f"[worker] ERROR: {e}")
            continue

    print(f"\n[worker] Done processing {year} archive!")


def scrape_archive_urls(year: int) -> list[str]:
    """Scrape the ARTV archive page to find session video URLs."""
    import urllib.request
    import html.parser

    urls = []
    page_url = f"https://canal.parlamento.pt/arquivo?year={year}"
    try:
        with urllib.request.urlopen(page_url, timeout=30) as resp:
            html_content = resp.read().decode("utf-8", errors="replace")
        # Find video/session links
        pattern = re.compile(r'href=["\']([^"\']*(?:vod|sessao|plenario)[^"\']*)["\']', re.IGNORECASE)
        raw = pattern.findall(html_content)
        base = "https://canal.parlamento.pt"
        for href in raw:
            full = href if href.startswith("http") else base + href
            if full not in urls:
                urls.append(full)
    except Exception as e:
        print(f"[worker] Scrape failed: {e}")
    return urls


def process_archive_session(video_url: str, year: int, model):
    """Download, transcribe, and store one archive session."""
    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = os.path.join(tmpdir, "audio.wav")

        print(f"  Downloading audio …", end="", flush=True)
        subprocess.run(
            [
                "yt-dlp", "-x",
                "--audio-format", "wav",
                "--audio-quality", "0",
                "--postprocessor-args", "-ar 16000 -ac 1",
                "-o", audio_path,
                video_url,
            ],
            capture_output=True, check=True,
        )
        print(" done.")

        # Extract session date from URL or metadata
        date_match = re.search(r"(\d{4})[/-](\d{2})[/-](\d{2})", video_url)
        if date_match:
            session_date = f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}"
        else:
            session_date = f"{year}-01-01"  # fallback

        session_id = get_or_create_session(session_date)

        # Transcribe in chunks (Whisper handles long files automatically)
        print(f"  Transcribing …", end="", flush=True)
        result = model.transcribe(audio_path, language="pt", task="transcribe",
                                   verbose=False, word_timestamps=False)
        print(" done.")

        # Process each Whisper segment as a transcript event
        for seg in result.get("segments", []):
            text = seg.get("text", "").strip()
            if not text:
                continue
            filler_count, filler_words = detect_fillers(text)
            post_event(
                session_id  = session_id,
                politician_id = None,   # TODO: speaker diarization
                text        = text,
                filler_count = filler_count,
                filler_words = filler_words,
                start_seconds = seg.get("start", 0),
                duration    = seg.get("end", 0) - seg.get("start", 0),
            )

        total_text  = result.get("text", "")
        total_fc, _ = detect_fillers(total_text)
        total_words = len(total_text.split())
        ratio       = total_fc / max(total_words, 1) * 100
        print(f"  {total_words} words · {total_fc} fillers ({ratio:.1f}%)")

        # Update session stats
        supabase_request("PATCH", "sessions", {
            "status": "completed",
            "transcript_status": "done",
            "total_filler_count": total_fc,
            "total_speaking_minutes": round(result["segments"][-1]["end"] / 60, 1)
                if result.get("segments") else 0,
        }, query=f"?id=eq.{session_id}")


# ─── Mode: FILE ───────────────────────────────────────────────────────────────

def run_file(path: str):
    """Process a single local video or audio file."""
    import whisper  # type: ignore
    print(f"[worker] Loading Whisper model '{WHISPER_MODEL}' …")
    model = whisper.load_model(WHISPER_MODEL)

    if not os.path.exists(path):
        print(f"[worker] File not found: {path}")
        sys.exit(1)

    # Convert to 16 kHz WAV if needed
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        wav_path = f.name

    print(f"[worker] Converting to WAV …")
    subprocess.run(
        ["ffmpeg", "-y", "-i", path, "-ar", "16000", "-ac", "1", "-f", "wav", wav_path],
        capture_output=True, check=True,
    )

    session_id = get_or_create_session()
    print(f"[worker] Transcribing {path} …")
    result = model.transcribe(wav_path, language="pt", task="transcribe",
                               verbose=False, word_timestamps=False)
    os.unlink(wav_path)

    for seg in result.get("segments", []):
        text = seg.get("text", "").strip()
        if not text:
            continue
        fc, fw = detect_fillers(text)
        post_event(session_id, None, text, fc, fw, seg["start"], seg["end"] - seg["start"])

    total_text = result.get("text", "")
    fc, _ = detect_fillers(total_text)
    print(f"[worker] Done: {len(total_text.split())} words, {fc} fillers ({fc/max(len(total_text.split()),1)*100:.1f}%)")


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.")
        sys.exit(1)

    mode = sys.argv[1] if len(sys.argv) > 1 else "live"

    if mode == "live":
        run_live()
    elif mode == "archive":
        year = int(sys.argv[2]) if len(sys.argv) > 2 else 2025
        run_archive(year)
    elif mode == "file":
        if len(sys.argv) < 3:
            print("Usage: python ai_worker.py file <path-to-video>")
            sys.exit(1)
        run_file(sys.argv[2])
    else:
        print(f"Unknown mode: {mode}. Use: live | archive [year] | file <path>")
        sys.exit(1)
