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

from fastapi import FastAPI, Header, HTTPException  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from fastapi.responses import StreamingResponse  # type: ignore
from pydantic import BaseModel, Field  # type: ignore

from services import cost_engine as ce
from services import advisor as advisor_svc
from services import experiment_policy as pol
from services import sla_evaluator as sla
from services import store
from services import workload_twin as wt
from services.certificate_engine import build_certificate
from services.certification_loop import LoopHooks
from services.nebius_runner import get_runner, get_runner_for_byok

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


def _sanitize_byok(api_key: str | None, project_id: str | None,
                   subnet_id: str | None) -> dict:
    """Normalize BYOK credentials; empty key means Demo Mode (no BYOK).

    Keys live in memory only for the certification run — they are never
    written to the server database (see create_cert: config persisted
    without secrets).
    """
    key = (api_key or "").strip()
    proj = (project_id or "").strip()
    sub = (subnet_id or "").strip()
    return {"api_key": key, "project_id": proj, "subnet_id": sub,
            "byok_used": bool(key)}


def _get_runner(byok: dict | None = None):
    """Shared simulator instance (unique job IDs); fresh real runner each call.

    BYOK dict (if any) supplies per-run credentials; simulator mode ignores
    the key for execution but still bypasses the shared budget cap in the
    loop. Real mode builds a runner bound to the caller's key.
    """
    global _SIM_RUNNER
    if os.environ.get("USE_SIMULATOR", "true").lower() == "true":
        if _SIM_RUNNER is None:
            _SIM_RUNNER = get_runner()
        return _SIM_RUNNER
    return get_runner_for_byok(byok)


def _runner_factory_for(cid: str):
    """Per-certification runner factory capturing that cert's BYOK creds."""
    def _factory():
        cert = CERTS.get(cid, {})
        return _get_runner(cert.get("byok"))
    return _factory


def _load(cid: str) -> dict:
    """Return the in-memory cert, rehydrating from SQLite after a restart."""
    if cid in CERTS:
        # Older in-memory entries predating BYOK may lack the key — default it.
        CERTS[cid].setdefault("byok", {"api_key": "", "project_id": "",
                                       "subnet_id": "", "byok_used": False})
        return CERTS[cid]
    row = store.get_cert_row(cid)
    if row is None:
        raise HTTPException(404, "unknown certification")
    CERTS[cid] = {"id": cid, "status": row["status"], "config": row["config"],
                  "twin": row["twin"], "experiments": store.list_experiments(cid),
                  "spend": row["spend"], "created_at": time.time(),
                  "simulated": row["simulated"], "telemetry": [],
                  # BYOK keys are never persisted — rehydrated runs fall back
                  # to server .env / simulator until the client resends them.
                  "byok": {"api_key": "", "project_id": "",
                           "subnet_id": "", "byok_used": False}}
    if cid not in BUS:
        BUS[cid] = queue.Queue()
    return CERTS[cid]


def _byok_flag(cert: dict) -> bool:
    return bool((cert.get("byok") or {}).get("byok_used"))


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
    candidate_model: str = Field(default="Nemotron-3-Nano-30B", max_length=250)
    current_model: str = Field(default="Qwen3-8B", max_length=250)
    gpu_type: str = "H100"
    precision: str = "FP8"
    workload_tasks: list[str] = ["tool_calling", "structured_output"]
    gates: list[dict] = [
        {"metric": "latency_p95_ms", "op": "<=", "threshold": 2000},
        {"metric": "quality_score", "op": ">=", "threshold": 0.85},
        {"metric": "error_rate", "op": "<=", "threshold": 0.05},
    ]
    budget_usd: float = Field(default=10.0, gt=0, le=100.0)
    requests: int = Field(default=200, gt=0, le=10000)
    # Legacy aliases
    budget_limit_usd: float | None = None
    sample_size: int | None = None
    # Explicit execution mode chosen in the web UI toggle ("real" | "sim").
    # Stored on the cert config for audit clarity; the runner still resolves
    # per-request via USE_SIMULATOR/BYOK so old clients keep working.
    mode: str | None = None
    # Optional BYOK payload fallback (headers take precedence). Never persisted.
    nebius_api_key: str | None = None
    nebius_project_id: str | None = None
    nebius_subnet_id: str | None = None


class AdvisorRequest(BaseModel):
    query: str = ""
    current_gpu: str | None = None


def _normalize_mode(*values: str | None) -> str:
    """Normalize the execution-mode toggle to 'real' | 'sim' (default sim)."""
    for v in values:
        s = (v or "").strip().lower()
        if s in ("real", "live", "nebius", "cloud"):
            return "real"
        if s in ("sim", "simulator", "demo", "deterministic"):
            return "sim"
    return "sim"


@app.get("/health")
def health():
    return {"ok": True, "simulator": os.environ.get("USE_SIMULATOR", "true"),
            "total_spend": TOTAL["spend"], "total_cap": TOTAL_CAP}


@app.get("/ready")
def ready():
    """Startup checks: spend hydration + Nemotron model verification (real mode only)."""
    return {"ok": True, "spend": TOTAL["spend"], "cap": TOTAL_CAP, **STARTUP_CHECKS}


@app.post("/advisor")
def advisor(
    req: AdvisorRequest,
    x_nebius_api_key: str | None = Header(default=None, alias="X-Nebius-Api-Key"),
):
    """Model Migration Advisor: deterministic VRAM math + optional Nemotron prose.

    Always returns concrete numbers (never an error when the LLM is down):
    `source` is 'nemotron-ultra' when Token Factory enriched the answer,
    otherwise 'deterministic'.
    """
    det = advisor_svc.advise(req.query, req.current_gpu)
    byok_key = (x_nebius_api_key or "").strip() or None
    try:
        from services.decision_engine import PLANNER_MODEL, _call
        sys_prompt = (
            "You are the GPUProof Model Migration Advisor, an expert GPU inference "
            "engineer. Answer concisely with concrete VRAM math: parameter memory "
            "(params x bytes), KV-cache formula 2 x layers x hidden x seq_len x batch "
            "x bytes / 1e9, plus a recommended single-GPU tier (RTX4090 24GB, L40S 48GB, "
            "A100/H100 80GB, H200 141GB) and a structured-JSON/tool-call risk note. "
            "End with the candidate Hugging Face slug on its own line as "
            "'CANDIDATE: <slug>'. Keep it under 220 words."
        )
        user = (f"Question: {(req.query or '').strip() or 'Can I run this model on my GPU?'}"
                f"\nCurrent GPU: {req.current_gpu or 'unknown'}"
                f"\nDeterministic sizing (ground truth, do not contradict): {det['answer']}")
        llm_text = _call(PLANNER_MODEL,
                         [{"role": "system", "content": sys_prompt},
                          {"role": "user", "content": user}],
                         json_mode=False, timeout=30, api_key=byok_key).strip()
        if llm_text:
            return {**det, "answer": f"{llm_text}\n\n---\n**Deterministic sizing (ground truth):**\n{det['answer']}",
                    "source": "nemotron-ultra"}
    except Exception:
        pass
    return det


@app.get("/system/hardware")
def system_hardware():
    """Native OS hardware probe for the machine running GPUProof."""
    from services.detector import gather_profile
    return gather_profile()


@app.get("/models/inspect")
def inspect_model(query: str = ""):
    """Dynamic hardware sizing & compatibility inspection for ANY Hugging Face model or URL."""
    return advisor_svc.inspect_model_fit(query)


@app.post("/models/inspect")
def inspect_model_post(payload: dict):
    q = payload.get("query") or payload.get("model") or payload.get("candidate_model") or ""
    return advisor_svc.inspect_model_fit(str(q))


@app.get("/certifications")
def list_all():
    mem = [{"id": cid, "status": c["status"], "spend": c["spend"],
            "simulated": c["simulated"], "byok_used": _byok_flag(c)}
           for cid, c in CERTS.items()]
    return {"memory": mem, "stored": store.list_certs(), "total_spend": TOTAL["spend"], "cap": TOTAL_CAP}


@app.post("/certifications")
def create_cert(
    c: NewCert,
    x_nebius_api_key: str | None = Header(default=None, alias="X-Nebius-Api-Key"),
    x_nebius_project_id: str | None = Header(default=None, alias="X-Nebius-Project-Id"),
    x_nebius_subnet_id: str | None = Header(default=None, alias="X-Nebius-Subnet-Id"),
    x_gpuproof_mode: str | None = Header(default=None, alias="X-GPUProof-Mode"),
    x_execution_mode: str | None = Header(default=None, alias="X-Execution-Mode"),
):
    if c.budget_limit_usd is not None:
        if c.budget_limit_usd <= 0 or c.budget_limit_usd > 100.0:
            raise HTTPException(status_code=422, detail="budget_limit_usd must be > 0 and <= 100")
        c.budget_usd = c.budget_limit_usd
    if c.sample_size is not None:
        if c.sample_size <= 0 or c.sample_size > 10000:
            raise HTTPException(status_code=422, detail="sample_size must be > 0 and <= 10000")
        c.requests = c.sample_size
    # Headers take precedence over payload fields (client localStorage -> headers).
    byok = _sanitize_byok(
        x_nebius_api_key if x_nebius_api_key is not None else c.nebius_api_key,
        x_nebius_project_id if x_nebius_project_id is not None else c.nebius_project_id,
        x_nebius_subnet_id if x_nebius_subnet_id is not None else c.nebius_subnet_id,
    )
    mode = _normalize_mode(c.mode, x_gpuproof_mode, x_execution_mode)
    cid = f"cert-{uuid.uuid4().hex[:8]}"
    twin = wt.build_twin(42, c.requests, tuple(c.workload_tasks))
    full_config = c.model_dump()
    # NEVER persist secrets: strip BYOK fields before writing to SQLite.
    safe_config = {k: v for k, v in full_config.items()
                   if k not in ("nebius_api_key", "nebius_project_id", "nebius_subnet_id")}
    # Clean URLs to clean Hugging Face repo IDs
    safe_config["candidate_model"] = advisor_svc.extract_hf_repo_id(c.candidate_model) or c.candidate_model
    safe_config["current_model"] = advisor_svc.extract_hf_repo_id(c.current_model) or c.current_model
    safe_config["mode"] = mode
    CERTS[cid] = {"id": cid, "status": "CREATED", "config": safe_config,
                  "twin": twin, "experiments": [], "spend": 0.0,
                  "created_at": time.time(), "simulated": None, "telemetry": [],
                  "byok": byok}
    store.store_cert(cid, "CREATED", safe_config, twin, 0.0, None)
    BUS[cid] = queue.Queue()
    return {"id": cid, "twin_digest": twin["digest"], "count": twin["count"],
            "byok_used": byok["byok_used"], "mode": mode}


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
            "experiments": len(c["experiments"]), "simulated": c["simulated"],
            "byok_used": _byok_flag(c)}


@app.get("/certifications/{cid}/experiments")
def list_experiments(cid: str):
    c = _load(cid)
    return {"certification": cid, "experiments": c["experiments"],
            "simulated": c["simulated"], "telemetry": c.get("telemetry", [])}


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
def start_cert(
    cid: str,
    x_nebius_api_key: str | None = Header(default=None, alias="X-Nebius-Api-Key"),
    x_nebius_project_id: str | None = Header(default=None, alias="X-Nebius-Project-Id"),
    x_nebius_subnet_id: str | None = Header(default=None, alias="X-Nebius-Subnet-Id"),
):
    c = _load(cid)
    # Allow the client to (re)send BYOK headers on start; header values win.
    # Still in-memory only — update_cert never receives secrets.
    if x_nebius_api_key is not None or x_nebius_project_id is not None or x_nebius_subnet_id is not None:
        prev = c.get("byok") or {}
        c["byok"] = _sanitize_byok(
            x_nebius_api_key if x_nebius_api_key is not None else prev.get("api_key"),
            x_nebius_project_id if x_nebius_project_id is not None else prev.get("project_id"),
            x_nebius_subnet_id if x_nebius_subnet_id is not None else prev.get("subnet_id"),
        )
    if c["status"] == "RUNNING":
        return {"certification": cid, "status": "RUNNING", "detail": "already running",
                "byok_used": _byok_flag(c)}
    c["status"] = "RUNNING"
    store.update_cert(cid, "RUNNING", c["spend"], c["simulated"])
    t = threading.Thread(target=HOOKS.run, args=(cid, _runner_factory_for(cid)), daemon=True)
    t.start()
    return {"certification": cid, "status": "RUNNING",
            "detail": "background loop started; stream /events",
            "byok_used": _byok_flag(c)}


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
