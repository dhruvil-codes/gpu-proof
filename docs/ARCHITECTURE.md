# docs/ARCHITECTURE.md — SandboxProof system architecture (verified against code)

> Sources of truth: `apps/api/app/main.py`, `services/*.py`, `apps/web/app/*`.
> Nothing below invents endpoints or URLs — every route/host is quoted from code.

## 1. Components

| Component | Location | Job |
|-----------|----------|-----|
| Web UI | `apps/web` (Next.js `14.2.5`, React 18) | `/` sizing widget, `/new` cert form, `/dashboard`, `/timeline`, `/certificate/[id]`, `/docs` |
| API controller | `apps/api/app/main.py` (FastAPI) | Cert CRUD, background loop thread, SSE bus, SQLite via `services/store.py`, ledger `TOTAL`/`TOTAL_CAP` |
| Workload Twin | `services/workload_twin.py:build_twin(seed=42, n, tasks)` | Seeded alternating `tool_calling`/`structured_output` set; SHA-256 digest (first 16 hex) |
| Decision layer | `services/decision_engine.py` | Nemotron Ultra planner `propose_experiment`, Nano classifier `fast_classify`, strict JSON validation + deterministic fallbacks |
| Policy engine | `services/experiment_policy.py:validate_proposal` | Deterministic allow/refuse; AI cannot bypass |
| Runners | `services/sandbox_runner.py` | `ContreeSandboxRunner` (Token Factory Sandboxes, `SANDBOX-MEASURED`) vs `SimulatedSandboxRunner` (dev/test, `SIMULATED` only, process-wide singleton for unique op IDs). Legacy `services/nebius_runner.py` kept for interface compat only. |
| Tavily grounding | `services/tavily_pricing.py` | GPU $/hr (`fetch_gpu_prices`), inference $/1M (`fetch_inference_prices`), release radar (`release_radar`); host-side only, cached `artifacts/market/`, `tavily-live` vs `cache` provenance |
| Replay + metrics | `services/replay.py`, `services/metrics_math.py:summarize` | Per-request TTFT/latency/throughput/VRAM; linear-interpolated percentiles |
| Quality | `services/quality_checks.py:score_response` | JSON validity + schema keys/types + tool + exact args; per-request `1.0`/`0.0`, mean = `quality_score` |
| SLA evaluator | `services/sla_evaluator.py:evaluate_gates` + `decision` | SHIP iff ALL gates pass else BLOCK; missing metric = FAIL |
| Failure classifier | `services/failure_classifier.py:classify` + `services/certification_loop.py` | MEMORY/LATENCY/QUALITY/RELIABILITY/INFRASTRUCTURE/UNKNOWN; next plan must visibly adapt |
| Certificate | `services/certificate_engine.py:build_certificate` | Deterministic SHIP/BLOCK; raises on `simulated=True`; embeds twin digest, gates, spend, deployment prescription |
| Cost ledger | `services/cost_engine.py` + `main.py:TOTAL` | `experiment_cost(gpu,runtime_s)`, per-cert + total caps enforced pre-launch |
| Advisor/sizing | `services/advisor.py` (`kv_cache_gb`, `calibrate_stress`, `STRESS_PRESETS`, `inspect_model_fit`, `fetch_hf_metadata`) | Pre-spend VRAM math mirrored by the `/new` UI sliders |
| HW probe | `services/detector.py:gather_profile` | Native OS hardware probe behind `GET /system/hardware` |

## 2. Data flow (ASCII)

```text
  [web /new] POST /certifications {candidate, current, gates, budget, concurrency, context_len}
      -> twin = build_twin(42, requests, tasks)  [digest sha256[:16]]
      -> CERTS[cid] = CREATED, store.store_cert (secrets stripped, never persisted)
  [web] POST /certifications/{cid}/start  -> status RUNNING, thread HOOKS.run(cid)
      -> loop (services/certification_loop.py):
           1. planner proposes {gpu_type,gpu_count,precision,engine,batch_config,reason}
           2. policy validate_proposal (caps §4) -> refuse = BLOCKED, else estimate cost
           3. ledger check (cert $10, total $20) -> refuse before launch
           4. runner.create(JobSpec) -> job_id (real or sim-job-NNNN)
           5. replay twin on vLLM -> requests[] {ttft_ms, latency_ms, tokens, status}
           6. summarize + score_response -> metrics {latency_p95_ms, quality_score, error_rate, ...}
           7. evaluate_gates -> per-gate PASS/FAIL
           8. fail -> classify -> planner adapts next exp (max 5) | all-pass -> stop
      -> SSE GET /certifications/{cid}/events streams progress; terminal "done"
  [web] GET /certifications/{cid}/certificate
      -> simulated? verdict SIMULATED (dev-only, can never certify)
      -> else build_certificate(gate_results, metrics, spend, plan, twin_digest/count)
      -> {verdict SHIP|BLOCK, failing_gates, evidence, spend_usd, deployment}
  [web /certificate/[id]] renders verdict + evidence + copyable FNV-1a/SHA-256 digests
      + vLLM serve command + economics ($/1k queries from measured spend)
```

State machine (PRD §7.6, enforced in loop): QUEUED → VALIDATING → PROVISIONING →
MODEL_LOADING → WARMUP → BENCHMARKING → EVALUATING → COMPLETED → DESTROYED,
with failure states OOM / MODEL_LOAD_FAILED / TIMEOUT / INFRA_FAILURE /
SLA_FAILED / QUALITY_FAILED / CANCELLED / BUDGET_EXCEEDED. Teardown runs on every path.

## 3. Sizing formulas (verified)

From `services/advisor.py` (mirrored client-side in `/new` sliders and `/` widget):

```text
bytes(param) : FP32 4.0 | FP16/BF16 2.0 | FP8/INT8 1.0 | INT4 0.5
weights_GB   = params_b * bytes(precision)
KV_cache_GB  = 2 * layers * hidden * context_len * concurrency * bytes / 1e9
total_GB     = weights_GB + KV_cache_GB + 2.0 (RUNTIME_OVERHEAD: CUDA ctx + PagedAttention)
usable       = vram_gb * 0.95            (USABLE_VRAM_FRACTION)
OOM  iff total_GB > usable ; TIGHT iff saturation >= 85%
maxSafeStreams = floor((usable - weights - 2.0) / perStreamKV)
```

Worked example (METRICS_SLA §2, Nano 30B ≈ 48L×5120H @FP8, 16 streams × 4096 ctx):
weights 30.00 + KV 32.21 + 2.0 = 64.21 GB → L40S 48 GB OOMs, H100 80 GB fits.
Presets (`STRESS_PRESETS`): Smoke 8×2048 (~$0.50) / SLA Gate 16×4096 (~$2.50, default twin) / Soak 32×8192 (~$8.00).
Percentiles (`metrics_math.percentile`): linear-interpolated p50/p95 over measured samples.

## 4. Gates (verified defaults in `main.py:NewCert`)

| Gate | Metric | Op | Threshold |
|------|--------|----|-----------|
| P95 latency | `latency_p95_ms` | `<=` | `2000` ms |
| Accuracy | `quality_score` | `>=` | `0.85` |
| Error rate | `error_rate` | `<=` | `0.05` |

Any FAIL (or missing metric) ⇒ `BLOCK`. Planner-down ⇒ "Certification incomplete",
never SHIP. Simulator ⇒ `SIMULATED`, never a real certificate.

## 5. Caps (verified)

```text
services/experiment_policy.py:
  MAX_GPU_COUNT=1, MAX_PARALLEL_EXPERIMENTS=2, MAX_EXPERIMENT_RUNTIME_S=900 (15 min),
  MAX_EXPERIMENT_COST=$2.00, MAX_CERTIFICATION_COST=$10.00,
  MAX_EXPERIMENTS=5, GPU_TYPES=(L40S,H100), ENGINES=(vLLM,),
  precision ∈ {FP8,INT4,FP16,BF16}, batch_config 1..64
apps/api/app/main.py: TOTAL_CAP=float(MAX_BUDGET_USD default 20.00)  # $20 total hard cap
```

`validate_proposal` refuses non-vLLM engines, `gpu_count != 1`, unknown tiers,
over-budget estimates, and experiment-index ≥ 5 — before any spend.

## 6. Endpoints (verified in `main.py` — exhaustive)

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

External hosts contacted (verified literals):
`https://api.tokenfactory.nebius.com/v1` (`POST /chat/completions`),
`https://api.nebius.cloud/ai/v1` (`POST /jobs`, `GET /jobs/{id}/logs…`,
`POST /jobs/cancel`, `DELETE /jobs/{id}`),
`https://huggingface.co/{repo}/raw/main/config.json`,
`https://huggingface.co/api/models/{repo}`.

## 7. Provenance model

- **MEASURED**: per-request `ttft_ms`/`latency_ms`/tokens/status from the job replay;
  `quality_score` from deterministic checks; `error_rate=(total-ok)/total`.
- **COMPUTED**: p50/p95 (`metrics_math`), KV-cache/VRAM fits (`advisor`),
  gate verdicts (`sla_evaluator`), serving command + limits + `$`/1k economics
  (`certificate_engine.build_deployment_prescription` from measured spend/count).
- **STATIC-PRICED**: `cost_engine.GPU_HOURLY_USD = {L40S 1.35, H100 3.20}` (+CPU/RAM);
  certificate `$`/1k = measured spend ÷ replayed count (never fabricated).
- **NOT present**: live price feeds, NIM fallback, Tavily, Run:ai — none found in
  `services/` or `apps/` (see orchestrator unverified-list note).
- **Digests**: twin SHA-256 `hexdigest()[:16]` (`workload_twin.py:32`); certificate
  carries `twin_digest`/`twin_count` + FNV-1a evidence hash re-computable offline
  (`METRICS_SLA.md` §4, `/certificate/[id]` client `Math.imul` implementation).
