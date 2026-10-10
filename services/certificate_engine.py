"""Certificate engine — deterministic SHIP/BLOCK from gate results only. AI never decides."""
from __future__ import annotations


def build_certificate(*, certification_id: str, gate_results: list, metrics: dict,
                      baseline: dict | None = None, spend_usd: float = 0.0,
                      simulated: bool = False) -> dict:
    if simulated:
        raise ValueError("simulator output can never produce a real certificate")
    fails = [g for g in gate_results if not g.passed]
    verdict = "BLOCK" if fails else "SHIP"
    return {
        "certification_id": certification_id,
        "verdict": verdict,
        "failing_gates": [{"metric": g.metric, "observed": g.observed,
                           "threshold": g.threshold, "detail": g.detail} for g in fails],
        "evidence": {"metrics": metrics, "baseline": baseline or {}},
        "spend_usd": round(spend_usd, 4),
    }
