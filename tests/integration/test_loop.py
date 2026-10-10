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


def test_full_simulated_loop_adapts_after_failure():
    main.CERTS.clear()
    c = TestClient(main.app)
    r = c.post("/certifications", json={})
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    out = c.post(f"/certifications/{cid}/start").json()
    # story: L40S OOM (MEMORY) -> H100 INT4 quality fail -> H100 FP8 pass
    assert len(out["experiments"]) >= 2, out
    first, second = out["experiments"][0], out["experiments"][1]
    assert first["plan"]["gpu_type"] == "L40S" and first["status"] == "OOM"
    assert second["plan"]["gpu_type"] == "H100" and second["plan"] != first["plan"]
    assert out["simulated"] is True
    cert = c.get(f"/certifications/{cid}/certificate").json()
    assert cert["verdict"] == "SIMULATED" and "never produce a real certificate" in cert["note"]
