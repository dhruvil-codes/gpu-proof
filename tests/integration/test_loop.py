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


def test_full_simulated_loop_adapts_after_failure():
    main.CERTS.clear()
    c = TestClient(main.app)
    r = c.post("/certifications", json={})
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    started = c.post(f"/certifications/{cid}/start").json()
    assert started["status"] == "RUNNING", started
    # story: lean max_tokens truncates structured output -> QUALITY failure -> planner raises max_tokens -> pass
    s = wait_done(c, cid)
    assert s["experiments"] >= 2, s
    exps = main.CERTS[cid]["experiments"]
    first, second = exps[0], exps[1]
    assert first["plan"]["max_tokens"] < 128 and first["failure"] == "QUALITY"
    assert second["plan"]["max_tokens"] >= 128 and second["verdict"] == "SHIP"
    cert = c.get(f"/certifications/{cid}/certificate").json()
    assert cert["verdict"] == "SIMULATED" and "never produce a real certificate" in cert["note"]
