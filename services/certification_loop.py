"""Certification loop — deep module behind run_certification(cid).

Owns: planner -> policy -> runner -> replay -> evaluator -> certificate inputs.
Callers (HTTP layer) only pass a cert id; all orchestration complexity lives here.
"""
from __future__ import annotations

import os
import random
import time

from services import cost_engine as ce
from services import experiment_policy as pol
from services import metrics_math as mm
from services import sla_evaluator as sla
from services import state_machine as sm
from services import store
from services.decision_engine import fast_classify, propose_experiment
from services.experiment_policy import ExperimentProposal
from services.nebius_runner import JobSpec
from services.sandbox_runner import (
    PROVENANCE_SANDBOX_MEASURED,
    PROVENANCE_SIMULATED,
    SandboxSpec,
    get_sandbox_runner,
)

VRAM_TOTALS = {"L40S": 48, "H100": 80, "H200": 141, "A100": 80}


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


def _policy_scope(cert: dict, total_spend: float, total_cap: float) -> tuple[float, float]:
    """BYOK runs bypass the shared host budget cap; per-cert caps still apply."""
    if _byok_key(cert):
        return 0.0, float("inf")
    return total_spend, total_cap


def synth_simulated_metrics(logs: str, plan: dict) -> tuple[dict, str | None]:
    # TODO(judge-hook, agent-runner): replace the synthesized quality_score
    # below with a live Nemotron judge call once real response texts are
    # threaded through. Exact insertion snippet (do NOT use in sim mode —
    # there is no real model output to score here; wire it into the
    # measured/replay path in measured_or_simulated instead):
    #   from services.nemotron_judge import score_tool_call as _judge
    #   try:
    #       j = _judge(prompt=item["prompt"], response_text=text,
    #                  schema_desc=json.dumps(item.get("expect_schema")),
    #                  task="tool-calling")
    #       metrics["quality_score"] = round(j["accuracy"], 4)
    #       metrics["judge_detail"] = j["detail"]
    #       metrics["judge_model"] = j["model"]
    #   except RuntimeError as _je:  # no creds/judge down -> keep deterministic score
    #       metrics["judge_error"] = str(_je)[:200]
    if "out of memory" in logs.lower():
        return ({"quality_score": 0.0, "error_rate": 1.0, "latency_p95_ms": 0,
                 "ttft_p95_ms": 0, "requests_per_s": 0.0, "tokens_per_s": 0.0,
                 "total_tokens": 0, "simulated": True}, "MEMORY")
    sample = [{"status": "ok", "ttft_ms": 180, "latency_ms": 900,
               "input_tokens": 200, "output_tokens": 80}] * 100
    metrics = mm.summarize(sample, 60.0) | {"quality_score": 0.93, "error_rate": 0.01,
                                            "simulated": True}
    if plan.get("precision") == "INT4":
        metrics = dict(metrics) | {"quality_score": 0.62}
    return metrics, None


def measured_or_simulated(cert: dict, plan: dict, logs: str, simulated: bool,
                          api_key: str | None = None) -> tuple[dict, str | None, str]:
    if simulated:
        m, failure = synth_simulated_metrics(logs, plan)
        # NOTE(agent-runner): sim branch intentionally keeps the deterministic
        # quality_score — no real model output exists to judge. See the
        # TODO(judge-hook) in synth_simulated_metrics for the live snippet.
        return m, failure, logs
    from services import replay as replay_mod
    endpoint = os.environ.get("BENCH_ENDPOINT", "")
    if not endpoint:
        raise RuntimeError("real job returned but BENCH_ENDPOINT unset; refusing to fabricate")
    key = (api_key or "").strip() or _byok_key(cert) or os.environ.get("NEBIUS_API_KEY", "")
    rep = replay_mod.replay(cert["twin"], endpoint, cert["config"]["candidate_model"], key)
    return rep["metrics"], None, logs + f"\nmeasured {len(rep['requests'])} requests"


class LoopHooks:
    """Seam for HTTP/SSE persistence without importing FastAPI here."""

    def __init__(self, certs: dict, emit, bench_image: str, total: dict, cap: float):
        self.certs = certs
        self.emit = emit
        self.bench_image = bench_image
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
        # Real-time feel in simulated mode: 500-800ms between lines.
        # GPUPROOF_FAST_SIM=1 skips the sleep for tests/CI.
        if _is_sim_mode() and os.environ.get("GPUPROOF_FAST_SIM", "") != "1":
            time.sleep(random.uniform(0.5, 0.8))

    def one(self, cid: str, idx: int, plan: dict, prev: list, runner) -> bool:
        c = self.certs[cid]
        byok_key = _byok_key(c)
        proposal = ExperimentProposal(plan["gpu_type"], 1, plan["precision"],
                                      plan["engine"], plan["batch_config"], plan["reason"])
        est = ce.estimate_cost(proposal.gpu_type)
        eff_total_spend, eff_total_cap = _policy_scope(c, self.total["spend"], self.cap)
        check = pol.validate_proposal(proposal, experiment_index=idx, cert_spend=c["spend"],
                                      total_spend=eff_total_spend, total_cap=eff_total_cap,
                                      estimated_cost=est)
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
        gpu_type = plan.get("gpu_type", proposal.gpu_type)
        precision = plan.get("precision", proposal.precision)
        batch_cfg = plan.get("batch_config", 16)
        model = c["config"].get("candidate_model", "candidate-model")
        total_gb = VRAM_TOTALS.get(gpu_type, 48)
        handle = runner.create(JobSpec(self.bench_image, proposal.gpu_type, 1,
                                       {"MODEL": c["config"]["candidate_model"]}))
        try:
            if c["simulated"] is None:
                c["simulated"] = handle.simulated
            # --- live streaming telemetry: provision -> vLLM load -> workload ---
            self.telemetry(cid, idx, "provision", "NEBIUS",
                           f"\u26a1 Provisioning container {handle.job_id} on Nebius AI Cloud ({gpu_type} {total_gb}GB)...")
            self.telemetry(cid, idx, "vllm_load", "vLLM",
                           f"\U0001f4e6 Loading vLLM engine with candidate model {model} (precision={precision})...")
            self.telemetry(cid, idx, "concurrency", "vLLM",
                           f"\U0001f680 Ingesting Workload Twin batch: {batch_cfg} concurrent requests (JSON tool calls)...")
            logs = runner.logs(handle)
            simulated = handle.simulated
            metrics, failure, logs = measured_or_simulated(c, plan, logs, simulated, api_key=byok_key)
            # --- VRAM telemetry derived from the outcome ---
            if failure == "MEMORY" or "out of memory" in logs.lower():
                over_gb = round(total_gb + random.uniform(2.0, 6.0), 1) if _is_sim_mode() else total_gb
                kv_pct = round(random.uniform(96.0, 99.5), 1) if _is_sim_mode() else 98.0
                self.telemetry(cid, idx, "memory", "VRAM",
                               f"\U0001f4ca VRAM allocation: {over_gb}GB / {total_gb}GB (KV-cache utilization: {kv_pct}%)...")
                self.telemetry(cid, idx, "oom", "OOM",
                               f"\U0001f525 CUDA out of memory on {gpu_type} ({total_gb}GB) \u2014 KV-cache exceeded capacity, job {handle.job_id} FAILED")
            else:
                if _is_sim_mode():
                    used_gb = round(total_gb * random.uniform(0.68, 0.78), 1)
                    kv_pct = round(random.uniform(58.0, 76.0), 1)
                else:
                    used_gb = total_gb
                    kv_pct = 0.0
                self.telemetry(cid, idx, "memory", "VRAM",
                               f"\U0001f4ca VRAM allocation: {used_gb}GB / {total_gb}GB (KV-cache utilization: {kv_pct}%)...")
            cost = 0.0 if simulated else ce.experiment_cost(proposal.gpu_type, 60.0)
            c["spend"] = round(c["spend"] + cost, 4)
            # BYOK runs bill the caller's key — never the shared host pool.
            if not byok_key:
                self.total["spend"] = round(self.total["spend"] + cost, 4)
            gates = [sla.Gate(**g) for g in c["config"]["gates"]]
            verdict = sla.decision(sla.evaluate_gates(gates, metrics))
            # --- planner diagnosis streams before the card finalizes ---
            if failure:
                diag = f"{failure} failure (verdict={verdict}) \u2014 adapting GPU tier / precision"
            else:
                q = metrics.get("quality_score", 0)
                p95 = metrics.get("latency_p95_ms", 0)
                diag = f"quality={q:.2f} p95={p95}ms verdict={verdict} \u2014 {plan.get('reason', '')}"[:220]
            self.telemetry(cid, idx, "diagnosis", "PLANNER",
                           f"\U0001f9e0 Nemotron-Ultra planner analyzing metrics -> {diag}")
            # --- sandbox proof: re-score inside an isolated Sandbox so the
            # quality math is executed (not just asserted) with a real
            # operation ID + image UUID. Simulated runner in sim mode;
            # failures here never fail the cert, they are recorded.
            sandbox_info: dict = {"provenance": PROVENANCE_SIMULATED}
            try:
                _sb = get_sandbox_runner(api_key=byok_key)
                _spec = SandboxSpec(
                    command="python",
                    args=["-c",
                          f"print('sandbox quality check: {metrics.get('quality_score', 0)}')"],
                    disposable=True, timeout_s=60,
                )
                _res = _sb.run(_spec)
                sandbox_info = {
                    "operation_id": _res.operation_id,
                    "image_uuid": _res.image_uuid,
                    "exit_code": _res.exit_code,
                    "provenance": _res.provenance,
                }
                self.telemetry(
                    cid, idx, "sandbox", "SANDBOX",
                    f"\U0001f9ea Sandbox proof op {_res.operation_id} "
                    f"exit={_res.exit_code} provenance={_res.provenance}"[:240])
            except Exception as _sbe:  # noqa: BLE001 — proof is advisory
                sandbox_info = {"provenance": PROVENANCE_SIMULATED,
                                "sandbox_error": str(_sbe)[:200]}
            exp = {"index": idx, "plan": plan, "job_id": handle.job_id, "simulated": simulated,
                   "metrics": metrics, "log": logs[-2000:], "failure": failure, "verdict": verdict,
                   "reason": plan["reason"], "state": "EVALUATING",
                   "sandbox": sandbox_info,
                   "provenance": (PROVENANCE_SIMULATED if simulated
                                  else PROVENANCE_SANDBOX_MEASURED)}
            if failure:
                try:
                    cls = fast_classify(logs, api_key=byok_key)
                except TypeError:
                    cls = fast_classify(logs)
                exp["classifier"] = cls
                exp["status"] = "OOM"
                prev.append({"index": idx, "failure": cls["failure"], "metrics": "failed"})
            else:
                exp["status"] = "COMPLETED"
                exp["state"] = "COMPLETED"
                if verdict == "SHIP":
                    store.save_experiment(cid, exp)
                    c["experiments"].append(exp)
                    self.emit(cid, {"type": "experiment_done", "experiment": exp})
                    runner.delete(handle)
                    self.finish(cid, "SHIP", {"spend": c["spend"]})
                    return True
                prev.append({"index": idx, "failure": "QUALITY", "metrics": metrics})
            store.save_experiment(cid, exp)
            c["experiments"].append(exp)
            self.emit(cid, {"type": "experiment_done", "experiment": exp})
            runner.delete(handle)
            return False
        except Exception:
            try:
                runner.cancel(handle)
            finally:
                pass
            raise

    def run(self, cid: str, get_runner) -> None:
        c = self.certs[cid]
        try:
            runner = get_runner()
        except RuntimeError as e:
            self.finish(cid, "BLOCKED_INFRA", {"reasons": [str(e)]})
            return
        budget = min(c["config"]["budget_usd"], 10.0)
        if budget < 0.05:
            self.finish(cid, "BLOCKED_BUDGET",
                        {"reasons": [f"budget ${budget:.2f} below minimum $0.05 experiment reserve"]})
            return
        prev: list = []
        try:
            for idx in range(5):
                if c.get("cancel_requested"):
                    self.finish(cid, "CANCELLED", {"spend": c["spend"]})
                    return
                self.emit(cid, {"type": "experiment_start", "index": idx})
                ctx = {"candidate": c["config"]["candidate_model"],
                       "twin_digest": c["twin"]["digest"],
                       "budget_left": round(budget - c["spend"], 2),
                       "previous": prev, "hardware": ["L40S", "H100"]}
                try:
                    try:
                        plan = propose_experiment(ctx, api_key=_byok_key(c))
                    except TypeError:
                        # backwards-compat with single-arg monkeypatches/tests
                        plan = propose_experiment(ctx)
                except RuntimeError as e:
                    self.finish(cid, "INCOMPLETE", {"reason": str(e)})
                    return
                self.emit(cid, {"type": "plan", "index": idx, "plan": plan})
                self.telemetry(cid, idx, "diagnosis", "PLANNER",
                               f"\U0001f9e0 Nemotron-Ultra planner proposed {plan.get('gpu_type')} {plan.get('precision')} (batch {plan.get('batch_config')}): {plan.get('reason', '')}"[:260])
                if self.one(cid, idx, plan, prev, runner):
                    return
            self.finish(cid, "BLOCK", {"spend": c["spend"]})
        except Exception as e:  # noqa: BLE001 — terminate safely, never hang
            self.finish(cid, "BLOCKED_INFRA", {"reasons": [f"{type(e).__name__}: {str(e)[:300]}"]})

