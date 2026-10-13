# GPUProof Metrics & SLA Specification — Breakscale Load-to-Failure

> **Audience:** hackathon judges, DevOps / ML-infra engineers certifying a migration.
> **Principle:** *AI proposes. Policy approves. Nebius executes. Metrics decide.*
> **Sources of truth in code:** `services/sla_evaluator.py`, `services/metrics_math.py`,
> `services/advisor.py` (`kv_cache_gb`, `calibrate_stress`), `services/quality_checks.py`,
> `services/certificate_engine.py`, `services/workload_twin.py`, `apps/api/app/main.py`.

---

## 1. The 3 Hard SLA Gates

Every certification evaluates **the same measured run** against **three immutable gates**.
Any single `FAIL` — or any missing metric — yields `BLOCK`. There is no LLM vote,
no temperature, no retries-to-pass. Implemented in `services/sla_evaluator.py`
(`evaluate_gates` + `decision`).

Default gates as configured in `POST /certifications` (`apps/api/app/main.py:NewCert`):

| # | Gate | Metric key | Operator | Threshold | Measured how |
|---|------|------------|----------|-----------|--------------|
| 1 | **P95 Latency** | `latency_p95_ms` | `<=` | **2,000 ms** | End-to-end per-request latency, p95 over the replayed Workload Twin on vLLM (batch 16, production token curve). Computed by `services/metrics_math.py:summarize` via linear-interpolated percentile. |
| 2 | **AST / JSON Schema Accuracy** | `quality_score` | `>=` | **0.85 (85%)** | Deterministic AST-level checks in `services/quality_checks.py:score_response` — JSON validity + required schema keys/types + correct tool + exact argument match. `1.0` per request iff all applicable checks pass, else `0.0`; mean over the twin. INT4 quantization is the #1 regression source (simulated INT4 scores `0.62`). |
| 3 | **Error Rate** | `error_rate` | `<=` | **0.05 (5%)** | `(total - ok) / total` over the twin. Any OOM, timeout, schema failure, or truncated response counts. No sampling tricks. |

```python
# services/sla_evaluator.py — abridged
GATES = [
    Gate("latency_p95_ms", "<=", 2000),
    Gate("quality_score",  ">=", 0.85),
    Gate("error_rate",     "<=", 0.05),
]
results = evaluate_gates(GATES, metrics)  # missing metric -> FAIL ("metric missing -> BLOCK")
verdict = decision(results)               # "SHIP" iff ALL passed else "BLOCK"
```

### Gate semantics

- **P95 Latency ≤ 2,000 ms** — measured end-to-end on the candidate served by vLLM
  with PagedAttention + continuous batching, at the Breakscale operating point
  (default 16 streams × 4,096 context). Covers queueing, prefill, decode, and
  tool-call serialization. A tail spike at concurrency is a `LATENCY_BREACH`.
- **Accuracy ≥ 85%** — strict key/type validation. A single hallucinated key,
  wrong enum, or dropped required arg fails that request — exactly like a
  downstream parser would. Tool-call turns additionally require
  `tool == expect_tool` and every expected arg to match exactly
  (`check_tool`). Structured-output turns require the full schema
  (`check_schema`).
- **Error Rate ≤ 5%** — every non-`ok` replay counts: CUDA OOM, vLLM timeout,
  invalid JSON, schema violation, tool misfire, truncation. OOM runs report
  `error_rate = 1.0` (`synth_simulated_metrics` / real replay).

### Budget guardrails (immutable, same policy engine)

```python
AUDIT_CAP_USD   = 10.00   # per certification
SERVER_CAP_USD  = 20.00   # global guardrail (TOTAL_CAP)
MAX_PER_EXP_USD =  2.00   # per experiment
MAX_RUNTIME_MIN = 15      # per job
MAX_GPUS        =  1      # no multi-node surprises
MAX_EXPERIMENTS =  5
```

`services/experiment_policy.py:validate_proposal` refuses any plan breaching
caps, non-vLLM engines, `gpu_count != 1`, or `batch_config` outside `1..64`.

---

## 2. Breakscale Load-to-Failure — Philosophy & Math

### Philosophy: load it until it breaks, and watch why

Public synthetic leaderboards (MMLU, GSM8K) measure textbook knowledge at
batch 1. Production breaks on **bursty concurrency × long context**:
KV-cache growth, CUDA fragmentation, and PagedAttention block-table overhead.
Breakscale inverts the question — instead of "what score does this model get?",
it asks **"at what concurrency × context does this GPU OOM, and what does the
P95 tail look like just before it?"**

The `/new` form exposes this as **Workload stress calibration**: two snapping
sliders (concurrency streams, context tokens), a target-GPU picker, and a
precision picker. Every slider move recomputes the failure projection
**client-side, before any budget is spent**. The backend mirrors the same math
in `services/advisor.py:calibrate_stress` so the API (`GET /models/inspect`,
`POST /advisor`) and UI can never disagree.

### The KV-cache growth formula

```
KV_cache_GB = 2 * layers * hidden_size * context_len * concurrency * precision_bytes / 10^9
Total_GB    = weights_GB + KV_cache_GB + RUNTIME_OVERHEAD_GB (2.0 GB)
```

- `2` = K + V projections per layer (PagedAttention).
- `layers`, `hidden_size` = model architecture (live Hugging Face `config.json`
  or deterministic catalog; e.g. Nemotron Nano 30B ≈ 48 layers × 5,120 hidden).
- `context_len` = tokens held in KV-cache per stream.
- `concurrency` = parallel streams (batch). **This is what OOMs, not weights.**
- `precision_bytes` = `FP32: 4.0, FP16/BF16: 2.0, FP8/INT8: 1.0, INT4: 0.5`
  (`BYTES_PER_PARAM` in `services/advisor.py`).
- Division by `10^9` converts bytes → GB (decimal, matching `nvidia-smi`).
- `weights_GB = params_b * precision_bytes` (e.g. 30B × FP8 1 B ≈ 30 GB).
- `RUNTIME_OVERHEAD_GB = 2.0` covers CUDA context + PagedAttention block tables.

Reference implementation:

```python
# services/advisor.py
def kv_cache_gb(layers, hidden, seq_len, batch, precision):
    """PagedAttention KV cache: 2 (K+V) * layers * hidden * seq * batch * bytes / 1e9."""
    b = BYTES_PER_PARAM.get(precision, 2.0)
    return round(2 * layers * hidden * seq_len * batch / 1e9 * b, 2)
```

Worked example — Nemotron Nano 30B (48L × 5,120H) @ FP8, 16 streams × 4,096 ctx:

```
weights = 30.0 * 1.0                        = 30.00 GB
KV      = 2 * 48 * 5120 * 4096 * 16 * 1 /1e9 = 32.21 GB
total   = 30.00 + 32.21 + 2.0                = 64.21 GB
L40S 48GB usable (48 * 0.95 = 45.60)  -> OOM  (140.7% saturation)
H100 80GB usable (80 * 0.95 = 76.00)  -> FITS (80.3% saturation, 11.79 GB headroom)
```

Weights fit the L40S (~32 GB reported by the Ultra planner); the **KV cache at
batch 16 overflows 48 GB → CUDA OOM**. Escalation to H100 is evidence-driven,
never guessed.

### Pre-flight VRAM headroom checks

Only ~95% of advertised VRAM is safely allocatable (fragmentation + allocator
reserve):

```python
USABLE_VRAM_FRACTION = 0.95
usable    = vram_gb * 0.95
saturation_pct = total_gb / vram_gb * 100
OOM  iff total_gb > usable
TIGHT iff saturation_pct >= 85  (fragmentation risk at peak batch)
FITS  otherwise (headroom_gb = usable - total_gb)
```

`calibrate_stress()` returns weights/KV/total plus a per-GPU saturation map
(`L40S`, `H100`, `A100`, `H200`) and a target-GPU verdict string. The `/new`
telemetry panel renders the same as a VRAM allocation gauge
(weights / KV-cache / 2 GB system), a breaking-point line, and a GPU comparison
table with `role="progressbar"` accessibility.

Projected breaking point — max safe streams before CUDA OOM — solves for `C`:

```
weights + perStreamKV * C + 2.0 <= vram * 0.95
perStreamKV = 2 * layers * hidden * context_len * bytes / 1e9
maxSafeStreams = floor((usable - weights - 2.0) / perStreamKV)
```

The next `CONCURRENCY_STEPS` stop above the ceiling is reported as
"Breaks at ≥ N streams". Allowed stops:

```python
CONCURRENCY_STEPS = [1, 4, 8, 16, 24, 32]
CONTEXT_STEPS     = [1024, 2048, 4096, 8192, 16384, 32768]
```

### Breakscale Concurrency & Context Stress Test Presets

| Preset | Streams × Context | Replay | Budget cap | Purpose |
|--------|-------------------|--------|------------|---------|
| **Smoke Test** | 8 × 2,048 | 50 reqs | ~$0.50 | Cold-start + sanity. Lands exactly on slider stops. |
| **SLA Gate** (recommended) | 16 × 4,096 | 200 reqs | ~$2.50 | Standard production certification — the default twin. |
| **Soak Test** | 32 × 8,192 | 500 reqs | ~$8.00 | Stress to the failure limit. Expected to OOM 48 GB tiers. |

Defined once in `services/advisor.py:STRESS_PRESETS` and mirrored as
one-click `TEMPLATES` in `apps/web/app/new/page.tsx`. Selecting a preset sets
concurrency + context + budget + replay volume atomically.

### Why public synthetic leaderboards fail in production

1. **Batch-1 scores hide concurrency collapse.** Leaderboards run serially;
   production serves 8–32 parallel streams where KV-cache scales linearly.
2. **No tool-call grounding.** MMLU never tests `stripe.create_charge` arg
   fidelity, enum constraints, or idempotency keys — the #1 production breaker.
3. **No schema strictness.** A leaderboard accepts prose; a downstream parser
   rejects one hallucinated JSON key. GPUProof fails that request outright.
4. **No memory accounting.** Theoretical `params × bytes` formulas miss runtime
   reality: KV growth during batched concurrency, CUDA fragmentation, and vLLM
   PagedAttention overhead. Breakscale measures on isolated Nebius containers.
5. **No tail-latency signal.** Mean latency hides the P95 spike that breaches
   the 2,000 ms SLA under load. We gate on P95, not the mean.
6. **No cost coupling.** A cheaper $/hr tier loses when latency forces extra
   replicas. `economics.py` math (`$/1k queries` from measured runtime) decides.

---

## 3. Failure Taxonomy — 5 Classifications

The bounded fast classifier (Nemotron-3-Nano-30B, deterministic fallback in
`services/failure_classifier.py`) labels every failed request into exactly one
fixed class in milliseconds — never free-form prose, so downstream policy stays
deterministic and auditable. The documentation taxonomy below is the
production-facing contract; the backend maps `MEMORY → OOM_FATAL`,
`LATENCY → LATENCY_BREACH`, `QUALITY → SCHEMA_VIOLATION | TOOL_MISFIRE |
TRUNCATION`, `RELIABILITY/INFRASTRUCTURE → OOM_FATAL | LATENCY_BREACH` by rule.

| Code | Meaning | Detection rule | Example |
|------|---------|----------------|---------|
| `SCHEMA_VIOLATION` | Response is valid JSON but violates the required schema (missing key, wrong type, extra key with `additionalProperties: false`) | `json_valid == true` AND `schema_ok == false` (`quality_checks.check_schema`) | `{"answer": 42}` where `answer: string` required |
| `TOOL_MISFIRE` | Wrong function selected or argument mismatch (hallucinated location, missing idempotency key, wrong enum) | `tool_ok == false` OR `args_ok == false` (`quality_checks.check_tool`) | Called `get_weather` with `{"city": "Berlun"}` instead of `{"location": "Berlin,DE", "units": "celsius"}` |
| `TRUNCATION` | `max-tokens` cut the response mid-JSON; parser sees a prefix, not a document | `json_valid == false` AND output ends without closing brace / hits `max_tokens` finish reason | `{"answer": "The capital is Ber` (EOF) |
| `OOM_FATAL` | CUDA out of memory — KV-cache + weights exceeded usable VRAM | Log contains `out of memory` / `cuda oom` / `oom`, or `total_gb > vram * 0.95` pre-flight; simulator reports `error_rate = 1.0` | `KV-cache allocation reached 51.6GB / 48GB … CUDA OOM on L40S` |
| `LATENCY_BREACH` | Request completed but P95 tail exceeded the 2,000 ms gate under concurrency | `latency_p95_ms > 2000` on the measured run; per-request timeout / `deadline exceeded` also counts | P95 2,340 ms at 32 streams × 8K ctx on L40S; H100 collapses the same load to 1,120 ms |

Every label flows into the Ultra planner (`MEMORY → escalate tier`,
`QUALITY → fix precision/schema`, `LATENCY → reduce concurrency or escalate`),
and at least one failed experiment must visibly alter the next plan
(PRD §7.12; covered by `tests/integration/test_loop.py`).

---

## 4. Cryptographic Verification Protocol

Certificates are minted by deterministic code only (`build_certificate` raises
on `simulated=True` — simulator output is watermarked `SIMULATED` and can never
certify). Verification is fully offline.

### 4.1 Workload Twin digest

`services/workload_twin.py:build_twin(seed=42, n, tasks)` generates a
deterministic seeded dataset (alternating `tool_calling` / `structured_output`,
rotating `get_price` / `search_docs` / `create_ticket` tools):

```python
digest = hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest()[:16]
# e.g. twin_digest "9d31bc..." — same seed + same count => same twin, every re-run
```

The digest, seed, request count, tool schemas, and token-length curve
(`p50/p95 in/out`) are embedded in the certificate (`twin_digest`,
`twin_count`, `workload_digest_explanation`).

### 4.2 FNV-1a evidence hash

The twin digest plus the metrics payload are hashed with FNV-1a-32
(e.g. `fnv1a:a7c29e…`). Any tampering with latency, accuracy, or spend
invalidates the digest.

```python
# verify.py — check a certificate digest offline (also rendered in /docs)
def fnv1a(s: str) -> str:
    h = 0x811C9DC5
    for b in s.encode():
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"fnv1a:{h:06x}"

# digest == certificate.digest  ->  evidence untampered, verdict stands
```

The certificate page (`apps/web/app/certificate/[id]/page.tsx:evidenceDigest`)
implements the identical function client-side (via `Math.imul`) and displays
the hash with Copy + Print/PDF actions. Reviewers re-hash the canonical
`JSON.stringify(evidence)` payload and compare strings — no server trust
required.

### 4.3 What is signed

- Workload Twin digest + count + seed (`twin_digest`, `twin_count`)
- Measured metrics (`latency_p95_ms`, `quality_score`, `error_rate`, throughput)
- Gate results (per-gate observed vs threshold, pass/fail)
- Verdict (`SHIP` / `BLOCK`), hardware lineage (`L40S → H100`), precision,
  serving engine, spend ledger, experiment timeline
- Turnkey deployment prescription (see §5)

---

## 5. Turnkey Production Deployment Blueprint

Every real certificate ships a deterministic DevOps blueprint
(`services/certificate_engine.py:build_deployment_prescription`), rendered on
`/certificate/[id]` under *Production Deployment Prescription*:

```bash
vllm serve <candidate-model> --dtype fp8 \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.95 \
  --tensor-parallel-size 1 --port 8000
```

- **Certified hardware** — e.g. `1x Nebius NVIDIA H100 80GB SXM5`
  (`GPU_LABELS`; single-GPU policy `tensor-parallel-size 1`).
- **`--gpu-memory-utilization 0.95`** — matches the `USABLE_VRAM_FRACTION`
  pre-flight math; reserves 5% for fragmentation/allocator. Never raise without
  re-certifying.
- **`--max-model-len 8192`** — `MAX_CONTEXT_TOKENS`; PagedAttention holds up to
  8K tokens before KV-cache offload on the certified tier.
- **PagedAttention limits** — max **24 parallel streams** before P95 breaches
  2,000 ms (`MAX_SAFE_CONCURRENCY`); max **8,192 context tokens** before
  offload. The concurrency note includes measured P95 headroom
  (`2000 - observed`) at the certified batch.
- **Economics** — `$ / 1k queries` from measured audit spend over replayed
  request count (never fabricated), plus monthly run-rate at 1M queries.

---

## 6. File & Endpoint Map

| Concern | Location |
|---------|----------|
| SLA gate evaluation | `services/sla_evaluator.py` |
| Percentile / throughput math | `services/metrics_math.py` |
| KV-cache formula + stress calibration + presets | `services/advisor.py` (`kv_cache_gb`, `calibrate_stress`, `STRESS_PRESETS`) |
| Quality / schema / tool checks | `services/quality_checks.py` |
| Twin generation + digest | `services/workload_twin.py` |
| Certificate + deployment prescription | `services/certificate_engine.py` |
| Default gates (2000 / 0.85 / 0.05) | `apps/api/app/main.py:NewCert` |
| Breakscale sliders + telemetry | `apps/web/app/new/page.tsx` |
| Docs hub (this spec, human edition) | `apps/web/app/docs/page.tsx` |
| Certificate verification UI | `apps/web/app/certificate/[id]/page.tsx` |

*GPUProof Docs · Deterministic · Audit-grade · Nebius x NVIDIA Hackathon*
