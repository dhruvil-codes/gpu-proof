import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("USE_SIMULATOR", "true")

spec = importlib.util.spec_from_file_location("gpuproof_api_main", str(ROOT / "apps" / "api" / "app" / "main.py"))
assert spec and spec.loader
main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main)

from fastapi.testclient import TestClient  # type: ignore


def test_budget_refused_over_cap():
    main.CERTS.clear()
    c = TestClient(main.app)
    cid = c.post("/certifications", json={"budget_usd": 0.01}).json()["id"]
    out = c.post(f"/certifications/{cid}/start").json()
    assert out["status"] == "BLOCKED_BUDGET", out


def test_planner_down_returns_incomplete_not_ship():
    main.CERTS.clear()
    c = TestClient(main.app)
    cid = c.post("/certifications", json={}).json()["id"]
    real = main.propose_experiment
    try:
        def boom(ctx):
            raise RuntimeError("Certification incomplete. Reason: Planning service unavailable (down)")
        main.propose_experiment = boom
        out = c.post(f"/certifications/{cid}/start").json()
        assert out["status"] == "INCOMPLETE" and "Planning service unavailable" in out["reason"], out
    finally:
        main.propose_experiment = real


def test_rejects_non_vllm_and_multi_gpu_policy():
    from services.experiment_policy import ExperimentProposal, validate_proposal
    bad = ExperimentProposal("H100", 2, "FP8", "tensorrt", 8, "x")
    r = validate_proposal(bad, experiment_index=0, cert_spend=0, total_spend=0, estimated_cost=1.0)
    assert not r.allowed
