"""State machine: QUEUED->VALIDATING->PROVISIONING->MODEL_LOADING->WARMUP->BENCHMARKING->EVALUATING->COMPLETED->DESTROYED."""
from __future__ import annotations

ORDER = ["QUEUED", "VALIDATING", "PROVISIONING", "MODEL_LOADING", "WARMUP",
         "BENCHMARKING", "EVALUATING", "COMPLETED", "DESTROYED"]
FAILURES = {"OOM", "MODEL_LOAD_FAILED", "TIMEOUT", "INFRA_FAILURE", "SLA_FAILED",
            "QUALITY_FAILED", "CANCELLED", "BUDGET_EXCEEDED"}


def advance(state: str) -> str:
    if state in FAILURES:
        raise ValueError(f"terminal failure {state}; no advance")
    i = ORDER.index(state)
    if i >= len(ORDER) - 1:
        raise ValueError("already terminal DESTROYED")
    return ORDER[i + 1]


def fail(state: str, failure: str) -> str:
    if failure not in FAILURES:
        raise ValueError(f"unknown failure {failure}")
    if state in ("COMPLETED", "DESTROYED"):
        raise ValueError(f"cannot fail from {state}")
    return failure
