# Spend ledger — hard cap $20.00 total, $10.00 per certification

| date (UTC) | certification | experiment | target / engine | secs | $ est | $ actual | cumulative | op_id / job_id | notes |
| ---------- | ------------- | ---------- | --------------- | ---- | ----- | -------- | ---------- | -------------- | ----- |
| 2026-10-10 | sim-001 (cert-5a086ff3) | exp1 OOM | L40S | ~1 | 0.00 | 0.00 | 0.00 | sim-job-0001 | SIMULATED: Nano-30B FP8 OOM, classifier MEMORY |
| 2026-10-10 | sim-001 (cert-5a086ff3) | exp2 quality BLOCK | H100 | ~1 | 0.00 | 0.00 | 0.00 | sim-job-0001 | SIMULATED: INT4 quality 0.62 < 0.85 gate |
| 2026-10-10 | sim-001 (cert-5a086ff3) | exp3 SHIP | H100 | ~1 | 0.00 | 0.00 | 0.00 | sim-job-0001 | SIMULATED: FP8 quality 0.93, all gates pass |
| 2026-10-12 | live (cert-c756f124) | exp1 OOM | L40S | ~1 | 0.00 | 0.00 | 0.00 | sim-job-0001 | SIMULATED, refactored loop, unique job ids |
| 2026-10-12 | live (cert-c756f124) | exp2 quality BLOCK | H100 | ~1 | 0.00 | 0.00 | 0.00 | sim-job-0002 | SIMULATED: INT4 quality 0.62 |
| 2026-10-12 | live (cert-c756f124) | exp3 SHIP | H100 | ~1 | 0.00 | 0.00 | 0.00 | sim-job-0003 | SIMULATED: FP8 quality 0.93 |
| 2026-10-29 | real-001 (cert-a1a3fa0d) | exp0 TRUNCATION BLOCK | Nebius Contree / Token Factory | ~4.5 | 0.01 | 0.0031 | 0.0031 | 01a1885f-2d09-73d2-9983-925aba588977 | REAL SANDBOX: lean max_tokens=64 truncates structured output; quality 0.0; Nemotron Ultra diagnoses TRUNCATION failure; BLOCK |
| 2026-10-29 | real-001 (cert-a1a3fa0d) | exp1 ADAPTED SHIP | Nebius Contree / Token Factory | ~8.5 | 0.01 | 0.0038 | 0.0069 | 01a1885f-6159-7708-86a6-9a0ca82cb13c | REAL SANDBOX: Nemotron Ultra adapted max_tokens=512; quality 1.0 (tool 100%, JSON 100%), error_rate 0.0, latency_p95_ms 3388ms (passes configured hosted reasoning SLA gate <= 5000ms); SHIP |
| 2026-10-29 | real-002 (cert-44e00621) | exp0 TRUNCATION BLOCK | Nebius Contree / Token Factory | ~4.5 | 0.01 | 0.0029 | 0.0029 | 01a188ea-5df4-77b8-b729-36b1bed72d40 | REAL SANDBOX: lean max_tokens=64 truncates structured output; quality 0.0; Nemotron Ultra diagnoses TRUNCATION; BLOCK |
| 2026-10-29 | real-002 (cert-44e00621) | exp1 ADAPTED SHIP | Nebius Contree / Token Factory | ~8.0 | 0.01 | 0.0030 | 0.0059 | 01a188ea-8f48-764a-aed5-b3182b529dfe | REAL SANDBOX: Nemotron Ultra adapted max_tokens=512; quality 1.0 (tool 100%, JSON 100%), error_rate 0.0, latency_p95_ms 3016ms (passes configured SLA gate <= 5000ms); SHIP |

Policy: refuse any launch that would breach $20 total or $10 per-cert. Simulator runs cost $0 and are marked SIMULATED.

## Verified Live Sandbox Execution (2026-10-29)

- Subject Model: `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` on Nebius Token Factory.
- Planning & Decision: `nvidia/Nemotron-3-Ultra-550b-a55b` via Token Factory.
- Execution Environment: Isolated disposable microVM sandboxes spawned on Nebius Contree (`python:3.12-slim`).
- Replay: In-sandbox replay harness executing sealed workload twin against live hosted endpoint.
- Measured Operations:
  - Base Image Preparation: `01a18858-7f8f-711f-be18-beeed4f1d7c5` (img `b01b6e8b-fb0f-42b2-9dc4-c55d393c2220`)
  - Experiment 0 MicroVM: `01a1885f-2d09-73d2-9983-925aba588977` (cost $0.002828)
  - Experiment 1 MicroVM: `01a1885f-6159-7708-86a6-9a0ca82cb13c` (cost $0.002828)
- Measured Cumulative Spend: $0.0069 (well under the $20.00 budget cap).
- Full Evidence: Saved in `docs/runs/real-001.json`.
