"""SLA evaluator — every hard gate checked against measured metrics. Any fail = BLOCK."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Gate:
    metric: str
    op: str  # <=, >=
    threshold: float


@dataclass
class GateResult:
    metric: str
    op: str
    threshold: float
    observed: float | None
    passed: bool
    detail: str


def evaluate_gates(gates: list[Gate], metrics: dict) -> list[GateResult]:
    out: list[GateResult] = []
    for g in gates:
        obs = metrics.get(g.metric)
        if obs is None:
            out.append(GateResult(g.metric, g.op, g.threshold, None, False, "metric missing -> BLOCK"))
            continue
        passed = (obs <= g.threshold) if g.op == "<=" else (obs >= g.threshold)
        out.append(GateResult(g.metric, g.op, g.threshold, obs, passed,
                              f"{obs} {g.op} {g.threshold} -> {'PASS' if passed else 'FAIL'}"))
    return out


def decision(results: list[GateResult]) -> str:
    return "SHIP" if results and all(r.passed for r in results) else "BLOCK"
