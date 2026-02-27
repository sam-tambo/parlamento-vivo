#!/usr/bin/env python3
"""
Parlamento Vivo — AI Speech Analysis Worker
============================================
Captures audio from the ARTV Plenário stream, transcribes with Whisper,
optionally diarizes speakers with pyannote.audio, detects Portuguese filler
words, and pushes everything to Supabase in real-time.

MODES:
  python ai_worker.py live
      Stream canal.parlamento.pt/plenario live, 30-second chunks.

  python ai_worker.py recent [N]
      Download and process the N most recent sessions from the ARTV Plenário
      archive (default N=20). Uses Playwright to discover URLs.

  python ai_worker.py file <path>
      Process a single local audio/video file.

REQUIRED ENV VARS:
  SUPABASE_URL          https://xxxxx.supabase.co
  SUPABASE_SERVICE_KEY  service_role key (not anon!)

OPTIONAL ENV VARS:
  WHISPER_MODEL    base | small | medium | large-v3  (default: medium)
  CHUNK_SECONDS    seconds per live chunk            (default: 30)
  HF_TOKEN         HuggingFace token — enables speaker diarization
                   (requires accepting model licenses, see diarization.py)
  VOICE_THRESHOLD  cosine distance for speaker match (default: 0.25)
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path

# Sibling modules
sys.path.insert(0, str(Path(__file__).parent))
from diarization import VoiceProfileDB, Diarizer, align_whisper_to_diarization, PYANNOTE_AVAILABLE

# ─── Config ───────────────────────────────────────────────────────────────────

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
HF_TOKEN             = os.environ.get("HF_TOKEN", "")
WHISPER_MODEL        = os.environ.get("WHISPER_MODEL", "medium")
CHUNK_SECONDS        = int(os.environ.get("CHUNK_SECONDS", "30"))
ARTV_PLENARIO_URL    = "https://canal.parlamento.pt/plenario"

# Portuguese parliamentary filler words — must match src/lib/filler-words.ts
FILLER_CATALOG = sorted([
    "como direi", "de certa forma", "de alguma maneira", "por assim dizer",
    "de certa maneira", "de algum modo",
    "portanto", "ou seja", "de facto", "na verdade",
    "quer dizer", "digamos", "basicamente", "efetivamente",
    "pronto", "enfim", "olhe", "tipo", "ok", "bem", "ora", "pois",
    "assim", "então", "depois", "exatamente", "claro",
    "obviamente", "naturalmente", "certamente", "ah", "eh", "hm",
], key=len, reverse=True)  # longest first for greedy matching


# ─── Supabase minimal REST client ────────────────────────────────────────────

def _sb(method: str, table: str, data: dict | None = None, qs: str = "") -> list | dict:
    url  = f"{SUPABASE_URL}/rest/v1/{table}{qs}"
    hdrs = {
        "apikey":        SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "return=representation",
    }
    body = json.dumps(data).encode() if data else None
    req  = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"[supabase] {method} {table}: HTTP {e.code} — {e.read().decode()[:200]}")
        return []


# ─── Filler detection ────────────────────────────────────────────────────────

def detect_fillers(text: str) -> tuple[int, dict[str, int]]:
    remaining = text.lower()
    found: dict[str, int] = {}
    for word in FILLER_CATALOG:
        pat = re.compile(r"\b" + re.escape(word) + r"\b", re.IGNORECASE)
        hits = pat.findall(remaining)
        if hits:
            found[word] = len(hits)
            remaining = pat.sub(" " * len(word), remaining)
    return sum(found.values()), found


# ─── Session management ───────────────────────────────────────────────────────

def get_or_create_session(session_date: str | None = None,
                           source_url: str | None  = None) -> str:
    today = session_date or date.today().isoformat()
    rows  = _sb("GET", "sessions",
                qs=f"?date=eq.{today}&status=eq.live&select=id&limit=1")
    if isinstance(rows, list) and rows:
        return rows[0]["id"]

    result = _sb("POST", "sessions", {
        "date":              today,
        "status":            "live",
        "artv_stream_url":   source_url or ARTV_PLENARIO_URL,
        "start_time":        datetime.now().strftime("%H:%M:%S"),
        "transcript_status": "processing",
    })
    if isinstance(result, list) and result:
        return result[0]["id"]
    raise RuntimeError("Could not create session in Supabase")


def close_session(session_id: str, total_filler: int, total_minutes: float):
    _sb("PATCH", "sessions", {
        "status":              "completed",
        "end_time":            datetime.now().strftime("%H:%M:%S"),
        "transcript_status":   "done",
        "total_filler_count":  total_filler,
        "total_speaking_minutes": round(total_minutes, 1),
    }, qs=f"?id=eq.{session_id}")


# ─── Supabase writes ──────────────────────────────────────────────────────────

def post_event(session_id: str, politician_id: str | None,
               text: str, filler_count: int, filler_words: dict,
               start_seconds: float, duration: float,
               confidence: float = 0.0):
    _sb("POST", "transcript_events", {
        "session_id":        session_id,
        "politician_id":     politician_id,
        "text_segment":      text,
        "filler_count":      filler_count,
        "total_words":       len(text.split()),
        "filler_words_found": filler_words,
        "start_seconds":     round(start_seconds, 2),
        "duration_seconds":  round(duration, 2),
    })


def upsert_speech(session_id: str, politician_id: str,
                  words: int, fillers: int, duration_s: int,
                  excerpt: str, filler_words: dict):
    """Store one complete speech turn in the speeches table."""
    ratio = fillers / max(words, 1)
    _sb("POST", "speeches", {
        "session_id":               session_id,
        "politician_id":            politician_id,
        "speaking_duration_seconds": duration_s,
        "filler_word_count":        fillers,
        "total_word_count":         words,
        "filler_ratio":             round(ratio, 4),
        "transcript_excerpt":       excerpt[:500],
        "filler_words_detail":      filler_words,
    })
    # Bump politician aggregate stats
    rows = _sb("GET", "politicians",
               qs=f"?id=eq.{politician_id}&select=*&limit=1")
    if not (isinstance(rows, list) and rows):
        return
    p = rows[0]
    new_speeches = p["total_speeches"] + 1
    new_fillers  = p["total_filler_count"] + fillers
    new_seconds  = p["total_speaking_seconds"] + duration_s
    # Running average of filler ratio across all speeches
    prev_ratio   = p["average_filler_ratio"] or 0.0
    new_ratio    = (prev_ratio * (new_speeches - 1) + ratio) / new_speeches
    _sb("PATCH", "politicians", {
        "total_speeches":         new_speeches,
        "total_filler_count":     new_fillers,
        "total_speaking_seconds": new_seconds,
        "average_filler_ratio":   round(new_ratio, 5),
    }, qs=f"?id=eq.{politician_id}")


# ─── Audio utilities ─────────────────────────────────────────────────────────

def get_hls_url(page_url: str) -> str:
    """Extract HLS .m3u8 URL using streamlink, falling back to yt-dlp."""
    for tool, args in [
        ("streamlink", ["streamlink", "--stream-url", page_url, "best"]),
        ("yt-dlp",     ["yt-dlp", "-f", "best", "--get-url", page_url]),
    ]:
        try:
            r = subprocess.run(args, capture_output=True, text=True, timeout=45)
            url = r.stdout.strip()
            if url.startswith("http"):
                print(f"[worker] HLS via {tool}: {url[:80]}…")
                return url
        except FileNotFoundError:
            continue
    raise RuntimeError("Cannot extract HLS URL — install streamlink or yt-dlp")


def capture_chunk(stream_url: str, out: str, duration: int = 30):
    subprocess.run(
        ["ffmpeg", "-y", "-i", stream_url,
         "-t", str(duration),
         "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", out],
        capture_output=True, check=True,
    )


def download_audio(video_url: str, out: str):
    """Download audio from any yt-dlp–supported URL as 16kHz mono WAV."""
    subprocess.run(
        ["yt-dlp", "-x",
         "--audio-format", "wav",
         "--postprocessor-args", "ffmpeg:-ar 16000 -ac 1",
         "-o", out,
         video_url],
        check=True,
    )
    # yt-dlp sometimes changes the extension
    if not Path(out).exists():
        candidates = list(Path(out).parent.glob(Path(out).stem + ".*"))
        if candidates:
            return str(candidates[0])
        raise FileNotFoundError(f"Download output not found near {out}")
    return out


def to_wav16k(src: str, out: str):
    subprocess.run(
        ["ffmpeg", "-y", "-i", src,
         "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", out],
        capture_output=True, check=True,
    )


# ─── Print helper ─────────────────────────────────────────────────────────────

def _log_chunk(idx: int, words: int, fillers: int, filler_words: dict,
               politician_name: str | None = None):
    ratio = fillers / max(words, 1) * 100
    who   = f" [{politician_name}]" if politician_name else ""
    print(f"[worker] #{idx:04d}{who}  {words:4d} words  {fillers:3d} fillers ({ratio:.1f}%)")
    if filler_words:
        top = sorted(filler_words.items(), key=lambda x: -x[1])[:4]
        print(f"          top: {', '.join(f'{w}×{c}' for w, c in top)}")


# ─── Mode: LIVE ───────────────────────────────────────────────────────────────

def run_live():
    import whisper

    print(f"[worker] Loading Whisper '{WHISPER_MODEL}' …")
    model = whisper.load_model(WHISPER_MODEL)

    # Optional diarizer
    diarizer: Diarizer | None = None
    profiles = VoiceProfileDB()
    if HF_TOKEN and PYANNOTE_AVAILABLE and len(profiles) > 0:
        print(f"[worker] Diarization enabled ({len(profiles)} voice profiles loaded)")
        diarizer = Diarizer(HF_TOKEN, profiles)
    elif HF_TOKEN and not PYANNOTE_AVAILABLE:
        print("[worker] HF_TOKEN set but pyannote.audio not installed — skipping diarization")
    else:
        print("[worker] No voice profiles — speaker attribution disabled (see build_profiles.py)")

    stream_url    = get_hls_url(ARTV_PLENARIO_URL)
    session_id    = get_or_create_session(source_url=ARTV_PLENARIO_URL)
    session_start = time.time()
    chunk_idx     = 0
    session_total_fillers = 0
    print(f"[worker] Session {session_id} — live. Ctrl+C to stop.\n")

    while True:
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                wav = f.name

            print(f"[worker] Chunk {chunk_idx:04d} — capturing {CHUNK_SECONDS}s …", end="", flush=True)
            capture_chunk(stream_url, wav, CHUNK_SECONDS)
            print(" transcribing …", end="", flush=True)

            result = model.transcribe(wav, language="pt", task="transcribe", verbose=False)
            text   = result["text"].strip()

            if not text:
                print(" (empty)")
                os.unlink(wav)
                chunk_idx += 1
                continue

            filler_count, filler_words = detect_fillers(text)
            elapsed = time.time() - session_start
            print()
            _log_chunk(chunk_idx, len(text.split()), filler_count, filler_words)

            politician_id: str | None = None
            if diarizer:
                try:
                    segs = diarizer.diarize(wav)
                    # Use the majority speaker for this chunk
                    by_dur: dict[str | None, float] = {}
                    for s in segs:
                        pid = s["politician_id"]
                        by_dur[pid] = by_dur.get(pid, 0.0) + (s["end"] - s["start"])
                    politician_id = max(by_dur, key=lambda k: by_dur[k])
                except Exception as e:
                    print(f"[worker] diarization error: {e}")

            post_event(session_id, politician_id, text,
                       filler_count, filler_words, elapsed, CHUNK_SECONDS)
            session_total_fillers += filler_count

            os.unlink(wav)
            chunk_idx += 1

        except KeyboardInterrupt:
            print("\n[worker] Stopping …")
            close_session(session_id, session_total_fillers,
                          (time.time() - session_start) / 60)
            break
        except Exception as e:
            print(f"\n[worker] Error: {e}")
            time.sleep(5)


# ─── Mode: RECENT (N latest sessions) ────────────────────────────────────────

def run_recent(limit: int = 20):
    """Download and process the N most recent Plenário sessions."""
    import whisper
    from scraper import get_latest_session_urls

    print(f"[worker] Loading Whisper '{WHISPER_MODEL}' …")
    model = whisper.load_model(WHISPER_MODEL)

    # Optional diarizer
    profiles = VoiceProfileDB()
    diarizer: Diarizer | None = None
    if HF_TOKEN and PYANNOTE_AVAILABLE:
        if len(profiles) > 0:
            print(f"[worker] Diarization enabled ({len(profiles)} voice profiles)")
            diarizer = Diarizer(HF_TOKEN, profiles)
        else:
            print("[worker] HF_TOKEN set but no voice profiles — run build_profiles.py first")
    else:
        print("[worker] No diarization — set HF_TOKEN and build voice profiles to enable")

    print(f"\n[worker] Scraping {limit} latest sessions from ARTV Plenário …")
    sessions = get_latest_session_urls(limit)

    if not sessions:
        print("[worker] No sessions found. Check scraper.py output.")
        sys.exit(1)

    for i, sess in enumerate(sessions, 1):
        url   = sess["url"]
        sdate = sess.get("date", "") or date.today().isoformat()
        title = sess.get("title", "")
        print(f"\n[worker] ── Session {i}/{len(sessions)}: {sdate} {title[:50]}")
        print(f"          {url}")

        try:
            _process_session(url, sdate, model, diarizer)
        except Exception as e:
            print(f"[worker] ERROR: {e}")
            continue
        time.sleep(2)

    print("\n[worker] All done.")


def _process_session(video_url: str, session_date: str,
                     model, diarizer: Diarizer | None):
    """Download, transcribe, diarize, and store one archive session."""
    with tempfile.TemporaryDirectory() as tmp:
        raw_path = os.path.join(tmp, "session.wav")

        print("[worker]   Downloading audio …", end="", flush=True)
        download_audio(video_url, raw_path)
        # Handle extension variation
        if not Path(raw_path).exists():
            candidates = list(Path(tmp).glob("session.*"))
            if candidates:
                raw_path = str(candidates[0])
        print(" done.")

        # Convert to 16 kHz mono if needed
        wav_path = os.path.join(tmp, "audio16k.wav")
        to_wav16k(raw_path, wav_path)

        session_id = get_or_create_session(session_date, video_url)

        # ── Diarization (optional) ─────────────────────────────────────────
        diar_segments: list[dict] = []
        if diarizer:
            print("[worker]   Diarizing …", end="", flush=True)
            try:
                diar_segments = diarizer.diarize(wav_path)
                print(f" {len(diar_segments)} speaker segments.")
            except Exception as e:
                print(f" failed: {e}")

        # ── Transcription ─────────────────────────────────────────────────
        print("[worker]   Transcribing …", end="", flush=True)
        result = model.transcribe(wav_path, language="pt", task="transcribe",
                                   verbose=False, word_timestamps=False)
        w_segs = result.get("segments", [])
        print(f" {len(w_segs)} segments.")

        # ── Align + post ───────────────────────────────────────────────────
        aligned = (
            align_whisper_to_diarization(w_segs, diar_segments)
            if diar_segments else
            [{**s, "politician_id": None, "confidence": 0.0} for s in w_segs]
        )

        # Group consecutive segments by the same politician into "turns"
        turns = _group_into_turns(aligned)

        session_fillers = 0
        session_seconds = 0.0

        for turn in turns:
            text         = turn["text"]
            pol_id       = turn["politician_id"]
            start        = turn["start"]
            duration     = turn["duration"]
            fc, fw       = detect_fillers(text)
            words        = len(text.split())
            session_fillers  += fc
            session_seconds  += duration

            post_event(session_id, pol_id, text, fc, fw, start, duration,
                       turn.get("confidence", 0.0))

            if pol_id:
                upsert_speech(session_id, pol_id, words, fc,
                              int(duration), text[:300], fw)

        total_text = result.get("text", "")
        total_fc, _ = detect_fillers(total_text)
        ratio = total_fc / max(len(total_text.split()), 1) * 100
        print(f"[worker]   Done: {len(total_text.split())} words, "
              f"{total_fc} fillers ({ratio:.1f}%)")

        close_session(session_id, session_fillers, session_seconds / 60)


def _group_into_turns(segments: list[dict],
                      gap_threshold: float = 3.0) -> list[dict]:
    """
    Group consecutive Whisper segments by speaker into speech turns.
    A new turn starts when the politician_id changes OR there is a gap
    > gap_threshold seconds between segments.
    """
    if not segments:
        return []

    turns: list[dict] = []
    cur_texts   = [segments[0].get("text", "")]
    cur_pol     = segments[0].get("politician_id")
    cur_start   = segments[0].get("start", 0.0)
    cur_end     = segments[0].get("end", 0.0)
    cur_conf    = segments[0].get("confidence", 0.0)

    def flush():
        turns.append({
            "text":         " ".join(cur_texts).strip(),
            "politician_id": cur_pol,
            "start":        cur_start,
            "duration":     max(cur_end - cur_start, 0.1),
            "confidence":   cur_conf,
        })

    for seg in segments[1:]:
        pol_id  = seg.get("politician_id")
        t_start = seg.get("start", cur_end)
        t_end   = seg.get("end",   t_start)
        gap     = t_start - cur_end

        if pol_id != cur_pol or gap > gap_threshold:
            flush()
            cur_texts = []
            cur_pol   = pol_id
            cur_start = t_start
            cur_conf  = seg.get("confidence", 0.0)

        cur_texts.append(seg.get("text", ""))
        cur_end  = t_end

    flush()
    return turns


# ─── Mode: FILE ───────────────────────────────────────────────────────────────

def run_file(path: str):
    import whisper

    if not Path(path).exists():
        print(f"[worker] File not found: {path}")
        sys.exit(1)

    print(f"[worker] Loading Whisper '{WHISPER_MODEL}' …")
    model = whisper.load_model(WHISPER_MODEL)

    profiles = VoiceProfileDB()
    diarizer: Diarizer | None = None
    if HF_TOKEN and PYANNOTE_AVAILABLE and len(profiles) > 0:
        diarizer = Diarizer(HF_TOKEN, profiles)

    session_id = get_or_create_session(source_url=path)
    _process_session(path, date.today().isoformat(), model, diarizer)


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.")
        print("  export SUPABASE_URL=https://xxxxx.supabase.co")
        print("  export SUPABASE_SERVICE_KEY=<service_role_key>")
        sys.exit(1)

    mode = sys.argv[1] if len(sys.argv) > 1 else "live"

    if mode == "live":
        run_live()

    elif mode == "recent":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        run_recent(limit)

    elif mode == "file":
        if len(sys.argv) < 3:
            print("Usage: python ai_worker.py file <path>")
            sys.exit(1)
        run_file(sys.argv[2])

    else:
        print(__doc__)
        sys.exit(1)
