"""Decision layer: Nemotron Ultra planner + Nano classifier via Token Factory.

The planner proposes a serving profile (concurrency, context budget, output
budget) for the certification subject. It cannot change the subject model and
it cannot bypass the deterministic policy engine. Planner down means
"Certification incomplete", never a fabricated SHIP.
"""
from __future__ import annotations

import json
import os
import urllib.request

BASE_URL = "https://api.tokenfactory.nebius.com/v1"
PLANNER_MODEL = os.environ.get("PLANNER_MODEL", "nvidia/Nemotron-3-Ultra-550b-a55b")
CLASSIFIER_MODEL = os.environ.get("CLASSIFIER_MODEL", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B")

PLAN_SCHEMA_KEYS = {"model", "concurrency", "context_len", "max_tokens", "reason"}

MIN_CONCURRENCY, MAX_CONCURRENCY = 1, 32
MIN_CONTEXT, MAX_CONTEXT = 512, 8192
MIN_OUTPUT, MAX_OUTPUT = 16, 1024


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


def _clamp(value, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return default


def _simulated_plan(context: dict) -> dict:
    """Deterministic stand-in for local dev/tests. Same schema as live output."""
    model = str(context.get("candidate") or "candidate-model")
    prev = context.get("previous", [])
    failures = {str(p.get("failure") or "").upper() for p in prev}
    if "LATENCY" in failures:
        return {"model": model, "concurrency": 4, "context_len": 4096,
                "max_tokens": 256,
                "reason": "SIMULATED planner: p95 breached the gate; halve concurrency"}
    if "QUALITY" in failures:
        return {"model": model, "concurrency": 8, "context_len": 4096,
                "max_tokens": 256,
                "reason": "SIMULATED planner: output budget truncated structured output; raise max_tokens"}
    if {"RELIABILITY", "INFRASTRUCTURE"} & failures:
        return {"model": model, "concurrency": 4, "context_len": 2048,
                "max_tokens": 256,
                "reason": "SIMULATED planner: transient failures; reduce concurrency and context"}
    return {"model": model, "concurrency": 16, "context_len": 4096,
            "max_tokens": 64,
            "reason": "SIMULATED planner: cheapest profile first (lean output budget)"}


def propose_experiment(context: dict, api_key: str | None = None) -> dict:
    # Simulator mode uses the deterministic stand-in so local dev costs $0.
    # Real mode always calls Nemotron Ultra; planner down -> Certification incomplete.
    # api_key is the per-run BYOK override (in-memory only); falls back to .env.
    if os.environ.get("USE_SIMULATOR", "true").lower() == "true":
        return _simulated_plan(context)
    candidate = str(context.get("candidate") or "")
    sys = (
        "You are the SandboxProof planner. Return ONLY a JSON object with keys: "
        "model (must equal the candidate under test), concurrency (1-32), "
        "context_len (512-8192), max_tokens (16-1024), reason (short string). "
        "The harness replays a sealed workload twin against a hosted "
        "OpenAI-compatible endpoint inside an isolated sandbox. Start with the "
        "cheapest profile that could plausibly pass: low concurrency and a lean "
        "output budget (e.g. max_tokens=64). If the previous experiment failed QUALITY, raise "
        "max_tokens to 512 (truncated structured output is the usual cause). If it "
        "failed LATENCY, reduce concurrency. If it failed RELIABILITY or "
        "INFRASTRUCTURE, reduce concurrency and context. Never change the model."
    )
    try:
        raw = _call(PLANNER_MODEL, [{"role": "system", "content": sys},
                                    {"role": "user", "content": json.dumps(context)}],
                    api_key=api_key)
        plan = json.loads(raw)
    except Exception as e:  # noqa: BLE001 — planner down is a stop condition
        raise RuntimeError(
            f"Certification incomplete. Reason: Planning service unavailable ({e})"
        ) from e
    if not isinstance(plan, dict) or not PLAN_SCHEMA_KEYS.issubset(plan.keys()):
        plan = {
            "model": candidate,
            "concurrency": 8,
            "context_len": 4096,
            "max_tokens": 256,
            "reason": "invalid planner JSON; defaulted to the safe profile",
        }
    plan["model"] = candidate or str(plan.get("model") or "")
    plan["concurrency"] = _clamp(plan.get("concurrency"), MIN_CONCURRENCY,
                                 MAX_CONCURRENCY, 8)
    plan["context_len"] = _clamp(plan.get("context_len"), MIN_CONTEXT,
                                 MAX_CONTEXT, 4096)
    plan["max_tokens"] = _clamp(plan.get("max_tokens"), MIN_OUTPUT,
                                MAX_OUTPUT, 256)
    plan["reason"] = str(plan.get("reason") or "planner proposed a serving profile")[:300]
    return plan


def fast_classify(summary: str, api_key: str | None = None) -> dict:
    sys = ('Return ONLY JSON {"failure": "LATENCY|QUALITY|RELIABILITY|INFRASTRUCTURE|UNKNOWN", '
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
