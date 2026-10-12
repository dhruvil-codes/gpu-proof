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


def wait_done(c, cid, timeout=30):
    import time
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = c.get(f"/certifications/{cid}").json()
        if s["status"] not in ("RUNNING", "CREATED"):
            return s
        time.sleep(0.5)
    raise AssertionError(f"timed out waiting for {cid}")


def test_ready_reports_simulator_without_inference_spend():
    c = TestClient(main.app)
    r = c.get("/ready").json()
    assert r["ok"] is True and r["simulator"] == "true" and "models" in r


def test_experiments_endpoints_empty_then_404():
    main.CERTS.clear()
    c = TestClient(main.app)
    cid = c.post("/certifications", json={}).json()["id"]
    assert c.get(f"/certifications/{cid}/experiments").json()["experiments"] == []
    assert c.get(f"/certifications/{cid}/experiments/0").status_code == 404
    out = c.post(f"/certifications/{cid}/cancel").json()
    assert out["detail"].startswith("not running")


def test_cancel_before_start_terminates_safely():
    main.CERTS.clear()
    c = TestClient(main.app)
    cid = c.post("/certifications", json={}).json()["id"]
    main.CERTS[cid]["cancel_requested"] = True
    c.post(f"/certifications/{cid}/start")
    assert wait_done(c, cid)["status"] == "CANCELLED"


def test_sim_job_ids_unique_and_store_rehydrates():
    main.CERTS.clear()
    c = TestClient(main.app)
    cid = c.post("/certifications", json={}).json()["id"]
    c.post(f"/certifications/{cid}/start")
    wait_done(c, cid)
    exps = c.get(f"/certifications/{cid}/experiments").json()["experiments"]
    assert len(exps) >= 2
    assert len({e["job_id"] for e in exps}) == len(exps), exps
    # simulate API restart: drop memory, endpoints must recover from SQLite
    main.CERTS.clear()
    assert c.get(f"/certifications/{cid}").status_code == 200
    assert len(c.get(f"/certifications/{cid}/experiments").json()["experiments"]) >= 2
