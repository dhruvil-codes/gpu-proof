"""Certification loop — deep module behind run_certification(cid).

Owns: planner -> policy -> runner -> replay -> evaluator -> certificate inputs.
Callers (HTTP layer) only pass a cert id; all orchestration complexity lives here.
"""
from __future__ import annotations

import os
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


def synth_simulated_metrics(logs: str, plan: dict) -> tuple[dict, str | None]:
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


def measured_or_simulated(cert: dict, plan: dict, logs: str, simulated: bool) -> tuple[dict, str | None, str]:
    if simulated:
        m, failure = synth_simulated_metrics(logs, plan)
        return m, failure, logs
    from services import replay as replay_mod
    endpoint = os.environ.get("BENCH_ENDPOINT", "")
    if not endpoint:
        raise RuntimeError("real job returned but BENCH_ENDPOINT unset; refusing to fabricate")
    rep = replay_mod.replay(cert["twin"], endpoint, cert["config"]["candidate_model"],
                            os.environ.get("NEBIUS_API_KEY", ""))
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

    def one(self, cid: str, idx: int, plan: dict, prev: list, runner) -> bool:
        c = self.certs[cid]
        proposal = ExperimentProposal(plan["gpu_type"], 1, plan["precision"],
                                      plan["engine"], plan["batch_config"], plan["reason"])
        est = ce.estimate_cost(proposal.gpu_type)
        check = pol.validate_proposal(proposal, experiment_index=idx, cert_spend=c["spend"],
                                      total_spend=self.total["spend"], total_cap=self.cap,
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
        handle = runner.create(JobSpec(self.bench_image, proposal.gpu_type, 1,
                                       {"MODEL": c["config"]["candidate_model"]}))
        try:
            if c["simulated"] is None:
                c["simulated"] = handle.simulated
            logs = runner.logs(handle)
            simulated = handle.simulated
            metrics, failure, logs = measured_or_simulated(c, plan, logs, simulated)
            cost = 0.0 if simulated else ce.experiment_cost(proposal.gpu_type, 60.0)
            c["spend"] = round(c["spend"] + cost, 4)
            self.total["spend"] = round(self.total["spend"] + cost, 4)
            gates = [sla.Gate(**g) for g in c["config"]["gates"]]
            verdict = sla.decision(sla.evaluate_gates(gates, metrics))
            exp = {"index": idx, "plan": plan, "job_id": handle.job_id, "simulated": simulated,
                   "metrics": metrics, "log": logs[-2000:], "failure": failure, "verdict": verdict,
                   "reason": plan["reason"], "state": "EVALUATING"}
            if failure:
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
                    plan = propose_experiment(ctx)
                except RuntimeError as e:
                    self.finish(cid, "INCOMPLETE", {"reason": str(e)})
                    return
                if self.one(cid, idx, plan, prev, runner):
                    return
            self.finish(cid, "BLOCK", {"spend": c["spend"]})
        except Exception as e:  # noqa: BLE001 — terminate safely, never hang
            self.finish(cid, "BLOCKED_INFRA", {"reasons": [f"{type(e).__name__}: {str(e)[:300]}"]})

