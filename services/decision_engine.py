"""Decision layer: Nemotron Ultra planner + Nano classifier via Token Factory (OpenAI-compatible).

Strict JSON validation, deterministic fallbacks. Planner down -> Certification incomplete (never SHIP).
"""
from __future__ import annotations

import json
import os
import urllib.request

BASE_URL = "https://api.tokenfactory.nebius.com/v1"
PLANNER_MODEL = os.environ.get("PLANNER_MODEL", "nvidia/Nemotron-3-Ultra-550b-a55b")
CLASSIFIER_MODEL = os.environ.get("CLASSIFIER_MODEL", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B")

PLAN_SCHEMA_KEYS = {"gpu_type", "gpu_count", "precision", "engine", "batch_config", "reason"}


def _resolve_key(explicit: str | None = None) -> str:
    """BYOK key (per-request, in-memory) takes precedence over server .env."""
    if explicit and explicit.strip():
        return explicit.strip()
    return os.environ.get("NEBIUS_API_KEY", "")


def _call(model: str, messages: list[dict], *, json_mode: bool = True, timeout: int = 60,
          api_key: str | None = None) -> str:
    key = _resolve_key(api_key)
    if not key:
        raise RuntimeError("NEBIUS_API_KEY missing")
    body: dict = {"model": model, "messages": messages, "temperature": 0.2}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode())
    return data["choices"][0]["message"]["content"]


def verify_models(api_key: str | None = None) -> dict:
    """Startup check that both Nemotron models exist; returns availability map."""
    out = {}
    for name, model in (("planner", PLANNER_MODEL), ("classifier", CLASSIFIER_MODEL)):
        try:
            _call(model, [{"role": "user", "content": '{"ping": true}'}], api_key=api_key)
            out[name] = {"model": model, "ok": True}
        except Exception as e:  # noqa: BLE001 — availability probe, message surfaced
            out[name] = {"model": model, "ok": False, "error": str(e)[:300]}
    return out


def _simulated_plan(context: dict) -> dict:
    prev = context.get("previous", [])
    had_memory = any(p.get("failure") == "MEMORY" for p in prev)
    had_quality = any(p.get("failure") == "QUALITY" for p in prev)
    if had_quality:
        return {"gpu_type": "H100", "gpu_count": 1, "precision": "FP8",
                "engine": "vLLM", "batch_config": 16,
                "reason": "SIMULATED planner: quality regressed on INT4; retry H100 FP8 with tuned batch"}
    if had_memory:
        return {"gpu_type": "H100", "gpu_count": 1, "precision": "INT4",
                "engine": "vLLM", "batch_config": 8,
                "reason": "SIMULATED planner: OOM on L40S; escalate to H100 INT4"}
    return {"gpu_type": "L40S", "gpu_count": 1, "precision": "FP8",
            "engine": "vLLM", "batch_config": 8,
            "reason": "SIMULATED planner: cheapest config first (L40S FP8)"}


def propose_experiment(context: dict, api_key: str | None = None) -> dict:
    # Simulator mode uses the deterministic stand-in so local dev costs $0.
    # Real mode always calls Nemotron Ultra; planner down -> Certification incomplete.
    # api_key is the per-run BYOK override (in-memory only); falls back to .env.
    if os.environ.get("USE_SIMULATOR", "true").lower() == "true":
        return _simulated_plan(context)
    sys = ("You are GPUProof planner. Return ONLY JSON with keys gpu_type (L40S|H100), "
           "gpu_count (1), precision (FP8|INT4|FP16|BF16), engine (vLLM), batch_config (1-64), reason. "
           "Prefer cheapest config likely to fit. After MEMORY failure, move up GPU/precision.")
    try:
        raw = _call(PLANNER_MODEL, [{"role": "system", "content": sys},
                                    {"role": "user", "content": json.dumps(context)}],
                    api_key=api_key)
        plan = json.loads(raw)
    except Exception as e:  # noqa: BLE001 — planner down is a stop condition per PRD 7.13
        raise RuntimeError(f"Certification incomplete. Reason: Planning service unavailable ({e})") from e
    if not PLAN_SCHEMA_KEYS.issubset(plan.keys()):
        # deterministic repair: fall back to safe L40S FP8 rather than failing hard
        plan = {"gpu_type": "L40S", "gpu_count": 1, "precision": "FP8",
                "engine": "vLLM", "batch_config": 8,
                "reason": "invalid planner JSON; defaulted to cheapest safe config"}
    plan["gpu_count"] = 1
    if plan.get("engine") != "vLLM":
        plan["engine"] = "vLLM"
    return plan


def fast_classify(summary: str, api_key: str | None = None) -> dict:
    sys = ('Return ONLY JSON {"failure": "MEMORY|LATENCY|QUALITY|RELIABILITY|INFRASTRUCTURE|UNKNOWN", '
           '"action": "CONTINUE|STOP_SUCCESS|STOP_BUDGET|ESCALATE", "reason": "..."}')
    try:
        raw = _call(CLASSIFIER_MODEL, [{"role": "system", "content": sys},
                                       {"role": "user", "content": summary}],
                    api_key=api_key)
        out = json.loads(raw)
        if "failure" in out and "action" in out:
            return out
    except Exception:  # noqa: BLE001 — fall through to deterministic rules
        pass
    from services.failure_classifier import classify
    return {"failure": classify(summary), "action": "CONTINUE",
            "reason": "deterministic fallback (classifier unavailable or invalid JSON)"}
