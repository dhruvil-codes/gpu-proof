# DISCLOSURE.md — pre-existing work + track choice

## Pre-existing-work statement

> SandboxProof was built during the submission period (Oct 10–29, 2026) for the Nebius x
> NVIDIA Global AI Hackathon (deadline Oct 30, 2026, 10:00am PDT).
>
> **Pre-existing as of the start date:**
> Minimal initial repo scaffold (Next.js + FastAPI skeleton, MIT LICENSE, .env.example template).
>
> **Built during the submission period:**
> All core engineering:
> 1. In-sandbox replay harness (`services/sandbox_harness.py`) and Nebius Contree Sandbox execution (`services/sandbox_runner.py`) with microVM operation UUID lineage and measured per-op cost tracking.
> 2. Sealed workload twin synthesis with deterministic SHA-256 fingerprinting (`services/workload_twin.py`).
> 3. Autonomous NVIDIA Nemotron Ultra planner (`nvidia/Nemotron-3-Ultra-550b-a55b`) and Nano classifier (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`) decision layer over Token Factory.
> 4. Deterministic policy boundary enforcing hard caps ($20 total, $10 per cert, $2 per experiment, max 32 streams, max 5 experiments; `services/experiment_policy.py`).
> 5. Turnkey SHIP/BLOCK Certificate engine with capacity envelope prescription (safe concurrency, context limits, output budget; `services/certificate_engine.py`).
> 6. Tavily live market pricing and release radar (`services/tavily_pricing.py`).
> 7. Full frontend application: Landing page, /new wizard, live diagnostic timeline with streaming SSE telemetry, verifiable certificate with QR code, and Model Passport generator.
> 8. Comprehensive test suite (89 passing tests across unit, integration, and security checks).
>
> **Third-party / generated assistance:**
> AI coding assistants were used for test scaffolding, refactoring assistance, and documentation. All benchmark numbers, operation IDs, and cost receipts originate from real measured Nebius Contree microVM executions or are explicitly marked `SIMULATED`.
>
> **Security & Secret Handling:**
> No secrets are committed to version control. The Nebius Token Factory inference key is injected per-operation into disposable microVMs with `preserve_env=False` and redacted from all logs. BYOK credentials live in memory only for the duration of a run and are stripped before database persistence (`apps/api/app/main.py:_sanitize_byok`, `store.store_cert`).

Checklist before paste-to-Devpost:
- [x] Dates + pre-existing list filled (PRD frozen: `docs/PRD.md`)
- [x] Track named: **Coding and Agentic Engineering**
- [x] Real-run evidence linked (`docs/runs/real-001.json`, `docs/runs/LEDGER.md`, operation IDs `01a1885f-2d09-73d2-9983-925aba588977`, `01a1885f-6159-7708-86a6-9a0ca82cb13c`)
- [x] Feedback referenced (`FEEDBACK_TF_NVIDIA.md` + `docs/FEEDBACK.md`)

## Track choice rationale — Coding and Agentic Engineering

SandboxProof is an autonomous agentic engineering system, not a passive chat wrapper:
- A Nemotron-Ultra planner analyzes workload characteristics and SLA gates to propose serving profiles.
- A deterministic policy engine acts as the hard safety boundary (15 min sandbox timeout, $2/experiment cap, $10/cert cap, 5 experiment limit).
- Nebius Contree Sandboxes execute the replay harness inside isolated, disposable CPU microVMs, capturing exact operation IDs, exit codes, and billed costs.
- Deterministic quality checks and metrics math evaluate outputs against strict SLA gates.
- A Nemotron classifier diagnoses failures and adapts subsequent serving parameters:
  - *QUALITY failure* (lean output budget truncates structured JSON) → planner autonomously raises `max_tokens` (e.g. 64 → 512) → rerun passes.
  - *LATENCY failure* (high concurrency saturates endpoint) → planner throttles concurrency.
- The outcome is a cryptographically verifiable SHIP / BLOCK certificate with a turnkey production capacity envelope.

## Bonus targeting

- **Tavily:** `services/tavily_pricing.py` integrates live GPU $/hr (`fetch_gpu_prices`), inference $/1M (`fetch_inference_prices`), and new model release radar (`release_radar`). Execution is strictly host-side (key never enters sandboxes) and cached in `artifacts/market/` with explicit `tavily-live` vs `cache` provenance. Bonus claimed with cited live numbers in certificate economics.
- **NVIDIA / Nebius mandatory bar:** Runs on Nebius Token Factory (hosted inference endpoints + Contree Sandboxes), NVIDIA open models throughout the decision layer and benchmark subject (`nvidia/Nemotron-3-Ultra-550b-a55b` planner, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` classifier and certified subject).
