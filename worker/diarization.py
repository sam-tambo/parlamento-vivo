#!/usr/bin/env python3
"""
diarization.py — Speaker diarization + voice profile matching
=============================================================
Uses pyannote.audio 3.x for:
  1. Speaker diarization: who speaks when (SPEAKER_00, SPEAKER_01 …)
  2. Speaker embedding: encode a voice segment as a fixed-length vector
  3. Voice profile DB: map embeddings → politician IDs via cosine similarity

Requires a HuggingFace token with access to the pyannote gated models:
  pyannote/speaker-diarization-3.1
  pyannote/embedding

Get your token at: https://huggingface.co/settings/tokens
Accept model licenses at:
  https://huggingface.co/pyannote/speaker-diarization-3.1
  https://huggingface.co/pyannote/embedding
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

import numpy as np

# Graceful import — diarization is optional
try:
    import torch
    from pyannote.audio import Pipeline, Model, Audio
    from pyannote.core import Segment
    from scipy.spatial.distance import cosine as cosine_distance
    PYANNOTE_AVAILABLE = True
except ImportError:
    PYANNOTE_AVAILABLE = False

PROFILES_PATH = Path(__file__).parent / "voice_profiles.json"

# Cosine distance below this threshold → identified speaker
# Lower = stricter matching. 0.20–0.30 is typical.
SIMILARITY_THRESHOLD = float(os.environ.get("VOICE_THRESHOLD", "0.25"))

# Minimum segment duration (seconds) to bother embedding
MIN_EMBED_SECONDS = 2.0


# ─── Voice profile database ───────────────────────────────────────────────────

class VoiceProfileDB:
    """
    JSON-backed store of speaker voice embeddings, keyed by politician UUID.

    Schema of voice_profiles.json:
      {
        "embeddings": { "<pol_uuid>": [float, ...], ... },
        "metadata":   { "<pol_uuid>": {"name": str, "party": str, "samples": int}, ... }
      }
    """

    def __init__(self, path: Path = PROFILES_PATH):
        self.path = path
        self.embeddings: dict[str, list[float]] = {}
        self.metadata:   dict[str, dict]        = {}
        self._load()

    def _load(self):
        if self.path.exists():
            data = json.loads(self.path.read_text())
            self.embeddings = data.get("embeddings", {})
            self.metadata   = data.get("metadata", {})

    def save(self):
        self.path.write_text(
            json.dumps({"embeddings": self.embeddings, "metadata": self.metadata}, indent=2)
        )

    def add(self, politician_id: str, embedding: np.ndarray,
            name: str = "", party: str = ""):
        """
        Add or update a voice profile.
        When a profile already exists, the new embedding is averaged in
        (online mean) to represent the speaker better over time.
        """
        vec = embedding.flatten()
        if politician_id in self.embeddings:
            existing = np.array(self.embeddings[politician_id])
            n = self.metadata.get(politician_id, {}).get("samples", 1)
            vec = (existing * n + vec) / (n + 1)          # running mean
        self.embeddings[politician_id] = vec.tolist()
        prev = self.metadata.get(politician_id, {"samples": 0})
        self.metadata[politician_id] = {
            "name":    name  or prev.get("name", politician_id),
            "party":   party or prev.get("party", ""),
            "samples": prev["samples"] + 1,
        }
        self.save()

    def identify(self, embedding: np.ndarray) -> tuple[Optional[str], float]:
        """
        Return (politician_id, confidence ∈ [0,1]) for the closest profile,
        or (None, 0.0) if no profiles exist or best distance > threshold.
        """
        if not self.embeddings:
            return None, 0.0

        vec = embedding.flatten()
        best_id   = None
        best_dist = float("inf")

        for pol_id, stored in self.embeddings.items():
            dist = cosine_distance(vec, np.array(stored))
            if dist < best_dist:
                best_dist = dist
                best_id   = pol_id

        if best_dist <= SIMILARITY_THRESHOLD:
            confidence = round(1.0 - best_dist, 3)
            return best_id, confidence
        return None, 0.0

    def list_profiles(self) -> list[dict]:
        return [
            {"id": pid, **self.metadata.get(pid, {})}
            for pid in self.embeddings
        ]

    def __len__(self) -> int:
        return len(self.embeddings)


# ─── Diarizer ─────────────────────────────────────────────────────────────────

class Diarizer:
    """
    Wraps pyannote.audio to:
      1. Diarize an audio file (who speaks when)
      2. Embed each speaker's voice
      3. Match embeddings against VoiceProfileDB to identify deputies

    Args:
        hf_token: HuggingFace token with access to pyannote gated models.
        profiles:  VoiceProfileDB instance (shared with build_profiles.py).
    """

    def __init__(self, hf_token: str, profiles: VoiceProfileDB):
        if not PYANNOTE_AVAILABLE:
            raise ImportError(
                "pyannote.audio not installed. Run:\n"
                "  pip install pyannote.audio torch torchaudio scipy"
            )

        self.profiles = profiles
        self.device   = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        print(f"[diarizer] Device: {self.device}")
        print("[diarizer] Loading pyannote/speaker-diarization-3.1 …")
        self.pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token,
        ).to(self.device)

        print("[diarizer] Loading pyannote/embedding …")
        self.emb_model = Model.from_pretrained(
            "pyannote/embedding",
            use_auth_token=hf_token,
        ).to(self.device)
        self.emb_model.eval()

        self._audio = Audio(sample_rate=16000, mono=True)

    # ── Core diarization ────────────────────────────────────────────────────

    def diarize(self, audio_path: str) -> list[dict]:
        """
        Run full diarization on an audio file.

        Returns a list of segments:
          {
            "start":        float,           # seconds
            "end":          float,
            "speaker_label": str,            # pyannote SPEAKER_xx label
            "politician_id": str | None,     # matched deputy UUID or None
            "confidence":   float,           # 0.0–1.0; 0 = unidentified
          }

        Each unique speaker in the audio is embedded (via averaged 2-s+ clips)
        and compared against the voice profile database.
        """
        print(f"[diarizer] Diarizing {audio_path} …", flush=True)
        diarization = self.pipeline(audio_path)

        # Collect raw segments + gather embeddings per speaker label
        raw_segments: list[dict] = []
        speaker_embs: dict[str, list[np.ndarray]] = {}

        for turn, _, speaker in diarization.itertracks(yield_label=True):
            duration = turn.end - turn.start
            if duration < 0.3:
                continue

            raw_segments.append({
                "start":         round(turn.start, 2),
                "end":           round(turn.end,   2),
                "speaker_label": speaker,
                "politician_id": None,
                "confidence":    0.0,
            })

            if duration >= MIN_EMBED_SECONDS:
                try:
                    emb = self._embed_segment(audio_path, turn.start, turn.end)
                    speaker_embs.setdefault(speaker, []).append(emb)
                except Exception as e:
                    print(f"[diarizer] embed error ({speaker}): {e}", flush=True)

        # Average per-speaker embeddings → identify
        speaker_id: dict[str, tuple[Optional[str], float]] = {}
        for speaker, embs in speaker_embs.items():
            avg = np.mean(embs, axis=0)
            pol_id, conf = self.profiles.identify(avg)
            speaker_id[speaker] = (pol_id, conf)
            label = self.profiles.metadata.get(pol_id, {}).get("name", "?") if pol_id else "unknown"
            print(f"[diarizer]   {speaker} → {label} (conf={conf:.2f})", flush=True)

        # Annotate segments
        for seg in raw_segments:
            lbl = seg["speaker_label"]
            if lbl in speaker_id:
                pol_id, conf = speaker_id[lbl]
                seg["politician_id"] = pol_id
                seg["confidence"]    = conf

        return raw_segments

    # ── Embedding ────────────────────────────────────────────────────────────

    def embed_clip(self, audio_path: str,
                   start: float = 0.0, end: Optional[float] = None) -> np.ndarray:
        """
        Return a speaker embedding vector for the specified segment.
        If start/end are omitted, embeds the entire file.
        """
        return self._embed_segment(audio_path, start, end)

    def _embed_segment(self, audio_path: str,
                       start: float, end: Optional[float]) -> np.ndarray:
        if end is not None:
            waveform, _ = self._audio.crop(audio_path, Segment(start, end))
        else:
            waveform, _ = self._audio(audio_path)

        with torch.no_grad():
            emb = self.emb_model(waveform[None].to(self.device))
        return emb.cpu().numpy().flatten()


# ─── Alignment helper (used by ai_worker) ────────────────────────────────────

def align_whisper_to_diarization(
    whisper_segments: list[dict],
    diar_segments:    list[dict],
) -> list[dict]:
    """
    Merge Whisper transcript segments with diarization segments.

    For each Whisper segment, find the diarization speaker that overlaps most.
    Returns Whisper segments augmented with politician_id and confidence.

    Args:
        whisper_segments: list of {"start", "end", "text"} from Whisper
        diar_segments:    list of {"start", "end", "politician_id", "confidence", ...}
    """
    result = []

    for w in whisper_segments:
        w_start, w_end = w["start"], w["end"]
        best_overlap = 0.0
        best_pol_id  = None
        best_conf    = 0.0

        for d in diar_segments:
            # Overlap length
            overlap = max(0.0, min(w_end, d["end"]) - max(w_start, d["start"]))
            if overlap > best_overlap:
                best_overlap = overlap
                best_pol_id  = d["politician_id"]
                best_conf    = d["confidence"]

        result.append({
            **w,
            "politician_id": best_pol_id,
            "confidence":    best_conf,
        })

    return result
