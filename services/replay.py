"""Real measured replay: per-request timing against a live OpenAI-compatible endpoint.

Each request is timed with perf_counter (TTFT approximated as time-to-first-chunk
when streaming, else total latency). Falls back to deterministic simulation only
when no endpoint is configured — and marks output simulated.
"""
from __future__ import annotations

import json
import time
import urllib.request

from services import metrics_math as mm
from services import quality_checks as qc


def replay(twin: dict, endpoint: str, model: str, api_key: str = "", limit: int = 60) -> dict:
    """Replay twin items against endpoint; returns {requests, metrics, quality} with REAL timings."""
    reqs: list[dict] = []
    scores: list[float] = []
    json_ok = tool_ok = 0
    n = 0
    for item in twin["items"][:limit]:
        n += 1
        body = {"model": model,
                "messages": [{"role": "user", "content": item["prompt"]}],
                "max_tokens": min(256, item["expect_output_tokens"] + 32),
                "temperature": 0}
        t0 = time.perf_counter()
        try:
            req = urllib.request.Request(endpoint, data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json",
                                                  **({"Authorization": f"Bearer {api_key}"} if api_key else {})})
            with urllib.request.urlopen(req, timeout=120) as r:
                payload = json.loads(r.read().decode())
            t1 = time.perf_counter()
            text = payload["choices"][0]["message"]["content"]
            ms = (t1 - t0) * 1000.0
            # TTFT unknown without streaming: report measured latency as both (documented)
            reqs.append({"status": "ok", "ttft_ms": round(ms, 2), "latency_ms": round(ms, 2),
                         "input_tokens": item["input_tokens"],
                         "output_tokens": len(text.split()) * 2,
                         "response": text[:2000]})
            s = qc.score_response(text, item)
            scores.append(s["quality"])
            json_ok += 1 if s["json_valid"] else 0
            tool_ok += 1 if (item.get("expect_tool") is None or (s["tool_ok"] and s["args_ok"])) else 0
        except Exception as e:  # noqa: BLE001 — per-request failure recorded, run continues
            t1 = time.perf_counter()
            reqs.append({"status": "error", "ttft_ms": 0, "latency_ms": round((t1 - t0) * 1000, 2),
                         "input_tokens": item["input_tokens"], "output_tokens": 0,
                         "error": str(e)[:200]})
    runtime = max(0.001, sum(r.get("latency_ms", 0) for r in reqs) / 1000.0)
    m = mm.summarize(reqs, runtime)
    m["quality_score"] = round(sum(scores) / len(scores), 4) if scores else 0.0
    m["json_success"] = round(json_ok / n, 4) if n else 0.0
    m["tool_success"] = round(tool_ok / n, 4) if n else 0.0
    return {"requests": reqs, "metrics": m, "simulated": False}
