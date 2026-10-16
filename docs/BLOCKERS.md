# BLOCKERS.md — what is needed for real runs

Updated after every task. Simulator is dev/test only, labelled SIMULATED, never issues certificates.
Pivot Oct 16: product is SandboxProof — real runs = Contree Sandboxes (free beta) + hosted
Token Factory endpoints. No AI Cloud billing, no SUBNET_ID needed.

- [x] Contree Sandboxes access — granted Oct 16 (`contree@nebius.com`). Verified live QR run.
  Creds present: `NEBIUS_API_KEY` + `NEBIUS_PROJECT_ID` in `.env`. 50 concurrent ops.
- [ ] Flip `USE_SIMULATOR=false` for a live sandbox run — needs explicit spend approval first
  (Token Factory inference $/1M per call; sandboxes free in beta). Simulator remains default.
- [ ] `HF_TOKEN` empty in `.env` — only public models allowed. Need: token only if a gated NVIDIA model is chosen; else no action (Nano-30B + Qwen3-8B are public).
- [ ] Confirm Nebius $35 balance / $20 hard cap acknowledgement — enforced in code; no action needed unless cap changes.
- [ ] Hosted demo URL credentials (Vercel token) — not provided; deploy config prepared but no deploy executed.
- [ ] YouTube / Devpost manual steps — owner records video and submits (see final report).
- [ ] Legacy AI Cloud GPU path retired — `services/nebius_runner.py` kept for interface compat only.
  `NEBIUS_SUBNET_ID` no longer required; do not provision GPU jobs for this track.
