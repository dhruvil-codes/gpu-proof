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

def _repo_root() -> Path:
    here = Path(__file__).resolve()
    for cand in (here.parents[2], here.parents[1], Path.cwd()):
        try:
            if (cand / "services").is_dir():
                return cand
        except Exception:
            continue
    for entry in sys.path:  # covers PYTHONPATH=repo-root launches (uvicorn app.main:app)
        try:
            if (Path(entry) / "services").is_dir():
                return Path(entry)
        except Exception:
            continue
    return here.parents[2]


sys.path.insert(0, str(_repo_root()))

try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv(_repo_root() / ".env")
except Exception:
    pass

from fastapi import FastAPI, HTTPException  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from fastapi.responses import StreamingResponse  # type: ignore
from pydantic import BaseModel  # type: ignore

from services import cost_engine as ce
from services import experiment_policy as pol
from services import sla_evaluator as sla
from services import store
from services import workload_twin as wt
from services.certificate_engine import build_certificate
from services.certification_loop import LoopHooks
from services.nebius_runner import get_runner

app = FastAPI(title="GPUProof API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
TOTAL_CAP = float(os.environ.get("MAX_BUDGET_USD", "20"))
CERTS: dict = {}
TOTAL = {"spend": 0.0}
BENCH_IMAGE = "ghcr.io/gpuproof/benchmark:cpu-sim"
BUS: dict[str, "queue.Queue[str]"] = {}
_SIM_RUNNER = None  # one simulator per process so sim job IDs stay unique


def emit(cid: str, event: dict) -> None:
    q = BUS.get(cid)
    if q is not None:
        try:
            q.put_nowait(json.dumps(event))
        except Exception:
            pass


HOOKS = LoopHooks(CERTS, emit, BENCH_IMAGE, TOTAL, TOTAL_CAP)


def _get_runner():
    """Shared simulator instance (unique job IDs); fresh real runner each call."""
    global _SIM_RUNNER
    if os.environ.get("USE_SIMULATOR", "true").lower() == "true":
        if _SIM_RUNNER is None:
            _SIM_RUNNER = get_runner()
        return _SIM_RUNNER
    return get_runner()


def _load(cid: str) -> dict:
    """Return the in-memory cert, rehydrating from SQLite after a restart."""
    if cid in CERTS:
        return CERTS[cid]
    row = store.get_cert_row(cid)
    if row is None:
        raise HTTPException(404, "unknown certification")
    CERTS[cid] = {"id": cid, "status": row["status"], "config": row["config"],
                  "twin": row["twin"], "experiments": store.list_experiments(cid),
                  "spend": row["spend"], "created_at": time.time(),
                  "simulated": row["simulated"]}
    if cid not in BUS:
        BUS[cid] = queue.Queue()
    return CERTS[cid]


def _hydrate_spend() -> None:
    try:
        TOTAL["spend"] = round(sum(r.get("spend", 0.0) or 0.0 for r in store.list_certs()), 4)
    except Exception:
        pass


_hydrate_spend()

STARTUP_CHECKS: dict = {"simulator": os.environ.get("USE_SIMULATOR", "true"),
                        "models": "skipped-simulator (no inference spend in simulator mode)"}
if os.environ.get("USE_SIMULATOR", "true").lower() != "true":
    try:
        from services.decision_engine import verify_models
        STARTUP_CHECKS["models"] = verify_models()
    except Exception as e:  # noqa: BLE001 — startup must never crash on a probe
        STARTUP_CHECKS["models"] = {"error": str(e)[:200]}


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
            "total_spend": TOTAL["spend"], "total_cap": TOTAL_CAP}


@app.get("/ready")
def ready():
    """Startup checks: spend hydration + Nemotron model verification (real mode only)."""
    return {"ok": True, "spend": TOTAL["spend"], "cap": TOTAL_CAP, **STARTUP_CHECKS}


@app.get("/certifications")
def list_all():
    mem = [{"id": cid, "status": c["status"], "spend": c["spend"], "simulated": c["simulated"]} for cid, c in CERTS.items()]
    return {"memory": mem, "stored": store.list_certs(), "total_spend": TOTAL["spend"], "cap": TOTAL_CAP}


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
    _load(cid)
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
    c = _load(cid)
    return {"id": cid, "status": c["status"], "spend": c["spend"],
            "experiments": len(c["experiments"]), "simulated": c["simulated"]}


@app.get("/certifications/{cid}/experiments")
def list_experiments(cid: str):
    c = _load(cid)
    return {"certification": cid, "experiments": c["experiments"], "simulated": c["simulated"]}


@app.get("/certifications/{cid}/experiments/{idx}")
def get_experiment(cid: str, idx: int):
    c = _load(cid)
    for e in c["experiments"]:
        if e.get("index") == idx:
            return e
    raise HTTPException(404, "unknown experiment index")


@app.post("/certifications/{cid}/cancel")
def cancel_cert(cid: str):
    c = _load(cid)
    if c["status"] == "RUNNING":
        c["cancel_requested"] = True
        return {"certification": cid, "status": "RUNNING", "detail": "cancel requested; loop stops after current experiment"}
    return {"certification": cid, "status": c["status"], "detail": "not running; nothing to cancel"}


@app.post("/certifications/{cid}/start")
def start_cert(cid: str):
    c = _load(cid)
    if c["status"] == "RUNNING":
        return {"certification": cid, "status": "RUNNING", "detail": "already running"}
    c["status"] = "RUNNING"
    store.update_cert(cid, "RUNNING", c["spend"], c["simulated"])
    t = threading.Thread(target=HOOKS.run, args=(cid, _get_runner), daemon=True)
    t.start()
    return {"certification": cid, "status": "RUNNING",
            "detail": "background loop started; stream /events"}


@app.get("/certifications/{cid}/certificate")
def certificate(cid: str):
    c = _load(cid)
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
