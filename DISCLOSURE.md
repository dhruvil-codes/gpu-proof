# DISCLOSURE.md — pre-existing work + track choice

## Pre-existing-work statement (fill placeholders before submitting)

> GPUProof was built during the submission period (Oct __–__, 2026) for the Nebius x
> NVIDIA Global AI Hackathon (deadline Oct 30, 2026, 10:00am PDT).
> Pre-existing as of the start date: [FILL — e.g. "repo scaffold, Next.js + FastAPI
> skeleton, MIT LICENSE, .env.example key names"].
> Built during the submission period: [FILL — e.g. "workload twin + SHA-256 digest,
> Nemotron planner/classifier via Token Factory, policy engine + $20/$10/$2 ledger,
> Nebius job runner + teardown, replay + SLA gates, SHIP/BLOCK certificate +
> deployment prescription, dashboard/new/timeline/certificate pages, tests"].
> Third-party / generated assistance: [FILL — e.g. "parallel coding agents for
> docs/tests; all benchmark numbers from real runs or labelled SIMULATED"].
> No secrets are committed; BYOK keys are in-memory only and never persisted
> (`apps/api/app/main.py:_sanitize_byok`, `store.store_cert` writes `safe_config` only).

Checklist before paste-to-Devpost:
- [ ] Dates + pre-existing list filled (keep PRD frozen: `docs/PRD.md` §1–§15)
- [ ] Track named: **Coding and Agentic Engineering**
- [ ] Real-run evidence linked (job IDs, certificate digests) OR labelled SIMULATED
- [ ] Feedback referenced (`FEEDBACK_TF_NVIDIA.md` + `docs/FEEDBACK.md`)

## Track choice rationale — Coding and Agentic Engineering

GPUProof is an agentic engineering loop, not a chat wrapper: a Nemotron Ultra planner
proposes, a deterministic policy engine disposes (1 GPU, L40S/H100, vLLM-only, 15 min,
$2/exp, $10/cert, $20 total, 5 exps max), Nebius jobs execute, measured metrics decide,
and a Nano classifier adapts the next plan (`MEMORY → escalate tier`,
`QUALITY → fix precision`). The demoable agentic property — *a failure visibly changes
the next experiment* (L40S OOM → H100; INT4 quality 0.62 → FP8) — plus the coding-engineering
artifacts (reproducible twin digest, offline-verifiable certificate, turnkey
`vllm serve` prescription) fit this track directly.
Note: `docs/PRD.md` §4 predates this choice and says "Best Apps and Agents" — update
or explain on the form; this file records the submission-time decision.

## Bonus targeting

- **Tavily (targeted, NOT yet integrated):** no Tavily import/call/env key exists in
  `services/` or `apps/` as of this writing. Planned post-freeze addition: live GPU
  price + outage radar feeding `cost_engine`/`advisor` (replacing static
  `GPU_HOURLY_USD`) with provenance tag `live-priced`; every number stays cited.
  Do NOT claim the bonus until the calls land in code + `.env.example` + ARCHITECTURE §7.
- **NVIDIA / Nebius mandatory bar (met):** runs on Nebius (Token Factory + AI Cloud),
  NVIDIA open models throughout the decision layer and as subject
  (Nemotron Ultra/Nano; Nano-30B candidate; Qwen3-8B baseline).
