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
MAX_TOKENS   = 8192
RATE_LIMIT_SEC = 60.0  # delay between Claude API calls (rate limit: 30k tokens/min)

CHUNK_SIZE              = 200   # interventions per chunk for large sessions
LARGE_SESSION_THRESHOLD = 500   # sessions with this many+ interventions use chunking
RETRY_WAIT_429          = 90    # seconds to wait after a 429
MAX_API_RETRIES         = 3

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
        f"&order=sequence_number.asc&limit=2000"
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

def _build_chunk_prompt(chunk_index: int, total_chunks: int, interventions: list[dict]) -> str:
    """Prompt to summarize a single chunk of interventions (no voting data)."""
    lines = []
    for intvn in interventions:
        name   = intvn.get("deputy_name", "?")
        party  = intvn.get("party", "?")
        wc     = intvn.get("word_count", 0) or 0
        fc     = intvn.get("filler_word_count", 0) or 0
        cutoff = intvn.get("was_mic_cutoff", False)
        snippet = intvn.get("text", "")[:150]
        flags = []
        if cutoff:
            flags.append("mic cortado")
        if intvn.get("applause_from"):
            flags.append(f"aplauso de {', '.join(intvn['applause_from'])}")
        if intvn.get("protests_from"):
            flags.append(f"protestos de {', '.join(intvn['protests_from'])}")
        flag_str = f" [{', '.join(flags)}]" if flags else ""
        lines.append(f"- {name} ({party}, {wc} palavras, {fc} fillers){flag_str}: {snippet}…")

    block = "\n".join(lines) or "(vazio)"
    return f"""Resumo parcial de sessão parlamentar portuguesa — bloco {chunk_index}/{total_chunks}.

# Intervenções deste bloco
{block}

---

Responde EXCLUSIVAMENTE com JSON válido (sem markdown):

{{
  "themes": ["tema1", "tema2"],
  "notable_moments": [
    {{"type": "mic_cutoff|heated_exchange|party_split|record_filler|dissent", "description": "…", "deputies_involved": ["…"]}}
  ],
  "speaker_highlights": [
    {{"name": "…", "party": "…", "summary": "posição/argumento principal (1 frase)"}}
  ]
}}"""


def _build_summary_of_summaries_prompt(
    session: dict,
    chunk_summaries: list[dict],
    votes: list[dict],
) -> str:
    """Final prompt that combines chunk summaries + votes into the full analysis JSON."""
    date     = session.get("date", "?")
    sess_num = session.get("session_number", "?")
    leg      = session.get("legislatura", "?")
    president = session.get("president_name", "Presidente da AR")
    n_deps   = session.get("deputies_present", "?")

    summaries_block = json.dumps(chunk_summaries, ensure_ascii=False, indent=2)

    vote_lines = []
    for v in votes:
        desc    = v.get("description", "?")[:100]
        result  = v.get("result", "?")
        favor   = ", ".join(v.get("favor") or []) or "—"
        against = ", ".join(v.get("against") or []) or "—"
        abstain = ", ".join(v.get("abstain") or []) or "—"
        dis     = v.get("dissidents") or []
        dis_str = f"; dissidentes: {dis}" if dis else ""
        vote_lines.append(
            f"- {desc} → {result} | favor: {favor} | contra: {against} | abs: {abstain}{dis_str}"
        )
    votes_block = "\n".join(vote_lines) or "(sem votações registadas)"

    return f"""Analisa esta sessão plenária da Assembleia da República Portuguesa como um jornalista cívico experiente.
A sessão foi muito longa; abaixo estão resumos parciais por blocos de intervenções, mais as votações completas.

# Metadados da Sessão
- Legislatura: {leg} | Sessão nº: {sess_num} | Data: {date}
- Presidente: {president}
- Deputados presentes: {n_deps}

# Resumos por Blocos de Intervenções
{summaries_block}

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


def _build_prompt(session: dict, interventions: list[dict], votes: list[dict]) -> str:
    date      = session.get("date", "?")
    sess_num  = session.get("session_number", "?")
    leg       = session.get("legislatura", "?")
    president = session.get("president_name", "Presidente da AR")
    n_deps    = session.get("deputies_present", "?")

    # Build concise intervention summary (top speakers by word count)
    speaker_summary = []
    by_party: dict[str, list[str]] = {}
    for intvn in interventions:  # send all interventions
        name  = intvn.get("deputy_name", "?")
        party = intvn.get("party", "?")
        wc    = intvn.get("word_count", 0) or 0
        fc    = intvn.get("filler_word_count", 0) or 0
        cutoff = intvn.get("was_mic_cutoff", False)
        text_snippet = intvn.get("text", "")[:150]
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

def call_claude(prompt: str) -> tuple[Optional[dict], Optional[str]]:
    """Call Anthropic Messages API and return (parsed_json, error_type).

    error_type is None on success, 'json' on JSON parse failure, 'api' on other errors.
    Automatically retries up to MAX_API_RETRIES times on 429 rate-limit responses.
    """
    if not ANTHROPIC_API_KEY:
        print("ERROR: ANTHROPIC_API_KEY not set.")
        return None, "api"

    try:
        import anthropic
    except ImportError:
        print("ERROR: anthropic package not installed. Run: pip install anthropic")
        return None, "api"

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    for attempt in range(1, MAX_API_RETRIES + 1):
        raw_text = ""
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

            return json.loads(raw_text), None

        except json.JSONDecodeError as e:
            print(f"  [claude] JSON parse error (attempt {attempt}): {e}")
            print(f"  Raw response (first 500 chars): {raw_text[:500]}")
            return None, "json"

        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "rate_limit" in err_str.lower() or "overloaded" in err_str.lower():
                if attempt < MAX_API_RETRIES:
                    print(f"  [claude] 429/rate-limit on attempt {attempt}. Waiting {RETRY_WAIT_429}s …")
                    time.sleep(RETRY_WAIT_429)
                    continue
                else:
                    print(f"  [claude] 429 after {MAX_API_RETRIES} attempts — giving up.")
            else:
                print(f"  [claude] API error: {e}")
            return None, "api"

    return None, "api"


# ─── Analysis pipeline ─────────────────────────────────────────────────────────

def _chunked_analysis(session: dict, interventions: list[dict], votes: list[dict]) -> Optional[dict]:
    """For large sessions: summarize in chunks then do a final summary-of-summaries pass."""
    chunks = [interventions[i:i + CHUNK_SIZE] for i in range(0, len(interventions), CHUNK_SIZE)]
    total  = len(chunks)
    print(f"  Large session: splitting {len(interventions)} interventions into {total} chunks of {CHUNK_SIZE}")

    chunk_summaries = []
    for idx, chunk in enumerate(chunks, start=1):
        print(f"  Chunk {idx}/{total} ({len(chunk)} interventions) …")
        prompt = _build_chunk_prompt(idx, total, chunk)
        result, err = call_claude(prompt)
        if result:
            chunk_summaries.append(result)
        else:
            print(f"  Chunk {idx} failed (err={err}), skipping.")
        if idx < total:
            print(f"  Waiting {RATE_LIMIT_SEC}s before next chunk …")
            time.sleep(RATE_LIMIT_SEC)

    if not chunk_summaries:
        print("  All chunks failed — cannot produce analysis.")
        return None

    print(f"  Building final summary from {len(chunk_summaries)} chunk summaries …")
    final_prompt = _build_summary_of_summaries_prompt(session, chunk_summaries, votes)
    analysis, err = call_claude(final_prompt)
    if not analysis:
        print(f"  Final summary-of-summaries call failed (err={err}).")
    return analysis


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

    analysis: Optional[dict] = None

    if len(interventions) >= LARGE_SESSION_THRESHOLD:
        analysis = _chunked_analysis(session, interventions, votes)
    else:
        prompt = _build_prompt(session, interventions, votes)
        print(f"  Calling Claude ({CLAUDE_MODEL}) …")
        analysis, err = call_claude(prompt)

        if analysis is None and err == "json":
            # JSON truncation: retry with first 300 interventions only
            print("  JSON error — retrying with first 300 interventions …")
            time.sleep(RATE_LIMIT_SEC)
            short_prompt = _build_prompt(session, interventions[:300], votes)
            analysis, err = call_claude(short_prompt)

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


def cmd_batch(leg: str = "XVII", n: int = 5, limit: Optional[int] = None):
    """Analyze N sessions that have been scraped but not yet analyzed."""
    count = limit if limit is not None else n
    sessions = fetch_pending_sessions(leg=leg, n=count)
    if not sessions:
        print(f"No pending sessions found for {leg}. Run dar_scraper.py first.")
        return

    print(f"Found {len(sessions)} sessions to analyze. Rate-limit delay: {RATE_LIMIT_SEC}s between calls.")
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
    p_batch.add_argument("--n",     type=int, default=5)
    p_batch.add_argument("--limit", type=int, default=None, help="Alias for --n")

    sub.add_parser("status", help="Show analysis coverage")

    args = parser.parse_args()

    if args.cmd == "analyze":
        cmd_analyze(args.session_id)
    elif args.cmd == "batch":
        cmd_batch(leg=args.leg, n=args.n, limit=args.limit)
    elif args.cmd == "status":
        cmd_status()
    else:
        parser.print_help()
