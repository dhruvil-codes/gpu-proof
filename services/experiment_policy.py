"""SandboxProof policy engine — deterministic, AI cannot bypass.

Hard limits (PRD 7.5, tightened by user $20 total / $10 per-cert):
MAX_GPU_COUNT=1, MAX_PARALLEL=2, MAX_RUNTIME=15min, MAX_EXP_COST=$2,
MAX_CERT_COST=$10 (user override of PRD $15), MAX_EXPERIMENTS=5,
GPU_TYPES=[L40S,H100], ENGINES=[vLLM].
"""
from __future__ import annotations

from dataclasses import dataclass

MAX_GPU_COUNT = 1
MAX_PARALLEL_EXPERIMENTS = 2
MAX_EXPERIMENT_RUNTIME_S = 15 * 60
MAX_EXPERIMENT_COST = 2.0
MAX_CERTIFICATION_COST = 10.0  # user override ($20 total / $10 per-cert)
MAX_EXPERIMENTS = 5
GPU_TYPES = ("L40S", "H100")
SERVING_ENGINES = ("vLLM",)


@dataclass(frozen=True)
class ExperimentProposal:
    gpu_type: str
    gpu_count: int
    precision: str
    engine: str
    batch_config: int
    reason: str


@dataclass
class PolicyResult:
    allowed: bool
    reasons: list
    estimated_cost: float


def validate_proposal(proposal: ExperimentProposal, *, experiment_index: int,
                      cert_spend: float, total_spend: float, total_cap: float = 20.0,
                      estimated_cost: float) -> PolicyResult:
    reasons: list[str] = []
    if proposal.gpu_type not in GPU_TYPES:
        reasons.append(f"gpu_type {proposal.gpu_type} not in {list(GPU_TYPES)}")
    if proposal.gpu_count != MAX_GPU_COUNT and proposal.gpu_count > MAX_GPU_COUNT:
        reasons.append(f"gpu_count {proposal.gpu_count} exceeds max {MAX_GPU_COUNT}")
    if proposal.gpu_count < 1:
        reasons.append("gpu_count must be >= 1")
    if proposal.engine not in SERVING_ENGINES:
        reasons.append(f"engine {proposal.engine} not in {list(SERVING_ENGINES)}")
    if proposal.precision not in ("FP8", "INT4", "FP16", "BF16"):
        reasons.append(f"precision {proposal.precision} unsupported")
    if not 1 <= proposal.batch_config <= 64:
        reasons.append("batch_config must be 1..64")
    if experiment_index >= MAX_EXPERIMENTS:
        reasons.append(f"experiment limit {MAX_EXPERIMENTS} reached")
    if estimated_cost > MAX_EXPERIMENT_COST:
        reasons.append(f"estimated ${estimated_cost:.2f} exceeds per-experiment cap ${MAX_EXPERIMENT_COST:.2f}")
    if cert_spend + estimated_cost > MAX_CERTIFICATION_COST:
        reasons.append(f"would exceed per-cert cap ${MAX_CERTIFICATION_COST:.2f}")
    if total_spend + estimated_cost > total_cap:
        reasons.append(f"would exceed total hard cap ${total_cap:.2f}")
    return PolicyResult(allowed=not reasons, reasons=reasons, estimated_cost=estimated_cost)
