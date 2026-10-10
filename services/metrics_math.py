"""Metrics math: p50/p95, throughput, rates. Pure functions over measured samples."""
from __future__ import annotations

import statistics


def percentile(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    k = (len(s) - 1) * (p / 100.0)
    f, c = int(k), min(int(k) + 1, len(s) - 1)
    if f == c:
        return float(s[f])
    return float(s[f] + (s[c] - s[f]) * (k - f))


def summarize(requests: list[dict], runtime_s: float) -> dict:
    ok = [r for r in requests if r.get("status") == "ok"]
    ttfts = [r["ttft_ms"] for r in ok if "ttft_ms" in r]
    lats = [r["latency_ms"] for r in ok if "latency_ms" in r]
    in_tok = sum(r.get("input_tokens", 0) for r in ok)
    out_tok = sum(r.get("output_tokens", 0) for r in ok)
    total = len(requests)
    return {
        "count": total,
        "success_rate": round(len(ok) / total, 4) if total else 0.0,
        "error_rate": round((total - len(ok)) / total, 4) if total else 0.0,
        "ttft_p50_ms": round(percentile(ttfts, 50), 2),
        "ttft_p95_ms": round(percentile(ttfts, 95), 2),
        "latency_p50_ms": round(percentile(lats, 50), 2),
        "latency_p95_ms": round(percentile(lats, 95), 2),
        "requests_per_s": round(len(ok) / runtime_s, 3) if runtime_s > 0 else 0.0,
        "tokens_per_s": round((in_tok + out_tok) / runtime_s, 2) if runtime_s > 0 else 0.0,
        "total_tokens": in_tok + out_tok,
    }
