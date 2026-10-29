# Devpost Project Description — SandboxProof

**Track:** Coding and Agentic Engineering  
**Hackathon:** Nebius x NVIDIA Global AI Hackathon (October 2026)  
**Live Demo:** https://sandboxproof.com (or local via `npm run dev`)  
**Verified Audit Evidence:** `docs/runs/real-001.json` (Cert: `cert-a1a3fa0d`)  
**GitHub Repository:** https://github.com/dhruvil-codes/gpu-proof  

---

### What is SandboxProof?
**SandboxProof is autonomous CI/CD for AI model migration.**  
When AI companies, research labs, or enterprise engineering teams want to swap their production LLMs (e.g. upgrading to an open-weight model like `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`), they currently deploy blind or rely on subjective chatbot leaderboards. 

SandboxProof replays a cryptographically sealed clone of their actual production traffic through **disposable Nebius Contree CPU microVMs** against hosted Token Factory inference endpoints. An **NVIDIA Nemotron Ultra/Nano agentic decision layer** autonomously plans, stress-tests, diagnoses failures, adapts serving parameters, and mints an immutable **SHIP or BLOCK Certificate** with measured hardware and economic receipts.

---

### The Problem: Why Chatbot Leaderboards & "AI Advice" Fail

1. **Leaderboard Vibes ≠ Production Scale:** LMSYS Chatbot Arena and Hugging Face benchmarks test single-turn conversational preferences at concurrency = 1. They tell you nothing about whether a model will drop JSON schemas at concurrency = 18, spike tail latency to 12 seconds, or exceed token budgets during agentic tool use.
2. **Why "Asking an AI" Doesn't Work:** 
   - An LLM can hallucinate plausible-sounding configurations (*"Nemotron-3-Nano will easily handle your 2,000ms SLA"*).
   - An LLM cannot execute Linux binaries, cannot simulate kernel network packet drops, cannot measure true P95 tail latency, cannot verify whether a reasoning model's thought tokens truncate its JSON output, and cannot sign an audit receipt backed by Nebius cloud billing receipts.
3. **The Hidden Reason Models Fail in Production:**
   Modern reasoning models (such as Nemotron Nano) generate reasoning tokens *before* producing formatted structured output. Under tight token budgets, the model runs out of output tokens mid-thought, outputting incomplete JSON and crashing downstream agent pipelines. 

**SandboxProof makes the model prove it inside an isolated sandbox before you touch production.**

---

### How SandboxProof Works: The Autonomous Loop

1. **Seal the Workload Twin:** 
   The user's actual production traffic (tool calls, schemas, argument types, multi-turn prompts) is compiled into a deterministic replay dataset sealed with a SHA-256 fingerprint at `temperature: 0.0`. Every model and test run meets the identical test harness.
2. **Autonomous Nemotron Ultra Planning:** 
   The NVIDIA Nemotron Ultra planner (`nvidia/Nemotron-3-Ultra-550b-a55b` via Token Factory) analyzes workload constraints and SLA targets to formulate an experiment hypothesis (concurrency, context window, output token budget).
3. **Deterministic Policy Boundary:** 
   Before any cloud execution, a hardcoded Python policy engine verifies constraints: max $2.00 per experiment, max $10.00 per certification, max 15-minute microVM lifespan, max 32 streams. The AI planner cannot renegotiate SLA gates or bypass financial budgets.
4. **Isolated Nebius Contree MicroVM Replay:** 
   SandboxProof spins up a fresh, disposable Nebius CPU microVM using `contree-sdk` (`ContreeSync`). The replay harness executes inside the microVM, streaming requests against Token Factory endpoints, capturing per-request latency, TTFT, JSON validity, and tool schema adherence.
5. **Nemotron Nano Failure Diagnosis & Autonomous Adaptation:**
   - **Quality Breach:** If a lean output budget (`max_tokens=64`) causes output truncation, Nemotron diagnoses `QUALITY_FAILURE` and raises `max_tokens=512`.
   - **Latency Breach:** If high concurrency saturates endpoints, the planner adapts concurrency downwards.
6. **The SHIP / BLOCK Certificate:** 
   If all hard gates pass (P95 latency ≤ 2,000ms, tool quality ≥ 85%, error rate ≤ 5%), SandboxProof mints an official **SHIP Certificate** with:
   - Certified Capacity Envelope: verified safe concurrency, max context length, output token allocation.
   - Ready-to-run cURL and deployment commands.
   - Measured cloud economics ($/1k queries, $/1M run-rate).
   - Automated CI/CD integration snippet for GitHub Actions.
   - Cryptographic workload fingerprint and Nebius operation UUID lineage.

---

### Verified Live Run Receipts

In our verified submission run (`cert-a1a3fa0d`, logged in `docs/runs/real-001.json`):
- **Base Environment:** Prepared in Nebius microVM `01a18858-7f8f-711f-be18-beeed4f1d7c5` (image `b01b6e8b-fb0f-42b2-9dc4-c55d393c2220`).
- **Experiment 0 (`01a1885f-2d09-73d2-9983-925aba588977`):** Max tokens = 64. Model ran out of tokens during reasoning thoughts, generating truncated output $\rightarrow$ **0% quality $\rightarrow$ BLOCK**.
- **Autonomous Adaptation:** Nemotron Ultra diagnosed the truncation and adapted `max_tokens=512`.
- **Experiment 1 (`01a1885f-6159-7708-86a6-9a0ca82cb13c`):** Replayed in fresh microVM $\rightarrow$ **100% tool accuracy, 100% JSON validity $\rightarrow$ SHIP**!
- **Total Real Spend:** **$0.0069 USD** across two disposable microVMs. Real receipts, real operation IDs.

---

### Why AI Companies, Research Labs, and Businesses Need This

| Use Case | Traditional Approach | With SandboxProof |
| :--- | :--- | :--- |
| **Model Evaluation** | Asking ChatGPT or looking at Chatbot Arena leaderboards | Replaying exact production JSON schemas in isolated microVMs |
| **Deployment Risk** | Deploying model swap directly to production canary | Getting an immutable SHIP/BLOCK certificate backed by real metrics |
| **Cost Optimization** | Guessing $/1M tokens from marketing pricing sheets | Empirical cost-per-query measured from live sandbox execution |
| **CI/CD Integration** | Manual QA testing before prompt or model updates | Automated PR gate (`npx sandboxproof verify`) failing builds on quality drop |
| **Scale Validation** | Assuming vendor endpoints will hold concurrent load | Live P95 latency curve under simulated multi-stream load |

---

### Built with Nebius & NVIDIA

- **Nebius Contree Sandbox:** Disposable Linux microVMs executed via `contree-sdk` with full operational audit lineage.
- **Nebius Token Factory:** Ultra-fast inference endpoints for test subjects and agentic decision layers.
- **NVIDIA Nemotron Models:**
  - `nvidia/Nemotron-3-Ultra-550b-a55b` as autonomous experiment planner.
  - `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` as failure classifier and certified model subject.
- **Tavily Live Market Pricing:** Real-time GPU cloud pricing and model release radar.
- **Next.js 14 + FastAPI:** Production-grade web interface, streaming SSE telemetry, and verifiable digital certificates.
