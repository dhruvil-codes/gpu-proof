# FEEDBACK_TF_NVIDIA.md — provider feedback drafts (grounded in verified usage)

> What we verifiably used: Token Factory OpenAI-compatible `POST /v1/chat/completions`
> with `response_format: json_object` (`services/decision_engine.py`); AI Cloud REST
> `POST /ai/v1/jobs`, logs, cancel, delete (`services/nebius_runner.py`);
> Nemotron Ultra `nvidia/Nemotron-3-Ultra-550b-a55b` (planner) + Nano
> `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (classifier); HF `config.json` + API metadata
> (`services/advisor.py`). NIM / Tavily / Run:ai are NOT used in this checkout —
> notes below are requests, not usage reports.

## 1. Nebius Token Factory — onboarding + endpoint discovery

**What worked:** OpenAI-compatible `POST {BASE}/chat/completions` with JSON mode just
worked (`BASE_URL=https://api.tokenfactory.nebius.com/v1`); strict key validation
(`PLAN_SCHEMA_KEYS`) plus deterministic fallbacks kept us shippable.

**Pain:** the human-readable model catalog drifted from the machine-readable one
(`docs/FEEDBACK.md` pre-existing note: Markdown vs `/api/public/models_info`).
We also guessed the base URL from docs rather than discovering it.

**Asks:**
1. Single source of truth: one versioned catalog endpoint whose `id` strings are
   exactly the `model` values the inference endpoint accepts (plus `context_len`,
   JSON-mode support, deprecation date per ID).
2. A "Token Factory in 5 minutes" page: base URL, auth header, JSON-mode example,
   model-ID table, and error-code table — one page, copy-pasteable `curl`.
3. Machine-readable OpenAPI/SDK listing for inference + catalog so key/ID drift
   breaks CI instead of demos.

## 2. Nemotron via NIM — judge loops want rate + caching guidance

**Context:** our decision layer is Token-Factory-only (no NIM calls in repo).
Our loop is planner-propose → policy-gate → GPU-run → classify → adapt (≤5 exps);
a judge-style loop hammers small JSON completions, not long generations.

**Pain (anticipated):** if NIM judge tiers stay near ~40 RPM, a 5-experiment
certification with planner + classifier + advisor calls risks throttle-stalls mid-run.
(Figure is a planning assumption, NOT measured in this repo.)

**Asks:**
1. Publish per-tier RPM/TPM for Nemotron Ultra + Nano judge-style traffic and a
   `Retry-After`-honoring example for JSON judge loops.
2. Caching guidance: which fields (system prompt pinning, prefix cache, seed/
   temperature for determinism) are safe for repeated judge calls, with a
   determinism recipe (`temperature 0`, fixed seed, JSON schema pinning).
3. A tiny "LLM-as-bounded-classifier" cookbook: enum-constrained outputs with
   server-side validation, matching our `MEMORY|LATENCY|QUALITY|…` pattern.

## 3. Nebius AI Cloud (Serverless Jobs) — GPU jobs

**What worked:** `POST /ai/v1/jobs` with project/subnet scoping, log tail, cancel,
delete — clean lifecycle for one-GPU vLLM sandboxes with teardown on every path.

**Pain:** request shape and exact `gpuType` enum values took digging
(pre-existing `docs/FEEDBACK.md` note); missing `NEBIUS_SUBNET_ID` blocks real runs
with a terse error.

**Asks:**
1. One "Serverless Job with GPU" page: minimal JSON (1× L40S/H100 + vLLM image),
   exact `gpuType` enum, timeout/cancel/log-tail semantics, and the subnet-missing error verbatim.
2. Pre-flight validation endpoint (quota/capacity/subnet check, dry-run cost
   estimate) so policy engines like ours can refuse before spending.
3. Documented log-retention + artifact-fetch window post-delete for audit trails.

## 4. Run:ai (open-source) — fractional-sizing recommendation idea

**Context:** not integrated; our pre-spend sizing (`advisor.calibrate_stress`) often
lands at 80–95% saturation on one GPU — the classic "almost fits" case.

**Idea:** a Run:ai-aware recommendation note for fractional/GPU-slice scheduling:
when `saturation_pct` is 85–100%, suggest slice/fraction + concurrency cap pairs
instead of forcing a tier jump, with the same P95 ≤ 2000 ms gate as arbiter.
Happy to pilot the math if there's an open API for slice-aware placement.

---
*Tone intent: concrete, technical, polite. Send as-is or trim per-question on the form.*
