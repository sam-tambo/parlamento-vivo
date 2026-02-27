#!/usr/bin/env python3
"""
build_profiles.py — Voice profile builder for Portuguese deputies
=================================================================
Builds a voice_profiles.json database so the AI worker can attribute
transcript segments to specific deputies.

SETUP (one-time):
  1. Get a HuggingFace token: https://huggingface.co/settings/tokens
  2. Accept the model licenses:
       https://huggingface.co/pyannote/speaker-diarization-3.1
       https://huggingface.co/pyannote/embedding
  3. Export env vars:
       export HF_TOKEN=hf_...
       export SUPABASE_URL=https://...
       export SUPABASE_SERVICE_KEY=...

COMMANDS:
  python build_profiles.py list
      Show all profiles already built.

  python build_profiles.py add <politician_id> <audio_file> [start_sec] [end_sec]
      Embed a local audio/video clip (extract [start, end] window).
      Can be called multiple times to average over multiple clips.
      Example:
        python build_profiles.py add <uuid> speech.wav 12.5 45.0

  python build_profiles.py download <politician_id> <video_url>
      Download audio from any URL supported by yt-dlp (YouTube, ARTV, etc.)
      and add as a profile. Uses the first 90 seconds of clean speech.
      Example:
        python build_profiles.py download <uuid> https://www.youtube.com/watch?v=...

  python build_profiles.py auto <video_url>
      Download a session video, run diarization, then interactively label
      each discovered speaker so you can quickly build profiles from real
      Plenário footage.

  python build_profiles.py verify <audio_file>
      Run identification on a test clip and show the top match.

  python build_profiles.py delete <politician_id>
      Remove a profile.

  python build_profiles.py dar auto [--sessions N]
      Auto-build profiles from DAR transcripts + ARTV archive (no manual labels needed).
      Equivalent to: python dar_profiles.py auto --sessions N

  python build_profiles.py dar status
      Show voice profile coverage across all deputies.

HOW TO FIND GOOD TRAINING CLIPS:
  - ARTV archive: canal.parlamento.pt/plenario (select a past session)
  - YouTube: search "Pedro Nuno Santos Assembleia República" for a clean clip
  - Use `start` / `end` to pick a window where that deputy is clearly speaking
    without interruptions (aim for 30–120 seconds of clean audio).
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HF_TOKEN             = os.environ.get("HF_TOKEN", "")
SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Ensure sibling modules importable
sys.path.insert(0, str(Path(__file__).parent))
from diarization import VoiceProfileDB, Diarizer, PYANNOTE_AVAILABLE


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _require_hf():
    if not HF_TOKEN:
        print("ERROR: Set HF_TOKEN (HuggingFace token).")
        print("  export HF_TOKEN=hf_...")
        sys.exit(1)


def _require_pyannote():
    if not PYANNOTE_AVAILABLE:
        print("ERROR: pyannote.audio not installed.")
        print("  pip install pyannote.audio torch torchaudio scipy")
        sys.exit(1)


def _fetch_politician(pol_id: str) -> dict:
    """Fetch name/party from Supabase (best-effort)."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return {"name": pol_id, "party": ""}
    try:
        import urllib.request
        url = f"{SUPABASE_URL}/rest/v1/politicians?id=eq.{pol_id}&select=name,party"
        req = urllib.request.Request(url, headers={
            "apikey":        SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            rows = json.loads(resp.read())
        if rows:
            return {"name": rows[0]["name"], "party": rows[0]["party"]}
    except Exception:
        pass
    return {"name": pol_id, "party": ""}


def _to_wav(src: str, start: float = 0.0, end: float | None = None) -> str:
    """Convert any media file to a 16 kHz mono WAV. Returns temp file path."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    cmd = ["ffmpeg", "-y", "-i", src]
    if start > 0:
        cmd += ["-ss", str(start)]
    if end is not None:
        cmd += ["-t", str(end - start)]
    cmd += ["-vn", "-ar", "16000", "-ac", "1", "-f", "wav", tmp.name]
    subprocess.run(cmd, capture_output=True, check=True)
    return tmp.name


def _download_audio(url: str) -> str:
    """Download audio from a URL via yt-dlp. Returns WAV temp file path."""
    tmp = tempfile.mktemp(suffix=".wav")
    subprocess.run(
        [
            "yt-dlp", "-x",
            "--audio-format", "wav",
            "--postprocessor-args", "ffmpeg:-ar 16000 -ac 1",
            "-o", tmp,
            url,
        ],
        check=True,
    )
    if not Path(tmp).exists():
        # yt-dlp may add extension
        candidates = list(Path(tmp).parent.glob(Path(tmp).stem + ".*"))
        if candidates:
            return str(candidates[0])
        raise FileNotFoundError(f"yt-dlp output not found near {tmp}")
    return tmp


# ─── Commands ────────────────────────────────────────────────────────────────

def cmd_list():
    db = VoiceProfileDB()
    profiles = db.list_profiles()
    if not profiles:
        print("No voice profiles yet.\n")
        print("Get started:")
        print("  python build_profiles.py download <politician_id> <youtube_url>")
        return

    print(f"\n{'ID'[:36]:<36}  {'NAME':<30}  {'PARTY':<6}  SAMPLES")
    print("-" * 84)
    for p in profiles:
        print(f"{p['id']:<36}  {p.get('name', ''):<30}  {p.get('party', ''):<6}  {p.get('samples', 0)}")
    print(f"\nTotal: {len(profiles)} profiles · voice_profiles.json: {VoiceProfileDB().path}")


def cmd_add(pol_id: str, audio_file: str,
            start: float = 0.0, end: float | None = None):
    _require_hf()
    _require_pyannote()

    db = VoiceProfileDB()
    diarizer = Diarizer(HF_TOKEN, db)

    print(f"Extracting embedding from {audio_file} [{start}s → {end or 'end'}s] …")
    wav = _to_wav(audio_file, start, end)
    try:
        emb = diarizer.embed_clip(wav, 0.0)
    finally:
        os.unlink(wav)

    meta = _fetch_politician(pol_id)
    db.add(pol_id, emb, name=meta["name"], party=meta["party"])
    print(f"✓ Profile saved for {meta['name']} ({meta['party']}) — {len(db)} total profiles.")


def cmd_download(pol_id: str, url: str):
    _require_hf()
    _require_pyannote()

    print(f"Downloading audio from:\n  {url}")
    raw = _download_audio(url)
    try:
        # Use first 90 seconds — enough for a good embedding
        cmd_add(pol_id, raw, start=0.0, end=90.0)
    finally:
        try:
            os.unlink(raw)
        except OSError:
            pass


def cmd_auto(video_url: str):
    """
    Download a session, diarize it, then interactively label each speaker
    so you can rapidly build profiles from real parliamentary footage.
    """
    _require_hf()
    _require_pyannote()

    db       = VoiceProfileDB()
    diarizer = Diarizer(HF_TOKEN, db)

    print(f"Downloading session audio from:\n  {video_url}")
    raw = _download_audio(video_url)

    # Only diarize the first 10 minutes (enough to identify main speakers)
    wav = _to_wav(raw, 0.0, 600.0)
    os.unlink(raw)

    try:
        print("Running speaker diarization on first 10 minutes …")
        segments = diarizer.diarize(wav)

        # Group by speaker label, keep only first large segment per speaker
        seen: dict[str, dict] = {}
        for seg in segments:
            lbl = seg["speaker_label"]
            dur = seg["end"] - seg["start"]
            if lbl not in seen or dur > (seen[lbl]["end"] - seen[lbl]["start"]):
                seen[lbl] = seg

        print(f"\nFound {len(seen)} distinct speakers.\n")

        for lbl, seg in sorted(seen.items()):
            print(f"Speaker {lbl} — {seg['start']:.0f}s → {seg['end']:.0f}s")
            if seg["politician_id"]:
                name = db.metadata.get(seg["politician_id"], {}).get("name", seg["politician_id"])
                print(f"  Already identified as: {name}")
                continue

            print("  Who is this? Enter politician UUID (from Supabase), or press Enter to skip:")
            pol_id = input("  > ").strip()
            if not pol_id:
                continue

            emb = diarizer.embed_clip(wav, seg["start"], seg["end"])
            meta = _fetch_politician(pol_id)
            db.add(pol_id, emb, name=meta["name"], party=meta["party"])
            print(f"  ✓ Saved profile for {meta['name']}")

    finally:
        os.unlink(wav)

    print(f"\nDone! {len(db)} profiles total.")


def cmd_verify(audio_file: str):
    _require_hf()
    _require_pyannote()

    db = VoiceProfileDB()
    if not db.embeddings:
        print("No profiles yet. Build some first.")
        return

    diarizer = Diarizer(HF_TOKEN, db)
    wav = _to_wav(audio_file)
    try:
        emb = diarizer.embed_clip(wav)
    finally:
        os.unlink(wav)

    pol_id, conf = db.identify(emb)
    if pol_id:
        meta = db.metadata.get(pol_id, {})
        print(f"Match: {meta.get('name', pol_id)} ({meta.get('party', '?')}) — confidence {conf:.2f}")
    else:
        print(f"No match (best confidence was below threshold {db.__class__.__module__}.SIMILARITY_THRESHOLD).")


def cmd_delete(pol_id: str):
    db = VoiceProfileDB()
    if pol_id not in db.embeddings:
        print(f"No profile found for {pol_id}")
        return
    name = db.metadata.get(pol_id, {}).get("name", pol_id)
    del db.embeddings[pol_id]
    db.metadata.pop(pol_id, None)
    db.save()
    print(f"✓ Deleted profile for {name}.")


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == "list":
        cmd_list()

    elif cmd == "add":
        if len(sys.argv) < 4:
            print("Usage: python build_profiles.py add <politician_id> <audio_file> [start] [end]")
            sys.exit(1)
        cmd_add(
            sys.argv[2],
            sys.argv[3],
            float(sys.argv[4]) if len(sys.argv) > 4 else 0.0,
            float(sys.argv[5]) if len(sys.argv) > 5 else None,
        )

    elif cmd == "download":
        if len(sys.argv) < 4:
            print("Usage: python build_profiles.py download <politician_id> <url>")
            sys.exit(1)
        cmd_download(sys.argv[2], sys.argv[3])

    elif cmd == "auto":
        if len(sys.argv) < 3:
            print("Usage: python build_profiles.py auto <video_url>")
            sys.exit(1)
        cmd_auto(sys.argv[2])

    elif cmd == "verify":
        if len(sys.argv) < 3:
            print("Usage: python build_profiles.py verify <audio_file>")
            sys.exit(1)
        cmd_verify(sys.argv[2])

    elif cmd == "delete":
        if len(sys.argv) < 3:
            print("Usage: python build_profiles.py delete <politician_id>")
            sys.exit(1)
        cmd_delete(sys.argv[2])

    elif cmd == "dar":
        # Delegate to dar_profiles.py — pass remaining args through
        import subprocess as _sp
        _sp.run(
            [sys.executable, str(Path(__file__).parent / "dar_profiles.py")]
            + (sys.argv[2:] or ["auto"]),
            check=False,
        )

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)
