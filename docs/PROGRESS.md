# PROGRESS.md — GPUProof build checklist (from PRD §13 + submission §14)

Status: all build milestones complete on `build` branch. 15/15 tests green, web build green,
live simulator verification done ($0.00 spend). Remaining: real GPU run (needs SUBNET_ID),
video + Devpost (manual).

## Acceptance (§13)
- [x] Create certification + candidate select (API + /new)
- [x] Workload twin generated + requirements configurable (seeded digest)
- [x] Nemotron proposes experiment + policy validates (Ultra real / simulated stand-in; strict caps)
- [x] Nebius GPU job launches + vLLM serves candidate (runner interface; real adapter needs SUBNET_ID)
- [x] Benchmark runs + metrics persisted (SQLite + replay harness)
- [x] Deterministic quality evaluation (JSON/schema/tool)
- [x] Cost calculated (ledger, $20/$10 caps)
- [x] Failed run triggers adaptive next experiment (verified live: L40S OOM -> H100)
- [x] Sandbox destroyed after each experiment (delete/cancel in all paths)
- [x] Certification terminates safely (INCOMPLETE on planner-down; policy/budget blocks; cancel endpoint)
- [ ] Real SHIP/BLOCK certificate — needs SUBNET_ID + spend approval; simulator returns SIMULATED only

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

Next: real run once SUBNET_ID is provided; then video + Devpost.
