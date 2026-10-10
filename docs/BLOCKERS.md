# BLOCKERS.md — what is needed for real runs

Updated after every task. Simulator is dev/test only, labelled SIMULATED, never issues certificates.

- [ ] `NEBIUS_SUBNET_ID` empty in `.env` — real Serverless Job create cannot run without VPC subnet. Need: subnet ID in eu-north1. Fallback active: simulated runner.
- [ ] `HF_TOKEN` empty in `.env` — only public models allowed. Need: token only if a gated NVIDIA model is chosen; else no action (Nano-30B + Qwen3-8B are public).
- [ ] Confirm Nebius $35 balance / $20 hard cap acknowledgement — enforced in code; no action needed unless cap changes.
- [ ] Hosted demo URL credentials (Vercel token) — not provided; deploy config prepared but no deploy executed.
- [ ] YouTube / Devpost manual steps — owner records video and submits (see final report).
