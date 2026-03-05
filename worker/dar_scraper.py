#!/usr/bin/env python3
"""
dar_scraper.py — Scrape DAR (Diário da Assembleia da República) plenary session data
=====================================================================================
Downloads PDFs from parlamento.pt and upserts sessions, agenda items,
interventions, votes and vote declarations to Supabase.

Builds on the Parliament API helpers already established in dar_profiles.py.

USAGE:
  python dar_scraper.py index [--leg XVII]              # Map all sessions for a legislature
  python dar_scraper.py download [--leg XVII] [--n 5]   # Download + cache XML files
  python dar_scraper.py parse --session-id SESS_DATE    # Parse one session → Supabase
  python dar_scraper.py run [--leg XVII] [--n 10]       # Full pipeline

REQUIREMENTS:
  pip install requests pdfplumber
  export SUPABASE_URL=https://...supabase.co
  export SUPABASE_SERVICE_KEY=...
"""

from __future__ import annotations

import argparse
import io
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

import pdfplumber
import requests as _requests
from bs4 import BeautifulSoup as _BS

# ─── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

DAR_WEB_URL  = "https://www.parlamento.pt/DAR/Paginas/DAR1Serie.aspx"
RATE_LIMIT_SEC = 1.0  # politeness delay between parliament.pt requests

DATA_DIR = Path(__file__).parent / "data" / "pdf"

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


# ─── Parliament web scraper — session list ────────────────────────────────────

_HTTP_HEADERS = {
    "User-Agent": "parlamento-aberto/1.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
}


def _extract_form_data(soup: "_BS") -> dict:
    """Pull all hidden ASP.NET form fields from the page."""
    data: dict[str, str] = {}
    form = soup.find("form", {"id": "aspnetForm"}) or soup.find("form")
    if not form:
        return data
    for inp in form.find_all("input", {"type": "hidden"}):
        name = inp.get("name")
        if name:
            data[name] = inp.get("value", "")
    return data


def _do_postback(
    http: "_requests.Session",
    soup: "_BS",
    event_target: str,
    field_name: str,
    field_value: str,
) -> Optional["_BS"]:
    """Submit an ASP.NET __doPostBack and return the new page soup."""
    form_data = _extract_form_data(soup)
    form_data["__EVENTTARGET"]   = event_target
    form_data["__EVENTARGUMENT"] = ""
    form_data["__LASTFOCUS"]     = ""
    form_data[field_name]        = field_value

    # Include all visible select values so SharePoint doesn't barf
    for sel in soup.find_all("select"):
        sel_name = sel.get("name", "")
        if sel_name and sel_name not in form_data:
            chosen = sel.find("option", selected=True)
            if chosen:
                form_data[sel_name] = chosen.get("value", "")

    resp = http.post(DAR_WEB_URL, data=form_data, timeout=45)
    if resp.status_code != 200:
        print(f"  Postback HTTP {resp.status_code}")
        return None
    return _BS(resp.text, "lxml")


def _parse_dar_entries(soup: "_BS") -> list[dict]:
    """Extract DAR entries from a parsed page."""
    sessions: list[dict] = []
    for a in soup.find_all("a", id=re.compile(r"_hplTitulo$")):
        title    = a.get_text(strip=True)
        pdf_url  = a.get("href", "")

        # Derive issue number from the filename param fich=DAR-I-NNN.pdf
        num_match = re.search(r"fich=DAR-I-(\d+)", pdf_url, re.I)
        if not num_match:
            # Fall back to extracting from title "DAR I Série n.º NNN"
            num_match = re.search(r"n\.º\s*(\d+)", title, re.I)
        number = num_match.group(1).lstrip("0") if num_match else ""

        # Sibling span with lblData
        row = a.find_parent("div", class_=re.compile(r"row"))
        date_str = ""
        if row:
            lbl = row.find("span", id=re.compile(r"_lblData$"))
            if lbl:
                date_str = lbl.get_text(strip=True)

        if not (title and pdf_url and date_str):
            continue

        sessions.append({
            "number":      number,
            "date":        date_str[:10],      # "2026-02-21"
            "dar_xml_url": pdf_url,            # PDF link (legacy field name kept)
            "title":       title,
        })

    sessions.sort(key=lambda s: s["date"], reverse=True)
    return sessions


def fetch_dar_session_list(leg: str = "XVII", sessao: int = 1, max_sessions: int = 200) -> list[dict]:
    """
    Scrape DAR I Série session list from the parliament website.
    Uses ASP.NET postbacks to switch between legislaturas / sessions.
    Returns list of {number, date, dar_xml_url (PDF), title}.
    """
    print(f"Fetching DAR session list for {leg} Legislatura, sessão {sessao} …")
    http = _requests.Session()
    http.headers.update(_HTTP_HEADERS)

    # ── Step 1: GET the initial page ─────────────────────────────────────────
    try:
        resp = http.get(DAR_WEB_URL, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"  ERROR fetching page: {e}")
        return []

    soup = _BS(resp.text, "lxml")

    # ── Step 2: Find dropdown names and available options ────────────────────
    ddl_leg = soup.find("select", {"title": "Legislatura"})
    ddl_ses = soup.find("select", {"title": "Sessão Legislativa"})

    if ddl_leg is None:
        print("  ERROR: Legislatura dropdown not found.")
        return []

    ddl_leg_name: str = ddl_leg.get("name", "")
    ddl_ses_name: str = ddl_ses.get("name", "") if ddl_ses else ""

    # Build map: Roman numeral → option value (internal arnet URL)
    leg_map: dict[str, str] = {}
    for opt in ddl_leg.find_all("option"):
        text = opt.get_text(strip=True)
        m = re.match(r"^([IVXLCDM]+)\s+Legislatura", text)
        if m:
            leg_map[m.group(1)] = opt.get("value", "")

    if leg not in leg_map:
        print(f"  ERROR: '{leg}' not found. Available: {list(leg_map.keys())}")
        return []

    target_leg_val = leg_map[leg]

    # ── Step 3: If not the default legislatura, postback to change it ────────
    current_leg = (ddl_leg.find("option", selected=True) or {}).get("value", "")

    if current_leg != target_leg_val:
        print(f"  Switching to {leg} Legislatura …")
        soup = _do_postback(http, soup, ddl_leg_name, ddl_leg_name, target_leg_val)
        if soup is None:
            return []
        time.sleep(RATE_LIMIT_SEC)
        # Re-find the sessão dropdown in the updated page
        ddl_ses = soup.find("select", {"title": "Sessão Legislativa"})
        if ddl_ses:
            ddl_ses_name = ddl_ses.get("name", "")

    # ── Step 4: Switch sessão if needed ──────────────────────────────────────
    if ddl_ses_name:
        ddl_ses = soup.find("select", {"title": "Sessão Legislativa"})
        if ddl_ses:
            ses_opts = ddl_ses.find_all("option")
            # sessao=1 means 1st session (index 0), but they may be newest-first
            # Match by ordinal text ("1.ª", "2.ª", ...) or fall back to index
            target_ses_val = None
            ordinals = ["1.ª", "2.ª", "3.ª", "4.ª"]
            target_ord = ordinals[sessao - 1] if sessao <= len(ordinals) else None
            for opt in ses_opts:
                if target_ord and opt.get_text(strip=True).startswith(target_ord):
                    target_ses_val = opt.get("value", "")
                    break
            if target_ses_val is None and sessao <= len(ses_opts):
                target_ses_val = ses_opts[sessao - 1].get("value", "")

            current_ses = (ddl_ses.find("option", selected=True) or {}).get("value", "")
            if target_ses_val and current_ses != target_ses_val:
                print(f"  Switching to sessão {sessao} …")
                soup = _do_postback(http, soup, ddl_ses_name, ddl_ses_name, target_ses_val)
                if soup is None:
                    return []
                time.sleep(RATE_LIMIT_SEC)

    # ── Step 5: Parse entries from the current page ───────────────────────────
    sessions = _parse_dar_entries(soup)
    print(f"  Found {len(sessions)} DAR entries.")
    return sessions[:max_sessions]


# ─── Download & cache XML ─────────────────────────────────────────────────────

def _cache_path(leg: str, session_num: str) -> Path:
    p = DATA_DIR / leg
    p.mkdir(parents=True, exist_ok=True)
    return p / f"dar_{session_num}.pdf"


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


# ─── DAR PDF parser ───────────────────────────────────────────────────────────

def _detect_cutoff(text: str) -> bool:
    """Detect if a speech was cut off mid-sentence by the presiding officer."""
    patterns = [
        r"[Tt]enha a bondade",
        r"[Oo] Sr\. Presidente.*interromp",
        r"[Pp]or ter excedido o tempo",
        r"microfone.*desligado",
        r"[Ss]r\. Presidente.*cortou",
        r"Esgotado o tempo",
    ]
    return any(re.search(p, text) for p in patterns)


def _extract_stage_directions(text: str) -> dict:
    """Pull applause, protests, interruptions from inline stage directions."""
    # DAR PDFs use plain text like: (Aplausos do PS.) or Aplausos gerais.
    applause = re.findall(
        r"\(?Aplausos? (?:do|da|dos|das|gerais?)\s*([^.)]*)[.)]?",
        text, re.I,
    )
    applause += re.findall(r"\(?Aplausos? gerais?[.)]?", text, re.I)
    protests = re.findall(
        r"\(?Protestos? (?:do|da|dos|das)\s*([^.)]*)[.)]?",
        text, re.I,
    )
    interrupted = re.findall(
        r"\(?O orador.*?interrompido por ([^.)]+)[.)]?",
        text, re.I,
    )
    # Clean up empty strings from "gerais" matches
    applause = [a.strip() or "gerais" for a in applause if a is not None]
    return {
        "applause_from": applause,
        "protests_from": [p.strip() for p in protests],
        "interrupted_by": [i.strip() for i in interrupted],
    }


def _count_words(text: str) -> int:
    return len(re.findall(r"\w+", text))


def _filler_count(text: str) -> tuple[int, dict]:
    """Simple filler word count."""
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


# Speaker line in DAR I Série PDFs:
#   "O Sr. Nome Apelido (PS): — Senhor Presidente..."
#   "A Sr.ª Nome Apelido (BE): — ..."
#   "O Sr. Presidente: — ..."
_SPEAKER_RE = re.compile(
    r"^(?:O|A)\s+Sr\.ª?\s+"       # gendered title
    r"(.+?)"                       # name (greedy but stopped by colon or paren)
    r"(?:\s*\(([^)]+)\))?"         # optional (Party)
    r"\s*:\s*[—–\-]",             # colon + em-dash
    re.MULTILINE,
)

# Vote result line patterns
_VOTE_RESULT_RE = re.compile(
    r"(?:Submetid[ao]|Colocad[ao]|Posta)\s+à\s+votação[^.]*?\,?\s*"
    r"(?:foi\s+)?(aprovad\w+|rejeitad\w+|retirad\w+)",
    re.I,
)
_VOTE_FAVOR_RE   = re.compile(r"votos?\s+a\s+favor\s+d[aeo]s?\s+((?:[A-Z]{1,4}(?:\s+e\s+)?)+)", re.I)
_VOTE_AGAINST_RE = re.compile(r"(?:contra|votos?\s+contra)\s+d[aeo]s?\s+((?:[A-Z]{1,4}(?:\s+e\s+)?)+)", re.I)
_VOTE_ABSTAIN_RE = re.compile(r"absten[çc][aã]o\s+d[aeo]s?\s+((?:[A-Z]{1,4}(?:\s+e\s+)?)+)", re.I)

# Agenda item lines like "1 — Projeto de Lei n.º 42/XVI/1.ª ..."
_AGENDA_RE = re.compile(r"^(\d+)\s*[—–]\s*(.+)", re.MULTILINE)

# President mention: "Presidiu à reunião o Sr. Presidente [Name]"
_PRESIDENT_RE = re.compile(
    r"[Pp]residiu[^.]*?(?:o\s+Sr\.|a\s+Sr\.ª)\s+(?:Presidente\s+)?([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][^\n,\.]+)",
)

# Deputies present: "Estiveram presentes NNN Deputados"
_DEPUTIES_RE = re.compile(r"[Ee]stiveram presentes\s+(\d+)\s+[Dd]eputados")


def _extract_pdf_text(raw: bytes) -> str:
    """Extract full text from PDF bytes using pdfplumber."""
    try:
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            parts = []
            for page in pdf.pages:
                text = page.extract_text(x_tolerance=3, y_tolerance=3)
                if text:
                    parts.append(text)
            return "\n".join(parts)
    except Exception as e:
        print(f"  pdfplumber error: {e}")
        return ""


def _parse_vote_block(block: str, seq: int) -> dict:
    """Parse a vote result block into structured data."""
    result_m = _VOTE_RESULT_RE.search(block)
    result_word = result_m.group(1).lower() if result_m else ""
    if "aprovad" in result_word:
        result_label = "aprovado"
    elif "rejeitad" in result_word:
        result_label = "rejeitado"
    elif "retirad" in result_word:
        result_label = "retirado"
    else:
        result_label = None

    def _party_split(m: Optional[re.Match]) -> list[str]:
        if not m:
            return []
        raw = m.group(1)
        return [p.strip() for p in re.split(r"\s+e\s+|,\s*", raw) if p.strip()]

    # Find initiative reference in the block
    ref_m = re.search(r"(?:Projeto|Proposta|Petição|Resolução)[^\n]*?n\.º\s*([\w/\.ª]+)", block, re.I)
    ref = ref_m.group(1) if ref_m else None

    return {
        "initiative_reference": ref,
        "description":          block[:200].strip(),
        "result":               result_label,
        "favor":                _party_split(_VOTE_FAVOR_RE.search(block)),
        "against":              _party_split(_VOTE_AGAINST_RE.search(block)),
        "abstain":              _party_split(_VOTE_ABSTAIN_RE.search(block)),
        "dissidents":           None,
        "sequence_number":      seq,
    }


def parse_dar_pdf(raw: bytes, session_meta: dict, leg: str) -> dict:
    """
    Parse a DAR-I PDF into structured data using pdfplumber text extraction.
    Returns dict with keys: session, agenda_items, interventions, votes, vote_declarations.
    """
    full_text = _extract_pdf_text(raw)
    if not full_text.strip():
        print("  PDF: no text extracted (possibly scanned/image PDF)")
        return {}

    result: dict = {
        "session":           {},
        "agenda_items":      [],
        "interventions":     [],
        "votes":             [],
        "vote_declarations": [],
    }

    # ── Session metadata from text ─────────────────────────────────────────────
    president = None
    pres_m = _PRESIDENT_RE.search(full_text)
    if pres_m:
        president = pres_m.group(1).strip().rstrip(".,")

    deputies_present = None
    dep_m = _DEPUTIES_RE.search(full_text)
    if dep_m:
        deputies_present = int(dep_m.group(1))

    # ── Agenda items ───────────────────────────────────────────────────────────
    # Look for "ORDEM DO DIA" section header then numbered items
    ordem_m = re.search(r"ORDEM DO DIA\s*\n(.*?)(?:\n[A-ZÁÉÍÓÚ]{4,}|\Z)", full_text, re.S | re.I)
    agenda_block = ordem_m.group(1) if ordem_m else full_text[:3000]
    for m in _AGENDA_RE.finditer(agenda_block):
        seq_num = int(m.group(1))
        title   = m.group(2).strip()
        if len(title) < 5:
            continue
        result["agenda_items"].append({
            "_seq":           seq_num,
            "title":          title,
            "topic_category": None,
            "initiatives":    None,
        })

    # ── Split text into speaker blocks ────────────────────────────────────────
    # Find all speaker-start positions
    matches = list(_SPEAKER_RE.finditer(full_text))
    if not matches:
        print("  PDF: no speaker markers found — cannot parse interventions")
    else:
        full_text_parts: list[str] = []
        seq = 0
        for i, m in enumerate(matches):
            speaker_name  = m.group(1).strip()
            party         = m.group(2).strip() if m.group(2) else None
            block_start   = m.end()
            block_end     = matches[i + 1].start() if i + 1 < len(matches) else len(full_text)
            speech_text   = full_text[block_start:block_end].strip()

            # Skip very short blocks (page headers, procedural one-liners)
            if len(speech_text) < 30:
                continue

            # Classify type by name/role
            if "Presidente" in speaker_name and not party:
                itype = "presidência"
            elif re.search(r"Ministr[ao]|Secretári[ao]|Primeiro-Ministr", speaker_name):
                itype = "governo"
            else:
                itype = "intervenção"

            seq += 1
            full_text_parts.append(f"{speaker_name}: {speech_text}")
            stage = _extract_stage_directions(speech_text)
            wc = _count_words(speech_text)
            filler_total, filler_detail = _filler_count(speech_text)

            result["interventions"].append({
                "deputy_name":                speaker_name,
                "party":                      party,
                "type":                       itype,
                "sequence_number":            seq,
                "text":                       speech_text,
                "word_count":                 wc,
                "estimated_duration_seconds": int(wc / 2.5),  # ~150 words/min
                "applause_from":              stage["applause_from"] or None,
                "protests_from":              stage["protests_from"] or None,
                "interrupted_by":             stage["interrupted_by"] or None,
                "was_mic_cutoff":             _detect_cutoff(speech_text),
                "filler_word_count":          filler_total,
                "filler_words_detail":        filler_detail if filler_detail else None,
            })

    # ── Votes ──────────────────────────────────────────────────────────────────
    # Split on vote result sentences
    vote_segs = re.split(
        r"(?=(?:Submetid[ao]|Colocad[ao]|Posta)\s+à\s+votação)",
        full_text, flags=re.I,
    )
    vote_seq = 0
    for seg in vote_segs[1:]:  # skip preamble before first vote
        # Take the first ~500 chars of the segment (the actual vote description)
        vote_block = seg[:500]
        if not _VOTE_RESULT_RE.search(vote_block):
            continue
        vote_seq += 1
        result["votes"].append(_parse_vote_block(vote_block, vote_seq))

    # ── Vote declarations ──────────────────────────────────────────────────────
    # "Declaração de voto do/a Deputado/a [Name] ([Party]): ..."
    for decl_m in re.finditer(
        r"[Dd]eclara[çc][aã]o de voto\s+d[ao]?\s*(?:Deputad[ao]\s+)?([^(:]+?)(?:\s*\(([^)]+)\))?\s*:\s*(.+?)(?=\n[A-ZÁÉÍÓÚ]|\Z)",
        full_text, re.S,
    ):
        deputy = decl_m.group(1).strip()
        party  = decl_m.group(2).strip() if decl_m.group(2) else None
        text   = decl_m.group(3).strip()
        if len(text) > 10:
            result["vote_declarations"].append({
                "party":       party,
                "deputy_name": deputy,
                "text":        text,
            })

    result["session"] = {
        "president_name":   president,
        "deputies_present": deputies_present,
        "full_text":        full_text,
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
            "applause_from":             intvn.get("applause_from") or None,
            "protests_from":             intvn.get("protests_from") or None,
            "interrupted_by":            intvn.get("interrupted_by") or None,
        }
        interventions_to_insert.append(row)

    if interventions_to_insert:
        # Batch insert in chunks of 50; normalize each chunk so every row has
        # identical keys (Supabase PGRST102 requires uniform object shapes).
        for i in range(0, len(interventions_to_insert), 50):
            chunk = interventions_to_insert[i:i+50]
            all_keys = set().union(*[r.keys() for r in chunk])
            chunk = [{k: r.get(k) for k in all_keys} for r in chunk]
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

def cmd_index(leg: str = "XVII", sessao: int = 1):
    """List all DAR sessions for a legislature."""
    sessions = fetch_dar_session_list(leg=leg, sessao=sessao)
    if not sessions:
        print("No sessions found.")
        return
    print(f"\n{'NUM':<8} {'DATE':<12} {'TITLE'}")
    print("─" * 72)
    for s in sessions:
        has_pdf = "✓" if s.get("dar_xml_url") else "✗"
        print(f"{s['number']:<8} {s['date']:<12} [{has_pdf} PDF] {s['title'][:45]}")
    print(f"\nTotal: {len(sessions)} sessions")


def cmd_download(leg: str = "XVII", sessao: int = 1, n: int = 10):
    """Download and cache DAR PDFs for N most recent sessions."""
    sessions = fetch_dar_session_list(leg=leg, sessao=sessao, max_sessions=n)
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


def cmd_parse(leg: str = "XVII", sessao: int = 1, session_date: Optional[str] = None, session_num: Optional[str] = None):
    """Parse one session from XML and upsert to Supabase."""
    sessions = fetch_dar_session_list(leg=leg, sessao=sessao)
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
        print("Failed to download PDF.")
        return

    parsed = parse_dar_pdf(raw, target, leg)
    if not parsed:
        print("Failed to parse PDF.")
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


def cmd_run(leg: str = "XVII", sessao: int = 1, n: int = 5):
    """Full pipeline: index → download → parse → upsert for N most recent sessions."""
    sessions = fetch_dar_session_list(leg=leg, sessao=sessao, max_sessions=n)
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

        parsed = parse_dar_pdf(raw, s, leg)
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
    p_idx.add_argument("--leg",    default="XVII")
    p_idx.add_argument("--sessao", type=int, default=1)

    p_dl = sub.add_parser("download", help="Download PDFs for N most recent sessions")
    p_dl.add_argument("--leg",    default="XVII")
    p_dl.add_argument("--sessao", type=int, default=1)
    p_dl.add_argument("--n",      type=int, default=10)

    p_parse = sub.add_parser("parse", help="Parse one session into Supabase")
    p_parse.add_argument("--leg",          default="XVII")
    p_parse.add_argument("--sessao",       type=int, default=1)
    p_parse.add_argument("--session-date", default=None)
    p_parse.add_argument("--session-num",  default=None)

    p_run = sub.add_parser("run", help="Full pipeline for N most recent sessions")
    p_run.add_argument("--leg",    default="XVII")
    p_run.add_argument("--sessao", type=int, default=1)
    p_run.add_argument("--n",      type=int, default=5)

    args = parser.parse_args()

    if args.cmd == "index":
        cmd_index(leg=args.leg, sessao=args.sessao)
    elif args.cmd == "download":
        cmd_download(leg=args.leg, sessao=args.sessao, n=args.n)
    elif args.cmd == "parse":
        cmd_parse(leg=args.leg, sessao=args.sessao, session_date=args.session_date, session_num=args.session_num)
    elif args.cmd == "run":
        cmd_run(leg=args.leg, sessao=args.sessao, n=args.n)
    else:
        parser.print_help()
