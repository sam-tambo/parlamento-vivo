#!/usr/bin/env python3
"""
scraper.py — ARTV Plenário session URL scraper
===============================================
Uses Playwright to handle JavaScript-rendered pages.
Intercepts XHR/fetch API calls to discover the real data endpoint,
then falls back to DOM scraping if no API is found.

Usage (standalone):
  python scraper.py [limit]          # Print latest N session URLs (default 20)
"""

import json
import re
import sys
import time
from typing import Optional

try:
    from playwright.sync_api import sync_playwright, Response, Page
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

ARTV_BASE = "https://canal.parlamento.pt"
PLENARIO_URL = f"{ARTV_BASE}/plenario"


# ─── Public API ───────────────────────────────────────────────────────────────

def get_latest_session_urls(limit: int = 20) -> list[dict]:
    """
    Scrape canal.parlamento.pt/plenario and return up to `limit` session dicts:
      [{"url": str, "date": str, "title": str}, ...]
    Sessions are ordered newest-first as displayed on the page.
    """
    if not PLAYWRIGHT_AVAILABLE:
        raise ImportError(
            "playwright not installed. Run:\n"
            "  pip install playwright\n"
            "  playwright install chromium"
        )

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
        )

        # ── Intercept all JSON API responses ─────────────────────────────────
        intercepted: list[dict] = []

        def on_response(resp: Response):
            ct = resp.headers.get("content-type", "")
            if "json" not in ct:
                return
            try:
                body = resp.json()
                if isinstance(body, (list, dict)) and body:
                    intercepted.append({"url": resp.url, "body": body})
            except Exception:
                pass

        page = context.new_page()
        page.on("response", on_response)

        print(f"[scraper] Loading {PLENARIO_URL} …", flush=True)
        try:
            page.goto(PLENARIO_URL, wait_until="networkidle", timeout=45_000)
        except Exception:
            page.goto(PLENARIO_URL, timeout=45_000)
            time.sleep(6)

        sessions = (
            _sessions_from_api(intercepted, limit)
            or _sessions_from_next_data(page, limit)
            or _sessions_from_dom(page, limit)
        )

        browser.close()

    print(f"[scraper] Found {len(sessions)} sessions.", flush=True)
    return sessions[:limit]


# ─── Strategy 1: intercepted JSON API ────────────────────────────────────────

def _sessions_from_api(intercepted: list[dict], limit: int) -> list[dict]:
    """Try to find session list in intercepted API responses."""
    for item in intercepted:
        body = item["body"]
        candidates = _find_session_arrays(body)
        if candidates:
            print(f"[scraper] API hit: {item['url']}", flush=True)
            return [_normalise(s) for s in candidates[:limit]]
    return []


def _find_session_arrays(obj, depth: int = 0) -> list:
    """Recursively find a list that looks like a session/video catalogue."""
    if depth > 8:
        return []

    if isinstance(obj, list) and obj:
        first = obj[0]
        if isinstance(first, dict) and _looks_like_session(first):
            return obj

    if isinstance(obj, dict):
        # Check known catalogue keys first
        for key in ("items", "sessions", "videos", "plenario", "results",
                    "data", "content", "programas", "programa"):
            val = obj.get(key)
            if isinstance(val, list) and val and isinstance(val[0], dict):
                if _looks_like_session(val[0]):
                    return val
        # Recurse
        for val in obj.values():
            found = _find_session_arrays(val, depth + 1)
            if found:
                return found
    return []


def _looks_like_session(d: dict) -> bool:
    """Heuristic: does this dict look like a session/video entry?"""
    keys = set(k.lower() for k in d)
    url_keys   = {"url", "link", "href", "slug", "path", "id"}
    date_keys  = {"date", "data", "datahora", "inicio", "start", "timestamp"}
    title_keys = {"title", "titulo", "descricao", "description", "nome", "name"}
    return bool(keys & url_keys) and bool(keys & (date_keys | title_keys))


def _normalise(d: dict) -> dict:
    """Normalise a raw session dict into {url, date, title}."""
    url   = d.get("url") or d.get("link") or d.get("href") or d.get("slug", "")
    date  = (d.get("date") or d.get("data") or d.get("dataHora")
             or d.get("inicio") or d.get("timestamp") or "")
    title = (d.get("title") or d.get("titulo") or d.get("descricao")
             or d.get("description") or d.get("nome") or "")
    if url and not url.startswith("http"):
        url = ARTV_BASE + (url if url.startswith("/") else "/" + url)
    return {"url": url, "date": str(date)[:10], "title": str(title)[:120]}


# ─── Strategy 2: Next.js __NEXT_DATA__ ───────────────────────────────────────

def _sessions_from_next_data(page: "Page", limit: int) -> list[dict]:
    """Extract sessions from Next.js __NEXT_DATA__ JSON island."""
    try:
        raw = page.evaluate(
            "() => { const el = document.getElementById('__NEXT_DATA__'); "
            "return el ? el.textContent : null; }"
        )
        if not raw:
            return []
        data = json.loads(raw)
        candidates = _find_session_arrays(data)
        if candidates:
            print("[scraper] Found sessions in __NEXT_DATA__", flush=True)
            return [_normalise(s) for s in candidates[:limit]]
    except Exception as e:
        print(f"[scraper] __NEXT_DATA__ parse error: {e}", flush=True)
    return []


# ─── Strategy 3: DOM scraping ─────────────────────────────────────────────────

# Ordered from most specific to most generic
_LINK_SELECTORS = [
    "a[href*='/vod/']",
    "a[href*='/sessao/']",
    "a[href*='/session/']",
    "a[href*='/video/']",
    "a[href*='/programa/']",
    "a[href*='/emissao/']",
    ".video-card a",
    ".session-item a",
    ".episode-card a",
    ".program-card a",
    ".card a",
    "article a",
]

def _sessions_from_dom(page: "Page", limit: int) -> list[dict]:
    """Brute-force: try common selectors and collect unique hrefs."""
    seen: set[str] = set()
    results: list[dict] = []

    for selector in _LINK_SELECTORS:
        try:
            elements = page.query_selector_all(selector)
            for el in elements:
                href = el.get_attribute("href") or ""
                if not href or href in seen:
                    continue
                full_url = href if href.startswith("http") else ARTV_BASE + href
                # Skip the plenario landing page itself
                if full_url.rstrip("/") == PLENARIO_URL.rstrip("/"):
                    continue
                seen.add(href)

                # Extract date from nearby text or aria-label
                text = (el.get_attribute("aria-label") or el.inner_text() or "").strip()
                date_match = re.search(r"(\d{4}[-/]\d{2}[-/]\d{2})", text)
                date_str = date_match.group(1).replace("/", "-") if date_match else ""

                results.append({"url": full_url, "date": date_str, "title": text[:120]})
                if len(results) >= limit:
                    break
        except Exception:
            continue
        if results:
            break

    # Also try to pull the live HLS URL if no VODs found
    if not results:
        try:
            # Look for <video src=...> or <source src=...>
            src = page.evaluate(
                "() => { "
                "  const v = document.querySelector('video source, video'); "
                "  return v ? (v.src || v.getAttribute('src')) : null; "
                "}"
            )
            if src:
                print(f"[scraper] Found live stream source: {src[:80]}", flush=True)
                results.append({"url": src, "date": "", "title": "Plenário ao vivo"})
        except Exception:
            pass

    if results:
        print(f"[scraper] DOM scraping found {len(results)} links", flush=True)
    else:
        print("[scraper] WARNING: No session links found. The site structure may have changed.", flush=True)

    return results[:limit]


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    sessions = get_latest_session_urls(limit)
    print(f"\n{'URL':<80} {'DATE':<12} TITLE")
    print("-" * 120)
    for s in sessions:
        print(f"{s['url']:<80} {s['date']:<12} {s['title'][:30]}")
