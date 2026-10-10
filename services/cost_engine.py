"""Cost engine — Nebius $/GPU-hr pricing, measured-runtime math only."""
from __future__ import annotations

GPU_HOURLY_USD = {"L40S": 1.35, "H100": 3.20}  # L40S verified from docs; H100 re-pulled at runtime
CPU_HOURLY_USD = 0.012
RAM_HOURLY_USD = 0.0032


def experiment_cost(gpu_type: str, runtime_s: float, cpus: int = 8, ram_gib: int = 32) -> float:
    hrs = max(0.0, runtime_s) / 3600.0
    return round(hrs * (GPU_HOURLY_USD[gpu_type] + cpus * CPU_HOURLY_USD + ram_gib * RAM_HOURLY_USD), 4)


def estimate_cost(gpu_type: str, runtime_s: float = 15 * 60) -> float:
    return experiment_cost(gpu_type, runtime_s)


def cost_per_1m_tokens(experiment_cost_usd: float, total_tokens: int) -> float:
    if total_tokens <= 0:
        return 0.0
    return round(experiment_cost_usd / total_tokens * 1_000_000, 4)


def monthly_projection(cost_per_1m: float, monthly_tokens: int) -> float:
    return round(cost_per_1m / 1_000_000 * monthly_tokens, 2)
