#!/usr/bin/env python3
"""
scrape_deputados.py — Scrape all 230 deputies from Portuguese Parliament (XVI Legislatura)
==========================================================================================
Fetches the full deputy list from the parlamento.pt OData API, downloads their
official photos, uploads them to Supabase Storage, and upserts every deputy into
the `politicians` table so the AI worker can attribute speech segments.

USAGE:
  python scrape_deputados.py                 # fetch deputies + photos + upsert
  python scrape_deputados.py --no-photos     # skip photo download
  python scrape_deputados.py --list          # show what's already in the DB
  python scrape_deputados.py --leg XVI       # choose legislature (default: XVI)

REQUIREMENTS:
  pip install requests lxml beautifulsoup4
  SUPABASE_URL and SUPABASE_SERVICE_KEY must be exported.

HOW IT WORKS:
  1. GET https://app.parlamento.pt/webutils/docs/DeputadosGP.aspx?Leg=XVI
     → Parliament OData XML with all active deputies.
  2. Parse depId, depNome, gpSigla (parliamentary group).
  3. Download photo from https://www.parlamento.pt/DeputadoGP/PublishingImages/fotos/{depId}.jpg
  4. Upload photo bytes to Supabase Storage bucket `politician-photos`.
  5. Upsert row into `politicians` (on conflict by bid → update name/party/photo_url).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

# ─── Configuration ─────────────────────────────────────────────────────────────

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Parliament OData API — returns XML with all deputies per legislature
PARLAMENTO_API_URL   = "https://app.parlamento.pt/webutils/docs/DeputadosGP.aspx"
# Direct-link photos — {depId} is the integer depId from the API
PHOTO_URL_TEMPLATE   = "https://www.parlamento.pt/DeputadoGP/PublishingImages/fotos/{depId}.jpg"
# Individual deputy page (informational, stored in parlamento_url)
DEPUTY_PAGE_TEMPLATE = "https://www.parlamento.pt/DeputadoGP/Paginas/DetalheDeputado.aspx?BID={depId}"

# Map parliament group siglas → short party codes used in the app
# XVI Legislature (from Oct 2024)
PARTY_MAP = {
    # Government coalition
    "AD":     "AD",    # Aliança Democrática (PSD+CDS-PP+PPM)
    "PSD":    "PSD",
    "CDS-PP": "CDS",
    "PPM":    "PPM",
    # Opposition
    "PS":     "PS",
    "CH":     "CH",    # Chega
    "Chega":  "CH",
    "IL":     "IL",    # Iniciativa Liberal
    "BE":     "BE",    # Bloco de Esquerda
    "CDU":    "PCP",   # Coligação Democrática Unitária (PCP+PEV)
    "PCP":    "PCP",
    "L":      "L",     # Livre
    "Livre":  "L",
    "PAN":    "PAN",
    "NI":     "NI",    # Não Inscritos (independents)
}

REQUEST_DELAY = 0.3   # seconds between requests (be polite)
PHOTO_BUCKET  = "politician-photos"

# ─── Supabase REST helpers ──────────────────────────────────────────────────────

def _supa_headers(extra: Optional[dict] = None) -> dict:
    h = {
        "apikey":        SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type":  "application/json",
    }
    if extra:
        h.update(extra)
    return h


def _supa_get(path: str) -> list | dict:
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    req = urllib.request.Request(url, headers=_supa_headers())
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def _supa_upsert(table: str, rows: list[dict]) -> None:
    """Upsert a batch of rows (ignoring conflicts by returning nothing on dup)."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    data = json.dumps(rows).encode()
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers=_supa_headers({
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }),
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"  [supabase] upsert error {e.code}: {body[:200]}")
        raise


def _supa_upload_photo(dep_id: int, photo_bytes: bytes) -> Optional[str]:
    """Upload photo bytes to Supabase Storage. Returns public URL or None."""
    if not photo_bytes:
        return None
    path = f"{dep_id}.jpg"
    url  = f"{SUPABASE_URL}/storage/v1/object/{PHOTO_BUCKET}/{path}"
    req  = urllib.request.Request(
        url, data=photo_bytes, method="POST",
        headers={
            "apikey":        SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type":  "image/jpeg",
            "x-upsert":      "true",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()
        return f"{SUPABASE_URL}/storage/v1/object/public/{PHOTO_BUCKET}/{path}"
    except urllib.error.HTTPError as e:
        # If storage bucket doesn't exist yet, fall back to direct parliament URL
        if e.code in (400, 404):
            return PHOTO_URL_TEMPLATE.format(depId=dep_id)
        print(f"  [storage] upload error {e.code}: {e.read().decode(errors='replace')[:120]}")
        return None


# ─── Parliament API ─────────────────────────────────────────────────────────────

def fetch_deputies_xml(leg: str = "XVI") -> list[dict]:
    """
    Fetch all deputies from the Parliament OData XML endpoint.
    Returns list of dicts: {bid, name, full_name, party, parlamento_url}
    """
    url = f"{PARLAMENTO_API_URL}?Leg={leg}"
    print(f"Fetching deputies from: {url}")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "parlamento-vivo/1.0 (research project)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
    except Exception as e:
        print(f"  ERROR fetching parliament API: {e}")
        return []

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        print(f"  ERROR parsing XML: {e}")
        print(f"  Response preview: {raw[:300]}")
        return []

    # The parliament API wraps everything in a namespace like
    # {http://schemas.datacontract.org/...} or similar.
    # Strip namespaces for simpler parsing.
    deputies = []
    for elem in root.iter():
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        elem.tag = tag

    # Now scan for known element patterns
    # Pattern A: flat <Table> or <Row> elements with depId/depNome/gpSigla
    # Pattern B: nested with <Deputado> or <DeputadoGP>
    for node in root.iter():
        dep_id   = _first_text(node, ["depId", "DepId", "id", "Id"])
        dep_name = _first_text(node, ["depNome", "DepNome", "nome", "Nome", "name"])
        gp_sigla = _first_text(node, ["gpSigla", "GpSigla", "sigla", "Sigla", "gp", "GP", "partido"])
        if dep_id and dep_name and gp_sigla:
            try:
                bid = int(dep_id.strip())
            except ValueError:
                continue
            party = PARTY_MAP.get(gp_sigla.strip(), gp_sigla.strip())
            deputies.append({
                "bid":          bid,
                "name":         dep_name.strip(),
                "full_name":    dep_name.strip(),
                "party":        party,
                "parlamento_url": DEPUTY_PAGE_TEMPLATE.format(depId=bid),
                "legislature":  leg,
            })

    # Deduplicate by bid
    seen: set[int] = set()
    unique = []
    for d in deputies:
        if d["bid"] not in seen:
            seen.add(d["bid"])
            unique.append(d)

    print(f"  Parsed {len(unique)} deputies from XML.")
    return unique


def _first_text(node: ET.Element, tags: list[str]) -> Optional[str]:
    """Return text of the first matching child tag."""
    for t in tags:
        child = node.find(t)
        if child is not None and child.text and child.text.strip():
            return child.text.strip()
    return None


def download_photo(dep_id: int) -> Optional[bytes]:
    """Download a deputy's photo from parlamento.pt. Returns bytes or None."""
    url = PHOTO_URL_TEMPLATE.format(depId=dep_id)
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "parlamento-vivo/1.0"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
        # Sanity check — valid JPEG starts with FF D8
        if len(data) > 1000 and data[:2] == b"\xff\xd8":
            return data
    except Exception:
        pass
    return None


# ─── Fallback: scrape HTML deputy list ─────────────────────────────────────────

def fetch_deputies_html(leg: str = "XVI") -> list[dict]:
    """
    Fallback HTML scraper for the Parliament deputies page.
    Used when the OData endpoint returns unexpected content.
    """
    try:
        from bs4 import BeautifulSoup
        import re
    except ImportError:
        print("  Install beautifulsoup4 for HTML fallback: pip install beautifulsoup4")
        return []

    url = "https://www.parlamento.pt/DeputadoGP/Paginas/Deputados.aspx"
    print(f"  [fallback] Scraping HTML from: {url}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            html = r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  ERROR: {e}")
        return []

    soup = BeautifulSoup(html, "html.parser")
    deputies = []
    for link in soup.select("a[href*='BID=']"):
        href = link.get("href", "")
        m = re.search(r"BID=(\d+)", href)
        if not m:
            continue
        bid  = int(m.group(1))
        name = link.get_text(strip=True)
        if not name or len(name) < 4:
            continue
        # Try to infer party from surrounding context (e.g., row class or parent)
        party = ""
        tr = link.find_parent("tr")
        if tr:
            cells = tr.find_all("td")
            if len(cells) >= 2:
                party = PARTY_MAP.get(cells[-1].get_text(strip=True), cells[-1].get_text(strip=True))
        deputies.append({
            "bid": bid, "name": name, "full_name": name,
            "party": party or "?",
            "parlamento_url": DEPUTY_PAGE_TEMPLATE.format(depId=bid),
            "legislature": leg,
        })

    seen: set[int] = set()
    unique = [d for d in deputies if not (d["bid"] in seen or seen.add(d["bid"]))]
    print(f"  [fallback] Found {len(unique)} deputies from HTML.")
    return unique


# ─── Main commands ──────────────────────────────────────────────────────────────

def cmd_scrape(leg: str = "XVI", skip_photos: bool = False):
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.")
        sys.exit(1)

    deputies = fetch_deputies_xml(leg)
    if len(deputies) < 10:
        print("  XML returned too few results — trying HTML fallback …")
        deputies = fetch_deputies_html(leg)

    if not deputies:
        print("ERROR: Could not fetch deputies. Check your network/API access.")
        sys.exit(1)

    print(f"\nProcessing {len(deputies)} deputies …\n")
    batch: list[dict] = []

    for i, dep in enumerate(deputies, 1):
        bid  = dep["bid"]
        name = dep["name"]
        print(f"  [{i:3d}/{len(deputies)}] {name} ({dep['party']}) bid={bid}", end="", flush=True)

        photo_url = None
        if not skip_photos:
            photo_bytes = download_photo(bid)
            if photo_bytes:
                photo_url = _supa_upload_photo(bid, photo_bytes)
                print(f" 📷", end="", flush=True)
            else:
                # Fall back to direct parliament URL (no upload needed)
                photo_url = PHOTO_URL_TEMPLATE.format(depId=bid)
            time.sleep(REQUEST_DELAY)

        row = {
            "bid":           bid,
            "name":          name,
            "full_name":     dep.get("full_name", name),
            "party":         dep["party"],
            "parlamento_url": dep["parlamento_url"],
            "legislature":   leg,
        }
        if photo_url:
            row["photo_url"] = photo_url

        batch.append(row)
        print()

        # Upsert in batches of 50
        if len(batch) >= 50:
            _supa_upsert("politicians", batch)
            print(f"  → Upserted {len(batch)} rows …")
            batch = []

    if batch:
        _supa_upsert("politicians", batch)
        print(f"  → Upserted {len(batch)} rows …")

    print(f"\n✓ Done! {len(deputies)} deputies synced to Supabase.")


def cmd_list():
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.")
        sys.exit(1)

    rows = _supa_get("politicians?select=name,party,bid,photo_url&order=party,name")
    if not rows:
        print("No deputies in database yet.")
        return

    current_party = None
    for r in rows:
        if r["party"] != current_party:
            current_party = r["party"]
            print(f"\n── {current_party} ──────────────")
        photo = "📷" if r.get("photo_url") else "  "
        bid   = str(r.get("bid") or "").rjust(6)
        print(f"  {photo} {bid}  {r['name']}")

    print(f"\nTotal: {len(rows)} deputies")


# ─── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape Portuguese Parliament deputies")
    parser.add_argument("--leg",        default="XVI", help="Legislature (default: XVI)")
    parser.add_argument("--no-photos",  action="store_true", help="Skip photo download")
    parser.add_argument("--list",       action="store_true", help="List deputies already in DB")
    args = parser.parse_args()

    if args.list:
        cmd_list()
    else:
        cmd_scrape(leg=args.leg, skip_photos=args.no_photos)
