"""GPUProof FastAPI — certifications, experiments, certificate. Policy-gated, ledger-enforced."""
from __future__ import annotations

import json
import os
import queue
import sys
import threading
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fastapi import FastAPI, HTTPException  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from fastapi.responses import StreamingResponse  # type: ignore
from pydantic import BaseModel  # type: ignore

from services import cost_engine as ce
from services import experiment_policy as pol
from services import metrics_math as mm
from services import sla_evaluator as sla
from services import state_machine as sm
from services import store
from services import workload_twin as wt
from services.certificate_engine import build_certificate
from services.decision_engine import fast_classify, propose_experiment
from services.experiment_policy import ExperimentProposal
from services.nebius_runner import JobSpec, get_runner

app = FastAPI(title="GPUProof API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
TOTAL_CAP = float(os.environ.get("MAX_BUDGET_USD", "20"))
CERTS: dict = {}
TOTAL_SPEND = 0.0
BENCH_IMAGE = "ghcr.io/gpuproof/benchmark:cpu-sim"
BUS: dict[str, "queue.Queue[str]"] = {}


def emit(cid: str, event: dict) -> None:
    q = BUS.get(cid)
    if q is not None:
        try:
            q.put_nowait(json.dumps(event))
        except Exception:
            pass


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
    return {"ok": True, "simulator": os.environ.get("USE_SIMULATOR", "true"),
            "total_spend": TOTAL_SPEND, "total_cap": TOTAL_CAP}


@app.get("/certifications")
def list_all():
    mem = [{"id": cid, "status": c["status"], "spend": c["spend"], "simulated": c["simulated"]} for cid, c in CERTS.items()]
    return {"memory": mem, "stored": store.list_certs(), "total_spend": TOTAL_SPEND, "cap": TOTAL_CAP}


@app.post("/certifications")
def create_cert(c: NewCert):
    cid = f"cert-{uuid.uuid4().hex[:8]}"
    twin = wt.build_twin(42, c.requests, tuple(c.workload_tasks))
    CERTS[cid] = {"id": cid, "status": "CREATED", "config": c.model_dump(),
                  "twin": twin, "experiments": [], "spend": 0.0,
                  "created_at": time.time(), "simulated": None}
    store.store_cert(cid, "CREATED", c.model_dump(), twin, 0.0, None)
    BUS[cid] = queue.Queue()
    return {"id": cid, "twin_digest": twin["digest"], "count": twin["count"]}


@app.get("/certifications/{cid}/events")
def events(cid: str):
    if cid not in CERTS and store.get_cert_row(cid) is None:
        raise HTTPException(404, "unknown certification")
    if cid not in BUS:
        BUS[cid] = queue.Queue()
    q = BUS[cid]

    def gen():
        yield f"data: {json.dumps({'type': 'hello', 'certification': cid})}\n\n"
        while True:
            try:
                msg = q.get(timeout=25)
                yield f"data: {msg}\n\n"
                if '"type": "done"' in msg or '"type":"done"' in msg:
                    break
            except queue.Empty:
                yield ": ping\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/certifications/{cid}")
def get_cert(cid: str):
    if cid not in CERTS:
        raise HTTPException(404, "unknown certification")
    c = CERTS[cid]
    return {"id": cid, "status": c["status"], "spend": c["spend"],
            "experiments": len(c["experiments"]), "simulated": c["simulated"]}


@app.post("/certifications/{cid}/start")
def start_cert(cid: str):
    if cid not in CERTS:
        row = store.get_cert_row(cid)
        if row is None:
            raise HTTPException(404, "unknown certification")
        CERTS[cid] = {"id": cid, "status": row["status"], "config": row["config"],
                      "twin": row["twin"], "experiments": store.list_experiments(cid),
                      "spend": row["spend"], "created_at": time.time(), "simulated": row["simulated"]}
    c = CERTS[cid]
    if c["status"] == "RUNNING":
        return {"certification": cid, "status": "RUNNING", "detail": "already running"}
    c["status"] = "RUNNING"
    store.update_cert(cid, "RUNNING", c["spend"], c["simulated"])
    t = threading.Thread(target=_run_loop, args=(cid,), daemon=True)
    t.start()
    return {"certification": cid, "status": "RUNNING",
            "detail": "background loop started; stream /events"}


def _finish(cid: str, status: str, payload: dict) -> dict:
    c = CERTS[cid]
    c["status"] = status
    store.update_cert(cid, status, c["spend"], c["simulated"])
    emit(cid, {"type": "done", "status": status, **payload})
    return {"certification": cid, "status": status, "experiments": c["experiments"],
            "spend": c["spend"], "simulated": c["simulated"], **payload}


def _run_loop(cid: str):
    global TOTAL_SPEND
    c = CERTS[cid]
    try:
        runner = get_runner()
    except RuntimeError as e:
        _finish(cid, "BLOCKED_INFRA", {"reasons": [str(e)]})
        return
    budget = min(c["config"]["budget_usd"], 10.0)
    if budget < 0.05:
        _finish(cid, "BLOCKED_BUDGET",
                {"reasons": [f"budget ${budget:.2f} below minimum $0.05 experiment reserve"]})
        return
    prev: list = []
    try:
        for idx in range(5):
            emit(cid, {"type": "experiment_start", "index": idx})
            ctx = {"candidate": c["config"]["candidate_model"],
                   "twin_digest": c["twin"]["digest"],
                   "budget_left": round(budget - c["spend"], 2),
                   "previous": prev, "hardware": ["L40S", "H100"]}
            try:
                plan = propose_experiment(ctx)
            except RuntimeError as e:
                _finish(cid, "INCOMPLETE", {"reason": str(e)})
                return
            RUN_ONE = (cid, idx, plan, prev, budget)
            done = _run_one(RUN_ONE)
            if done:
                return
        _finish(cid, "BLOCK", {"spend": c["spend"]})
    except Exception as e:  # noqa: BLE001 — terminate safely, never hang
        _finish(cid, "BLOCKED_INFRA", {"reasons": [f"{type(e).__name__}: {str(e)[:300]}"]})


def _run_one(args) -> bool:
    global TOTAL_SPEND
    cid, idx, plan, prev, budget = args
    c = CERTS[cid]
    runner = get_runner()
    proposal = ExperimentProposal(plan["gpu_type"], 1, plan["precision"],
                                  plan["engine"], plan["batch_config"], plan["reason"])
    est = ce.estimate_cost(proposal.gpu_type)
    check = pol.validate_proposal(proposal, experiment_index=idx, cert_spend=c["spend"],
                                  total_spend=TOTAL_SPEND, total_cap=TOTAL_CAP, estimated_cost=est)
    emit(cid, {"type": "policy", "index": idx, "allowed": check.allowed,
               "reasons": check.reasons, "estimated_cost": est})
    if not check.allowed:
        status = "BLOCKED_BUDGET" if any("cap" in r for r in check.reasons) else "BLOCKED_POLICY"
        _finish(cid, status, {"reasons": check.reasons})
        return True
    state = "QUEUED"
    for _ in range(5):
        state = sm.advance(state)
    emit(cid, {"type": "state", "index": idx, "state": state})
    handle = runner.create(JobSpec(BENCH_IMAGE, proposal.gpu_type, 1,
                                   {"MODEL": c["config"]["candidate_model"]}))
    try:
        if c["simulated"] is None:
            c["simulated"] = handle.simulated
        logs = runner.logs(handle)
        simulated = handle.simulated
        if simulated:
            time.sleep(1.0)
            if "out of memory" in logs.lower():
                metrics = {"quality_score": 0.0, "error_rate": 1.0, "latency_p95_ms": 0,
                           "ttft_p95_ms": 0, "requests_per_s": 0.0, "tokens_per_s": 0.0,
                           "total_tokens": 0, "simulated": True}
                failure = "MEMORY"
            else:
                sample = [{"status": "ok", "ttft_ms": 180, "latency_ms": 900,
                           "input_tokens": 200, "output_tokens": 80}] * 100
                metrics = mm.summarize(sample, 60.0) | {"quality_score": 0.93,
                                                        "error_rate": 0.01, "simulated": True}
                failure = None
                if plan["precision"] == "INT4":
                    metrics = dict(metrics) | {"quality_score": 0.62}
        else:
            from services import replay as replay_mod
            endpoint = os.environ.get("BENCH_ENDPOINT", "")
            if not endpoint:
                raise RuntimeError("real job returned but BENCH_ENDPOINT unset; refusing to fabricate")
            rep = replay_mod.replay(c["twin"], endpoint, c["config"]["candidate_model"],
                                    os.environ.get("NEBIUS_API_KEY", ""))
            metrics = rep["metrics"]
            failure = None
            logs = logs + f"\nmeasured {len(rep['requests'])} requests"
        cost = 0.0 if simulated else ce.experiment_cost(proposal.gpu_type, 60.0)
        c["spend"] = round(c["spend"] + cost, 4)
        TOTAL_SPEND = round(TOTAL_SPEND + cost, 4)
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
                emit(cid, {"type": "experiment_done", "experiment": exp})
                runner.delete(handle)
                _finish(cid, "SHIP", {"spend": c["spend"]})
                return True
            prev.append({"index": idx, "failure": "QUALITY", "metrics": metrics})
        store.save_experiment(cid, exp)
        c["experiments"].append(exp)
        emit(cid, {"type": "experiment_done", "experiment": exp})
        runner.delete(handle)
        return False
    except Exception:
        try:
            runner.cancel(handle)
        finally:
            pass
        raise


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
