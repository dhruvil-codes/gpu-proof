"""Certification loop — deep module behind run_certification(cid).

Owns: planner -> policy -> sandbox runner -> harness execution -> evaluator -> certificate inputs.
Callers (HTTP layer) only pass a cert id; all orchestration complexity lives here.
"""
from __future__ import annotations

import json
import os
import random
import time
from pathlib import Path

from services import cost_engine as ce
from services import experiment_policy as pol
from services import sla_evaluator as sla
from services import state_machine as sm
from services import store
from services.decision_engine import fast_classify, propose_experiment
from services.experiment_policy import ExperimentProposal
from services.sandbox_runner import (
    PROVENANCE_SANDBOX_MEASURED,
    PROVENANCE_SIMULATED,
    SandboxResult,
    SandboxSpec,
    get_sandbox_runner,
)

_SERVICES_DIR = Path(__file__).resolve().parent


def _is_sim_mode() -> bool:
    return os.environ.get("USE_SIMULATOR", "true").lower() == "true"


def _byok_of(cert: dict) -> dict:
    """Return the in-memory BYOK dict for one run (never persisted)."""
    byok = cert.get("byok") or {}
    if not isinstance(byok, dict):
        return {}
    return byok


def _byok_key(cert: dict) -> str | None:
    key = (_byok_of(cert).get("api_key") or "").strip()
    return key or None


def _byok_project(cert: dict) -> str | None:
    proj = (_byok_of(cert).get("project_id") or "").strip()
    return proj or None


def _policy_scope(cert: dict, total_spend: float, total_cap: float) -> tuple[float, float]:
    """BYOK runs bypass the shared host budget cap; per-cert caps still apply."""
    if _byok_key(cert):
        return 0.0, float("inf")
    return total_spend, total_cap


def parse_harness_output(stdout: str) -> dict | None:
    """Extract the compact JSON document emitted by sandbox_harness.py."""
    stdout = stdout or ""
    # Try parsing each line from bottom up
    lines = [ln.strip() for ln in stdout.splitlines() if ln.strip()]
    for ln in reversed(lines):
        if ln.startswith("{") and ln.endswith("}"):
            try:
                data = json.loads(ln)
                if isinstance(data, dict) and "metrics" in data:
                    return data
            except Exception:
                continue
    # Fallback: locate substring between first { and last }
    first = stdout.find("{")
    last = stdout.rfind("}")
    if first != -1 and last != -1 and last > first:
        try:
            data = json.loads(stdout[first:last + 1])
            if isinstance(data, dict) and "metrics" in data:
                return data
        except Exception:
            pass
    return None


class LoopHooks:
    """Seam for HTTP/SSE persistence without importing FastAPI here."""

    def __init__(self, certs: dict, emit, total: dict, cap: float):
        self.certs = certs
        self.emit = emit
        self.total = total
        self.cap = cap

    def finish(self, cid: str, status: str, payload: dict) -> dict:
        c = self.certs[cid]
        c["status"] = status
        store.update_cert(cid, status, c["spend"], c["simulated"])
        self.emit(cid, {"type": "done", "status": status, **payload})
        return {"certification": cid, "status": status, "experiments": c["experiments"],
                "spend": c["spend"], "simulated": c["simulated"], **payload}

    def telemetry(self, cid: str, idx: int, step: str, tag: str, line: str) -> None:
        """Emit a fine-grained telemetry line; sleeps in sim mode for visible streaming."""
        c = self.certs[cid]
        event = {"type": "telemetry", "index": idx, "step": step, "tag": tag, "line": line}
        c.setdefault("telemetry", []).append(event)
        # cap in-memory history so long runs stay bounded
        if len(c["telemetry"]) > 500:
            c["telemetry"] = c["telemetry"][-500:]
        self.emit(cid, event)
        _fast = (os.environ.get("SANDBOXPROOF_FAST_SIM", "") == "1"
                 or os.environ.get("GPUPROOF_FAST_SIM", "") == "1")
        if _is_sim_mode() and not _fast:
            time.sleep(random.uniform(0.3, 0.6))

    def one(self, cid: str, idx: int, plan: dict, prev: list, runner,
            base_image_uuid: str | None = None) -> bool:
        c = self.certs[cid]
        byok_key = _byok_key(c)
        candidate_model = str(c["config"].get("candidate_model", "candidate-model"))

        proposal = ExperimentProposal(
            model=plan.get("model", candidate_model),
            concurrency=int(plan.get("concurrency", 8)),
            context_len=int(plan.get("context_len", 4096)),
            max_tokens=int(plan.get("max_tokens", 256)),
            reason=str(plan.get("reason", "")),
        )

        requests_count = len(c["twin"].get("items") or [])
        est = ce.sandbox_experiment_cost(
            requests=requests_count,
            context_len=proposal.context_len,
            max_tokens=proposal.max_tokens,
        )

        eff_total_spend, eff_total_cap = _policy_scope(c, self.total["spend"], self.cap)
        check = pol.validate_proposal(
            proposal,
            experiment_index=idx,
            cert_spend=c["spend"],
            total_spend=eff_total_spend,
            total_cap=eff_total_cap,
            estimated_cost=est,
            allowed_model=candidate_model,
        )

        self.emit(cid, {"type": "policy", "index": idx, "allowed": check.allowed,
                        "reasons": check.reasons, "estimated_cost": est})
        if not check.allowed:
            status = "BLOCKED_BUDGET" if any("cap" in r for r in check.reasons) else "BLOCKED_POLICY"
            self.finish(cid, status, {"reasons": check.reasons})
            return True

        state = "QUEUED"
        for _ in range(5):
            state = sm.advance(state)
        self.emit(cid, {"type": "state", "index": idx, "state": state})

        # --- Sandbox execution ---
        harness_path = _SERVICES_DIR / "sandbox_harness.py"
        quality_path = _SERVICES_DIR / "quality_checks.py"
        metrics_path = _SERVICES_DIR / "metrics_math.py"
        twin_bytes = json.dumps(c["twin"]).encode("utf-8")

        files = {
            "/work/sandbox_harness.py": harness_path,
            "/work/quality_checks.py": quality_path,
            "/work/metrics_math.py": metrics_path,
            "/work/twin.json": twin_bytes,
        }

        token_factory_key = byok_key or os.environ.get("NEBIUS_TF_KEY", "") or os.environ.get("NEBIUS_API_KEY", "")
        env = {
            "TF_BASE_URL": os.environ.get("TOKENFACTORY_URL", "https://api.tokenfactory.nebius.com/v1"),
            "TF_KEY": token_factory_key,
            "MODEL": proposal.model,
            "CONCURRENCY": str(proposal.concurrency),
            "CONTEXT_LEN": str(proposal.context_len),
            "MAX_TOKENS": str(proposal.max_tokens),
            "REQUESTS": str(requests_count),
            "REQUEST_TIMEOUT_S": "90",
        }

        spec = SandboxSpec(
            base_image="python:3.12-slim",
            command="python",
            args=["/work/sandbox_harness.py"],
            files=files,
            env=env,
            disposable=True,
            timeout_s=900,
        )

        self.telemetry(
            cid, idx, "provision", "SANDBOX",
            f"\u26a1 Spawning isolated disposable microVM on Nebius Token Factory (base=python:3.12-slim)..."
        )
        self.telemetry(
            cid, idx, "mount", "FILES",
            f"\U0001f4e6 Uploading sealed workload twin ({requests_count} items), deterministic quality checks, and replay harness..."
        )
        self.telemetry(
            cid, idx, "replay", "HARNESS",
            f"\U0001f680 Replaying workload against {proposal.model}: concurrency={proposal.concurrency}, "
            f"context_len={proposal.context_len}, max_tokens={proposal.max_tokens}..."
        )

        res: SandboxResult = runner.run(spec, image_uuid=base_image_uuid)

        simulated = res.provenance == PROVENANCE_SIMULATED
        if c["simulated"] is None:
            c["simulated"] = simulated

        harness_doc = parse_harness_output(res.stdout)
        if not harness_doc:
            if res.exit_code != 0:
                raw_err = (res.stderr or res.stdout or "sandbox exit non-zero").strip()
                failure = "INFRASTRUCTURE"
                metrics = {
                    "count": requests_count,
                    "quality_score": 0.0,
                    "error_rate": 1.0,
                    "latency_p95_ms": 0.0,
                    "simulated": simulated,
                }
            else:
                failure = "INFRASTRUCTURE"
                metrics = {"count": 0, "quality_score": 0.0, "error_rate": 1.0,
                           "latency_p95_ms": 0.0, "simulated": simulated}
        else:
            metrics = harness_doc.get("metrics") or {}
            metrics["simulated"] = simulated
            failure = None

        # Evaluate SLA gates
        gates = [sla.Gate(**g) for g in c["config"]["gates"]]
        eval_results = sla.evaluate_gates(gates, metrics)
        verdict = sla.decision(eval_results)

        if verdict == "BLOCK" and not failure:
            failed_gates = [g.metric for g in eval_results if not g.passed]
            if any("quality" in m for m in failed_gates):
                failure = "QUALITY"
            elif any("latency" in m or "ttft" in m for m in failed_gates):
                failure = "LATENCY"
            elif any("error" in m for m in failed_gates):
                failure = "RELIABILITY"
            else:
                failure = "QUALITY"

        # Costs: sandbox op cost from Contree + inference tokens from Token Factory
        tokens_n = int(metrics.get("total_tokens") or 0)
        inf_cost = ce.inference_cost(tokens_n) if not simulated else 0.0
        exp_cost = round(res.cost_usd + inf_cost, 6) if not simulated else 0.0
        c["spend"] = round(c["spend"] + exp_cost, 4)
        if not byok_key:
            self.total["spend"] = round(self.total["spend"] + exp_cost, 4)

        # Telemetry: measured outcome
        q = metrics.get("quality_score", 0.0)
        p95 = metrics.get("latency_p95_ms", 0.0)
        err = metrics.get("error_rate", 0.0)

        self.telemetry(
            cid, idx, "metrics", "METRICS",
            f"\U0001f4ca Replay results: P95={p95:g}ms, quality={q:.2f}, error_rate={err:.2%}, total_tokens={tokens_n}"
        )

        if failure == "QUALITY":
            self.telemetry(
                cid, idx, "quality_fail", "QUALITY",
                f"\u26a0\ufe0f Quality SLA breached ({q:.2f} < gate threshold) \u2014 output truncated due to lean max_tokens ({proposal.max_tokens})"
            )
        elif failure == "LATENCY":
            self.telemetry(
                cid, idx, "latency_fail", "LATENCY",
                f"\u26a0\ufe0f Latency SLA breached (P95 {p95:g}ms > threshold) \u2014 concurrency={proposal.concurrency} exceeds endpoint capacity"
            )

        # Telemetry: planner diagnosis
        if failure:
            diag = f"{failure} failure (verdict={verdict}) \u2014 Nemotron planner adapting serving parameters"
        else:
            diag = f"quality={q:.2f} p95={p95:g}ms verdict={verdict} \u2014 {plan.get('reason', '')}"[:220]

        self.telemetry(cid, idx, "diagnosis", "PLANNER",
                       f"\U0001f9e0 Nemotron planner analyzing metrics -> {diag}")

        # Telemetry: sandbox execution proof
        self.telemetry(
            cid, idx, "sandbox", "SANDBOX",
            f"\U0001f9ea Nebius Sandbox op {res.operation_id} (exit={res.exit_code}, cost=${res.cost_usd:.4f}, provenance={res.provenance})"
        )

        sandbox_info = {
            "operation_id": res.operation_id,
            "image_uuid": res.image_uuid,
            "exit_code": res.exit_code,
            "provenance": res.provenance,
            "cost_usd": res.cost_usd,
            "elapsed_s": res.elapsed_s,
        }

        exp = {
            "index": idx,
            "plan": plan,
            "job_id": res.operation_id,
            "simulated": simulated,
            "metrics": metrics,
            "log": (res.stdout + "\n" + res.stderr)[-2000:],
            "failure": failure,
            "verdict": verdict,
            "reason": plan.get("reason", ""),
            "state": "COMPLETED",
            "status": failure or "COMPLETED",
            "sandbox": sandbox_info,
            "provenance": res.provenance,
        }

        if failure:
            try:
                cls = fast_classify(res.stdout + "\n" + res.stderr, api_key=byok_key)
            except TypeError:
                cls = fast_classify(res.stdout + "\n" + res.stderr)
            exp["classifier"] = cls
            prev.append({"index": idx, "failure": failure, "metrics": metrics})
        else:
            if verdict == "SHIP":
                store.save_experiment(cid, exp)
                c["experiments"].append(exp)
                self.emit(cid, {"type": "experiment_done", "experiment": exp})
                self.finish(cid, "SHIP", {"spend": c["spend"]})
                return True
            prev.append({"index": idx, "failure": "QUALITY", "metrics": metrics})

        store.save_experiment(cid, exp)
        c["experiments"].append(exp)
        self.emit(cid, {"type": "experiment_done", "experiment": exp})
        return False

    def run(self, cid: str, get_runner) -> None:
        c = self.certs[cid]
        try:
            runner = get_runner()
        except RuntimeError as e:
            self.finish(cid, "BLOCKED_INFRA", {"reasons": [str(e)]})
            return

        budget = min(c["config"].get("budget_usd", 10.0), 10.0)
        if budget < 0.05:
            self.finish(cid, "BLOCKED_BUDGET",
                        {"reasons": [f"budget ${budget:.2f} below minimum $0.05 experiment reserve"]})
            return

        # Prepare base image once per certification run to reuse cached setup
        base_image_uuid: str | None = None
        try:
            prep_res = runner.prepare(base_image="python:3.12-slim", shell="mkdir -p /work")
            base_image_uuid = prep_res.image_uuid
        except Exception:
            # Fall back to spawning directly from python:3.12-slim
            base_image_uuid = None

        prev: list = []
        try:
            for idx in range(5):
                if c.get("cancel_requested"):
                    self.finish(cid, "CANCELLED", {"spend": c["spend"]})
                    return
                self.emit(cid, {"type": "experiment_start", "index": idx})
                ctx = {
                    "candidate": c["config"]["candidate_model"],
                    "twin_digest": c["twin"]["digest"],
                    "budget_left": round(budget - c["spend"], 2),
                    "previous": prev,
                    "concurrency_limit": 32,
                    "gates": c["config"].get("gates", []),
                }
                try:
                    try:
                        plan = propose_experiment(ctx, api_key=_byok_key(c))
                    except TypeError:
                        plan = propose_experiment(ctx)
                except RuntimeError as e:
                    self.finish(cid, "INCOMPLETE", {"reason": str(e)})
                    return

                self.emit(cid, {"type": "plan", "index": idx, "plan": plan})
                self.telemetry(
                    cid, idx, "diagnosis", "PLANNER",
                    f"\U0001f9e0 Nemotron planner proposed: concurrency={plan.get('concurrency')}, "
                    f"context={plan.get('context_len')}, max_tokens={plan.get('max_tokens')}: {plan.get('reason', '')}"[:260]
                )

                if self.one(cid, idx, plan, prev, runner, base_image_uuid=base_image_uuid):
                    return
            self.finish(cid, "BLOCK", {"spend": c["spend"]})
        except Exception as e:  # noqa: BLE001 — terminate safely, never hang
            self.finish(cid, "BLOCKED_INFRA", {"reasons": [f"{type(e).__name__}: {str(e)[:300]}"]})
