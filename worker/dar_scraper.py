#!/usr/bin/env python3
"""
dar_scraper.py — Scrape DAR (Diário da Assembleia da República) plenary session data
=====================================================================================
Downloads structured XML from the Parliament API and upserts sessions, agenda items,
interventions, votes and vote declarations to Supabase.

Builds on the Parliament API helpers already established in dar_profiles.py.

USAGE:
  python dar_scraper.py index [--leg XVII]              # Map all sessions for a legislature
  python dar_scraper.py download [--leg XVII] [--n 5]   # Download + cache XML files
  python dar_scraper.py parse --session-id SESS_DATE    # Parse one session → Supabase
  python dar_scraper.py run [--leg XVII] [--n 10]       # Full pipeline

REQUIREMENTS:
  pip install requests
  export SUPABASE_URL=https://...supabase.co
  export SUPABASE_SERVICE_KEY=...
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

# ─── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

DAR_SESSIONS_API = "https://app.parlamento.pt/webutils/docs/DAR1Serie.aspx"
RATE_LIMIT_SEC   = 1.0  # politeness delay between parliament.pt requests

DATA_DIR = Path(__file__).parent / "data" / "xml"

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
        print(f"  [supa GET] {path}: {e}")
        return []


def _supa_upsert(table: str, rows: list[dict], conflict: str = "id") -> bool:
    if not SUPABASE_URL or not rows:
        return False
    url  = f"{SUPABASE_URL}/rest/v1/{table}"
    data = json.dumps(rows).encode()
    req  = urllib.request.Request(
        url, data=data, method="POST",
        headers={**_headers(), "Prefer": f"resolution=merge-duplicates,return=minimal"},
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
        print(f"  [supa patch {table}]: {e}")
        return False


# ─── XML helpers (shared with dar_profiles.py) ────────────────────────────────

def _strip_ns(root: ET.Element) -> ET.Element:
    for elem in root.iter():
        if "}" in elem.tag:
            elem.tag = elem.tag.split("}")[-1]
        for k in list(elem.attrib):
            if "{" in k:
                elem.attrib[k.split("}")[-1]] = elem.attrib.pop(k)
    return root


def _first_text(node: ET.Element, tags: list[str]) -> Optional[str]:
    for t in tags:
        c = node.find(t)
        if c is not None and c.text and c.text.strip():
            return c.text.strip()
    return None


def _extract_text(elem: ET.Element) -> str:
    parts: list[str] = []
    if elem.text:
        parts.append(elem.text)
    for child in elem:
        parts.append(_extract_text(child))
        if child.tail:
            parts.append(child.tail)
    return " ".join(p.strip() for p in parts if p.strip())


def _parse_time(s: Optional[str]) -> Optional[float]:
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


# ─── Parliament API — session list ────────────────────────────────────────────

def fetch_dar_session_list(leg: str = "XVII", max_sessions: int = 200) -> list[dict]:
    """Return list of {number, date, dar_xml_url, title} from Parliament API."""
    url = f"{DAR_SESSIONS_API}?Leg={leg}&pType=ata"
    print(f"Fetching session list: {url}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "parlamento-aberto/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
    except Exception as e:
        print(f"  ERROR: {e}")
        return []

    try:
        root = _strip_ns(ET.fromstring(raw))
    except ET.ParseError:
        print("  ERROR: could not parse session list XML")
        return []

    sessions = []
    for node in root.iter():
        num     = _first_text(node, ["numero", "Numero", "num", "Num"])
        date    = _first_text(node, ["data", "Data", "date"])
        doc_url = _first_text(node, ["urlFicheiro", "UrlFicheiro", "url", "URL"])
        title   = _first_text(node, ["titulo", "Titulo", "title"])
        if num and date and re.match(r"\d{4}-\d{2}-\d{2}", date):
            sessions.append({
                "number":      num,
                "date":        date[:10],
                "dar_xml_url": doc_url or "",
                "title":       title or f"Sessão Plenária {num}",
            })

    sessions.sort(key=lambda s: s["date"], reverse=True)
    print(f"  Found {len(sessions)} sessions.")
    return sessions[:max_sessions]


# ─── Download & cache XML ─────────────────────────────────────────────────────

def _cache_path(leg: str, session_num: str) -> Path:
    p = DATA_DIR / leg
    p.mkdir(parents=True, exist_ok=True)
    return p / f"dar_{session_num}.xml"


def download_dar_xml(leg: str, session: dict) -> Optional[bytes]:
    """Download DAR XML, cache to disk, return bytes."""
    cache = _cache_path(leg, session["number"])
    if cache.exists() and cache.stat().st_size > 500:
        return cache.read_bytes()

    url = session.get("dar_xml_url", "")
    if not url:
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "parlamento-aberto/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
        cache.write_bytes(raw)
        return raw
    except Exception as e:
        print(f"  ERROR downloading {url}: {e}")
        return None


# ─── DAR XML parser ───────────────────────────────────────────────────────────

def _detect_cutoff(text: str) -> bool:
    """Detect if a speech was cut off mid-sentence by the presiding officer."""
    patterns = [
        r"[Tt]enha a bondade",
        r"[Oo] Sr\. Presidente.*interromp",
        r"\[O orador.*interromp",
        r"[Ss]r\. Presidente.*cortou",
        r"Esgotado o tempo",
    ]
    return any(re.search(p, text) for p in patterns)


def _extract_stage_directions(text: str) -> dict:
    """Pull applause, protests, interruptions from stage direction tags."""
    applause    = re.findall(r"\[Aplausos? (?:do|da|dos|das) ([^\]]+)\]", text, re.I)
    protests    = re.findall(r"\[Protestos? (?:do|da|dos|das) ([^\]]+)\]", text, re.I)
    interrupted = re.findall(r"\[O orador.*?interrompido por ([^\]]+)\]", text, re.I)
    return {
        "applause_from": applause,
        "protests_from": protests,
        "interrupted_by": interrupted,
    }


def _count_words(text: str) -> int:
    return len(re.findall(r"\w+", text))


def _filler_count(text: str) -> tuple[int, dict]:
    """Simple filler word count (no accent stripping — fast pass)."""
    fillers = [
        "portanto", "digamos", "ou seja", "pronto", "basicamente",
        "efetivamente", "de facto", "na verdade", "quer dizer", "tipo",
        "bem", "olhe", "enfim", "claro", "obviamente", "naturalmente",
        "certamente", "exatamente", "honestamente", "sinceramente",
        "fundamentalmente", "essencialmente", "eventualmente",
        "no fundo", "de certa forma", "de alguma forma",
        "se calhar", "pois", "bom", "ora",
    ]
    lo = text.lower()
    detail: dict[str, int] = {}
    total = 0
    for fw in fillers:
        count = lo.count(fw)
        if count:
            detail[fw] = count
            total += count
    return total, detail


def parse_dar_xml(raw: bytes, session_meta: dict, leg: str) -> dict:
    """
    Parse a DAR-I XML file into structured data.
    Returns dict with keys: session, agenda_items, interventions, votes, vote_declarations.
    """
    try:
        root = _strip_ns(ET.fromstring(raw))
    except ET.ParseError as e:
        print(f"  XML parse error: {e}")
        return {}

    result: dict = {
        "session":            {},
        "agenda_items":       [],
        "interventions":      [],
        "votes":              [],
        "vote_declarations":  [],
    }

    # ── Session metadata ───────────────────────────────────────────────────────
    # Look for <sessao>, <reuniao>, <plenario> root elements
    session_node = (
        root.find("sessao") or root.find("reuniao") or
        root.find("plenario") or root
    )

    president = _first_text(session_node, [
        "presidente", "Presidente", "presidenteSessao", "presidenteReuniao",
    ])
    deputies_present_str = _first_text(session_node, [
        "deputadosPresentes", "presentes", "nPresentes",
    ])
    deputies_present = None
    if deputies_present_str and deputies_present_str.isdigit():
        deputies_present = int(deputies_present_str)

    # Try to extract full text
    full_text_parts: list[str] = []

    # ── Agenda items ───────────────────────────────────────────────────────────
    agenda_seq = 0
    for item_node in root.iter("pontoOrdemDia"):
        agenda_seq += 1
        title_raw   = _first_text(item_node, ["titulo", "Titulo", "descricao"])
        category    = _first_text(item_node, ["categoria", "tipo", "tipoAssunto"])
        initiatives_raw = []
        for init_node in item_node.iter("iniciativa"):
            ref  = _first_text(init_node, ["referencia", "numero", "num"])
            desc = _first_text(init_node, ["descricao", "titulo"])
            if ref or desc:
                initiatives_raw.append({"ref": ref, "description": desc})

        if title_raw:
            result["agenda_items"].append({
                "_seq":         agenda_seq,
                "title":        title_raw.strip(),
                "topic_category": category,
                "initiatives":  initiatives_raw or None,
            })

    # ── Interventions ──────────────────────────────────────────────────────────
    seq = 0
    tag_sets = [
        ("intervencao",  "orador",   "texto"),
        ("Interveniente", "Nome",    "Texto"),
        ("INTERVENCAO",  "ORADOR",   "TEXTO"),
        ("interveniente", "depNome", "discurso"),
        ("intervencao",  "nome",     "texto"),
    ]

    for container, name_tag, text_tag in tag_sets:
        nodes = list(root.iter(container))
        if not nodes:
            continue
        for node in nodes:
            speaker = _first_text(node, [name_tag, name_tag.lower(), name_tag.upper()])
            party   = _first_text(node, ["partido", "Partido", "GP", "gp"])
            itype   = _first_text(node, ["tipo", "tipoIntervencao", "Tipo"]) or "intervenção"
            text_elem = (
                node.find(text_tag) or
                node.find(text_tag.lower()) or
                node.find(text_tag.upper())
            )
            text_content = _extract_text(text_elem) if text_elem is not None else None
            if not speaker or not text_content or len(text_content) < 20:
                continue

            seq += 1
            full_text_parts.append(f"{speaker}: {text_content}")
            stage = _extract_stage_directions(text_content)
            wc = _count_words(text_content)
            filler_total, filler_detail = _filler_count(text_content)

            result["interventions"].append({
                "deputy_name":              speaker.strip(),
                "party":                    party,
                "type":                     itype,
                "sequence_number":          seq,
                "text":                     text_content.strip(),
                "word_count":               wc,
                "estimated_duration_seconds": int(wc / 2.5),  # ~150 words/min
                "applause_from":            stage["applause_from"] or None,
                "protests_from":            stage["protests_from"] or None,
                "interrupted_by":           stage["interrupted_by"] or None,
                "was_mic_cutoff":           _detect_cutoff(text_content),
                "filler_word_count":        filler_total,
                "filler_words_detail":      filler_detail if filler_detail else None,
            })
        if result["interventions"]:
            break  # found the right schema

    # ── Votes ──────────────────────────────────────────────────────────────────
    vote_seq = 0
    for vote_node in root.iter("votacao"):
        vote_seq += 1
        desc   = _first_text(vote_node, ["descricao", "assunto", "titulo", "resultado"])
        result_ = _first_text(vote_node, ["resultado", "decisao"]) or ""
        ref    = _first_text(vote_node, ["referencia", "iniciativa", "num"])

        favor_raw   = _first_text(vote_node, ["favor",     "a_favor",  "votos_favor"])
        against_raw = _first_text(vote_node, ["contra",    "votos_contra"])
        abstain_raw = _first_text(vote_node, ["abstencao", "abstencoes"])

        def _party_list(raw: Optional[str]) -> list[str]:
            if not raw:
                return []
            return [p.strip() for p in re.split(r"[,;]", raw) if p.strip()]

        # Dissidents: deputies who broke party line
        dissidents = []
        for dis_node in vote_node.iter("disidente"):
            name  = _first_text(dis_node, ["nome", "depNome"])
            party = _first_text(dis_node, ["partido", "GP"])
            vote  = _first_text(dis_node, ["voto", "sentido"])
            if name:
                dissidents.append({"name": name, "party": party, "vote": vote})

        # Determine result label
        result_lower = result_.lower()
        if "aprovad" in result_lower:
            result_label = "aprovado"
        elif "rejeitad" in result_lower:
            result_label = "rejeitado"
        elif "retirad" in result_lower:
            result_label = "retirado"
        else:
            result_label = result_ or None

        result["votes"].append({
            "initiative_reference": ref,
            "description":          desc,
            "result":               result_label,
            "favor":                _party_list(favor_raw),
            "against":              _party_list(against_raw),
            "abstain":              _party_list(abstain_raw),
            "dissidents":           dissidents or None,
            "sequence_number":      vote_seq,
        })

    # ── Vote declarations ──────────────────────────────────────────────────────
    for decl_node in root.iter("declaracaoVoto"):
        deputy = _first_text(decl_node, ["orador", "nome", "depNome"])
        party  = _first_text(decl_node, ["partido", "GP"])
        text_elem = decl_node.find("texto") or decl_node.find("Texto")
        text = _extract_text(text_elem) if text_elem is not None else _extract_text(decl_node)
        if deputy and len(text) > 10:
            result["vote_declarations"].append({
                "party":       party,
                "deputy_name": deputy,
                "text":        text.strip(),
            })

    result["session"] = {
        "president_name":   president,
        "deputies_present": deputies_present,
        "full_text":        "\n\n".join(full_text_parts),
        "session_number":   int(session_meta.get("number", 0) or 0),
        "dar_url":          session_meta.get("dar_xml_url", ""),
        "legislatura":      leg,
        "analysis_status":  "extracted",
    }

    print(f"  Parsed: {len(result['interventions'])} interventions, "
          f"{len(result['votes'])} votes, {len(result['vote_declarations'])} vote declarations, "
          f"{len(result['agenda_items'])} agenda items")

    return result


# ─── Supabase upsert pipeline ─────────────────────────────────────────────────

def _load_politicians_index() -> dict[str, str]:
    """Return {normalized_name → id} from Supabase politicians table."""
    rows = _supa_get("politicians", "?select=id,name")
    return {r["name"].lower().strip(): r["id"] for r in rows}


def _fuzzy_match_deputy(name: str, index: dict[str, str]) -> Optional[str]:
    """Match a speaker name to a politician ID."""
    lo = name.lower().strip()
    if lo in index:
        return index[lo]
    # Partial surname match
    for key, pid in index.items():
        if lo in key or key in lo:
            return pid
    return None


def upsert_to_supabase(
    session_id: str,
    session_date: str,
    parsed: dict,
    pol_index: dict[str, str],
) -> None:
    """Upsert all parsed data for one session into Supabase."""

    # 1. Update session metadata
    sess_fields = {k: v for k, v in parsed["session"].items() if v is not None}
    if sess_fields:
        _supa_patch("sessions", session_id, sess_fields)
        print(f"  Updated session metadata for {session_date}")

    # 2. Upsert agenda items
    agenda_id_map: dict[int, str] = {}  # seq → uuid
    for item in parsed.get("agenda_items", []):
        item_id = str(uuid.uuid4())
        agenda_id_map[item["_seq"]] = item_id
        row = {
            "id":             item_id,
            "session_id":     session_id,
            "item_number":    item["_seq"],
            "title":          item["title"],
            "topic_category": item.get("topic_category"),
            "initiatives":    json.dumps(item["initiatives"]) if item.get("initiatives") else None,
        }
        _supa_upsert("agenda_items", [row])

    # 3. Upsert interventions
    interventions_to_insert = []
    for intvn in parsed.get("interventions", []):
        deputy_id = _fuzzy_match_deputy(intvn["deputy_name"], pol_index)
        row: dict = {
            "id":                        str(uuid.uuid4()),
            "session_id":                session_id,
            "deputy_id":                 deputy_id,
            "deputy_name":               intvn["deputy_name"],
            "party":                     intvn.get("party"),
            "type":                      intvn.get("type", "intervenção"),
            "sequence_number":           intvn.get("sequence_number"),
            "text":                      intvn["text"],
            "word_count":                intvn.get("word_count"),
            "estimated_duration_seconds": intvn.get("estimated_duration_seconds"),
            "was_mic_cutoff":            intvn.get("was_mic_cutoff", False),
            "filler_word_count":         intvn.get("filler_word_count", 0),
            "filler_words_detail":       json.dumps(intvn["filler_words_detail"]) if intvn.get("filler_words_detail") else None,
        }
        if intvn.get("applause_from"):
            row["applause_from"] = intvn["applause_from"]
        if intvn.get("protests_from"):
            row["protests_from"] = intvn["protests_from"]
        if intvn.get("interrupted_by"):
            row["interrupted_by"] = intvn["interrupted_by"]
        interventions_to_insert.append(row)

    if interventions_to_insert:
        # Batch insert in chunks of 50
        for i in range(0, len(interventions_to_insert), 50):
            chunk = interventions_to_insert[i:i+50]
            _supa_upsert("interventions", chunk)
        print(f"  Inserted {len(interventions_to_insert)} interventions")

    # 4. Upsert votes
    vote_id_map: dict[int, str] = {}
    for vote in parsed.get("votes", []):
        vote_id = str(uuid.uuid4())
        seq = vote.get("sequence_number", 0)
        vote_id_map[seq] = vote_id
        row = {
            "id":                   vote_id,
            "session_id":           session_id,
            "initiative_reference": vote.get("initiative_reference"),
            "description":          vote.get("description"),
            "result":               vote.get("result"),
            "favor":                vote.get("favor") or [],
            "against":              vote.get("against") or [],
            "abstain":              vote.get("abstain") or [],
            "dissidents":           json.dumps(vote["dissidents"]) if vote.get("dissidents") else None,
            "sequence_number":      seq,
        }
        _supa_upsert("votes", [row])

    if vote_id_map:
        print(f"  Inserted {len(vote_id_map)} votes")

    # 5. Upsert vote declarations (link to first vote for session if no vote_id)
    first_vote_id = next(iter(vote_id_map.values()), None) if vote_id_map else None
    decls_to_insert = []
    for decl in parsed.get("vote_declarations", []):
        deputy_id = _fuzzy_match_deputy(decl.get("deputy_name", ""), pol_index)
        row = {
            "id":        str(uuid.uuid4()),
            "vote_id":   first_vote_id,
            "deputy_id": deputy_id,
            "party":     decl.get("party"),
            "text":      decl["text"],
        }
        decls_to_insert.append(row)
    if decls_to_insert:
        _supa_upsert("vote_declarations", decls_to_insert)
        print(f"  Inserted {len(decls_to_insert)} vote declarations")


# ─── Ensure session row exists ────────────────────────────────────────────────

def _ensure_session(date: str, leg: str, num: str, dar_url: str) -> Optional[str]:
    """Return existing session ID or create one."""
    rows = _supa_get("sessions", f"?select=id&date=eq.{date}&limit=1")
    if rows:
        return rows[0]["id"]

    # Create new session row
    session_id = str(uuid.uuid4())
    row = {
        "id":             session_id,
        "date":           date,
        "status":         "completed",
        "legislatura":    leg,
        "session_number": int(num) if num.isdigit() else None,
        "dar_url":        dar_url,
        "transcript_status": "pending",
    }
    ok = _supa_upsert("sessions", [row])
    return session_id if ok else None


# ─── Commands ──────────────────────────────────────────────────────────────────

def cmd_index(leg: str = "XVII"):
    """List all DAR sessions for a legislature."""
    sessions = fetch_dar_session_list(leg=leg)
    if not sessions:
        print("No sessions found.")
        return
    print(f"\n{'NUM':<8} {'DATE':<12} {'TITLE'}")
    print("─" * 72)
    for s in sessions:
        has_xml = "✓" if s.get("dar_xml_url") else "✗"
        print(f"{s['number']:<8} {s['date']:<12} [{has_xml} XML] {s['title'][:45]}")
    print(f"\nTotal: {len(sessions)} sessions")


def cmd_download(leg: str = "XVII", n: int = 10):
    """Download and cache XML files for N most recent sessions."""
    sessions = fetch_dar_session_list(leg=leg, max_sessions=n)
    downloaded = 0
    for s in sessions:
        if not s.get("dar_xml_url"):
            print(f"  {s['date']}: no XML URL — skipping")
            continue
        cache = _cache_path(leg, s["number"])
        if cache.exists() and cache.stat().st_size > 500:
            print(f"  {s['date']}: cached ({cache.stat().st_size:,} bytes)")
            continue
        print(f"  {s['date']}: downloading …", end="", flush=True)
        raw = download_dar_xml(leg, s)
        if raw:
            print(f" {len(raw):,} bytes")
            downloaded += 1
        else:
            print(" FAILED")
        time.sleep(RATE_LIMIT_SEC)
    print(f"\nDownloaded {downloaded} new files.")


def cmd_parse(leg: str = "XVII", session_date: Optional[str] = None, session_num: Optional[str] = None):
    """Parse one session from XML and upsert to Supabase."""
    sessions = fetch_dar_session_list(leg=leg)
    target = None

    if session_date:
        target = next((s for s in sessions if s["date"] == session_date), None)
    elif session_num:
        target = next((s for s in sessions if s["number"] == session_num), None)

    if not target:
        print(f"Session not found. Use `python dar_scraper.py index --leg {leg}` to list sessions.")
        return

    print(f"\nParsing session {target['number']} ({target['date']}) …")
    raw = download_dar_xml(leg, target)
    if not raw:
        print("Failed to download XML.")
        return

    parsed = parse_dar_xml(raw, target, leg)
    if not parsed:
        print("Failed to parse XML.")
        return

    if not SUPABASE_URL:
        print("\n[DRY RUN — no SUPABASE_URL set]")
        print(f"  {len(parsed['interventions'])} interventions parsed")
        print(f"  {len(parsed['votes'])} votes parsed")
        return

    session_id = _ensure_session(target["date"], leg, target["number"], target.get("dar_xml_url", ""))
    if not session_id:
        print("Failed to ensure session row in Supabase.")
        return

    pol_index = _load_politicians_index()
    upsert_to_supabase(session_id, target["date"], parsed, pol_index)
    print(f"\nDone: session {target['date']}")


def cmd_run(leg: str = "XVII", n: int = 5):
    """Full pipeline: index → download → parse → upsert for N most recent sessions."""
    sessions = fetch_dar_session_list(leg=leg, max_sessions=n)
    if not sessions:
        print("No sessions found.")
        return

    pol_index = _load_politicians_index() if SUPABASE_URL else {}
    print(f"Loaded {len(pol_index)} politicians from Supabase")

    ok_count = 0
    for s in sessions:
        print(f"\n{'─'*60}")
        print(f"Session {s['number']} — {s['date']}")

        if not s.get("dar_xml_url"):
            print("  No XML URL — skipping")
            continue

        raw = download_dar_xml(leg, s)
        if not raw:
            time.sleep(RATE_LIMIT_SEC)
            continue

        parsed = parse_dar_xml(raw, s, leg)
        if not parsed or not parsed.get("interventions"):
            print("  No interventions parsed — skipping upsert")
            time.sleep(RATE_LIMIT_SEC)
            continue

        if SUPABASE_URL:
            session_id = _ensure_session(s["date"], leg, s["number"], s.get("dar_xml_url", ""))
            if session_id:
                upsert_to_supabase(session_id, s["date"], parsed, pol_index)
                ok_count += 1
        else:
            print(f"  [DRY RUN] {len(parsed['interventions'])} interventions, "
                  f"{len(parsed['votes'])} votes")
            ok_count += 1

        time.sleep(RATE_LIMIT_SEC)

    print(f"\n{'═'*60}")
    print(f"Pipeline complete: {ok_count}/{len(sessions)} sessions processed.")


# ─── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scrape DAR plenary session data into Supabase"
    )
    sub = parser.add_subparsers(dest="cmd")

    p_idx = sub.add_parser("index", help="List all sessions for a legislature")
    p_idx.add_argument("--leg", default="XVII")

    p_dl = sub.add_parser("download", help="Download XML for N most recent sessions")
    p_dl.add_argument("--leg", default="XVII")
    p_dl.add_argument("--n", type=int, default=10)

    p_parse = sub.add_parser("parse", help="Parse one session into Supabase")
    p_parse.add_argument("--leg",            default="XVII")
    p_parse.add_argument("--session-date",   default=None)
    p_parse.add_argument("--session-num",    default=None)

    p_run = sub.add_parser("run", help="Full pipeline for N most recent sessions")
    p_run.add_argument("--leg", default="XVII")
    p_run.add_argument("--n",   type=int, default=5)

    args = parser.parse_args()

    if args.cmd == "index":
        cmd_index(leg=args.leg)
    elif args.cmd == "download":
        cmd_download(leg=args.leg, n=args.n)
    elif args.cmd == "parse":
        cmd_parse(leg=args.leg, session_date=args.session_date, session_num=args.session_num)
    elif args.cmd == "run":
        cmd_run(leg=args.leg, n=args.n)
    else:
        parser.print_help()
