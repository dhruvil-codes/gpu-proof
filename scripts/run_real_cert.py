import json
import os
import sys
from pathlib import Path

# Ensure repo root is on sys.path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ["USE_SIMULATOR"] = "false"

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

from apps.api.app import main
from apps.api.app.main import CERTS, HOOKS, _runner_factory_for, NewCert

print("Starting live real certification...")
payload = NewCert(
    candidate_model="nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
    requests=4,
    budget_usd=5.0,
    gates=[
        {"metric": "latency_p95_ms", "op": "<=", "threshold": 5000},
        {"metric": "quality_score", "op": ">=", "threshold": 0.85},
        {"metric": "error_rate", "op": "<=", "threshold": 0.05},
    ],
)

cert_info = main.create_cert(payload)
cid = cert_info["id"]
print(f"Created certification: {cid}")

# Run certification loop synchronously
HOOKS.run(cid, _runner_factory_for(cid))

cert_res = CERTS[cid]
print(f"Certification status: {cert_res['status']}")
print(f"Total experiments: {len(cert_res['experiments'])}")

for exp in cert_res["experiments"]:
    print(f"--- Experiment {exp['index']} ---")
    print(f"  Plan: {exp['plan']}")
    print(f"  Verdict: {exp['verdict']}")
    print(f"  Failure: {exp.get('failure')}")
    print(f"  Metrics: {exp.get('metrics')}")
    print(f"  Sandbox Op: {exp['sandbox']['operation_id']}")
    print(f"  Sandbox Cost: ${exp['sandbox']['cost_usd']}")

cert = main.certificate(cid)
print(f"Certificate verdict: {cert['verdict']}")
print(f"Certificate deployment: {json.dumps(cert.get('deployment', {}), indent=2)}")

out_path = ROOT / "docs" / "runs" / "real-001.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump({"certification": cert, "experiments": cert_res["experiments"]}, f, indent=2)
print(f"Saved evidence to {out_path}")

