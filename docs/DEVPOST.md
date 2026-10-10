# Devpost project description

**What:** GPUProof is CI/CD for AI inference. Give it your current deployment, a candidate model,
and production requirements; it runs real experiments on Nebius GPUs, learns from failures, and
issues a SHIP/BLOCK certificate backed by measured evidence.

**Why:** Teams swap models or serving configs without knowing whether their workload breaks —
public benchmarks miss broken tool calls, invalid JSON, latency regressions, OOMs, cost surprises.
An LLM can recommend a config but cannot prove one works. GPUProof makes the model prove it.

**How:** A fixed deterministic workload twin (tool calling + structured output) is replayed in a
fresh Serverless Job running vLLM on L40S/H100. Nemotron Ultra (Token Factory) proposes each
experiment; a deterministic policy engine (1 GPU, 15 min, $2/exp, $10/cert, vLLM only) must approve
it; Nemotron Nano classifies failures (OOM→MEMORY→escalate to H100); deterministic evaluators check
every SLA gate against measured TTFT/latency/throughput/quality/cost. Any failing hard gate = BLOCK.
Planner down = "Certification incomplete", never a fabricated SHIP. Demo: L40S OOM, H100 INT4 quality
fail, H100 FP8 SHIP — each failure visibly changing the next plan.
