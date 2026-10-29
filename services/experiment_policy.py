"""SandboxProof policy engine — deterministic, AI cannot bypass.

The planner proposes a serving profile for the certification subject; this
module is the hard boundary. Limits are deliberately conservative so a
runaway planner cannot spend the budget or escape the workload envelope.

Hard limits:
  concurrency      1..32 parallel streams
  context_len      512..8192 input-token budget
  max_tokens       16..512 output budget
  requests         <= 200 per experiment (set by the certification)
  runtime          <= 15 min per sandbox op
  cost             <= $2/experiment, $10/certification, $20 total
  experiments      <= 5
  model            must equal the certification's candidate model
"""
from __future__ import annotations

from dataclasses import dataclass

MAX_CONCURRENCY = 32
MAX_CONTEXT_TOKENS = 8192
MIN_CONTEXT_TOKENS = 512
MAX_OUTPUT_TOKENS = 1024
MIN_OUTPUT_TOKENS = 16
MAX_REQUESTS = 200
MAX_EXPERIMENT_RUNTIME_S = 15 * 60
MAX_EXPERIMENT_COST = 2.0
MAX_CERTIFICATION_COST = 10.0  # user override ($20 total / $10 per-cert)
MAX_EXPERIMENTS = 5


@dataclass(frozen=True)
class ExperimentProposal:
    model: str
    concurrency: int
    context_len: int
    max_tokens: int
    reason: str


@dataclass
class PolicyResult:
    allowed: bool
    reasons: list
    estimated_cost: float


def validate_proposal(proposal: ExperimentProposal, *, experiment_index: int,
                      cert_spend: float, total_spend: float,
                      total_cap: float = 20.0, estimated_cost: float,
                      allowed_model: str | None = None) -> PolicyResult:
    reasons: list[str] = []
    if not (proposal.model or "").strip():
        reasons.append("model is empty")
    if allowed_model and proposal.model.strip() != allowed_model.strip():
        reasons.append(
            f"model {proposal.model} is not the certification subject {allowed_model}")
    if not 1 <= int(proposal.concurrency) <= MAX_CONCURRENCY:
        reasons.append(f"concurrency must be 1..{MAX_CONCURRENCY}")
    if not MIN_CONTEXT_TOKENS <= int(proposal.context_len) <= MAX_CONTEXT_TOKENS:
        reasons.append(
            f"context_len must be {MIN_CONTEXT_TOKENS}..{MAX_CONTEXT_TOKENS}")
    if not MIN_OUTPUT_TOKENS <= int(proposal.max_tokens) <= MAX_OUTPUT_TOKENS:
        reasons.append(f"max_tokens must be {MIN_OUTPUT_TOKENS}..{MAX_OUTPUT_TOKENS}")
    if int(proposal.max_tokens) >= int(proposal.context_len):
        reasons.append("max_tokens must be smaller than context_len")
    if experiment_index >= MAX_EXPERIMENTS:
        reasons.append(f"experiment limit {MAX_EXPERIMENTS} reached")
    if estimated_cost > MAX_EXPERIMENT_COST:
        reasons.append(
            f"estimated ${estimated_cost:.2f} exceeds per-experiment cap "
            f"${MAX_EXPERIMENT_COST:.2f}")
    if cert_spend + estimated_cost > MAX_CERTIFICATION_COST:
        reasons.append(
            f"would exceed per-cert cap ${MAX_CERTIFICATION_COST:.2f}")
    if total_spend + estimated_cost > total_cap:
        reasons.append(f"would exceed total hard cap ${total_cap:.2f}")
    return PolicyResult(allowed=not reasons, reasons=reasons,
                        estimated_cost=estimated_cost)
