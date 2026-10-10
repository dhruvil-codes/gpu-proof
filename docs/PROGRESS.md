# PROGRESS.md — GPUProof build checklist (from PRD §13 + submission §14)

Status: Phase 0 done. Building on `build` branch.

## Acceptance (§13)
- [ ] Create certification + candidate select
- [ ] Workload twin generated + requirements configurable
- [ ] Nemotron proposes experiment + policy validates
- [ ] Nebius GPU job launches + vLLM serves candidate
- [ ] Benchmark runs + metrics persisted
- [ ] Deterministic quality evaluation
- [ ] Cost calculated
- [ ] Failed run triggers adaptive next experiment
- [ ] Sandbox destroyed after each experiment
- [ ] Certification terminates safely
- [ ] Real SHIP/BLOCK certificate produced

## Build order
- [x] Phase 0: PRD/env/skills/docs verification
- [ ] Setup: monorepo, Postgres, Compose, lint/CI
- [ ] Core backend + unit tests first
- [ ] Decision layer (Nemotron planner + classifier)
- [ ] Runner + sandbox + state machine
- [ ] Benchmark + evaluator
- [ ] Adaptive loop with persisted reasoning
- [ ] Frontend 4 screens in screenshot style
- [ ] Integration + failure tests
- [ ] Real runs → docs/runs/
- [ ] Submission readiness
- [ ] Final pass (architecture, tests, lint, build, fresh-clone)

## Spend ledger
See `docs/runs/LEDGER.md`. Total: $0.00 / $20.00 hard cap.

Next: scaffold monorepo.
