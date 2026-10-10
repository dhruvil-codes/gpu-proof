# GPUProof PRD (Hackathon Edition)

> **For the implementing agent:** This is the source of truth for the build. Follow the scope in Section 6, respect the hard limits in Section 7, and never expand into the "Out" list. When a requirement is ambiguous, choose the simplest option that still satisfies the demo story in Section 10.

## 1. One-liner

GPUProof is CI/CD for AI inference. Give it your current deployment, a candidate model, and your production requirements. It runs real experiments on Nebius GPUs, learns from failures, and issues a **SHIP / BLOCK** certificate backed by measured evidence.

**Core principle:** AI proposes. Policy approves. Nebius executes. Metrics decide.

## 2. Problem

Teams swap models or serving configs (new release, cheaper model, quantization) without knowing whether their workload will break. Public benchmarks do not catch broken tool calls, invalid JSON, latency regressions, OOMs, or cost surprises. An LLM can recommend a config, but it cannot prove one works.

## 3. Target User

AI engineers, ML infra engineers, and startup CTOs running open-source models who want to test a migration before it hits production.

## 4. Hackathon Context

- **Event:** Nebius x NVIDIA Global AI Hackathon
- **Deadline:** Oct 30, 2026, 10:00am PDT
- **Track:** Best Apps and Agents
- **Mandatory:** must run on Nebius (Token Factory and/or AI Cloud) and use at least one NVIDIA open-source model
- **Judging criteria:** Technological Implementation, Design (complete product, not a PoC), Potential Impact, Quality of Idea

| Requirement                         | How GPUProof meets it                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Nemotron on Token Factory           | Planner (deep reasoning) and fast classifier                                     |
| Nebius Serverless Jobs (encouraged) | Each experiment is an isolated GPU job                                           |
| NVIDIA open model                   | Nemotron as the decision layer, plus an NVIDIA model as the candidate under test |
| Complete product                    | Dashboard, New Certification, Experiment Timeline, Certificate                   |

**Model assignment:**

- **Deep planner / diagnosis:** Nemotron Ultra (via Token Factory)
- **Fast bounded classifier ("Jev" layer):** Nemotron Nano or Super (via Token Factory). This keeps the whole decision layer NVIDIA-native.

## 5. Core Flow

```text
Inputs: current deployment + candidate model + workload + SLA gates + budget
   ↓
Workload Twin (fixed, deterministic test set)
   ↓
Planner (Nemotron Ultra) proposes an experiment
   ↓
Policy Engine validates (deterministic, AI cannot bypass)
   ↓
Nebius Serverless Job: vLLM + candidate model on GPU
   ↓
Replay workload, collect metrics
   ↓
Evaluator: check every gate against measured metrics
   ↓
Fail -> Fast classifier labels failure -> Planner adapts next experiment (max 5)
Pass -> Certificate: SHIP / BLOCK
```

## 6. MVP Scope

### In

- New Certification form: current deployment, candidate model ID, workload, SLA gates, budget
- Synthetic workload twin, 1 to 2 task types (**tool calling** and **structured output** recommended, both deterministically checkable)
- Nemotron planner and fast failure classifier
- Deterministic policy engine
- Nebius Serverless Job runner (vLLM; L40S and H100)
- Workload replay with latency, throughput, VRAM, and error metrics
- Deterministic quality checks (JSON validity, schema, correct tool and arguments)
- Cost per experiment, cost per 1M tokens, projected monthly cost
- Adaptive retry where a failed experiment visibly changes the next experiment
- SHIP / BLOCK certificate

### Out (do not build)

- AWS, GCP, Azure, Colab, Kaggle, Lightning AI, any other cloud
- Kubernetes management
- Training workloads
- Production traffic routing or auto-deploy
- Production trace upload
- Multi-engine support (vLLM only)
- LLM-as-judge as the only quality metric
- Full FinOps

## 7. Functional Requirements

### 7.1 Inputs

**Current deployment (manual entry):** model, GPU type, GPU count, precision, engine.

**Candidate:** Hugging Face model ID. Retrieve or accept metadata: architecture, parameter count, precision support, memory requirement, context window, model family.

**Workload:**

- Type: Chat, RAG, Coding, Tool calling, or Structured output
- Average and p95 input tokens
- Average and p95 output tokens
- Average and peak RPS
- Concurrency
- Number of benchmark requests (about 100 to 300)

**SLA gates (all hard gates, never silently changed):**

- P95 TTFT
- P95 total latency
- Minimum throughput
- Minimum task quality %
- JSON validity %
- Tool-call success %
- Maximum error rate
- Maximum cost per 1M tokens

### 7.2 Workload Twin

A deterministic workload representation containing: input and output token distributions, arrival pattern, concurrency profile, task distribution, structured-output and tool-call requirements, and an evaluation dataset. **The exact same twin is used for every experiment** so comparisons are fair.

### 7.3 Experiment Planner (Nemotron Ultra)

Receives: model info, workload twin, available hardware, SLA, budget, previous experiments, metrics, failure reasons. Returns a structured proposal:

```json
{
  "gpu_type": "L40S",
  "gpu_count": 1,
  "precision": "FP8",
  "engine": "vLLM",
  "batch_config": 8,
  "reason": "lowest-cost configuration likely to fit workload"
}
```

The planner **cannot execute infrastructure directly**.

### 7.4 Fast Classifier (Nemotron Nano / Super)

Used only for bounded decisions:

- **Failure type:** `MEMORY | LATENCY | QUALITY | RELIABILITY | INFRASTRUCTURE | UNKNOWN`
- **Next action:** `CONTINUE | STOP_SUCCESS | STOP_BUDGET | ESCALATE`
- **Escalate?** Can deterministic logic handle this? YES / NO

Obvious cases (for example OOM) are classified by deterministic rules. Ambiguous cases escalate to the Ultra planner.

### 7.5 Policy Engine (deterministic)

Every proposed experiment must pass validation. Hard limits:

```text
MAX_GPU_COUNT             = 1
MAX_PARALLEL_EXPERIMENTS  = 2
MAX_EXPERIMENT_RUNTIME    = 15 minutes
MAX_EXPERIMENT_COST       = $2
MAX_CERTIFICATION_COST    = $15
MAX_EXPERIMENTS           = 5
GPU_TYPES                 = [L40S, H100]
SERVING_ENGINES           = [vLLM]
```

Before each launch, compute and validate: estimated cost, remaining budget, max experiment cost.

### 7.6 Experiment Controller

For each approved experiment: generate ID, estimate cost, create Nebius Serverless Job, track lifecycle, capture logs, handle timeout, trigger benchmark, collect artifacts, destroy environment, persist results.

**State machine:**

```text
QUEUED -> VALIDATING -> PROVISIONING -> MODEL_LOADING -> WARMUP
-> BENCHMARKING -> EVALUATING -> COMPLETED -> DESTROYED
```

**Failure states:** `OOM, MODEL_LOAD_FAILED, TIMEOUT, INFRA_FAILURE, SLA_FAILED, QUALITY_FAILED, CANCELLED, BUDGET_EXCEEDED`

### 7.7 Sandbox

Each experiment runs in a fresh container with: approved base image, CUDA runtime, vLLM, the model, benchmark runner, and metrics agent.

Security: fresh environment, temporary identity, no production DB or write access, no unrestricted Nebius credentials, minimal network (allow model registry, GPUProof controller, metrics service, required Nebius services; deny everything else), isolated storage, automatic teardown, **secrets never written to logs**.

### 7.8 Benchmark Runner and Metrics

Per request record: request ID, start timestamp, first-token timestamp, completion timestamp, input and output token counts, status, response.

Compute: TTFT p50/p95, latency p50/p95, requests/sec, tokens/sec, success rate, error rate. GPU metrics where available: utilization, peak and average VRAM, OOM events.

### 7.9 Quality Evaluation

- **Primary (deterministic):** valid JSON, required fields present, correct schema, correct tool selected, valid tool arguments, expected output type.
- **Secondary (optional):** Nemotron judges correctness, relevance, instruction following. Never the only quality metric.

### 7.10 Economics

Record GPU type, count, runtime, and Nebius price per experiment. Compute experiment cost, cost per request, cost per 1M tokens, projected monthly cost. Projections must be based on **measured** workload behavior.

### 7.11 Certification

Evaluate every gate against measured metrics. **Any failing hard gate means BLOCK.** The certificate is produced by deterministic evaluation only, never by AI opinion.

### 7.12 Adaptive Loop and Stop Conditions

After each experiment: classify outcome. If simple, use policy for the next step. Otherwise the Ultra planner diagnoses and proposes the next experiment, which then goes through the policy engine.

**Requirement:** at least one failed experiment must visibly alter the next experiment.

**Stop when:** success (all gates met, no reasonable cheaper config left), budget exhausted, experiment limit reached, no feasible config, or user cancels.

### 7.13 Failure Handling

- Fast classifier down: use deterministic classification if obvious, else escalate to Nemotron Ultra.
- Nemotron Ultra down: **stop autonomous iteration**, return "Certification incomplete. Reason: Planning service unavailable." **Never fabricate a SHIP decision.**
- Must fail safely on: no Nebius capacity, job timeout, model download failure, vLLM startup failure, OOM, invalid experiment proposal, budget exceeded, incomplete metrics.

## 8. UI (4 Screens)

1. **Dashboard:** list of certifications with status (SHIP / BLOCK / RUNNING).
2. **New Certification:** one form with sections Current, Candidate, Workload, Requirements, Budget. Primary CTA: **Run Certification**.
3. **Experiment Timeline:** per-experiment card showing GPU, precision, status, Nebius job ID, and a concise reasoning line (classifier label plus the planner's next move).
4. **Certificate:** large **SHIP** or **BLOCK**, then evidence: Current vs Candidate table (quality, P95 latency, cost per 1M, tool success, error rate), failing gate if BLOCK, budget spent.

Design goal: feels like one coherent product (Configure, Certify, Watch, Decide), not an infra dashboard.

## 9. Architecture

```text
Next.js frontend
   ↓
FastAPI API
   ↓
Certification Service -> Workload Twin Service
   ↓
Decision Layer (Nemotron Ultra planner + Nemotron Nano/Super classifier)
   ↓
Experiment Policy Engine
   ↓
Experiment Controller
   ↓
Nebius Serverless AI Jobs -> temporary GPU sandbox -> vLLM
   ↓
Workload Replay -> Metrics + Evaluations
   ↓
Certification Engine -> Postgres / artifact store -> SHIP / BLOCK
```

### Suggested repo structure

```text
apps/web            # Next.js
apps/api            # FastAPI
services/           # workload_twin, decision_engine, experiment_policy,
                    # experiment_controller, nebius_runner, benchmark_runner,
                    # evaluator, cost_engine, certificate_engine
packages/           # schemas, clients, policies, common
infra/              # containers, nebius, scripts
tests/              # unit, integration, fixtures
```

### Data entities

- **Certification:** id, status, current_model, candidate_model, created_at, finished_at, final_decision
- **Workload:** id, certification_id, task_type, input_distribution, output_distribution, concurrency, request_count
- **Requirement:** metric, operator, threshold
- **Experiment:** id, certification_id, gpu_type, gpu_count, precision, engine, status, reason, started_at, finished_at, estimated_cost, actual_cost, failure_type
- **ExperimentMetrics:** ttft_p50, ttft_p95, latency_p50, latency_p95, throughput, tokens_per_second, gpu_utilization, peak_vram, quality_score, json_success, tool_success, error_rate, cost_per_1m_tokens

### API

```text
POST /certifications
GET  /certifications/:id
POST /certifications/:id/start
GET  /certifications/:id/experiments
GET  /experiments/:id
POST /experiments/:id/cancel
GET  /certifications/:id/certificate

Internal:
POST /internal/experiment-plan
POST /internal/experiment-result
POST /internal/evaluate
POST /internal/certify
```

## 10. Demo Story (3-minute video)

1. **Setup:** current Model A on H100 FP8, candidate is an NVIDIA model B.
2. **Experiment 1:** L40S FP8 fails with **OOM**. Classifier labels `MEMORY`. Planner moves to a larger config.
3. **Experiment 2:** H100 INT4. Performance passes, **quality fails**. Planner reasons that quantization caused the regression and tries FP8 with tuned serving params.
4. **Experiment 3:** H100 FP8. All gates pass.
5. **Certificate:** **SHIP**, with measured savings.

The demo must visibly show: real Nebius job IDs or job state, one real failure, that failure changing the next experiment, real measured latency/throughput/quality/cost, budget validation, and the final decision. All numbers must come from real runs. If a natural failure does not occur, choose a candidate and config pair known to OOM on L40S rather than faking results.

## 11. Budget (about $50 Nebius credits)

| Use                  | Amount |
| -------------------- | ------ |
| Development testing  | $25    |
| Final benchmark runs | $10    |
| Demo and video       | $5     |
| Reserve              | $10    |

Track remaining certification budget in the app. Also watch Token Factory usage from planner and classifier calls.

## 12. Testing

- **Unit:** SLA evaluation, budget math, experiment policy, certificate decision, failure classification mapping, metric calculations.
- **Integration:** Nemotron response to experiment proposal, proposal to policy validator, validator to Nebius job request, benchmark result to evaluator, evaluator to certificate.
- **Failure tests:** Nebius no capacity, job timeout, model download failure, vLLM startup failure, OOM, invalid proposal, budget exceeded, Nemotron unavailable, classifier unavailable, incomplete metrics.

## 13. Acceptance Criteria

The MVP is complete when:

- [ ] User can create a certification and select a candidate model
- [ ] Workload twin is generated and requirements are configurable
- [ ] Nemotron proposes an experiment and the policy engine validates it
- [ ] Nebius GPU job launches and vLLM serves the candidate
- [ ] Benchmark runs and metrics are persisted
- [ ] Deterministic quality evaluation runs
- [ ] Cost is calculated
- [ ] At least one failed run triggers an adaptive next experiment
- [ ] Sandbox is destroyed after each experiment
- [ ] Certification terminates safely
- [ ] A real SHIP or BLOCK certificate is produced

## 14. Submission Checklist

- [ ] Working project on Nebius using Nemotron / NVIDIA open models
- [ ] Hosted demo URL
- [ ] Public YouTube demo video, 3 minutes or less
- [ ] Public repo with an open-source license (MIT, Apache 2.0, or MPL 2.0) visible at the top
- [ ] README with setup and run instructions, highlighting how Nemotron, Token Factory, and other Nebius services are used
- [ ] Written feedback on Nebius Token Factory, AI Cloud, and NVIDIA tools used
- [ ] Project description (what, why, how)
- [ ] Track selected: Best Apps and Agents
      |

**Cut order if time runs short:** (1) drop the second task type, (2) drop parallel experiments, (3) simplify the dashboard to a plain list. **Never cut** the adaptive retry or the real-run evidence.

## 16. Success Criterion

A fully autonomous, budget-safe certification loop runs on real Nebius infrastructure, a failed experiment changes the agent's next experiment, and the result is a trustworthy SHIP / BLOCK decision based on measured evidence.

**Pitch:** _GPUProof is CI/CD for AI inference. Don't ask whether a new AI deployment should work. Make it prove that it works._
