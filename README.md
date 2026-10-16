# SandboxProof — crash-tests for open-weight models — SHIP or BLOCK with receipts.

SandboxProof certifies a candidate model against your production requirements inside
isolated Nebius Token Factory Sandboxes. Give it your current deployment, a candidate
model, and production requirements. It runs real experiments in fresh microVMs
(operation ID + image UUID per run), learns from failures, and issues a **SHIP / BLOCK**
certificate backed by measured evidence — never vibes.

> AI proposes. Policy approves. Nebius executes. Metrics decide.

Built for the **Nebius x NVIDIA Global AI Hackathon** (deadline Oct 30 2026).
Track per submission paperwork: **Coding and Agentic Engineering**.
(Note: `docs/PRD.md` §4 still says "Best Apps and Agents" — pre-existing text, see `DISCLOSURE.md`.)

## Quick start

Prereqs: Python 3.11+, Node 18+, Docker (optional, for compose).

```powershell
# 1. env (backend auto-loads .env via python-dotenv)
Copy-Item .env.example .env   # then fill keys (names only — never commit values)

# 2. backend :8000
pip install -r apps/api/requirements.txt
$env:USE_SIMULATOR = "true"   # "false" for real Nebius Sandbox runs (needs NEBIUS_API_KEY + NEBIUS_PROJECT_ID)
python -m uvicorn main:app --app-dir apps/api/app --host 127.0.0.1 --port 8000

# 3. web :3000 (new terminal)
npm --prefix apps/web install
$env:NEXT_PUBLIC_API = "http://127.0.0.1:8000"
npm --prefix apps/web run dev   # http://localhost:3000
```

Run a certification (verified in `apps/api/app/main.py`):

```powershell
# create -> start -> stream events -> read certificate
curl -X POST http://127.0.0.1:8000/certifications -H "Content-Type: application/json" -d "{}"
curl -X POST http://127.0.0.1:8000/certifications/{id}/start
curl http://127.0.0.1:8000/certifications/{id}/events        # SSE stream
curl http://127.0.0.1:8000/certifications/{id}/certificate
```

Health: `GET /health`, `GET /ready`. Full endpoint list: see `docs/ARCHITECTURE.md` §6.

### Env keys (names only — no values in repo)

| Key | Purpose |
|-----|---------|
| `NEBIUS_API_KEY` | Token Factory inference + AI Cloud Jobs auth (BYOK header `X-Nebius-Api-Key` overrides per-run, in-memory only) |
| `NEBIUS_PROJECT_ID` | AI Cloud parent project for `POST /jobs` |
| `NEBIUS_REGION` | GPU provisioning region (default `eu-north1`) |
| `NEBIUS_SUBNET_ID` | VPC subnet for jobs (empty = real job creation blocked, simulator only) |
| `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN` | Optional; public models only when empty |
| `MAX_BUDGET_USD` | Total hard cap (default `20.00`) |
| `MAX_PER_RUN_USD` | Per-certification reference cap (default `10.00`) |
| `USE_SIMULATOR` | `true` = deterministic simulator, `$0`, `SIMULATED` verdicts only |
| `CANDIDATE_MODEL` | Default candidate (`Nemotron-3-Nano-30B`) |
| `BASELINE_MODEL` | Cached baseline (`Qwen3-8B`) |
| `PLANNER_MODEL` | `nvidia/Nemotron-3-Ultra-550b-a55b` |
| `CLASSIFIER_MODEL` | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` |

## Architecture (ASCII)

```text
 Next.js 14 web (apps/web: /, /new, /dashboard, /timeline, /certificate/[id], /docs)
   |  REST + SSE
 FastAPI (apps/api/app/main.py) — certs, ledger, background loop, SSE bus, SQLite store
   |-- services/workload_twin.py   seeded twin (SHA-256 digest, 16 hex chars)
   |-- services/decision_engine.py Nemotron Ultra planner + Nano classifier (Token Factory)
   |-- services/experiment_policy.py  deterministic gates (AI cannot bypass)
   |-- services/sandbox_runner.py Contree Sandboxes (real, isolated) | Simulated (dev/test only)
   |-- services/nebius_runner.py  legacy AI Cloud adapter (kept for interface compat; not used)
   |-- services/replay.py + metrics_math.py + quality_checks.py  measured metrics
   |-- services/sla_evaluator.py   SHIP iff ALL hard gates pass, else BLOCK
   |-- services/certificate_engine.py  deterministic SHIP/BLOCK + deployment prescription
   +-- services/cost_engine.py     measured-runtime $ math, ledger refusal
```

Data flow: inputs → Workload Twin → planner proposes harness → policy validates →
Sandbox run (fresh microVM, teardown always) → replay vs hosted Token Factory
endpoints → evaluator →
fail = classify + adapt (max 5 exps) / pass = SHIP/BLOCK certificate.
Planner down = "Certification incomplete", never SHIP. Simulator = `SIMULATED`, never a real
certificate; sandbox runs are labelled `SANDBOX-MEASURED`.

## Gates, caps, provenance

- **Hard gates** (`apps/api/app/main.py:NewCert` defaults): `latency_p95_ms <= 2000`,
  `quality_score >= 0.85`, `error_rate <= 0.05`. Missing metric = FAIL = BLOCK.
- **Caps** (`services/experiment_policy.py` + `main.py`): hosted-tier shortlist,
  15 min/sandbox op, **$2/experiment, $10/certification, $20 total hard cap**,
  5 experiments max. Ledger refuses over-budget launches before they spend.
- **Provenance**: SANDBOX-MEASURED (isolated sandbox run vs hosted endpoints) →
  COMPUTED (percentiles, KV-cache sizing, `$` from measured runtime) →
  TAVILY-LIVE (`services/tavily_pricing.py`, GPU $/hr + inference $/1M + release radar,
  cached fallback) or STATIC-PRICED (`services/cost_engine.py:GPU_HOURLY_USD`).

## Integrations (only what exists in code)

- **Nebius Token Factory** — carries planner + classifier inference.
  `services/decision_engine.py:BASE_URL=https://api.tokenfactory.nebius.com/v1`,
  `POST /chat/completions` (OpenAI-compatible, `response_format: json_object`).
- **NVIDIA Nemotron** — carries decisions, not vibes. Planner
  `nvidia/Nemotron-3-Ultra-550b-a55b` proposes one experiment JSON;
  classifier `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` labels failures
  (MEMORY/LATENCY/QUALITY/RELIABILITY/INFRASTRUCTURE/UNKNOWN) with deterministic
  fallback (`services/failure_classifier.py`). Subject under test:
  Nemotron-3-Nano-30B; cached baseline Qwen3-8B on H100 FP8.
- **Nebius Token Factory Sandboxes** — carries isolated execution.
  `services/sandbox_runner.py` (Contree SDK): fresh microVM per op, `disposable=False`
  chaining for prepared images, operation ID + image UUID per run, 1 MiB stream caps,
  secrets never enter the sandbox. Simulator fallback for dev/test only.
- **Hugging Face** — carries model identity + architecture truth.
  `services/advisor.py:fetch_hf_metadata` reads
  `https://huggingface.co/{repo}/raw/main/config.json` and
  `https://huggingface.co/api/models/{repo}` (optional `HF_TOKEN`);
  web widget validates `https://huggingface.co/api/models/{slug}` client-side.
- **Tavily** — carries live market grounding (host-side only; key never enters sandboxes).
  `services/tavily_pricing.py`: GPU $/hr (`fetch_gpu_prices`), inference $/1M
  (`fetch_inference_prices`), new-release radar (`release_radar`), cached to
  `artifacts/market/` with honest `tavily-live` vs `cache` provenance. Targets the
  Best-Use-of-Tavily bonus — see `DISCLOSURE.md`.

## Tests

```powershell
python -m pytest tests/unit tests/integration -q   # USE_SIMULATOR=true
npm --prefix apps/web run build                     # production frontend build
```

## Docs

- `docs/ARCHITECTURE.md` — components, data flow, sizing formulas, gates, caps, provenance.
- `docs/METRICS_SLA.md` — gate semantics, Breakscale math, failure taxonomy, verification protocol.
- `docs/DEMO_SCRIPT.md` — 3-min demo beats (verified L40S-OOM → H100-FP8-SHIP path).
- `VIDEO_SCRIPT.md` — 180-second shoot script + shot list.
- `FEEDBACK_TF_NVIDIA.md` — provider feedback drafts.
- `DISCLOSURE.md` — pre-existing-work statement + track rationale.

## License

MIT — see [LICENSE](LICENSE).
