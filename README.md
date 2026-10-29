# SandboxProof — crash-tests for open-weight models — SHIP or BLOCK with receipts.

SandboxProof certifies candidate models against your production requirements inside
isolated Nebius Token Factory Sandboxes. Give it a candidate model and production SLA requirements.
It runs real experiments in fresh microVMs (capturing operation UUID and billed microVM cost per run),
learns from failures via NVIDIA Nemotron models, and issues a **SHIP / BLOCK** certificate backed by
measured evidence — never vibes.

> AI proposes. Policy approves. Nebius executes. Metrics decide.

Built for the **Nebius x NVIDIA Global AI Hackathon** (deadline Oct 30 2026).
Track per submission paperwork: **Coding and Agentic Engineering**.
(See `DISCLOSURE.md` for pre-existing work and track choice declaration.)

## Quick start

Prereqs: Python 3.11+, Node 18+, Docker (optional, for compose).

```powershell
# 1. env (backend auto-loads .env via python-dotenv)
Copy-Item .env.example .env   # then fill keys (names only — never commit values)

# 2. backend :8000
pip install -r apps/api/requirements.txt
# Set to "false" for real Nebius Sandbox execution (requires NEBIUS_API_KEY + NEBIUS_PROJECT_ID)
$env:USE_SIMULATOR = "false"
python -m uvicorn main:app --app-dir apps/api/app --host 127.0.0.1 --port 8000

# 3. web :3000 (new terminal)
npm --prefix apps/web install
$env:BACKEND_API_URL = "http://127.0.0.1:8000"
$env:NEXT_PUBLIC_API = "http://127.0.0.1:8000"
npm --prefix apps/web run dev   # http://localhost:3000
```

Run a certification (verified in `apps/api/app/main.py`):

```powershell
# create -> start -> stream events -> read certificate
curl -X POST http://127.0.0.1:8000/certifications -H "Content-Type: application/json" -d "{\"candidate_model\": \"nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B\", \"requests\": 10}"
curl -X POST http://127.0.0.1:8000/certifications/{id}/start
curl http://127.0.0.1:8000/certifications/{id}/events        # SSE stream
curl http://127.0.0.1:8000/certifications/{id}/certificate
```

Health: `GET /health`, `GET /ready`. Full endpoint list: see `docs/ARCHITECTURE.md` §6.

### Env keys (names only — no values in repo)

| Key | Purpose |
|-----|---------|
| `NEBIUS_API_KEY` | Token Factory inference + Contree Sandbox auth (BYOK header `X-Nebius-Api-Key` overrides per-run, in-memory only) |
| `NEBIUS_PROJECT_ID` | Nebius parent project ID for Contree sandboxes |
| `NEBIUS_REGION` | Nebius region (default `eu-north1`) |
| `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN` | Optional; public models only when empty |
| `MAX_BUDGET_USD` | Total hard cap (default `20.00`) |
| `MAX_PER_RUN_USD` | Per-certification reference cap (default `10.00`) |
| `USE_SIMULATOR` | `false` = real Nebius Contree Sandbox microVM execution; `true` = deterministic offline stand-in |
| `CANDIDATE_MODEL` | Default candidate (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`) |
| `PLANNER_MODEL` | `nvidia/Nemotron-3-Ultra-550b-a55b` |
| `CLASSIFIER_MODEL` | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` |
| `TAVILY_API_KEY` | Live GPU $/hr and model release radar grounding |

## Architecture

```text
 Next.js 14 web (apps/web: / crash-test lab, /dashboard runs registry, /timeline/[id] live run,
    /certificate/[id] document, /matrix, /usage, /docs guide, /sandbox-console live sandbox console)
   |  REST + SSE
 FastAPI (apps/api/app/main.py) — certs, ledger, background loop, SSE bus, SQLite store
   |-- services/workload_twin.py   seeded twin (SHA-256 digest, 16 hex chars)
   |-- services/decision_engine.py Nemotron Ultra planner + Nano classifier (Token Factory)
   |-- services/experiment_policy.py  deterministic safety gates (AI cannot bypass)
   |-- services/sandbox_runner.py Contree Sandboxes (real microVMs) | Simulated (dev/test only)
   |-- services/sandbox_harness.py in-sandbox replay harness (uploaded per microVM)
   |-- services/quality_checks.py + metrics_math.py deterministic scoring inside sandbox
   |-- services/sla_evaluator.py   SHIP iff ALL hard gates pass, else BLOCK
   |-- services/certificate_engine.py  deterministic SHIP/BLOCK + capacity envelope prescription
   +-- services/cost_engine.py     measured microVM + inference spend math, ledger refusal
```

Data flow: inputs → Workload Twin → Nemotron Ultra proposes serving profile → policy validates →
Contree Sandbox spawns disposable microVM → uploads harness, twin, and scoring modules → replays against
Token Factory hosted endpoint → measures latency, throughput, and JSON tool calling accuracy →
evaluates SLA gates →
fail = Nemotron classifier adapts (e.g. lean output budget truncated structured output → raise `max_tokens`) →
pass = cryptographically sealed SHIP certificate with turnkey capacity envelope.
Planner down = "Certification incomplete", never fake SHIP. Simulator = `SIMULATED`, never a real
certificate; real runs are labelled `SANDBOX-MEASURED` with verified Contree operation IDs.

## Gates, caps, provenance

- **Hard gates** (`apps/api/app/main.py:NewCert` defaults): `latency_p95_ms <= 2000`,
  `quality_score >= 0.85`, `error_rate <= 0.05`. Missing metric = FAIL = BLOCK.
- **Caps** (`services/experiment_policy.py` + `main.py`):
  15 min/sandbox op, **$2/experiment, $10/certification, $20 total hard cap**,
  5 experiments max. Ledger refuses over-budget launches before they spend.
- **Provenance**: SANDBOX-MEASURED (isolated microVM sandbox run vs hosted endpoints) →
  COMPUTED (percentiles, quality scores, exact cost from Contree operation metadata) →
  TAVILY-LIVE (`services/tavily_pricing.py`, live GPU $/hr + inference $/1M + release radar).

## Integrations

- **Nebius Token Factory** — carries planner + classifier inference and candidate endpoints.
  `services/decision_engine.py:BASE_URL=https://api.tokenfactory.nebius.com/v1`,
  `POST /chat/completions` (OpenAI-compatible, `response_format: json_object`).
- **NVIDIA Nemotron** — carries decisions and candidate subjects. Planner
  `nvidia/Nemotron-3-Ultra-550b-a55b` proposes serving profiles;
  classifier `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` labels failures
  (QUALITY/LATENCY/RELIABILITY/INFRASTRUCTURE/UNKNOWN) with deterministic
  fallback (`services/failure_classifier.py`). Certified subject:
  `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`.
- **Nebius Token Factory Sandboxes (Contree)** — carries isolated execution.
  `services/sandbox_runner.py` (contree-sdk): fresh CPU microVM per op,
  operation UUID + image UUID tracking per run, 1 MiB stream caps,
  per-operation token injection with `preserve_env=False`, secrets redacted from logs.
- **Tavily** — carries live market grounding (host-side only; key never enters sandboxes).
  `services/tavily_pricing.py`: GPU $/hr (`fetch_gpu_prices`), inference $/1M
  (`fetch_inference_prices`), new-release radar (`release_radar`), cached to
  `artifacts/market/` with honest `tavily-live` vs `cache` provenance. Targets the
  Best-Use-of-Tavily bonus — see `DISCLOSURE.md`.

## Tests

```powershell
python -m pytest tests/unit tests/integration -q   # 89 passing tests
npm --prefix apps/web run build                     # production Next.js build
```

## Docs

- `docs/ARCHITECTURE.md` — components, data flow, sizing formulas, gates, caps, provenance.
- `docs/METRICS_SLA.md` — gate semantics, Breakscale math, failure taxonomy, verification protocol.
- `docs/DEMO_SCRIPT.md` — 3-min demo beats with live sandbox execution.
- `VIDEO_SCRIPT.md` — 180-second shoot script + shot list.
- `FEEDBACK_TF_NVIDIA.md` — provider feedback drafts.
- `DISCLOSURE.md` — pre-existing-work statement + track rationale.
- `docs/runs/LEDGER.md` — live run ledger with operation UUIDs and measured costs.

## License

MIT — see [LICENSE](LICENSE).
