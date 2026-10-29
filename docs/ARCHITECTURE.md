# docs/ARCHITECTURE.md — SandboxProof system architecture (verified against code)

> Sources of truth: `apps/api/app/main.py`, `services/*.py`, `apps/web/app/*`.
> Real execution environment: Nebius Token Factory Sandboxes (Contree CPU microVMs) + hosted endpoints.

## 1. Components

| Component | Location | Job |
|-----------|----------|-----|
| Web UI | `apps/web` (Next.js `14.2.5`, React 18) | `/` unified 3-step crash-test lab (model → workload → sizing+launch), `/dashboard`, `/timeline`, `/certificate/[id]`, `/matrix`, `/usage`, `/docs`, `/sandbox-console` |
| API controller | `apps/api/app/main.py` (FastAPI) | Cert CRUD, background loop thread, SSE bus, SQLite via `services/store.py`, ledger `TOTAL`/`TOTAL_CAP` |
| Workload Twin | `services/workload_twin.py:build_twin(seed=42, n, tasks)` | Seeded alternating `tool_calling`/`structured_output` set; deterministic SHA-256 fingerprint |
| Decision layer | `services/decision_engine.py` | Nemotron Ultra planner `propose_experiment`, Nano classifier `fast_classify`, structured JSON validation + deterministic fallbacks |
| Policy engine | `services/experiment_policy.py:validate_proposal` | Deterministic hard boundary (concurrency 1..32, context 512..8192, max_tokens 16..1024, spend limits); AI cannot bypass |
| Sandbox Runner | `services/sandbox_runner.py` | `ContreeSandboxRunner` (disposable microVMs via contree-sdk, `SANDBOX-MEASURED`) vs `SimulatedSandboxRunner` (offline tests, `SIMULATED` only) |
| In-Sandbox Harness | `services/sandbox_harness.py` | Python harness uploaded to `/work` in microVM; replays twin with `ThreadPoolExecutor`, measures with `perf_counter`, scores outputs, emits stdout JSON |
| Tavily grounding | `services/tavily_pricing.py` | GPU $/hr (`fetch_gpu_prices`), inference $/1M (`fetch_inference_prices`), release radar (`release_radar`); host-side only, cached `artifacts/market/`, `tavily-live` vs `cache` provenance |
| Quality & Metrics | `services/quality_checks.py`, `services/metrics_math.py:summarize` | Deterministic JSON validation + schema keys/types + tool arguments; percentiles (P50/P95) |
| SLA evaluator | `services/sla_evaluator.py:evaluate_gates` + `decision` | SHIP iff ALL gates pass else BLOCK; missing metric = FAIL |
| Certificate | `services/certificate_engine.py:build_certificate` | Deterministic SHIP/BLOCK; raises on `simulated=True`; embeds twin digest, gates, spend, turnkey capacity envelope |
| Cost engine | `services/cost_engine.py` + `main.py:TOTAL` | Contree operation cost + Token Factory token math, ledger refusal |

## 2. Data flow

```text
  [web /] POST /certifications {candidate_model, workload_tasks, gates, concurrency, context_len}
      -> twin = build_twin(42, requests, tasks)  [deterministic sha256 digest]
      -> CERTS[cid] = CREATED, store.store_cert (secrets stripped, never persisted)
  [web] POST /certifications/{cid}/start  -> status RUNNING, thread HOOKS.run(cid)
      -> loop (services/certification_loop.py):
           1. runner.prepare("python:3.12-slim", "mkdir -p /work") -> mints reusable base image
           2. for each experiment (max 5):
                a. planner proposes {model, concurrency, context_len, max_tokens, reason}
                b. policy validate_proposal -> refuse = BLOCKED, else estimate cost
                c. ledger check (cert $10, total $20) -> refuse before launch
                d. runner.run(SandboxSpec):
                     - uploads sandbox_harness.py, quality_checks.py, metrics_math.py, twin.json
                     - injects per-op TF_KEY (preserve_env=False, disposable microVM)
                     - replays sealed twin against live hosted endpoint
                     - captures operation UUID, exit code, and billed Contree cost
                e. parse stdout JSON -> metrics {latency_p95_ms, quality_score, error_rate, total_tokens}
                f. evaluate_gates -> per-gate PASS/FAIL
                g. fail -> classifier diagnoses -> planner adapts next exp (e.g. raise max_tokens)
                h. pass -> emit SHIP -> stop
      -> SSE GET /certifications/{cid}/events streams real-time progress; terminal "done"
  [web] GET /certifications/{cid}/certificate
      -> simulated? verdict SIMULATED (dev-only, can never certify)
      -> else build_certificate(gate_results, metrics, spend, plan, twin_digest/count)
      -> {verdict SHIP|BLOCK, failing_gates, evidence, spend_usd, deployment}
  [web /certificate/[id]] renders verdict + evidence + copyable SHA-256 digests
      + turnkey capacity envelope + economics ($/1k queries from measured spend) + Model Passport
```

## 3. Policy & Caps (verified)

```text
services/experiment_policy.py:
  MAX_CONCURRENCY = 32,
  MIN_CONTEXT_TOKENS = 512, MAX_CONTEXT_TOKENS = 8192,
  MIN_OUTPUT_TOKENS = 16, MAX_OUTPUT_TOKENS = 1024,
  MAX_EXPERIMENT_RUNTIME_S = 900 (15 min),
  MAX_EXPERIMENT_COST = $2.00, MAX_CERTIFICATION_COST = $10.00,
  MAX_EXPERIMENTS = 5.
apps/api/app/main.py:
  TOTAL_CAP = float(MAX_BUDGET_USD default 20.00)  # $20 total hard cap
```

## 4. Gates (verified defaults in `main.py:NewCert`)

| Gate | Metric | Op | Threshold |
|------|--------|----|-----------|
| P95 latency | `latency_p95_ms` | `<=` | `2000` ms (or user SLA) |
| Accuracy | `quality_score` | `>=` | `0.85` |
| Error rate | `error_rate` | `<=` | `0.05` |

Any FAIL (or missing metric) ⇒ `BLOCK`. Planner-down ⇒ "Certification incomplete", never fake SHIP. Simulator ⇒ `SIMULATED`, never a real certificate.

## 5. Endpoints (verified in `main.py`)

```text
GET  /health                              {ok, simulator, total_spend, total_cap}
GET  /ready                               spend hydration + Nemotron verify (real mode only)
POST /advisor                              deterministic sizing + optional Nemotron prose
GET  /system/hardware                     native OS probe (detector.gather_profile)
GET  /models/inspect  +  POST /models/inspect   HF sizing for any slug/URL
GET  /certifications                      memory + stored + total_spend + cap
POST /certifications                      create (BYOK headers or body; secrets stripped)
GET  /certifications/{cid}                status/spend/simulated/byok_used
GET  /certifications/{cid}/events         SSE stream
GET  /certifications/{cid}/experiments    experiments + simulated + telemetry
GET  /certifications/{cid}/experiments/{idx}
POST /certifications/{cid}/start          background loop (BYOK headers refreshable)
POST /certifications/{cid}/cancel         cooperative cancel
GET  /certifications/{cid}/certificate   SIMULATED or build_certificate SHIP/BLOCK
```

## 6. Provenance Model

- **SANDBOX-MEASURED**: Real execution inside a fresh Nebius Contree CPU microVM (`operation_id` captured, `cost_usd` reported by service), replaying sealed traffic against live hosted Token Factory endpoints.
- **SIMULATED**: Local deterministic offline adapter for tests/development; output payload mirrors harness JSON contract; never produces a real certificate.
- **TAVILY-LIVE**: Fresh live rates (<7 days) and model release radar fetched from Tavily host-side.
