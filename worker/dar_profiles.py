#!/usr/bin/env python3
"""
dar_profiles.py — Auto-build voice profiles from DAR transcripts + ARTV video
==============================================================================
The Diário da Assembleia da República (DAR) Série I contains verbatim transcripts
of every plenary session, labelled by speaker name. By cross-referencing this
text with the diarized ARTV session video we can *automatically* identify which
audio segment belongs to which deputy — no manual labelling needed.

PIPELINE:
  1. Fetch recent plenary sessions list from the Parliament API.
  2. For each session, download the DAR-I XML transcript.
  3. Download the corresponding ARTV HLS video archive.
  4. Run pyannote speaker diarization on the full audio.
  5. Run Whisper on each diarized segment (≥15 s).
  6. Match Whisper text against DAR interventions using fuzzy similarity.
  7. When a match is found → the speaker is identified → embed the audio segment
     and add/update their voice profile in voice_profiles.json.
  8. Repeat until voice profiles are built for all known deputies.

USAGE:
  python dar_profiles.py auto [--sessions N] [--min-duration 15]
      Download the N most recent sessions (default: 5) and auto-build profiles.

  python dar_profiles.py sessions [--leg XVI]
      List available DAR sessions with their ARTV video URLs.

  python dar_profiles.py status
      Show how many deputies already have voice profiles.

REQUIREMENTS:
  pip install openai-whisper pyannote.audio torch torchaudio scipy yt-dlp ffmpeg-python
  export HF_TOKEN=hf_...
  export SUPABASE_URL=...
  export SUPABASE_SERVICE_KEY=...

TIPS:
  - Run with --sessions 1 first to test the pipeline on a single session.
  - Each session adds ~5–20 new deputy profiles depending on who spoke.
  - Re-running improves profiles for frequent speakers (embeddings are averaged).
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

# ─── Config ────────────────────────────────────────────────────────────────────

HF_TOKEN             = os.environ.get("HF_TOKEN", "")
SUPABASE_URL         = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Parliament APIs
DAR_SESSIONS_API  = "https://app.parlamento.pt/webutils/docs/DAR1Serie.aspx"
ARTV_ARCHIVE_BASE = "https://canal.parlamento.pt"

# Text similarity threshold: how similar must the Whisper text be to a DAR
# intervention for us to count it as a match?  0.35 = lenient, 0.55 = strict.
TEXT_SIM_THRESHOLD = float(os.environ.get("TEXT_SIM_THRESHOLD", "0.40"))

# Minimum audio duration (seconds) before we try to embed a segment
MIN_EMBED_SECS = float(os.environ.get("MIN_EMBED_SECS", "15.0"))

# Max audio to diarize per session (minutes) — saves time; first hour captures most speakers
MAX_SESSION_MINUTES = int(os.environ.get("MAX_SESSION_MINUTES", "60"))

# Ensure sibling modules importable
sys.path.insert(0, str(Path(__file__).parent))

# ─── Lazy imports (pyannote / whisper are heavy) ───────────────────────────────

def _import_diarizer():
    try:
        from diarization import VoiceProfileDB, Diarizer, PYANNOTE_AVAILABLE
        return VoiceProfileDB, Diarizer, PYANNOTE_AVAILABLE
    except ImportError as e:
        print(f"ERROR importing diarization module: {e}")
        sys.exit(1)


def _import_whisper():
    try:
        import whisper
        return whisper
    except ImportError:
        print("ERROR: openai-whisper not installed.")
        print("  pip install openai-whisper")
        sys.exit(1)


# ─── Supabase helpers ──────────────────────────────────────────────────────────

def _supa_get(path: str) -> list:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    req = urllib.request.Request(url, headers={
        "apikey":        SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception:
        return []


def _load_politicians() -> dict[str, dict]:
    """Return {normalized_name: {id, name, party}} from Supabase."""
    rows = _supa_get("politicians?select=id,name,party,bid")
    return {_normalize(r["name"]): r for r in rows}


def _normalize(text: str) -> str:
    """Lowercase, strip accents-ish, collapse whitespace for fuzzy name matching."""
    return re.sub(r"\s+", " ", text.strip().lower())


# ─── Parliament DAR API ─────────────────────────────────────────────────────────

def fetch_dar_sessions(leg: str = "XVI", n: int = 10) -> list[dict]:
    """
    Return a list of recent DAR-I plenary sessions.
    Each entry: {number, date, dar_xml_url, title}
    """
    url = f"{DAR_SESSIONS_API}?Leg={leg}&pType=ata"
    print(f"Fetching DAR session list: {url}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "parlamento-vivo/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
    except Exception as e:
        print(f"  ERROR: {e}")
        return []

    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        print("  ERROR: could not parse DAR session XML")
        return []

    # Strip namespaces
    for elem in root.iter():
        if "}" in elem.tag:
            elem.tag = elem.tag.split("}")[-1]

    sessions = []
    for node in root.iter():
        num   = _first_text(node, ["numero", "Numero", "num"])
        date  = _first_text(node, ["data", "Data", "date"])
        doc_url = _first_text(node, ["urlFicheiro", "UrlFicheiro", "url", "URL"])
        title = _first_text(node, ["titulo", "Titulo", "title"])
        if num and date:
            sessions.append({
                "number": num,
                "date":   date,
                "dar_xml_url": doc_url or "",
                "title": title or f"Sessão {num}",
            })

    # Most recent first
    sessions.sort(key=lambda s: s["date"], reverse=True)
    print(f"  Found {len(sessions)} sessions, using latest {n}.")
    return sessions[:n]


def _first_text(node: ET.Element, tags: list[str]) -> Optional[str]:
    for t in tags:
        c = node.find(t)
        if c is not None and c.text and c.text.strip():
            return c.text.strip()
    return None


def fetch_dar_interventions(xml_url: str) -> list[dict]:
    """
    Download and parse a DAR-I XML file.
    Returns list of {speaker_name, text, start_seconds (if available)}.
    """
    if not xml_url:
        return []
    print(f"  Fetching DAR XML: {xml_url}")
    try:
        req = urllib.request.Request(xml_url, headers={"User-Agent": "parlamento-vivo/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
    except Exception as e:
        print(f"    ERROR fetching DAR XML: {e}")
        return []

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        print(f"    ERROR parsing DAR XML: {e}")
        return []

    # Strip namespaces
    for elem in root.iter():
        if "}" in elem.tag:
            elem.tag = elem.tag.split("}")[-1]

    interventions = []
    # Common DAR XML patterns for speaker + text
    tag_sets = [
        # Pattern A: <intervencao><orador>Name</orador><texto>...</texto></intervencao>
        ("intervencao", "orador",   "texto"),
        # Pattern B: <Interveniente><Nome>Name</Nome><Texto>...</Texto></Interveniente>
        ("Interveniente", "Nome",   "Texto"),
        # Pattern C: <p class="orador">Name</p> followed by <p class="texto">
        ("INTERVENCAO",  "ORADOR",  "TEXTO"),
        # Pattern D: <interveniente><depNome>Name</depNome><discurso>
        ("interveniente", "depNome", "discurso"),
        ("intervencao",   "nome",    "texto"),
    ]

    for container, name_tag, text_tag in tag_sets:
        for node in root.iter(container):
            speaker_name = _first_text(node, [name_tag, name_tag.lower(), name_tag.upper()])
            text_elem    = node.find(text_tag) or node.find(text_tag.lower()) or node.find(text_tag.upper())
            text_content = _extract_text(text_elem) if text_elem is not None else None
            if speaker_name and text_content and len(text_content) > 20:
                # Try to get timing (ata format may have hh:mm:ss)
                start_sec = _parse_time(_first_text(node, ["inicio", "start", "Inicio", "hora"]))
                interventions.append({
                    "speaker_name":  speaker_name.strip(),
                    "text":          text_content.strip(),
                    "start_seconds": start_sec,
                })
        if interventions:
            break

    print(f"    Parsed {len(interventions)} interventions.")
    return interventions


def _extract_text(elem: ET.Element) -> str:
    """Get all text recursively from an XML element."""
    parts = []
    if elem.text:
        parts.append(elem.text)
    for child in elem:
        parts.append(_extract_text(child))
        if child.tail:
            parts.append(child.tail)
    return " ".join(p.strip() for p in parts if p.strip())


def _parse_time(s: Optional[str]) -> Optional[float]:
    """Parse 'HH:MM:SS' or 'MM:SS' to seconds, or None."""
    if not s:
        return None
    parts = s.strip().split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
    except ValueError:
        pass
    return None


# ─── ARTV video helpers ─────────────────────────────────────────────────────────

def find_artv_url_for_session(session_date: str, session_num: str) -> Optional[str]:
    """
    Try to find the ARTV archive HLS URL for a given session date.
    Uses yt-dlp or the ARTV API to locate the stream.
    """
    # Try the parlamento.pt canonical archive URL first
    # The ARTV archive usually has URLs in the form:
    # https://canal.parlamento.pt/vod/{date}/{session_num}
    candidate_urls = [
        f"{ARTV_ARCHIVE_BASE}/vod/{session_date.replace('-', '/')}/plenario",
        f"{ARTV_ARCHIVE_BASE}/plenario/{session_num}",
        f"https://www.parlamento.pt/sites/COM/Paginas/Plenario.aspx?id={session_num}",
    ]

    for url in candidate_urls:
        try:
            result = subprocess.run(
                ["yt-dlp", "--get-url", "--quiet", url],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0 and ".m3u8" in result.stdout:
                hls_url = result.stdout.strip().split("\n")[0]
                print(f"    Found ARTV URL via yt-dlp: {hls_url[:80]}…")
                return hls_url
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue

    return None


def download_audio_segment(hls_url: str, start: float, duration: float) -> Optional[str]:
    """
    Download a segment of HLS stream to a temporary WAV file.
    Returns path to WAV file or None on failure.
    """
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(int(start)),
            "-i", hls_url,
            "-t", str(int(duration) + 5),  # a little extra
            "-vn", "-ar", "16000", "-ac", "1",
            "-f", "wav", tmp.name,
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=120)
        if result.returncode == 0 and Path(tmp.name).stat().st_size > 10_000:
            return tmp.name
    except Exception as e:
        print(f"    [ffmpeg] {e}")
    try:
        os.unlink(tmp.name)
    except OSError:
        pass
    return None


def download_full_audio(hls_url: str, max_minutes: int = 60) -> Optional[str]:
    """Download up to max_minutes of a session audio to a WAV temp file."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        cmd = [
            "ffmpeg", "-y",
            "-i", hls_url,
            "-t", str(max_minutes * 60),
            "-vn", "-ar", "16000", "-ac", "1",
            "-f", "wav", tmp.name,
        ]
        print(f"    Downloading {max_minutes} min of audio …", end="", flush=True)
        result = subprocess.run(cmd, capture_output=True, timeout=max_minutes * 90)
        if result.returncode == 0 and Path(tmp.name).stat().st_size > 100_000:
            size_mb = Path(tmp.name).stat().st_size / 1e6
            print(f" {size_mb:.1f} MB")
            return tmp.name
        print(" FAILED")
    except subprocess.TimeoutExpired:
        print(" timeout")
    except Exception as e:
        print(f" error: {e}")
    try:
        os.unlink(tmp.name)
    except OSError:
        pass
    return None


# ─── Text matching ─────────────────────────────────────────────────────────────

def text_similarity(a: str, b: str) -> float:
    """
    Sequence-matcher similarity between two text strings.
    Normalised to [0, 1].  0.4+ is a reasonable match for parliamentary speech.
    """
    a_words = a.lower().split()[:60]   # use first 60 words to speed things up
    b_words = b.lower().split()[:60]
    if not a_words or not b_words:
        return 0.0
    sm = difflib.SequenceMatcher(None, " ".join(a_words), " ".join(b_words))
    return sm.ratio()


def match_segment_to_dar(
    whisper_text: str,
    dar_interventions: list[dict],
    exclude_used: set[int],
) -> tuple[Optional[dict], int, float]:
    """
    Find the DAR intervention whose text best matches the Whisper transcription.
    Returns (intervention, index, similarity_score) or (None, -1, 0.0).
    """
    best_score = TEXT_SIM_THRESHOLD
    best_idx   = -1
    best_match = None

    for i, intvn in enumerate(dar_interventions):
        if i in exclude_used:
            continue
        score = text_similarity(whisper_text, intvn["text"])
        if score > best_score:
            best_score = score
            best_idx   = i
            best_match = intvn

    return best_match, best_idx, best_score


# ─── Main pipeline ─────────────────────────────────────────────────────────────

def process_session(
    session: dict,
    db,              # VoiceProfileDB
    diarizer,        # Diarizer
    whisper_model,
    politicians: dict[str, dict],
    new_profiles: dict,  # mut: tracks new profiles added this run
) -> int:
    """
    Process one plenary session: diarize → transcribe → match → embed.
    Returns number of new speaker profiles added.
    """
    date   = session["date"]
    num    = session["number"]
    print(f"\n{'─'*60}")
    print(f"Session {num}  ({date})")
    print(f"{'─'*60}")

    # 1. Get DAR transcript
    interventions = fetch_dar_interventions(session.get("dar_xml_url", ""))
    if not interventions:
        print("  No DAR interventions — skipping.")
        return 0

    # 2. Find ARTV archive URL
    hls_url = find_artv_url_for_session(date, num)
    if not hls_url:
        print("  Could not find ARTV archive URL — skipping.")
        return 0

    # 3. Download audio
    audio_path = download_full_audio(hls_url, MAX_SESSION_MINUTES)
    if not audio_path:
        print("  Audio download failed — skipping.")
        return 0

    try:
        return _process_audio(
            audio_path, interventions, db, diarizer, whisper_model,
            politicians, new_profiles,
        )
    finally:
        try:
            os.unlink(audio_path)
        except OSError:
            pass


def _process_audio(
    audio_path: str,
    dar_interventions: list[dict],
    db,
    diarizer,
    whisper_model,
    politicians: dict[str, dict],
    new_profiles: dict,
) -> int:
    """Inner pipeline: diarize → transcribe → match → embed."""
    import whisper as whisper_module  # already loaded

    # 4. Diarize
    print("  Running speaker diarization …")
    segments = diarizer.diarize(audio_path)
    if not segments:
        print("  No segments returned from diarizer.")
        return 0

    # Group by speaker label, build per-speaker segment list
    from collections import defaultdict
    by_speaker: dict[str, list[dict]] = defaultdict(list)
    for seg in segments:
        if (seg["end"] - seg["start"]) >= MIN_EMBED_SECS:
            by_speaker[seg["speaker_label"]].append(seg)

    print(f"  {len(by_speaker)} distinct speakers, {len(segments)} total segments.")

    added = 0
    used_dar_idx: set[int] = set()

    for speaker_label, spk_segs in by_speaker.items():
        # Already identified by voice profiles?
        pol_id_known = spk_segs[0].get("politician_id")
        if pol_id_known:
            pol_name = db.metadata.get(pol_id_known, {}).get("name", "?")
            print(f"  {speaker_label}: already known → {pol_name}")
            continue

        # Pick the longest segment for transcription (best quality)
        longest = max(spk_segs, key=lambda s: s["end"] - s["start"])
        start, end = longest["start"], longest["end"]
        duration = end - start
        if duration < MIN_EMBED_SECS:
            continue

        # 5. Transcribe with Whisper
        print(f"  {speaker_label} [{start:.0f}s–{end:.0f}s]: transcribing …", end="", flush=True)
        try:
            result = whisper_model.transcribe(
                audio_path,
                language="pt",
                initial_prompt="Assembleia da República, Portugal.",
                clip_timestamps=[start, end],
                verbose=False,
            )
            whisper_text = result.get("text", "").strip()
        except Exception as e:
            print(f" whisper error: {e}")
            continue

        if len(whisper_text.split()) < 8:
            print(" too short")
            continue
        print(f" ✓ ({len(whisper_text.split())} words)")

        # 6. Match to DAR
        match, dar_idx, score = match_segment_to_dar(whisper_text, dar_interventions, used_dar_idx)
        if not match:
            print(f"    → No DAR match (best sim < {TEXT_SIM_THRESHOLD})")
            continue

        speaker_name = match["speaker_name"]
        used_dar_idx.add(dar_idx)
        print(f"    → DAR match: '{speaker_name}' (sim={score:.2f})")

        # 7. Find politician in DB
        pol = _find_politician(speaker_name, politicians)
        if not pol:
            print(f"    → '{speaker_name}' not in DB — adding as new deputy …")
            pol = _create_politician(speaker_name)
            if pol:
                politicians[_normalize(pol["name"])] = pol

        if not pol:
            print(f"    → Could not create politician record for '{speaker_name}'")
            continue

        pol_id = pol["id"]

        # 8. Embed the audio segment and add to voice profile
        print(f"    → Embedding audio for {pol['name']} …", end="", flush=True)
        try:
            embedding = diarizer.embed_clip(audio_path, start, end)
            db.add(pol_id, embedding, name=pol["name"], party=pol.get("party", ""))
            new_profiles[pol_id] = pol["name"]
            added += 1
            print(" ✓")
        except Exception as e:
            print(f" error: {e}")

        time.sleep(0.1)

    return added


def _find_politician(speaker_name: str, politicians: dict[str, dict]) -> Optional[dict]:
    """Fuzzy-match speaker name from DAR against known politicians."""
    norm = _normalize(speaker_name)

    # Exact match
    if norm in politicians:
        return politicians[norm]

    # Partial match: check if name is a suffix/prefix (common in DAR — first name only)
    for key, pol in politicians.items():
        if norm in key or key in norm:
            return pol

    # Difflib close match
    matches = difflib.get_close_matches(norm, list(politicians.keys()), n=1, cutoff=0.70)
    if matches:
        return politicians[matches[0]]

    return None


def _create_politician(name: str) -> Optional[dict]:
    """Create a minimal politician record in Supabase and return it."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return None
    try:
        row = {"name": name, "party": "?"}
        data = json.dumps([row]).encode()
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/politicians",
            data=data, method="POST",
            headers={
                "apikey":        SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type":  "application/json",
                "Prefer":        "return=representation",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            rows = json.loads(r.read())
        if rows:
            return rows[0]
    except Exception as e:
        print(f"    [create_politician] {e}")
    return None


# ─── Commands ──────────────────────────────────────────────────────────────────

def cmd_auto(n_sessions: int = 5, leg: str = "XVI"):
    VoiceProfileDB, Diarizer, PYANNOTE_AVAILABLE = _import_diarizer()
    if not PYANNOTE_AVAILABLE:
        print("ERROR: pyannote.audio not installed.")
        print("  pip install pyannote.audio torch torchaudio scipy")
        sys.exit(1)
    if not HF_TOKEN:
        print("ERROR: Set HF_TOKEN (HuggingFace access token).")
        sys.exit(1)

    whisper = _import_whisper()

    print("Loading Whisper model (base) …")
    whisper_model = whisper.load_model("base")

    db       = VoiceProfileDB()
    diarizer = Diarizer(HF_TOKEN, db)

    print(f"\nLoading politicians from Supabase …")
    politicians = _load_politicians()
    print(f"  {len(politicians)} politicians in DB.")

    sessions = fetch_dar_sessions(leg=leg, n=n_sessions)
    if not sessions:
        print("No sessions found. Check your network / parliament API access.")
        sys.exit(1)

    new_profiles: dict[str, str] = {}
    total_added = 0

    for session in sessions:
        added = process_session(session, db, diarizer, whisper_model, politicians, new_profiles)
        total_added += added

    print(f"\n{'═'*60}")
    print(f"Done!  {total_added} new voice profiles added across {len(sessions)} sessions.")
    if new_profiles:
        print("\nNew profiles:")
        for pid, name in new_profiles.items():
            print(f"  • {name}")
    print(f"\nTotal profiles in DB: {len(db)}")


def cmd_sessions(leg: str = "XVI"):
    sessions = fetch_dar_sessions(leg=leg, n=20)
    if not sessions:
        print("No sessions found.")
        return
    print(f"\n{'NUM':<8} {'DATE':<12} {'TITLE'}")
    print("─" * 70)
    for s in sessions:
        print(f"{s['number']:<8} {s['date']:<12} {s['title'][:50]}")


def cmd_status():
    VoiceProfileDB, _, _ = _import_diarizer()
    db = VoiceProfileDB()
    profiles = db.list_profiles()
    if not profiles:
        print("No voice profiles yet. Run: python dar_profiles.py auto")
        return
    total_pols = len(_load_politicians())
    print(f"\nVoice profiles: {len(profiles)} / {total_pols} deputies")
    print()
    for p in sorted(profiles, key=lambda x: x.get("name", "")):
        samples = p.get("samples", 0)
        quality = "▓" * min(samples, 5) + "░" * max(0, 5 - samples)
        print(f"  {quality}  {p.get('name', p['id'][:8])}  ({p.get('party', '?')})"
              f"  {samples} sample{'s' if samples != 1 else ''}")


# ─── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Auto-build deputy voice profiles from DAR transcripts + ARTV video"
    )
    sub = parser.add_subparsers(dest="cmd")

    p_auto = sub.add_parser("auto", help="Auto-build profiles from recent sessions")
    p_auto.add_argument("--sessions",    type=int, default=5, help="Number of sessions (default: 5)")
    p_auto.add_argument("--leg",         default="XVI",       help="Legislature (default: XVI)")
    p_auto.add_argument("--min-duration", type=float, default=15.0,
                        help="Min segment seconds to embed (default: 15)")

    p_sess = sub.add_parser("sessions", help="List available DAR sessions")
    p_sess.add_argument("--leg", default="XVI")

    sub.add_parser("status", help="Show current voice profile coverage")

    args = parser.parse_args()

    if args.cmd == "auto":
        MIN_EMBED_SECS = args.min_duration
        cmd_auto(n_sessions=args.sessions, leg=args.leg)
    elif args.cmd == "sessions":
        cmd_sessions(leg=args.leg)
    elif args.cmd == "status":
        cmd_status()
    else:
        parser.print_help()
