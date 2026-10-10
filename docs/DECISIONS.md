# DECISIONS.md — GPUProof autonomous build log

Rule: every autonomous decision gets one line + reason. PRD is frozen; user overrides win on conflict.

- 2026-10-10 — PRD treated as frozen source of truth, never edited. Reason: user table row 1 explicit.
- 2026-10-10 — Reuse single NEBIUS_API_KEY for Token Factory inference (OpenAI-compatible base https://api.tokenfactory.nebius.com/v1/). Reason: user row 3 = No separate key.
- 2026-10-10 — HF_TOKEN absent so public models only; no gated pulls. Reason: user row 4 + .env shows HF empty.
- 2026-10-10 — Candidate Nemotron-3-Nano-30B; baseline Qwen3-8B on H100 FP8 measured once and cached. Reason: user row 5.
- 2026-10-10 — Planner Nemotron-3-Ultra, classifier Nemotron-3-Nano, verified at startup with graceful fallback. Reason: user row 6.
- 2026-10-10 — Failure story L40S-first then adapt to H100; never fake failures. Reason: user row 7 + PRD demo story.
- 2026-10-10 — Cost caps: PRD limits apply but tightened to user override $20 total hard cap / $10 per-cert cap; MAX_EXPERIMENT_COST $2, MAX_EXPERIMENTS 5, 1 GPU, L40S/H100, vLLM only. Refuse launches over budget. Reason: user row 11 is stricter than PRD §11.
- 2026-10-10 — Hosting: Vercel web + Docker API + Windows-compatible docker-compose; no deploy without creds. Reason: user row 8.
- 2026-10-10 — License MIT (already in repo). Reason: user row 9.
- 2026-10-10 — Work on `build` branch, small commits, never commit .env. Reason: user row 10 + operating rules.
- 2026-10-10 — NEBIUS_SUBNET_ID empty so real Serverless Job create is blocked; build NebiusRunner interface + simulated adapter, keep going. Reason: operating rules simulator fallback.
- 2026-10-10 — Design locked to screenshot: #EFEBE4 canvas, #1F1F1F ink/buttons, thin 1px borders, inset frame, rounded-cell grid, full mono (Geist Mono via next/font), SHIP green / BLOCK red accents only for status. Reason: user keep-style instruction.
