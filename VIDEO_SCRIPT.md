# VIDEO_SCRIPT.md — GPUProof 180-second demo (shoot script)

> Uses ONLY the verified repo path: Nano-30B candidate, L40S OOM → H100 FP8 SHIP
> (`docs/DEMO_SCRIPT.md`, PRD §10, `services/nebius_runner.py:SimulatedRunner`).
> NOTE for orchestrator: a "70B BLOCKs live" subject is NOT the backend default
> (default `CANDIDATE_MODEL=Nemotron-3-Nano-30B`); the widget lists a 70B preset for
> sizing only. Film the verified Nano path below; swap the slug only after a real 70B run.

## Shot list

| # | Shot | Source |
|---|------|--------|
| 1 | Landing + sizing widget | `apps/web/app/page.tsx` (`/` — `/new?...` audit link) |
| 2 | New Certification form | `apps/web/app/new/page.tsx` (candidate, gates, $10 budget, stress sliders) |
| 3 | Timeline exp 1 (OOM) | `GET /certifications/{cid}/experiments` + SSE `/events` |
| 4 | Timeline exp 2→3 (adapt → pass) | same stream; planner reason lines |
| 5 | Certificate SHIP + receipt | `GET /certifications/{cid}/certificate`, `/certificate/[id]` |

## Script (spoken lines + on-screen cues)

### 0:00–0:15 — Problem + identity

**ON SCREEN:** landing hero + widget. Text overlay: *"Public benchmarks don't catch OOMs."*

**SAY:** "Teams swap models and pray. Leaderboards run batch-one and miss the thing
that kills you in production — memory, tail latency, broken tool calls.
GPUProof crash-tests open-weight models — SHIP or BLOCK with receipts."

### 0:15–1:45 — ONE live golden path (BLOCK evidence → flips to SHIP)

**0:15 ON SCREEN:** `/new` form. Current: Qwen3-8B, H100 FP8. Candidate:
Nemotron-3-Nano-30B. Twin digest visible. Gates: P95 ≤ 2000ms, accuracy ≥ 85%,
errors ≤ 5%. Budget $10. Click **Run Certification**.

**SAY:** "Current deployment, candidate, workload, gates, budget. One click.
The same seeded workload twin replays on every experiment, so comparisons are fair."

**0:45 ON SCREEN:** Timeline experiment 1 — L40S FP8, real/sim job ID, log line
`CUDA out of memory`, classifier label MEMORY, planner reason: escalate to H100.

**SAY:** "Experiment one: cheapest config first, L40S. It OOMs — weights fit, the
KV-cache at batch sixteen doesn't. The classifier labels it MEMORY, and the planner
visibly adapts: escalate to H100."

**1:15 ON SCREEN:** Experiment 2/3 — H100, quality gate red (INT4 ≈ 0.62 < 0.85),
then H100 FP8 all gates green: P95, throughput, quality, error rate.

**SAY:** "A cheap quantization pass fails the accuracy gate — that failure changes the
next plan. Final run, H100 FP8: every hard gate measured green. Any failing gate
would mean BLOCK — metrics decide, not the model that proposed the run."

### 1:45–2:40 — Certificate + cent-level receipt + integrations aloud

**ON SCREEN:** `/certificate/[id]` — big SHIP, failing-gates empty, evidence table
(Current vs Candidate), twin digest, spend ledger, `vllm serve …` command, $/1k math.

**SAY:** "SHIP — with receipts. Twin digest, per-gate observed versus threshold,
spend to the cent, and a ready-to-run vLLM serve line.
Carrying this: Nebius Token Factory serving Nemotron Ultra as planner and Nemotron
Nano as failure classifier; Nebius AI Cloud Serverless Jobs running each isolated
vLLM experiment; Hugging Face for model identity and architecture truth."

### 2:40–3:00 — Roadmap + close

**ON SCREEN:** `/dashboard` portfolio + `/docs`. Text overlay: *"Don't ask. Prove it."*

**SAY:** "Next: more GPU tiers, longer soak presets, policy-checked multi-step migrations.
GPUProof is CI/CD for inference — don't ask whether a deployment should work.
Make it prove it."

## Filming notes

- Set `USE_SIMULATOR=true` for rehearsal (verdicts read SIMULATED, dev-only);
  film the money take with `USE_SIMULATOR=false` + BYOK headers so the certificate
  reads SHIP/BLOCK with a real job ID.
- Keep the SSE `/events` stream visible during 0:45–1:45 — the adapting planner
  reason lines are the demo.
- Never edit numbers in post; certificate economics derive from measured spend.
