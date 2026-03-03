#!/usr/bin/env python3
"""
dar_analyzer.py — AI-powered session analysis using Claude
===========================================================
Fetches parsed session data from Supabase and uses the Anthropic API to generate:
  - summary_pt: 2-minute Portuguese summary for citizens
  - summary_en: English translation
  - key_decisions: structured list of main votes/decisions
  - notable_moments: mic cutoffs, heated exchanges, party splits
  - party_positions: per-topic party stance upserted to party_positions table

USAGE:
  python dar_analyzer.py analyze --session-id <uuid>     # Analyze one session
  python dar_analyzer.py batch [--n 5] [--leg XVII]      # Batch analyze recent sessions
  python dar_analyzer.py status                          # Show analysis coverage

REQUIREMENTS:
  pip install anthropic
  export ANTHROPIC_API_KEY=sk-ant-...
  export SUPABASE_URL=https://...supabase.co
  export SUPABASE_SERVICE_KEY=...
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
import uuid
from typing import Optional

# ─── Config ────────────────────────────────────────────────────────────────────

ANTHROPIC_API_KEY    = os.environ.get("ANTHROPIC_API_KEY", "")
SUPABASE_URL         = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

CLAUDE_MODEL = "claude-sonnet-4-6"  # current Sonnet model
MAX_TOKENS   = 4096
RATE_LIMIT_SEC = 2.0  # delay between Claude API calls

# ─── Supabase helpers ──────────────────────────────────────────────────────────

def _headers() -> dict:
    return {
        "apikey":        SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type":  "application/json",
    }


def _supa_get(path: str, params: str = "") -> list:
    if not SUPABASE_URL:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{path}{params}"
    req = urllib.request.Request(url, headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  [supa GET {path}]: {e}")
        return []


def _supa_patch(table: str, row_id: str, fields: dict) -> bool:
    if not SUPABASE_URL:
        return False
    url  = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}"
    data = json.dumps(fields).encode()
    req  = urllib.request.Request(
        url, data=data, method="PATCH",
        headers={**_headers(), "Prefer": "return=minimal"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            r.read()
        return True
    except Exception as e:
        print(f"  [supa PATCH {table}/{row_id}]: {e}")
        return False


def _supa_upsert(table: str, rows: list[dict]) -> bool:
    if not SUPABASE_URL or not rows:
        return False
    url  = f"{SUPABASE_URL}/rest/v1/{table}"
    data = json.dumps(rows).encode()
    req  = urllib.request.Request(
        url, data=data, method="POST",
        headers={**_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()
        return True
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"  [supa upsert {table}] HTTP {e.code}: {body[:200]}")
        return False
    except Exception as e:
        print(f"  [supa upsert {table}]: {e}")
        return False


# ─── Data fetching ─────────────────────────────────────────────────────────────

def fetch_session(session_id: str) -> Optional[dict]:
    rows = _supa_get("sessions", f"?id=eq.{session_id}&select=*&limit=1")
    return rows[0] if rows else None


def fetch_interventions(session_id: str) -> list[dict]:
    return _supa_get(
        "interventions",
        f"?session_id=eq.{session_id}&select=deputy_name,party,type,text,word_count,"
        f"filler_word_count,was_mic_cutoff,applause_from,protests_from"
        f"&order=sequence_number.asc&limit=200"
    )


def fetch_votes(session_id: str) -> list[dict]:
    return _supa_get(
        "votes",
        f"?session_id=eq.{session_id}&select=description,result,favor,against,abstain,dissidents"
        f"&order=sequence_number.asc"
    )


def fetch_pending_sessions(leg: str = "XVII", n: int = 5) -> list[dict]:
    """Return sessions with analysis_status=extracted that haven't been analyzed yet."""
    return _supa_get(
        "sessions",
        f"?legislatura=eq.{leg}&analysis_status=eq.extracted"
        f"&select=id,date,session_number,legislatura"
        f"&order=date.desc&limit={n}"
    )


# ─── Prompt building ───────────────────────────────────────────────────────────

def _build_prompt(session: dict, interventions: list[dict], votes: list[dict]) -> str:
    date      = session.get("date", "?")
    sess_num  = session.get("session_number", "?")
    leg       = session.get("legislatura", "?")
    president = session.get("president_name", "Presidente da AR")
    n_deps    = session.get("deputies_present", "?")

    # Build concise intervention summary (top speakers by word count)
    speaker_summary = []
    by_party: dict[str, list[str]] = {}
    for intvn in interventions[:80]:  # cap to avoid token overflow
        name  = intvn.get("deputy_name", "?")
        party = intvn.get("party", "?")
        wc    = intvn.get("word_count", 0) or 0
        fc    = intvn.get("filler_word_count", 0) or 0
        cutoff = intvn.get("was_mic_cutoff", False)
        text_snippet = intvn.get("text", "")[:300]
        flags = []
        if cutoff:
            flags.append("⚠️ mic cortado")
        if intvn.get("applause_from"):
            flags.append(f"👏 {', '.join(intvn['applause_from'])}")
        if intvn.get("protests_from"):
            flags.append(f"📢 protestos de {', '.join(intvn['protests_from'])}")
        flag_str = f" [{', '.join(flags)}]" if flags else ""
        speaker_summary.append(
            f"- {name} ({party}, {wc} words, {fc} fillers){flag_str}: "
            f"{text_snippet}…"
        )
        if party:
            by_party.setdefault(party, []).append(name)

    parties_present = ", ".join(sorted(by_party.keys()))

    # Build vote summary
    vote_lines = []
    for v in votes:
        desc   = v.get("description", "?")[:100]
        result = v.get("result", "?")
        favor  = ", ".join(v.get("favor") or []) or "—"
        against = ", ".join(v.get("against") or []) or "—"
        abstain = ", ".join(v.get("abstain") or []) or "—"
        dis    = v.get("dissidents") or []
        dis_str = f"; dissidentes: {dis}" if dis else ""
        vote_lines.append(
            f"- {desc} → {result} | favor: {favor} | contra: {against} | abs: {abstain}{dis_str}"
        )

    interventions_block = "\n".join(speaker_summary) or "(sem intervenções registadas)"
    votes_block         = "\n".join(vote_lines) or "(sem votações registadas)"

    return f"""Analisa esta sessão plenária da Assembleia da República Portuguesa como um jornalista cívico experiente.

# Metadados da Sessão
- Legislatura: {leg} | Sessão nº: {sess_num} | Data: {date}
- Presidente: {president}
- Deputados presentes: {n_deps}
- Partidos presentes: {parties_present}

# Intervenções (resumo)
{interventions_block}

# Votações
{votes_block}

---

Responde EXCLUSIVAMENTE com JSON válido no seguinte formato (sem markdown, sem texto extra):

{{
  "summary_pt": "Resumo em português para cidadãos (máx. 300 palavras). Explica o que aconteceu de forma clara e imparcial. Menciona os temas principais, as decisões tomadas e os momentos notáveis.",
  "summary_en": "English translation of the summary (max 200 words). Clear and factual.",
  "key_decisions": [
    {{
      "description": "Descrição breve da decisão",
      "result": "aprovado | rejeitado | retirado",
      "significance": "Porque é importante para os cidadãos (1 frase)"
    }}
  ],
  "notable_moments": [
    {{
      "type": "mic_cutoff | heated_exchange | party_split | record_filler | dissent",
      "description": "O que aconteceu (1-2 frases)",
      "deputies_involved": ["Nome do deputado"]
    }}
  ],
  "party_positions": [
    {{
      "topic": "Nome do tema (ex: Habitação, Saúde, Orçamento)",
      "party": "Sigla do partido",
      "position_summary": "Posição do partido (1 frase)",
      "vote_alignment": "favor | against | abstain | mixed | not_present"
    }}
  ]
}}"""


# ─── Claude API call ───────────────────────────────────────────────────────────

def call_claude(prompt: str) -> Optional[dict]:
    """Call Anthropic Messages API and return parsed JSON response."""
    if not ANTHROPIC_API_KEY:
        print("ERROR: ANTHROPIC_API_KEY not set.")
        return None

    try:
        import anthropic
    except ImportError:
        print("ERROR: anthropic package not installed. Run: pip install anthropic")
        return None

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    try:
        message = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = message.content[0].text.strip()

        # Strip markdown code fences if Claude added them
        if raw_text.startswith("```"):
            raw_text = raw_text.split("\n", 1)[-1]
            if raw_text.endswith("```"):
                raw_text = raw_text[:-3].rstrip()

        return json.loads(raw_text)
    except json.JSONDecodeError as e:
        print(f"  [claude] JSON parse error: {e}")
        print(f"  Raw response (first 500 chars): {raw_text[:500]}")
        return None
    except Exception as e:
        print(f"  [claude] API error: {e}")
        return None


# ─── Analysis pipeline ─────────────────────────────────────────────────────────

def analyze_session(session_id: str) -> bool:
    """Fetch, analyze and upsert analysis for one session. Returns True on success."""

    session = fetch_session(session_id)
    if not session:
        print(f"Session {session_id} not found in Supabase.")
        return False

    date = session.get("date", session_id)
    print(f"\nAnalyzing session {date} ({session_id[:8]}…)")

    interventions = fetch_interventions(session_id)
    votes         = fetch_votes(session_id)
    print(f"  {len(interventions)} interventions, {len(votes)} votes")

    if not interventions and not votes:
        print("  No data to analyze — mark as pending and skip")
        return False

    prompt = _build_prompt(session, interventions, votes)
    print(f"  Calling Claude ({CLAUDE_MODEL}) …")
    analysis = call_claude(prompt)

    if not analysis:
        print("  Analysis failed.")
        return False

    # Upsert to sessions table
    sess_update = {
        "summary_pt":       analysis.get("summary_pt"),
        "summary_en":       analysis.get("summary_en"),
        "key_decisions":    json.dumps(analysis.get("key_decisions", [])),
        "notable_moments":  json.dumps(analysis.get("notable_moments", [])),
        "analysis_status":  "analyzed",
    }
    _supa_patch("sessions", session_id, {k: v for k, v in sess_update.items() if v is not None})

    # Upsert party positions
    party_positions = analysis.get("party_positions", [])
    if party_positions:
        rows = []
        for pp in party_positions:
            if pp.get("party") and pp.get("topic"):
                rows.append({
                    "id":               str(uuid.uuid4()),
                    "session_id":       session_id,
                    "topic":            pp["topic"],
                    "party":            pp["party"],
                    "position_summary": pp.get("position_summary"),
                    "vote_alignment":   pp.get("vote_alignment"),
                })
        if rows:
            _supa_upsert("party_positions", rows)
            print(f"  Upserted {len(rows)} party positions")

    print(f"  ✓ Analysis complete for {date}")
    return True


# ─── Commands ──────────────────────────────────────────────────────────────────

def cmd_analyze(session_id: str):
    success = analyze_session(session_id)
    sys.exit(0 if success else 1)


def cmd_batch(leg: str = "XVII", n: int = 5):
    """Analyze N sessions that have been scraped but not yet analyzed."""
    sessions = fetch_pending_sessions(leg=leg, n=n)
    if not sessions:
        print(f"No pending sessions found for {leg}. Run dar_scraper.py first.")
        return

    print(f"Found {len(sessions)} sessions to analyze.")
    ok = 0
    for s in sessions:
        success = analyze_session(s["id"])
        if success:
            ok += 1
        time.sleep(RATE_LIMIT_SEC)

    print(f"\n{'═'*60}")
    print(f"Analyzed {ok}/{len(sessions)} sessions.")


def cmd_status():
    """Show analysis coverage across all legislatures."""
    for leg in ["XVII", "XVI", "XV"]:
        all_sess    = _supa_get("sessions", f"?legislatura=eq.{leg}&select=id,analysis_status")
        if not all_sess:
            continue
        analyzed  = sum(1 for s in all_sess if s.get("analysis_status") == "analyzed")
        extracted = sum(1 for s in all_sess if s.get("analysis_status") == "extracted")
        pending   = sum(1 for s in all_sess if s.get("analysis_status") in ("pending", None))
        total     = len(all_sess)
        pct       = int(analyzed / total * 100) if total else 0
        bar       = "█" * (pct // 5) + "░" * (20 - pct // 5)
        print(f"\n{leg}: [{bar}] {analyzed}/{total} analyzed ({pct}%)")
        print(f"     extracted={extracted}, pending={pending}")


# ─── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="AI-powered analysis of plenary session data using Claude"
    )
    sub = parser.add_subparsers(dest="cmd")

    p_analyze = sub.add_parser("analyze", help="Analyze one session")
    p_analyze.add_argument("--session-id", required=True, help="Supabase session UUID")

    p_batch = sub.add_parser("batch", help="Batch analyze pending sessions")
    p_batch.add_argument("--leg", default="XVII")
    p_batch.add_argument("--n",   type=int, default=5)

    sub.add_parser("status", help="Show analysis coverage")

    args = parser.parse_args()

    if args.cmd == "analyze":
        cmd_analyze(args.session_id)
    elif args.cmd == "batch":
        cmd_batch(leg=args.leg, n=args.n)
    elif args.cmd == "status":
        cmd_status()
    else:
        parser.print_help()
