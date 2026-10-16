# PROGRESS.md — SandboxProof build checklist (from PRD §13 + submission §14)

Status (Oct 16): pivoted GPUProof → SandboxProof (Track 1: Coding and Agentic
Engineering). 38/38 tests green, web build green (20/20), live simulator
verification done ($0.00 spend, 3-exp L40S-OOM → H100-INT4 → H100-FP8 SHIP with
unique sandbox op IDs). Remaining: live sandbox run (USE_SIMULATOR=false +
spend approval), video + Devpost (manual).

## Acceptance (§13)
- [x] Create certification + candidate select (API + /new)
- [x] Workload twin generated + requirements configurable (seeded digest)
- [x] Nemotron proposes experiment + policy validates (Ultra real / simulated stand-in; strict caps)
- [x] Sandbox op launches + harness executes in isolation (Contree runner; simulated
  adapter for dev, real adapter verified via QR run Oct 16)
- [x] Benchmark runs + metrics persisted (SQLite + replay harness)
- [x] Deterministic quality evaluation (JSON/schema/tool)
- [x] Cost calculated (ledger, $20/$10 caps)
- [x] Failed run triggers adaptive next experiment (verified live: L40S OOM -> H100)
- [x] Sandbox destroyed after each experiment (disposable ops; cancel/delete in all paths)
- [x] Certification terminates safely (INCOMPLETE on planner-down; policy/budget blocks; cancel endpoint)
- [ ] Real SANDBOX-MEASURED SHIP/BLOCK certificate — needs USE_SIMULATOR=false + spend
  approval; simulator returns SIMULATED only

## Build order
- [x] Phase 0: PRD/env/skills/docs verification
- [x] Setup: monorepo, Postgres schema, Compose, lint/CI (CI now covers pytest + web build)
- [x] Core backend + unit tests first
- [x] Decision layer (Nemotron planner + classifier)
- [x] Runner + sandbox + state machine
- [x] Benchmark + evaluator
- [x] Adaptive loop with persisted reasoning
- [x] Frontend 4 screens in screenshot style
- [x] Integration + failure tests
- [x] Simulator runs -> docs/runs/ (sim-001.json; $0.00)
- [x] Submission readiness (README, LICENSE, DEMO_SCRIPT, DEVPOST, DEPLOY, FEEDBACK)
- [x] Final pass: architecture review (certification_loop deep module), tests, web build

## Spend ledger
See `docs/runs/LEDGER.md`. Total: $0.00 / $20.00 hard cap.

Next: live sandbox run (USE_SIMULATOR=false + spend approval); then video + Devpost.
