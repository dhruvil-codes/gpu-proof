# Demo script (≤3 min)

0:00 — Landing: "Make your model prove it." Show prompt panel, Built-on row.
0:20 — New Certification: current Qwen3-8B H100 FP8, candidate Nemotron-3-Nano-30B, workload twin digest, gates, $10 budget. Run.
0:45 — Timeline Exp 1: L40S FP8, sandbox op ID + image UUID, OOM, classifier MEMORY. Planner reason: escalate to H100.
1:15 — Exp 2: H100 INT4 passes perf, quality 0.62 < 0.85 gate. Planner: quantization regression → H100 FP8 tuned.
1:45 — Exp 3: H100 FP8 all gates pass. Metrics: p95 latency, throughput, quality, cost/1M. Sandbox PROVEN chips on each card.
2:15 — Certificate: SHIP (sandbox-measured) or SIMULATED (dev). Tavily evidence links, budget spent, failing gate if BLOCK.
2:45 — Close: "Don't ask whether a new deployment should work. Make it prove it."
