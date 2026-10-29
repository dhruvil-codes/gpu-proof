"""Cost engine — measured sandbox spend + inference token estimates.

Sandbox ops are billed by the Contree service (the SDK returns the exact
``cost`` per operation). Inference tokens are billed by Token Factory; the
blended list-price estimate below is used only for the pre-spend reserve and
the certificate's $/1k projection, and is labelled as an estimate.
"""
from __future__ import annotations

GPU_HOURLY_USD = {"L40S": 1.35, "H100": 4.50}  # retained for the sizing widget
CPU_HOURLY_USD = 0.012
RAM_HOURLY_USD = 0.0032

# Conservative reserve for a sandbox op; the measured cost is usually lower.
SANDBOX_OP_RESERVE_USD = 0.01
# Blended Token Factory list-price estimate per 1M tokens (input + output).
INFERENCE_USD_PER_1M_TOKENS = 0.15


def experiment_cost(gpu_type: str, runtime_s: float, cpus: int = 8, ram_gib: int = 32) -> float:
    """Legacy GPU estimate, kept for the landing-page sizing widget only."""
    hrs = max(0.0, runtime_s) / 3600.0
    return round(hrs * (GPU_HOURLY_USD[gpu_type] + cpus * CPU_HOURLY_USD + ram_gib * RAM_HOURLY_USD), 4)


def estimate_cost(gpu_type: str, runtime_s: float = 15 * 60) -> float:
    return experiment_cost(gpu_type, runtime_s)


def sandbox_experiment_cost(requests: int, context_len: int, max_tokens: int,
                            rate_per_1m: float = INFERENCE_USD_PER_1M_TOKENS) -> float:
    """Pre-spend reserve: sandbox op + worst-case inference tokens."""
    tokens = max(0, int(requests)) * (max(0, int(context_len)) + max(0, int(max_tokens)))
    return round(SANDBOX_OP_RESERVE_USD + tokens / 1_000_000.0 * rate_per_1m, 4)


def inference_cost(total_tokens: int,
                   rate_per_1m: float = INFERENCE_USD_PER_1M_TOKENS) -> float:
    return round(max(0, int(total_tokens)) / 1_000_000.0 * rate_per_1m, 6)


def cost_per_1k(requests: int, spend_usd: float) -> float:
    if requests <= 0:
        return 0.0
    return round(float(spend_usd) / requests * 1000.0, 4)


def cost_per_1m_tokens(experiment_cost_usd: float, total_tokens: int) -> float:
    if total_tokens <= 0:
        return 0.0
    return round(experiment_cost_usd / total_tokens * 1_000_000, 4)


def monthly_projection(cost_per_1m: float, monthly_tokens: int) -> float:
    return round(cost_per_1m / 1_000_000 * monthly_tokens, 2)
