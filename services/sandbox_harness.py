"""Sandbox replay harness — runs INSIDE a fresh Nebius Sandbox microVM.

The host uploads this file plus ``twin.json``, ``quality_checks.py`` and
``metrics_math.py`` into ``/work`` and starts it with a per-op environment.
The harness replays the sealed workload twin against a live OpenAI-compatible
endpoint, measures every request with ``perf_counter``, scores each response
with the deterministic quality checks, and prints one compact JSON document
to stdout. It never prints the API key.

Environment contract (all required unless noted):
    TF_BASE_URL       e.g. https://api.tokenfactory.nebius.com/v1
    TF_KEY            per-op inference key (never logged)
    MODEL             candidate model slug
    CONCURRENCY       1..32 parallel requests
    CONTEXT_LEN       approximate total input-token budget (padding target)
    MAX_TOKENS        output budget per request
    REQUESTS          number of twin items to replay
    REQUEST_TIMEOUT_S optional, default 90

Output contract:
    {"ok": true, "model": ..., "config": {...}, "metrics": {...},
     "quality": {...}, "requests": [...], "errors": [...], "elapsed_s": ...}
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from metrics_math import summarize
from quality_checks import score_response

PAD_SENTENCE = (
    "The following policy context is provided for the workload replay. "
    "Treat it as background material and answer only the final user request. "
)


def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = default
    return max(lo, min(hi, value))


def _context_pad(context_len: int, prompt: str) -> str:
    """Build a system message that approximates the requested input budget.

    Rough token estimate: 4 characters per token. The API's usage block is
    authoritative for the measured token counts; this only shapes the load.
    """
    target_chars = max(0, int(context_len) * 4 - len(prompt) - 64)
    if target_chars < 32:
        return ""
    repeats = target_chars // len(PAD_SENTENCE) + 1
    return (PAD_SENTENCE * repeats)[:target_chars]


def _chat_url(base: str) -> str:
    base = (base or "").strip().rstrip("/")
    if not base:
        raise RuntimeError("TF_BASE_URL is empty")
    if base.endswith("/chat/completions"):
        return base
    return base + "/chat/completions"


def _one(item: dict, *, url: str, key: str, model: str, max_tokens: int,
         context_len: int, timeout_s: int) -> dict:
    prompt = str(item.get("prompt") or "")
    if item.get("expect_tool"):
        prompt += f" Output format: {{\"tool\": \"{item['expect_tool']}\", \"arguments\": ...}}"
    elif item.get("expect_schema"):
        prompt += ' Output format: {"answer": "result summary", "confidence": 0.95}'
    system = _context_pad(context_len, prompt)
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    body = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0,
        "stream": False,
    }
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers=headers, method="POST")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            payload = json.loads(r.read().decode())
        latency_ms = (time.perf_counter() - t0) * 1000.0
        text = payload["choices"][0]["message"].get("content") or ""
        usage = payload.get("usage") or {}
        tokens_in = int(usage.get("prompt_tokens") or 0)
        tokens_out = int(usage.get("completion_tokens") or 0)
        score = score_response(text, item)
        return {
            "id": item.get("id"),
            "status": "ok",
            "latency_ms": round(latency_ms, 2),
            "ttft_ms": round(latency_ms, 2),  # non-streaming: total == first token
            "input_tokens": tokens_in,
            "output_tokens": tokens_out,
            "quality": score["quality"],
            "json_valid": score["json_valid"],
            "schema_ok": score["schema_ok"],
            "tool_ok": score["tool_ok"],
            "args_ok": score["args_ok"],
            "text": text[:400],
        }
    except urllib.error.HTTPError as e:
        latency_ms = (time.perf_counter() - t0) * 1000.0
        try:
            detail = e.read().decode()[:300]
        except Exception:  # noqa: BLE001
            detail = str(e)[:300]
        return {
            "id": item.get("id"), "status": "error",
            "latency_ms": round(latency_ms, 2), "ttft_ms": 0,
            "input_tokens": 0, "output_tokens": 0,
            "error": f"HTTP {e.code}: {detail}",
        }
    except Exception as e:  # noqa: BLE001 — per-request failure is data
        latency_ms = (time.perf_counter() - t0) * 1000.0
        return {
            "id": item.get("id"), "status": "error",
            "latency_ms": round(latency_ms, 2), "ttft_ms": 0,
            "input_tokens": 0, "output_tokens": 0,
            "error": f"{type(e).__name__}: {str(e)[:300]}",
        }


def main() -> int:
    base = os.environ.get("TF_BASE_URL", "https://api.tokenfactory.nebius.com/v1")
    key = os.environ.get("TF_KEY", "")
    model = os.environ.get("MODEL", "").strip()
    if not model:
        print(json.dumps({"ok": False, "error": "MODEL is empty"}))
        return 2
    concurrency = _env_int("CONCURRENCY", 8, 1, 32)
    context_len = _env_int("CONTEXT_LEN", 4096, 256, 32768)
    max_tokens = _env_int("MAX_TOKENS", 256, 16, 2048)
    requests_n = _env_int("REQUESTS", 40, 1, 200)
    timeout_s = _env_int("REQUEST_TIMEOUT_S", 90, 5, 300)

    work = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(work, "twin.json"), "r", encoding="utf-8") as fh:
        twin = json.load(fh)
    items = list(twin.get("items") or [])[:requests_n]
    if not items:
        print(json.dumps({"ok": False, "error": "twin has no items"}))
        return 2

    url = _chat_url(base)
    print(f"replay: {len(items)} requests, concurrency {concurrency}, "
          f"ctx {context_len}, max_tokens {max_tokens}", file=sys.stderr)
    t0 = time.perf_counter()
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [
            pool.submit(_one, item, url=url, key=key, model=model,
                        max_tokens=max_tokens, context_len=context_len,
                        timeout_s=timeout_s)
            for item in items
        ]
        for fut in as_completed(futures):
            results.append(fut.result())
    elapsed_s = time.perf_counter() - t0
    results.sort(key=lambda r: str(r.get("id")))

    metrics = summarize(results, max(elapsed_s, 0.001))
    ok = [r for r in results if r.get("status") == "ok"]
    quality = round(sum(r.get("quality", 0.0) for r in ok) / len(ok), 4) if ok else 0.0
    json_success = round(sum(1 for r in ok if r.get("json_valid")) / len(ok), 4) if ok else 0.0
    tool_ok = [r for r in ok if r.get("tool_ok") and r.get("args_ok")]
    tool_total = [r for r in ok if r.get("tool_ok") is not None]
    metrics["quality_score"] = quality
    metrics["json_success"] = json_success
    metrics["tool_success"] = (round(len(tool_ok) / len(tool_total), 4)
                               if tool_total else 0.0)
    metrics["count"] = len(results)
    errors = [r.get("error") for r in results if r.get("status") != "ok"][:8]
    print(f"replay: done in {elapsed_s:.2f}s, p95 {metrics['latency_p95_ms']}ms, "
          f"quality {quality}, errors {metrics['error_rate']}", file=sys.stderr)
    print(json.dumps({
        "ok": True,
        "model": model,
        "config": {"concurrency": concurrency, "context_len": context_len,
                   "max_tokens": max_tokens, "requests": len(items)},
        "metrics": metrics,
        "quality": {"score": quality, "json_success": json_success,
                    "tool_success": metrics["tool_success"]},
        "requests": results,
        "errors": errors,
        "elapsed_s": round(elapsed_s, 3),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
