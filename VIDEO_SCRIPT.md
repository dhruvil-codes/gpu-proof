# VIDEO_SCRIPT.md — SandboxProof 180-second demo (shoot script)

> Uses the verified repo path: Candidate `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` on Nebius Token Factory,
> isolated CPU microVMs on Nebius Contree Sandboxes, Nemotron Ultra planner adaptation, SHIP certificate.
> Live run evidence recorded in `docs/runs/real-001.json` and `docs/runs/LEDGER.md`.

## Shot list

| # | Shot | Source |
|---|------|--------|
| 1 | Landing + candidate inspection | `apps/web/app/page.tsx` (`/` — crash-test hero, workload twin, live pricing) |
| 2 | New Certification form | `apps/web/app/new/page.tsx` (candidate slug, SLA gates, safety budget limits) |
| 3 | Timeline Exp 0 (Quality crash) | `GET /certifications/{cid}/experiments` + SSE `/events` (lean max_tokens truncation) |
| 4 | Timeline Exp 1 (Adaptation → SHIP) | same stream; Nemotron Ultra diagnosis + adapted max_tokens pass |
| 5 | Certificate SHIP + receipt | `GET /certifications/{cid}/certificate`, `/certificate/[id]` (capacity envelope, operation receipts, Model Passport) |

## Script (spoken lines + on-screen cues)

### 0:00–0:15 — Problem + identity

**ON SCREEN:** Landing hero + candidate model inspector. Text overlay: *"Public benchmarks don't catch agent failures."*

**SAY:** "Teams swap open-weight models into production and pray. Public benchmarks evaluate single-turn chat and miss what breaks in real agentic systems — truncated JSON, tail latency, and broken tool calls under concurrency.
SandboxProof crash-tests open-weight models inside isolated Nebius Sandboxes — SHIP or BLOCK with receipts."

### 0:15–1:45 — Live golden path (BLOCK evidence → flips to SHIP)

**0:15 ON SCREEN:** `/new` form. Candidate: `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`. Twin digest visible. Gates: P95 ≤ 5000ms, accuracy ≥ 85%, error rate ≤ 5%. Budget cap $10. Click **Run Certification**.

**SAY:** "Candidate model, sealed workload twin, production SLA gates, and deterministic safety budget. One click.
The same cryptographic twin replays against each configuration, so comparisons are reproducible."

**0:45 ON SCREEN:** Timeline Experiment 0 — A fresh microVM spawns on Nebius Contree with a real operation UUID (`01a1885f-...`). Plan: `concurrency=1`, `max_tokens=64`. Output truncates during structured JSON tool calling. Classifier labels QUALITY failure (quality 0% < 85%). Planner diagnoses: lean output budget truncated structured output.

**SAY:** "Experiment zero: cheapest profile first. A fresh Nebius Contree microVM spawns in seconds. But a lean output budget truncates the structured JSON response. The Nemotron classifier labels it QUALITY failure, and the planner visibly adapts: raise max_tokens to 512."

**1:15 ON SCREEN:** Timeline Experiment 1 — New disposable microVM spawns on Nebius Contree (`01a1885f-...`). Plan: `max_tokens=512`. Workload twin replays. All gates turn green: quality 100%, tool accuracy 100%, zero errors, P95 latency inside gate.

**SAY:** "Experiment one: with the output budget right-sized to 512 tokens, every structured tool call and JSON schema completes with 100% accuracy. Every SLA gate passes. Metrics decide, not vibes."

### 1:45–2:40 — Certificate + cent-level receipts + integrations aloud

**ON SCREEN:** `/certificate/[id]` — big SHIP, failing-gates empty, capacity envelope (concurrency, context tokens, output budget), exact measured spend ($0.0069), Contree operation UUID receipts, Model Passport PNG download.

**SAY:** "SHIP — with cryptographically sealed receipts. The certificate prescribes a turnkey Production Capacity Envelope: verified safe concurrency, safe context budget, output token guarantee, and exact unit economics.
Under the hood: Nebius Token Factory for model endpoints and Nemotron Ultra planning; Nebius Contree Sandboxes for isolated microVM execution; and Tavily for live pricing grounding."

### 2:40–3:00 — Close

**ON SCREEN:** `/dashboard` runs registry + `/certificate/[id]` Model Passport export. Text overlay: *"Don't ask. Prove it."*

**SAY:** "SandboxProof is continuous certification for agentic engineering. Don't guess whether an open-weight model will survive your production agent workload. Make it prove it with receipts."

## Filming notes

- Set `USE_SIMULATOR=false` for the real run (as verified in `docs/runs/real-001.json`).
- Keep the SSE `/events` stream visible during 0:45–1:45 — the real-time planner reasoning lines demonstrate autonomous agentic adaptation.
- Show the Contree microVM operation UUIDs directly on the timeline card drawer.
