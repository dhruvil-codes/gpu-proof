import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("USE_SIMULATOR", "true")

spec = importlib.util.spec_from_file_location("sandboxproof_api_main", str(ROOT / "apps" / "api" / "app" / "main.py"))
assert spec and spec.loader
main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main)

from fastapi.testclient import TestClient  # type: ignore


def wait_done(c, cid, timeout=30):
    import time
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = c.get(f"/certifications/{cid}").json()
        if s["status"] not in ("RUNNING", "CREATED"):
            return s
        time.sleep(0.5)
    raise AssertionError(f"timed out waiting for {cid}")


def test_budget_refused_over_cap():
    main.CERTS.clear()
    c = TestClient(main.app)
    cid = c.post("/certifications", json={"budget_usd": 0.01}).json()["id"]
    c.post(f"/certifications/{cid}/start")
    out = wait_done(c, cid)
    assert out["status"] == "BLOCKED_BUDGET", out


def test_planner_down_returns_incomplete_not_ship():
    main.CERTS.clear()
    c = TestClient(main.app)
    cid = c.post("/certifications", json={}).json()["id"]
    import services.certification_loop as loop
    real = loop.propose_experiment
    try:
        def boom(ctx, **kw):
            raise RuntimeError("Certification incomplete. Reason: Planning service unavailable (down)")
        loop.propose_experiment = boom
        c.post(f"/certifications/{cid}/start")
        s = wait_done(c, cid)
        assert s["status"] == "INCOMPLETE", s
    finally:
        loop.propose_experiment = real


def test_rejects_out_of_bounds_policy():
    from services.experiment_policy import ExperimentProposal, validate_proposal
    bad_concurrency = ExperimentProposal("test-model", 64, 4096, 256, "excessive concurrency")
    r = validate_proposal(bad_concurrency, experiment_index=0, cert_spend=0, total_spend=0, estimated_cost=1.0)
    assert not r.allowed and any("concurrency" in x for x in r.reasons)

    bad_model = ExperimentProposal("wrong-model", 8, 4096, 256, "divergent model")
    r2 = validate_proposal(bad_model, experiment_index=0, cert_spend=0, total_spend=0, estimated_cost=0.01,
                           allowed_model="test-model")
    assert not r2.allowed and any("not the certification subject" in x for x in r2.reasons)
