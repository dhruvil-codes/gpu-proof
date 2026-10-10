"""GPUProof FastAPI — certifications, experiments, certificate. Policy-gated, ledger-enforced."""
from __future__ import annotations

import os
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fastapi import FastAPI, HTTPException  # type: ignore
from pydantic import BaseModel  # type: ignore

from services import cost_engine as ce
from services import experiment_policy as pol
from services import metrics_math as mm
from services import sla_evaluator as sla
from services import state_machine as sm
from services import workload_twin as wt
from services.certificate_engine import build_certificate
from services.decision_engine import fast_classify, propose_experiment, verify_models
from services.experiment_policy import ExperimentProposal
from services.nebius_runner import JobSpec, get_runner

app = FastAPI(title="GPUProof API")
TOTAL_CAP = float(os.environ.get("MAX_BUDGET_USD", "20"))
CERTS: dict = {}
TOTAL_SPEND = 0.0
BENCH_IMAGE = "ghcr.io/gpuproof/benchmark:cpu-sim"


class NewCert(BaseModel):
    candidate_model: str = "Nemotron-3-Nano-30B"
    current_model: str = "Qwen3-8B"
    gpu_type: str = "H100"
    precision: str = "FP8"
    workload_tasks: list[str] = ["tool_calling", "structured_output"]
    gates: list[dict] = [
        {"metric": "latency_p95_ms", "op": "<=", "threshold": 2000},
        {"metric": "quality_score", "op": ">=", "threshold": 0.85},
        {"metric": "error_rate", "op": "<=", "threshold": 0.05},
    ]
    budget_usd: float = 10.0
    requests: int = 200


@app.get("/health")
def health():
    return {"ok": True, "simulator": os.environ.get("USE_SIMULATOR", "true")}


@app.post("/certifications")
def create_cert(c: NewCert):
    cid = f"cert-{uuid.uuid4().hex[:8]}"
    twin = wt.build_twin(42, c.requests, tuple(c.workload_tasks))
    CERTS[cid] = {"id": cid, "status": "CREATED", "config": c.model_dump(),
                  "twin": twin, "experiments": [], "spend": 0.0,
                  "created_at": time.time(), "simulated": None}
    return {"id": cid, "twin_digest": twin["digest"], "count": twin["count"]}


@app.get("/certifications/{cid}")
def get_cert(cid: str):
    if cid not in CERTS:
        raise HTTPException(404, "unknown certification")
    c = CERTS[cid]
    return {"id": cid, "status": c["status"], "spend": c["spend"],
            "experiments": len(c["experiments"]), "simulated": c["simulated"]}


@app.post("/certifications/{cid}/start")
def start_cert(cid: str):
    global TOTAL_SPEND
    if cid not in CERTS:
        raise HTTPException(404, "unknown certification")
    c = CERTS[cid]
    runner = get_runner()
    c["status"] = "RUNNING"
    budget = min(c["config"]["budget_usd"], 10.0)
    if budget < 0.05:
        # Even simulator launches need a non-trivial budget reserved: a $0.01
        # certification can never cover a real experiment, so refuse up front.
        c["status"] = "BLOCKED_BUDGET"
        return {"certification": cid, "status": "BLOCKED_BUDGET",
                "reasons": [f"budget ${budget:.2f} below minimum $0.05 experiment reserve"],
                "experiments": []}
    prev: list = []
    for idx in range(5):
        ctx = {"candidate": c["config"]["candidate_model"],
               "twin_digest": c["twin"]["digest"],
               "budget_left": round(budget - c["spend"], 2),
               "previous": prev, "hardware": ["L40S", "H100"]}
        try:
            plan = propose_experiment(ctx)
        except RuntimeError as e:
            c["status"] = "INCOMPLETE"
            return {"certification": cid, "status": "INCOMPLETE",
                    "reason": str(e), "experiments": c["experiments"]}
        proposal = ExperimentProposal(plan["gpu_type"], 1, plan["precision"],
                                      plan["engine"], plan["batch_config"],
                                      plan["reason"])
        est = ce.estimate_cost(proposal.gpu_type)
        check = pol.validate_proposal(proposal, experiment_index=idx,
                                      cert_spend=c["spend"], total_spend=TOTAL_SPEND,
                                      total_cap=TOTAL_CAP, estimated_cost=est)
        if not check.allowed:
            c["status"] = "BLOCKED_BUDGET" if any("cap" in r for r in check.reasons) else "BLOCKED_POLICY"
            return {"certification": cid, "status": c["status"],
                    "reasons": check.reasons, "experiments": c["experiments"]}
        state = "QUEUED"
        for _ in range(5):
            state = sm.advance(state)
        handle = runner.create(JobSpec(BENCH_IMAGE, proposal.gpu_type, 1,
                                       {"MODEL": c["config"]["candidate_model"]}))
        if c["simulated"] is None:
            c["simulated"] = handle.simulated
        logs = runner.logs(handle)
        simulated = handle.simulated
        if simulated:
            oom = "out of memory" in logs.lower()
            if oom:
                metrics = {"quality_score": 0.0, "error_rate": 1.0,
                           "latency_p95_ms": 0, "ttft_p95_ms": 0,
                           "requests_per_s": 0.0, "tokens_per_s": 0.0,
                           "total_tokens": 0, "simulated": True}
                failure = "MEMORY"
            else:
                sample = [{"status": "ok", "ttft_ms": 180, "latency_ms": 900,
                           "input_tokens": 200, "output_tokens": 80}] * 100
                metrics = mm.summarize(sample, 60.0) | {"quality_score": 0.93,
                                                        "error_rate": 0.01,
                                                        "simulated": True}
                failure = None
                if plan["precision"] == "INT4":
                    metrics = dict(metrics) | {"quality_score": 0.62}
        else:
            raise HTTPException(500, "real log parsing not yet wired; refusing to fabricate")
        cost = 0.0 if simulated else ce.experiment_cost(proposal.gpu_type, 60.0)
        c["spend"] = round(c["spend"] + cost, 4)
        TOTAL_SPEND = round(TOTAL_SPEND + cost, 4)
        try:
            gates = [sla.Gate(**g) for g in c["config"]["gates"]]
            results = sla.evaluate_gates(gates, metrics)
            verdict = sla.decision(results)
            exp = {"index": idx, "plan": plan, "job_id": handle.job_id,
                   "simulated": simulated, "metrics": metrics,
                   "failure": failure, "verdict": verdict, "reason": plan["reason"]}
            if failure:
                cls = fast_classify(logs)
                exp["classifier"] = cls
                exp["status"] = "OOM"
                prev.append({"index": idx, "failure": cls["failure"], "metrics": "failed"})
                c["experiments"].append(exp)
                runner.delete(handle)
                continue
            exp["status"] = "COMPLETED"
            c["experiments"].append(exp)
            runner.delete(handle)
            if verdict == "SHIP":
                c["status"] = "SHIP"
                return {"certification": cid, "status": "SHIP",
                        "experiments": c["experiments"], "spend": c["spend"],
                        "simulated": simulated}
            prev.append({"index": idx, "failure": "QUALITY", "metrics": metrics})
        except Exception:
            runner.cancel(handle)
            raise
    c["status"] = "BLOCK"
    return {"certification": cid, "status": c["status"],
            "experiments": c["experiments"], "spend": c["spend"],
            "simulated": c["simulated"]}


@app.get("/certifications/{cid}/certificate")
def certificate(cid: str):
    if cid not in CERTS:
        raise HTTPException(404, "unknown certification")
    c = CERTS[cid]
    if c["simulated"]:
        return {"certification": cid, "verdict": "SIMULATED",
                "note": "simulator output is dev-only and can never produce a real certificate",
                "experiments": c["experiments"]}
    last = c["experiments"][-1] if c["experiments"] else None
    if not last:
        raise HTTPException(409, "no experiments yet")
    gates = [sla.Gate(**g) for g in c["config"]["gates"]]
    results = sla.evaluate_gates(gates, last["metrics"])
    return build_certificate(certification_id=cid, gate_results=results,
                             metrics=last["metrics"], spend_usd=c["spend"])
