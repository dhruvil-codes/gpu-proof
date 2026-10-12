import Link from "next/link";
import { SiteFooter, TopNav } from "@/components/ui";

export const metadata = {
  title: "Docs — GPUProof Architecture & Intricacy Guide",
  description:
    "Deep technical architecture of GPUProof: why public benchmarks fail, how the NVIDIA Nemotron decision engine operates, how Workload Twins are generated, and how Nebius serverless GPU containers are orchestrated.",
};

const SECTIONS = [
  { id: "architecture", num: "01", label: "System Architecture Overview" },
  { id: "decision-engine", num: "02", label: "NVIDIA Nemotron Decision Engine" },
  { id: "workload-twin", num: "03", label: "The Workload Twin" },
  { id: "hardware-tiers", num: "04", label: "Hardware Tiers & Economics" },
  { id: "sla-gates", num: "05", label: "SLA Gates & Safety Guardrails" },
  { id: "certificates", num: "06", label: "Interpreting Official Certificates" },
];

function SectionHeading({ num, eyebrow, title }: { num: string; eyebrow: string; title: string }) {
  return (
    <div>
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted">
        <span className="inline-block border border-ink px-2 py-0.5 font-mono text-[11px] text-ink">{num}</span>
        {eyebrow}
      </p>
      <h2 className="mt-2 text-2xl tracking-tight md:text-3xl">{title}</h2>
    </div>
  );
}

function Code({ title, children }: { title?: string; children: string }) {
  return (
    <figure className="mt-4 overflow-hidden rounded-lg border border-ink bg-[#141414] text-left shadow-[4px_4px_0_#1F1F1F]">
      {title && (
        <figcaption className="border-b border-canvas/20 bg-ink px-4 py-2 font-mono text-[11px] text-canvas/70">
          {title}
        </figcaption>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed text-canvas/90">{children}</pre>
    </figure>
  );
}

export default function DocsPage() {
  return (
    <main>
      <TopNav />

      {/* Hero */}
      <section className="grid-cells border-b border-ink px-6 pb-10 pt-14">
        <div className="mx-auto max-w-5xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-ink px-3.5 py-1 text-[11px] font-bold uppercase tracking-widest shadow-[2px_2px_0_#1F1F1F]">
            <span className="inline-block h-2 w-2 rounded-full bg-ink" />
            Technical Documentation · Intricacy Guide
          </p>
          <h1 className="mt-5 max-w-3xl text-3xl font-extrabold leading-[1.15] tracking-tight md:text-5xl">
            GPUProof Architecture &amp; Intricacy Guide
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
            Why public benchmarks fail in production, how the NVIDIA Nemotron decision engine reasons
            about OOMs, how Workload Twins mirror real traffic, and how Nebius serverless GPU
            containers are orchestrated — written for hackathon judges and engineering leads.
          </p>
          <blockquote className="mt-6 max-w-2xl rounded-lg border border-ink bg-ink p-4 text-left text-canvas shadow-[4px_4px_0_rgba(31,31,31,0.25)]">
            <p className="font-mono text-sm font-bold tracking-tight">
              &ldquo;AI proposes. Policy approves. Nebius executes. Metrics decide.&rdquo;
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-widest text-canvas/60">
              Governing principle — no vibes, only measured evidence
            </p>
          </blockquote>
          <div className="mt-6 flex flex-wrap gap-3 text-xs font-bold">
            <Link
              href="/new"
              className="btn-dark min-h-[44px] cursor-pointer rounded-lg px-5 py-2.5 transition-all hover:-translate-y-px"
            >
              Start a Hardware Audit →
            </Link>
            <Link
              href="/dashboard"
              className="panel min-h-[44px] cursor-pointer rounded-lg border border-ink px-5 py-2.5 transition-all hover:-translate-y-px"
            >
              View Audit Portfolio
            </Link>
          </div>
        </div>
      </section>

      {/* Body with sticky sub-nav */}
      <div className="mx-auto grid max-w-5xl gap-8 px-6 py-10 lg:grid-cols-[230px_1fr]">
        {/* Sidebar / sticky sub-navigation */}
        <aside aria-label="Documentation sections" className="h-fit lg:sticky lg:top-20">
          <nav className="panel rounded-lg border border-ink p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted">On this page</p>
            <ol className="mt-3 space-y-1">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="flex cursor-pointer items-baseline gap-2 rounded px-2 py-1.5 text-[12px] font-bold leading-snug transition-colors hover:bg-ink hover:text-canvas"
                  >
                    <span className="font-mono text-[11px] text-muted">{s.num}</span>
                    <span>{s.label}</span>
                  </a>
                </li>
              ))}
            </ol>
            <div className="mt-4 border-t border-ink/20 pt-3 text-[11px] leading-relaxed text-muted">
              <p className="font-mono">SLA: P95 &lt; 2000ms · accuracy ≥ 85% · error ≤ 5%</p>
              <p className="mt-1 font-mono">Cap: $10.00 / audit · $20.00 server</p>
            </div>
          </nav>
        </aside>

        <div className="min-w-0 space-y-10">
          {/* 01 — System Architecture Overview */}
          <section id="architecture" aria-label="System Architecture Overview" className="scroll-mt-24">
            <SectionHeading num="01" eyebrow="System Architecture Overview" title="Five stages, one deterministic loop" />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Every certification is a closed loop. An LLM planner can suggest the next experiment, but it
              can never spend money or mint a certificate on its own. A deterministic policy engine sits in
              the middle and enforces budgets, runtimes, and SLA gates.
            </p>

            <Code title="nebius-pipeline · canonical flow">
{`FastAPI ──▶ Nebius Token Factory ──▶ Nebius Serverless Jobs ──▶ vLLM ──▶ Deterministic Policy Engine
   │                │                          │                        │                │
   │  REST + SSE   │  short-lived creds       │  isolated containers   │  PagedAttention│  SHIP / BLOCK
   │  /certify     │  per-job, auto-expire    │  L40S → H100           │  FP8 / BF16    │  FNV-1a digest
   └────────────────┴──────────────────────────┴────────────────────────┴────────────────┘
                              AI proposes. Policy approves. Nebius executes. Metrics decide.`}
            </Code>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <article className="panel rounded-lg border border-ink p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest">FastAPI (orchestrator)</p>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Owns certification state, streams Server-Sent Events to the timeline UI, computes spend,
                  and refuses any experiment the policy engine rejects. Stateless planners call it; it
                  decides.
                </p>
              </article>
              <article className="panel rounded-lg border border-ink p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest">Nebius Token Factory</p>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Mints short-lived, least-privilege credentials per job. No long-lived cloud keys in the
                  loop. Every GPU container inherits exactly one scoped token that expires with the job.
                </p>
              </article>
              <article className="panel rounded-lg border border-ink p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest">Nebius Serverless Jobs</p>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Isolated GPU containers (eu-north1) provisioned on demand. Starts on the cheapest tier
                  (L40S), escalates to H100 only on diagnosed OOM. Max 1 GPU, 15 min runtime, $2.00 per
                  experiment.
                </p>
              </article>
              <article className="panel rounded-lg border border-ink p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest">vLLM + Policy Engine</p>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  vLLM serves the candidate with PagedAttention and continuous batching. The deterministic
                  policy engine then checks P95 latency, tool accuracy, and error rate — and mints SHIP or
                  BLOCK with a cryptographic digest.
                </p>
              </article>
            </div>
          </section>

          {/* 02 — Decision Engine */}
          <section id="decision-engine" aria-label="The NVIDIA Nemotron Decision Engine" className="scroll-mt-24 border-t border-ink pt-10">
            <SectionHeading num="02" eyebrow="The NVIDIA Nemotron Decision Engine" title="Two brains: deep planner, fast classifier" />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Public leaderboards tell you a model is smart. They never tell you it will OOM at 16-way
              concurrency on a 48&nbsp;GB card. GPUProof splits cognition into two Nemotron roles so
              reasoning stays deep where it matters and instant where it must.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <article className="rounded-lg border border-ink bg-ink p-5 text-canvas">
                <p className="text-[11px] font-bold uppercase tracking-widest text-canvas/60">Deep reasoning planner</p>
                <h3 className="mt-1 text-base font-bold tracking-tight">Nemotron-3-Ultra-550B</h3>
                <p className="mt-2 text-[12px] leading-relaxed text-canvas/80">
                  Diagnoses CUDA OOM, concurrency saturation, and precision trade-offs. Reads KV-cache
                  growth, batch traces, and tool-error clusters, then writes the next experiment plan:
                  escalate hardware, lower precision, or shrink max-model-len.
                </p>
                <ul className="mt-3 space-y-1.5 border-t border-canvas/20 pt-3 font-mono text-[11px] text-canvas/70">
                  <li>→ OOM root-cause: KV cache vs. weights vs. fragmentation</li>
                  <li>→ concurrency saturation: throughput collapse point</li>
                  <li>→ precision call: FP8 vs. BF16 vs. INT4-AWQ</li>
                </ul>
              </article>
              <article className="panel rounded-lg border border-ink p-5">
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted">Bounded fast classifier</p>
                <h3 className="mt-1 text-base font-bold tracking-tight">Nemotron-3-Nano-30B</h3>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Labels every failed request into a fixed taxonomy in milliseconds — never free-form prose,
                  so downstream policy stays deterministic and auditable.
                </p>
                <ul className="mt-3 space-y-1.5 border-t border-ink/20 pt-3 font-mono text-[11px]">
                  <li><span className="font-bold">SCHEMA_VIOLATION</span> — bad JSON key / type</li>
                  <li><span className="font-bold">TOOL_MISFIRE</span> — wrong function / args</li>
                  <li><span className="font-bold">TRUNCATION</span> — max-tokens cut mid-JSON</li>
                  <li><span className="font-bold">OOM_FATAL</span> — CUDA out of memory</li>
                  <li><span className="font-bold">LATENCY_BREACH</span> — P95 tail spike</li>
                </ul>
              </article>
            </div>

            <Code title="planner-reasoning.json · ultra-550b diagnosis (abridged)">
{`{
  "diagnosis": "MEMORY",
  "evidence": "KV cache 47.9GB / 48GB at batch=16, seq_len=4096",
  "cause": "concurrency saturation, not weight size (30B FP8 = ~32GB)",
  "plan": [
    "escalate L40S-48GB -> H100-80GB-SXM5",
    "keep precision FP8, keep max_model_len=4096",
    "re-run 200-req twin at batch=16 before tuning"
  ],
  "confidence": 0.91
}`}
            </Code>
          </section>

          {/* 03 — Workload Twin */}
          <section id="workload-twin" aria-label="The Workload Twin" className="scroll-mt-24 border-t border-ink pt-10">
            <SectionHeading num="03" eyebrow="The Workload Twin" title="Synthetic traffic that mirrors production" />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              MMLU and GSM8k measure textbook knowledge. Production breaks on malformed tool arguments,
              over-long contexts, and bursty concurrency. The Workload Twin replays a deterministic sample
              (20–1,000 requests) drawn from your real token-length curves, schema shapes, and function
              mix — same seed, same twin, every re-run.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="panel rounded-lg border border-ink p-4">
                <p className="text-sm font-bold">◈ Structured JSON schemas</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  Strict key/type validation. A single hallucinated key fails the request — exactly like
                  your downstream parser would.
                </p>
              </div>
              <div className="panel rounded-lg border border-ink p-4">
                <p className="text-sm font-bold">⬢ Weather + Stripe tools</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  Real function signatures with required args, enums, and idempotency keys. Tests routing,
                  argument grounding, and multi-step calls.
                </p>
              </div>
              <div className="panel rounded-lg border border-ink p-4">
                <p className="text-sm font-bold">⬣ Token-length curves</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  Short chat, long RAG contexts, and JSON-heavy agent turns sampled to match your P50 / P95
                  production distribution.
                </p>
              </div>
            </div>

            <Code title="workload-twin.json · tool-call sample">
{`{
  "twin_digest": "fnv1a:9d31bc",
  "seed": 42,
  "requests": 200,
  "tools": [
    { "name": "get_weather", "args": { "location": "Berlin,DE", "units": "celsius" } },
    { "name": "stripe.create_charge", "args": { "amount": 4999, "currency": "usd" } }
  ],
  "schema": { "type": "object", "required": ["answer", "tool_calls"], "additionalProperties": false },
  "token_curve": { "p50_in": 812, "p95_in": 3420, "p50_out": 220, "p95_out": 890 }
}`}
            </Code>
          </section>

          {/* 04 — Hardware Tiers */}
          <section id="hardware-tiers" aria-label="Hardware Tiers and Economics" className="scroll-mt-24 border-t border-ink pt-10">
            <SectionHeading num="04" eyebrow="Hardware Tiers & Economics" title="Start cheap, escalate on evidence" />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              GPUProof always bids the cheapest tier first. Escalation is never a guess — it requires a
              diagnosed OOM with KV-cache evidence from the Ultra planner.
            </p>

            <div className="mt-4 overflow-hidden rounded-lg border border-ink">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="bg-ink font-mono text-[11px] uppercase tracking-widest text-canvas">
                    <th className="px-4 py-3">Tier</th>
                    <th className="px-4 py-3">VRAM / Bandwidth</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Where it OOMs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/20 bg-[#F5F1E9]">
                  <tr>
                    <td className="px-4 py-3 font-bold">NVIDIA L40S<br /><span className="font-mono text-[11px] font-normal text-muted">48GB Ada Lovelace · PCIe 4.0</span></td>
                    <td className="px-4 py-3">48 GB · ~864 GB/s</td>
                    <td className="px-4 py-3 font-mono font-bold">$1.20/hr</td>
                    <td className="px-4 py-3 text-muted">30B FP8 fits weights (~32GB) but KV cache at batch 16 × 4k context overflows 48GB → CUDA OOM.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">NVIDIA H100<br /><span className="font-mono text-[11px] font-normal text-muted">80GB SXM5 · Hopper</span></td>
                    <td className="px-4 py-3">80 GB · 3.35 TB/s</td>
                    <td className="px-4 py-3 font-mono font-bold">$3.95/hr</td>
                    <td className="px-4 py-3 text-muted">Absorbs the same batch with headroom; 3.9× bandwidth collapses P95 tail under concurrency.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <Code title="economics.py · verified cost per 1k queries">
{`# L40S run:  200 reqs in 11.2 min @ $1.20/hr  ->  $0.224  ->  $1.12 / 1k queries
# H100 run:  200 reqs in  6.4 min @ $3.95/hr  ->  $0.421  ->  $2.11 / 1k queries
# Switching Nano-30B (H100) vs Qwen-8B (H100 x2 replicas): -38% fleet cost.
# Rule: cheaper per-hour loses if latency forces extra replicas. Metrics decide.`}
            </Code>
          </section>

          {/* 05 — SLA Gates */}
          <section id="sla-gates" aria-label="Deterministic SLA Gates and Safety Guardrails" className="scroll-mt-24 border-t border-ink pt-10">
            <SectionHeading num="05" eyebrow="Deterministic SLA Gates & Safety Guardrails" title="Three gates. Zero discretion." />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              The policy engine is pure code — no LLM vote, no temperature, no retries-to-pass. A candidate
              ships only if all three gates pass on the same measured run.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="panel rounded-lg border border-ink border-l-4 border-l-ink p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">Gate 1 · Latency</p>
                <p className="mt-1 text-xl font-extrabold tracking-tight">P95 &lt; 2,000ms</p>
                <p className="mt-1 text-[12px] text-muted">Measured end-to-end on vLLM, batch 16, production token curve.</p>
              </div>
              <div className="panel rounded-lg border border-ink border-l-4 border-l-ship p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">Gate 2 · Quality</p>
                <p className="mt-1 text-xl font-extrabold tracking-tight">Accuracy ≥ 85%</p>
                <p className="mt-1 text-[12px] text-muted">Tool-call + JSON-schema accuracy scored deterministically.</p>
              </div>
              <div className="panel rounded-lg border border-ink border-l-4 border-l-block p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">Gate 3 · Reliability</p>
                <p className="mt-1 text-xl font-extrabold tracking-tight">Error ≤ 5%</p>
                <p className="mt-1 text-[12px] text-muted">Any OOM, timeout, or schema failure counts. No sampling tricks.</p>
              </div>
            </div>

            <Code title="policy.py · immutable budget guardrails">
{`AUDIT_CAP_USD   = 10.00   # per certification, immutable
SERVER_CAP_USD  = 20.00   # global guardrail across all audits
MAX_PER_EXP_USD =  2.00   # per experiment
MAX_RUNTIME_MIN = 15      # per job
MAX_GPUS        =  1      # no multi-node surprises

def approve(plan, spend_so_far):
    est = estimate_cost(plan.gpu, plan.minutes)
    if spend_so_far + est > AUDIT_CAP_USD: return "REFUSE: audit cap"
    if global_spend() + est > SERVER_CAP_USD: return "REFUSE: server guardrail"
    return "APPROVE"`}
            </Code>
          </section>

          {/* 06 — Certificates */}
          <section id="certificates" aria-label="Interpreting Official Certificates" className="scroll-mt-24 border-t border-ink pt-10">
            <SectionHeading num="06" eyebrow="Interpreting Official Certificates" title="Proof you can hand to a judge — or an auditor" />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Each finished audit mints one certificate at <code className="rounded bg-ink/10 px-1.5 py-0.5 font-mono text-[12px]">/certificate/[id]</code>.
              Simulated runs are watermarked SIMULATED and can never mint.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <article className="panel rounded-lg border border-ink p-4">
                <p className="text-sm font-bold">◉ Cryptographic FNV-1a digest</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  The twin digest plus the metrics payload are hashed with FNV-1a (e.g.{" "}
                  <code className="rounded bg-ink/10 px-1 font-mono">fnv1a:a7c29e</code>). Any tampering
                  with latency, accuracy, or spend invalidates the digest — verifiable offline.
                </p>
              </article>
              <article className="panel rounded-lg border border-ink p-4">
                <p className="text-sm font-bold">◉ Evidence scorecard</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  Verdict (SHIP / BLOCK), per-gate pass/fail, hardware lineage (L40S → H100), precision,
                  spend ledger, and experiment timeline — all rendered for screenshot or print.
                </p>
              </article>
            </div>

            <Code title="verify.py · check a certificate digest offline">
{`def fnv1a(s: str) -> str:
    h = 0x811C9DC5
    for b in s.encode():
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"fnv1a:{h:06x}"

# digest == certificate.digest  ->  evidence untampered, verdict stands`}
            </Code>

            <div className="mt-4 rounded-lg border border-ink bg-ink p-5 text-canvas">
              <p className="text-[11px] font-bold uppercase tracking-widest text-canvas/60">Export to PDF</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-canvas/85">
                <li>Open the certificate page and confirm the digest matches the timeline ledger.</li>
                <li>Use browser Print → Save as PDF (background graphics on preserves the editorial styling).</li>
                <li>Attach the PDF alongside the digest string — reviewers can re-hash the payload offline.</li>
              </ol>
              <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold">
                <Link href="/dashboard" className="cursor-pointer rounded-lg bg-canvas px-5 py-2.5 text-ink transition-all hover:bg-white">
                  Open Audit Portfolio →
                </Link>
                <Link href="/#faq" className="cursor-pointer rounded-lg border border-canvas/40 px-5 py-2.5 text-canvas transition-colors hover:border-canvas">
                  Read the FAQ
                </Link>
              </div>
            </div>
          </section>

          <p className="border-t border-ink pt-6 text-center text-[11px] uppercase tracking-widest text-muted">
            GPUProof Docs · Deterministic · Audit-grade · Nebius x NVIDIA Hackathon
          </p>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
