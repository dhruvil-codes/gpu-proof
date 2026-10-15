"""Live GPU market pricing via Tavily Search API (stdlib only).

Two entry points:
  fetch_gpu_prices() -> dict(source, fetched_at, rates, evidence, queries)
  release_radar()     -> list[{model, note, url, days_ago_hint}]

Contract:
- TAVILY_API_KEY comes from the environment at runtime only.
- Successful results are cached to artifacts/market/prices.json + radar.json.
- On ANY failure (missing key, HTTP error, bad payload, unparseable
  rates) raise RuntimeError. Callers decide fallback; this module never
  returns static data silently.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
FRESH_DAYS = 7
RATE_KEYS = ("L40S", "H100", "H200", "B200")
PLAUSIBLE_MIN_USD = 0.20
PLAUSIBLE_MAX_USD = 25.00

PRICE_QUERIES = (
    "Nebius GPU cloud pricing H100 per hour October 2026",
    "Nebius H200 GPU price per hour 2026",
    "GPU cloud H100 H200 B200 L40S price per hour 2026",
)
RADAR_QUERIES = (
    "newest open weight LLM release 2026",
    "new open weight quantized model release FP8 AWQ 2026",
)


def _repo_root() -> Path:
    here = Path(__file__).resolve()
    for cand in (here.parents[1], here.parents[0], Path.cwd()):
        try:
            if (cand / "services").is_dir():
                return cand
        except Exception:
            continue
    return here.parents[1]


def _cache_dir() -> Path:
    override = os.environ.get("TAVILY_CACHE_DIR", "").strip()
    if override:
        return Path(override)
    return _repo_root() / "artifacts" / "market"


def prices_cache_path() -> Path:
    return _cache_dir() / "prices.json"


def radar_cache_path() -> Path:
    return _cache_dir() / "radar.json"


def _api_key() -> str:
    key = (os.environ.get("TAVILY_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("TAVILY_API_KEY is not set")
    return key


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _post_search(query: str, max_results: int = 5,
                 search_depth: str = "advanced",
                 include_answer: bool = True,
                 timeout_s: int = 30) -> dict:
    """POST one query to Tavily. Raises RuntimeError on any failure."""
    key = _api_key()
    body = json.dumps({
        "api_key": key,
        "query": query,
        "max_results": max_results,
        "search_depth": search_depth,
        "include_answer": include_answer,
    }).encode("utf-8")
    req = urllib.request.Request(
        TAVILY_SEARCH_URL, data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"tavily search HTTP {e.code} for {query!r}") from e
    except Exception as e:  # timeouts, DNS, refused
        raise RuntimeError(f"tavily search failed for {query!r}: {e}") from e
    try:
        payload = json.loads(raw)
    except Exception as e:
        raise RuntimeError(f"tavily returned non-JSON for {query!r}") from e
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        raise RuntimeError(f"tavily returned bad payload for {query!r}")
    return payload


_GPU_RE = re.compile(r"\b(H100|H200|B200|L40S)\b", re.IGNORECASE)
# $3.20/hr, $3.20 per hour, $3.20/GPU-hr, 3.20 USD/hour
_PRICE_RE = re.compile(
    r"\$\s*(?P<dollar>\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?|\d+(?:\.\d{1,4})?)"
    r"\s*(?:/\s*(?:gpu\s*[-–]?\s*)?h(?:r|our)?\b|per\s+(?:gpu\s*[-–]?\s*)?h(?:ou)?r\b)",
    re.IGNORECASE,
)
_PRICE_USD_RE = re.compile(
    r"(?P<usd>\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?|\d+(?:\.\d{1,4})?)\s*USD\s*"
    r"(?:/\s*(?:gpu\s*[-–]?\s*)?h(?:r|our)?\b|per\s+(?:gpu\s*[-–]?\s*)?h(?:ou)?r\b)",
    re.IGNORECASE,
)
_DAYS_AGO_RE = re.compile(r"(\d{1,3})\s+days?\s+ago", re.IGNORECASE)
# Hour-unit guard: a bare "$X" only counts when hourly billing is explicit
# nearby (rejects per-token $/1M inference prices that slip through prose).
_HOUR_RE = re.compile(r"(?:/\s*(?:gpu\s*[-–]?\s*)?h(?:r|our)?\b|per\s+(?:gpu\s*[-–]?\s*)?h(?:ou)?r\b|hourly|gpu[\s-]?h\b)", re.IGNORECASE)
# Per-tier sanity floors AND ceilings (Oct 2026 Nebius PAYG ± sane band).
# Anything outside is a confused token-rate, spot anomaly, or stale figure.
RATE_FLOOR_USD = {"L40S": 0.80, "H100": 2.50, "H200": 3.00, "B200": 5.00}
RATE_CEIL_USD = {"L40S": 3.00, "H100": 8.00, "H200": 10.00, "B200": 15.00}


def _num(s: str) -> float | None:
    try:
        return float(s.replace(",", ""))
    except (TypeError, ValueError):
        return None


def _prices_in_text(text: str) -> list[tuple[int, float]]:
    """All (char_offset, usd_per_hr) hits in a text blob."""
    hits: list[tuple[int, float]] = []
    for m in _PRICE_RE.finditer(text):
        v = _num(m.group("dollar"))
        if v is not None:
            hits.append((m.start(), v))
    for m in _PRICE_USD_RE.finditer(text):
        v = _num(m.group("usd"))
        if v is not None:
            hits.append((m.start(), v))
    return hits


def extract_rates_from_results(results: list[dict],
                               answer: str | None = None) -> tuple[dict, list[dict]]:
    """Associate per-GPU hourly rates from Tavily result blobs.

    Returns (rates, evidence). A price votes only when ALL hold:
      - an hour unit (/hr, /hour, per hour, hourly, GPU-h) within +/-60 chars
        (rejects per-token $/1M inference prices and stray dollar figures);
      - at or above the per-tier floor (Oct 2026 PAYG minus sane discount):
        L40S $0.80, H100 $2.50, H200 $3.00, B200 $5.00;
      - within the global $0.20-$25.00 band;
      - nearest GPU mention within 500 chars.
    Cheapest surviving observation wins per tier. Raises RuntimeError when
    no usable rate is found at all (callers fall back to the static table
    with honest provenance — never a hallucinated market rate).
    """
    buckets: dict[str, list[float]] = {k: [] for k in RATE_KEYS}
    texts: list[str] = []
    for r in results or []:
        if not isinstance(r, dict):
            continue
        blob = f"{r.get('title') or ''}\n{r.get('content') or ''}"
        texts.append(blob)
    if answer:
        texts.append(str(answer))
    for text in texts:
        price_hits = _prices_in_text(text)
        if not price_hits:
            continue
        gpu_hits = [(m.start(), m.group(1).upper()) for m in _GPU_RE.finditer(text)]
        if not gpu_hits:
            continue
        # Each price votes only for its NEAREST GPU mention (<=500 chars),
        # and only with an hour unit nearby (rejects $/1M-token prices) and
        # at/above the per-tier floor (rejects confused token-rate figures):
        for pos, val in price_hits:
            if not (PLAUSIBLE_MIN_USD <= val <= PLAUSIBLE_MAX_USD):
                continue
            window = text[max(0, pos - 60):pos + 60]
            if not _HOUR_RE.search(window):
                continue
            best_gpu: str | None = None
            best_dist: int | None = None
            for gpos, gpu in gpu_hits:
                d = abs(pos - gpos)
                if d <= 500 and (best_dist is None or d < best_dist):
                    best_gpu, best_dist = gpu, d
            if best_gpu is not None and best_gpu in buckets \
                    and val >= RATE_FLOOR_USD.get(best_gpu, 0.0) \
                    and val <= RATE_CEIL_USD.get(best_gpu, 25.0):
                buckets[best_gpu].append(val)
    rates: dict[str, float] = {}
    for gpu, vals in buckets.items():
        if not vals:
            continue
        vals.sort()
        rates[gpu] = round(min(vals), 4)
    if not rates:
        raise RuntimeError("could not extract any GPU hourly rate from tavily results")
    evidence = extract_evidence(results)
    return rates, evidence


def extract_evidence(results: list[dict], limit: int = 10) -> list[dict]:
    """[{title, url}] for results with an http(s) url (offline-safe)."""
    out: list[dict] = []
    for r in results or []:
        if not isinstance(r, dict):
            continue
        url = (r.get("url") or "").strip()
        if not url.startswith("http"):
            continue
        title = (r.get("title") or "").strip()[:160] or url
        out.append({"title": title, "url": url})
        if len(out) >= limit:
            break
    return out


def _extract_days_ago(text: str) -> int | None:
    m = _DAYS_AGO_RE.search(text or "")
    if not m:
        return None
    try:
        return int(m.group(1))
    except (TypeError, ValueError):
        return None


def parse_radar_results(results: list[dict], limit: int = 10) -> list[dict]:
    """Map raw Tavily results to release-radar items (pure, offline-safe)."""
    items: list[dict] = []
    for r in results or []:
        if not isinstance(r, dict):
            continue
        url = (r.get("url") or "").strip()
        if not url.startswith("http"):
            continue
        title = (r.get("title") or "").strip()
        content = (r.get("content") or "").strip()
        model = re.split(r"\s[-–—|:]\s", title)[0].strip()[:120] or "unknown-open-weight-release"
        days = (r.get("published_date") or r.get("publishedDate")
                or r.get("published") or _extract_days_ago(content + " " + title))
        try:
            days_hint = int(days) if days is not None and str(days).strip().isdigit() else days
        except (TypeError, ValueError):
            days_hint = days
        items.append({
            "model": model,
            "note": content[:240],
            "url": url,
            "days_ago_hint": days_hint,
        })
        if len(items) >= limit:
            break
    return items


def is_fresh(fetched_at: str | None, max_days: int = FRESH_DAYS) -> bool:
    """True when fetched_at ISO8601 is within max_days of now (UTC)."""
    if not fetched_at or not isinstance(fetched_at, str):
        return False
    try:
        ts = datetime.fromisoformat(fetched_at.strip().replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - ts
        return 0 <= delta.total_seconds() <= max_days * 86400
    except (ValueError, TypeError):
        return False


def save_prices(doc: dict, path: Path | str | None = None) -> Path:
    dest = Path(path) if path else prices_cache_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    return dest


def load_cached_prices(path: Path | str | None = None) -> dict | None:
    src = Path(path) if path else prices_cache_path()
    try:
        doc = json.loads(src.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or not isinstance(doc.get("rates"), dict):
        return None
    return doc


def save_radar(items: list, path: Path | str | None = None) -> Path:
    dest = Path(path) if path else radar_cache_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(
        {"source": "tavily", "fetched_at": _now_iso(), "releases": items},
        indent=2), encoding="utf-8")
    return dest


def load_cached_radar(path: Path | str | None = None) -> list | None:
    src = Path(path) if path else radar_cache_path()
    try:
        doc = json.loads(src.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    items = doc.get("releases") if isinstance(doc, dict) else None
    return items if isinstance(items, list) else None


def fetch_gpu_prices(queries: tuple | list | None = None,
                     max_results: int = 5,
                     cache: bool = True) -> dict:
    """Fetch live per-hour GPU rates via 2-3 targeted Tavily queries.

    Raises RuntimeError on any failure or when any of L40S/H100/H200/B200
    cannot be extracted (callers decide fallback).
    """
    qs = list(queries) if queries else list(PRICE_QUERIES)
    all_results: list[dict] = []
    answers: list[str] = []
    for q in qs:
        payload = _post_search(q, max_results=max_results)
        all_results.extend(payload.get("results") or [])
        if payload.get("answer"):
            answers.append(str(payload["answer"]))
    rates, evidence = extract_rates_from_results(
        all_results, answer="\n".join(answers) or None)
    missing = [k for k in RATE_KEYS if k not in rates]
    if missing:
        raise RuntimeError(f"tavily missing rates for: {', '.join(missing)}")
    doc = {
        "source": "tavily",
        "fetched_at": _now_iso(),
        "rates": {k: rates[k] for k in RATE_KEYS},
        "evidence": evidence,
        "queries": qs,
    }
    if cache:
        try:
            save_prices(doc)
        except OSError:
            pass  # cache write failure must not fail the fetch itself
    return doc


def release_radar(queries: tuple | list | None = None,
                  max_results: int = 5,
                  cache: bool = True) -> list[dict]:
    """Newest open-weight releases/quants via 1-2 Tavily queries.

    Raises RuntimeError on any failure or empty parse.
    """
    qs = list(queries) if queries else list(RADAR_QUERIES)
    all_results: list[dict] = []
    for q in qs:
        payload = _post_search(q, max_results=max_results)
        all_results.extend(payload.get("results") or [])
    items = parse_radar_results(all_results)
    if not items:
        raise RuntimeError("tavily returned no parseable release-radar results")
    if cache:
        try:
            save_radar(items)
        except OSError:
            pass
    return items
