"""Deterministic failure classifier rules. Obvious cases never need the LLM."""
from __future__ import annotations


def classify(log_text: str = "", *, oom: bool = False, timeout: bool = False,
             load_failed: bool = False, metrics: dict | None = None,
             truncated: bool = False) -> str:
    """Classify failure into: TRUNCATION | MEMORY | LATENCY | RELIABILITY | INFRASTRUCTURE | QUALITY | UNKNOWN."""
    t = (log_text or "").lower()
    # 1. Truncation failure: model ran out of output token budget before completing JSON
    if truncated or "truncat" in t or "finish_reason: length" in t or "max_tokens exceeded" in t:
        return "TRUNCATION"
    # 2. Out of Memory / Hardware exhaustion
    if oom or "out of memory" in t or "cuda oom" in t or "oom" in t:
        return "MEMORY"
    # 3. Model loading or binary execution crash
    if load_failed or ("model load" in t and "fail" in t):
        return "RELIABILITY"
    # 4. Timeout / microVM deadline
    if timeout or "timeout" in t or "deadline exceeded" in t:
        return "INFRASTRUCTURE"
    m = metrics or {}
    if m.get("error_rate", 0) is not None and m.get("error_rate", 0) > 0.2:
        return "RELIABILITY"
    if "latency" in t or (m.get("latency_p95_ms") and m.get("latency_p95_ms", 0) > 10000):
        return "LATENCY"
    # If JSON is invalid specifically due to truncation
    if "quality" in t or (m.get("quality_score") is not None and m.get("quality_score", 1) < 0.5):
        if "max_tokens" in t or "cut off" in t:
            return "TRUNCATION"
        return "QUALITY"
    return "UNKNOWN"


def next_action(failure: str, *, budget_left: float, attempts_left: int) -> str:
    if attempts_left <= 0 or budget_left <= 0:
        return "STOP_BUDGET"
    if failure in ("TRUNCATION", "MEMORY", "LATENCY", "QUALITY", "RELIABILITY", "INFRASTRUCTURE", "UNKNOWN"):
        return "CONTINUE"
    return "CONTINUE"
