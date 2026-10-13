import Link from "next/link";
import { SiteFooter, TopNav } from "@/components/ui";

export const metadata = {
  title: "Docs — Local AI Hardware & Nebius Deployment Guide",
  description:
    "The definitive GPUProof reference: why benchmarks fail, the full hardware spectrum from Mac Mini to 10-GPU clusters, VRAM and KV-cache math, 2026 model cheat sheet, and Nebius production deployment.",
};

const SECTIONS = [
  { id: "why-gpuproof", num: "01", label: "Why GPUProof Exists" },
  { id: "hardware-spectrum", num: "02", label: "Complete Hardware Spectrum" },
  { id: "vram-math", num: "03", label: "VRAM & KV-Cache Math" },
  { id: "model-lineup", num: "04", label: "2026 Model Lineup & Cheat Sheet" },
  { id: "local-to-nebius", num: "05", label: "Local to Nebius Bridge" },
  { id: "sla-failures", num: "06", label: "SLAs & Failure Taxonomy" },
  { id: "audit-fingerprint", num: "07", label: "Audit Fingerprint" },
];

function SectionHeading({ num, eyebrow, title }: { num: string; eyebrow: string; title: string }) {
  return (
    <div>
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted">
        <span className="inline-block border border-ink px-2 py-0.5 font-mono text-[11px] text-ink">
          {num}
        </span>
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
      <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed text-canvas/90">
        {children}
      </pre>
    </figure>
  );
}

function Formula({ children }: { children: string }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-ink bg-ink px-4 py-3 font-mono text-[12px] leading-relaxed text-canvas">
      {children}
    </div>
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
            Technical Guide · Local AI Machines → Nebius Cloud
          </p>
          <h1 className="mt-5 max-w-3xl text-3xl font-extrabold leading-[1.15] tracking-tight md:text-5xl">
            Size the model before you download it. Prove it before you ship it.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
            The definitive reference for setting up a local AI machine — Mac Mini, 24&nbsp;GB PC,
            multi-GPU homelab, 10-card clusters — and for deploying to Nebius AI Cloud. Hardware
            tiers, VRAM math, KV-cache growth, 2026 model cheat sheet, production commands.
          </p>
          <blockquote className="mt-6 max-w-2xl rounded-lg border border-ink bg-ink p-4 text-left text-canvas shadow-[4px_4px_0_rgba(31,31,31,0.25)]">
            <p className="font-mono text-sm font-bold tracking-tight">
              Total = Weights + KV-Cache + 2.0&nbsp;GB runtime. OOM when total &gt; usable VRAM.
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-widest text-canvas/60">
              If a sizing tool skips the KV-cache, it is guessing
            </p>
          </blockquote>
          <div className="mt-6 flex flex-wrap gap-3 text-xs font-bold">
            <Link
              href="/new"
              className="btn-dark min-h-[44px] cursor-pointer rounded-lg px-5 py-2.5 transition-all hover:-translate-y-px"
            >
              Run a Hardware Sizing Audit →
            </Link>
            <a
              href="#vram-math"
              className="panel min-h-[44px] cursor-pointer rounded-lg border border-ink px-5 py-2.5 transition-all hover:-translate-y-px"
            >
              Jump to the Sizing Math
            </a>
          </div>
          <p className="mt-4 font-mono text-[11px] text-muted">
            Scope: Apple Silicon (Metal/MLX) · PC DDR4/DDR5 offload · RTX 3060–6000 Ada · 2–10 GPU
            tensor-parallel · Nebius L40S / A100 / H100 / H200 / 8×H100
          </p>
        </div>
      </section>

      {/* Body with sticky sub-nav */}
      <div className="mx-auto grid max-w-5xl gap-8 px-6 py-10 lg:grid-cols-[240px_1fr]">
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
            <div className="mt-4 border-t border-ink/20 pt-3 font-mono text-[11px] leading-relaxed text-muted">
              <p>SLA: P95 ≤ 2000ms · ≥85% · ≤5%</p>
              <p className="mt-1">Total = W + KV + 2.0GB</p>
            </div>
          </nav>
        </aside>

        <div className="min-w-0 space-y-10">
          {/* 01 */}
          <section id="why-gpuproof" aria-label="Why GPUProof Exists" className="scroll-mt-24">
            <SectionHeading
              num="01"
              eyebrow="Why GPUProof Exists — Beyond ChatGPT & Leaderboard Guesses"
              title="Benchmarks score knowledge. Production breaks on memory."
            />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Public benchmarks (MMLU, GSM8K) and generic chatbot advice share three defects: they
              assume batch size 1, they ignore the KV-cache entirely, and they hallucinate memory
              numbers. A model that scores 82% on MMLU at batch 1 still dies with CUDA OOM at batch
              16 when five teammates hit the same endpoint.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <article className="panel rounded-lg border border-ink p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
                  Failure 1 · Batch-1 fiction
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Leaderboards run one prompt at a time. Production runs concurrent streams. The
                  KV-cache scales linearly with concurrency — batch 1 hides 90%+ of real memory.
                </p>
              </article>
              <article className="panel rounded-lg border border-ink p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
                  Failure 2 · Missing KV-cache
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Weights are static. KV-cache is dynamic and often larger than weights at long
                  context. Any estimate of the form &ldquo;params × bytes&rdquo; alone understates
                  VRAM by 10–40&nbsp;GB.
                </p>
              </article>
              <article className="panel rounded-lg border border-ink p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
                  Failure 3 · Hallucinated GB
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Chat assistants quote round numbers (&ldquo;70B needs ~140&nbsp;GB&rdquo;) without
                  stating precision, context length, or concurrency. FP16 vs INT4 is a 4× difference.
                </p>
              </article>
            </div>

            <div className="mt-4 rounded-lg border border-ink bg-ink p-5 text-canvas">
              <p className="text-[11px] font-bold uppercase tracking-widest text-canvas/60">
                The real pain
              </p>
              <ul className="mt-2 space-y-2 text-[12px] leading-relaxed text-canvas/85">
                <li>
                  <span className="font-bold text-canvas">40&nbsp;GB download → CUDA OOM.</span> You
                  pull a 70B FP16 checkpoint overnight, load it, and die at the first 8K-context
                  request. Weights fit. Weights + KV-cache + CUDA context do not.
                </li>
                <li>
                  <span className="font-bold text-canvas">Over-rented cloud GPU.</span> You pay H100
                  rates for a 32B workload that fits an L40S in FP8 with correct
                  max-model-len — 2.4× overspend per hour, compounding across replicas.
                </li>
              </ul>
              <p className="mt-3 border-t border-canvas/20 pt-3 text-[12px] leading-relaxed text-canvas/85">
                <span className="font-bold">How GPUProof solves it:</span> deterministic hardware
                sizing (weights + KV-cache + 2.0&nbsp;GB runtime vs usable VRAM at stated
                precision, context, and concurrency) plus mathematical verification — every audit
                replays a seeded workload twin and mints a hash-verifiable certificate.
              </p>
            </div>
          </section>

          {/* 02 */}
          <section
            id="hardware-spectrum"
            aria-label="The Complete Hardware Spectrum"
            className="scroll-mt-24 border-t border-ink pt-10"
          >
            <SectionHeading
              num="02"
              eyebrow="The Complete Hardware Spectrum"
              title="From Mac Mini to 8×H100 — one sizing model"
            />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Every tier below reduces to the same inequality: weights + KV-cache + runtime must fit
              usable memory. What changes is what &ldquo;usable&rdquo; means and how fast overflow
              paths run.
            </p>

            <h3 className="mt-6 text-sm font-extrabold uppercase tracking-widest">
              A · Apple Silicon unified memory (Metal / MLX)
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              CPU and GPU share one high-bandwidth memory bus — no PCIe copy between system RAM and
              VRAM. The GPU can address nearly the whole pool, which makes large models loadable but
              not necessarily fast. macOS reserves ~20–25% for WindowServer, kernel, and apps.
            </p>
            <Formula>usable_mac_gb = vram_gb × 0.75 – 0.80 (unless wired-memory flags tuned)</Formula>
            <div className="mt-3 overflow-hidden rounded-lg border border-ink">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="bg-ink font-mono text-[11px] uppercase tracking-widest text-canvas">
                    <th className="px-4 py-3">Machine</th>
                    <th className="px-4 py-3">Pool</th>
                    <th className="px-4 py-3">Usable ≈</th>
                    <th className="px-4 py-3">Practical envelope</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/20 bg-[#F5F1E9]">
                  <tr>
                    <td className="px-4 py-3 font-bold">Mac Mini M2 / M4</td>
                    <td className="px-4 py-3 font-mono">16 GB</td>
                    <td className="px-4 py-3 font-mono">~12 GB</td>
                    <td className="px-4 py-3 text-muted">8B INT4 single-user; 12B tight</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">Mac Mini M2 / M4</td>
                    <td className="px-4 py-3 font-mono">24 GB</td>
                    <td className="px-4 py-3 font-mono">~18 GB</td>
                    <td className="px-4 py-3 text-muted">20–27B INT4 single-user (§03 worked example)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">MacBook Pro</td>
                    <td className="px-4 py-3 font-mono">36 / 48 GB</td>
                    <td className="px-4 py-3 font-mono">~27 / ~36 GB</td>
                    <td className="px-4 py-3 text-muted">30–38B INT4/FP8; 70B INT4 needs 48GB+ tier</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">MacBook Pro Max</td>
                    <td className="px-4 py-3 font-mono">64 / 128 GB</td>
                    <td className="px-4 py-3 font-mono">~48 / ~96 GB</td>
                    <td className="px-4 py-3 text-muted">70B INT4 comfortable; 120B INT4 at 128GB</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">Mac Studio</td>
                    <td className="px-4 py-3 font-mono">128 / 192 GB</td>
                    <td className="px-4 py-3 font-mono">~96 / ~144 GB</td>
                    <td className="px-4 py-3 text-muted">70B FP16 (≈140GB) needs 192GB tier; 123B INT4 fits</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="mt-8 text-sm font-extrabold uppercase tracking-widest">
              B · PC workstations &amp; system RAM offload
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              DDR4/DDR5 system RAM tiers: 16 / 24 / 32 / 64 / 128&nbsp;GB. When VRAM overflows,
              GGUF / llama.cpp offloads layers to CPU RAM. It runs — at ~2–5 tokens/sec vs 60+
              tok/s on dedicated VRAM — because every token crosses PCIe/RAM bandwidth instead of
              HBM. Offload is a fallback for solo prototyping, never a latency SLA strategy.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="panel rounded-lg border border-ink p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
                  Rule of thumb
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  If more than ~25% of layers spill to CPU, expect 10–30× slowdown and P95 far above
                  2,000&nbsp;ms. Size for VRAM-fit; treat offload as &ldquo;loads, but slow.&rdquo;
                </p>
              </div>
              <div className="panel rounded-lg border border-ink p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
                  When offload is correct
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Offline batch summarization, confidential single-user drafts, overnight evals —
                  anywhere throughput, not interactivity, is the constraint.
                </p>
              </div>
            </div>

            <h3 className="mt-8 text-sm font-extrabold uppercase tracking-widest">
              C · Consumer &amp; homelab GPUs
            </h3>
            <div className="mt-3 overflow-hidden rounded-lg border border-ink">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="bg-ink font-mono text-[11px] uppercase tracking-widest text-canvas">
                    <th className="px-4 py-3">Card(s)</th>
                    <th className="px-4 py-3">VRAM</th>
                    <th className="px-4 py-3">Usable (×0.95)</th>
                    <th className="px-4 py-3">Envelope</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/20 bg-[#F5F1E9]">
                  <tr>
                    <td className="px-4 py-3 font-bold">RTX 3060 / 4070</td>
                    <td className="px-4 py-3 font-mono">12 GB</td>
                    <td className="px-4 py-3 font-mono">~11.4 GB</td>
                    <td className="px-4 py-3 text-muted">8–12B INT4; 20B tight</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">RTX 4080</td>
                    <td className="px-4 py-3 font-mono">16 GB</td>
                    <td className="px-4 py-3 font-mono">~15.2 GB</td>
                    <td className="px-4 py-3 text-muted">20–22B INT4 single-user</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">RTX 3090 / 4090</td>
                    <td className="px-4 py-3 font-mono">24 GB</td>
                    <td className="px-4 py-3 font-mono">~22.8 GB</td>
                    <td className="px-4 py-3 text-muted">27–32B INT4; 70B needs TP</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">RTX 6000 Ada</td>
                    <td className="px-4 py-3 font-mono">48 GB</td>
                    <td className="px-4 py-3 font-mono">~45.6 GB</td>
                    <td className="px-4 py-3 text-muted">32–38B FP8; 70B INT4</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">Dual RTX 3090</td>
                    <td className="px-4 py-3 font-mono">48 GB</td>
                    <td className="px-4 py-3 font-mono">~45.6 GB pool</td>
                    <td className="px-4 py-3 text-muted">70B INT4 sharded (TP=2)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">Quad RTX 3090</td>
                    <td className="px-4 py-3 font-mono">96 GB</td>
                    <td className="px-4 py-3 font-mono">~91 GB pool</td>
                    <td className="px-4 py-3 text-muted">70B FP8 / 123B INT4 (TP=4)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">8× RTX 4090</td>
                    <td className="px-4 py-3 font-mono">192 GB</td>
                    <td className="px-4 py-3 font-mono">~182 GB pool</td>
                    <td className="px-4 py-3 text-muted">120–123B FP8; long-context 70B</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Formula>Weight per GPU = Weights_total / N  —  tensor parallelism (TP=N) shards each layer across N cards</Formula>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Example: 70B INT4 = ~35&nbsp;GB total → TP=10 gives ~3.5&nbsp;GB weights per card;
              70B FP16 = ~140&nbsp;GB → TP=10 gives ~14&nbsp;GB per card before KV-cache. §03 works
              the full per-card budget including KV-cache and the 2.0&nbsp;GB runtime reserve.
            </p>

            <h3 className="mt-8 text-sm font-extrabold uppercase tracking-widest">
              D · Nebius AI Cloud GPUs (production fleet)
            </h3>
            <div className="mt-3 overflow-hidden rounded-lg border border-ink">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="bg-ink font-mono text-[11px] uppercase tracking-widest text-canvas">
                    <th className="px-4 py-3">GPU</th>
                    <th className="px-4 py-3">VRAM / BW</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Best for</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/20 bg-[#F5F1E9]">
                  <tr>
                    <td className="px-4 py-3 font-bold">
                      L40S 48GB Ada
                    </td>
                    <td className="px-4 py-3 font-mono">48 GB · 864 GB/s</td>
                    <td className="px-4 py-3 font-mono font-bold">$1.35/hr</td>
                    <td className="px-4 py-3 text-muted">
                      Sweet spot for 14–32B in FP8; 38B FP8 single-user
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">A100 80GB SXM4</td>
                    <td className="px-4 py-3 font-mono">80 GB · ~2 TB/s</td>
                    <td className="px-4 py-3 font-mono font-bold">$2.10/hr</td>
                    <td className="px-4 py-3 text-muted">Reliable 80GB enterprise classic; 70B INT4/FP8</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">H100 80GB SXM5</td>
                    <td className="px-4 py-3 font-mono">80 GB · 3.35 TB/s</td>
                    <td className="px-4 py-3 font-mono font-bold">$3.20/hr</td>
                    <td className="px-4 py-3 text-muted">
                      3.9× bandwidth vs L40S; collapses latency tails under concurrency
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">H200 141GB SXM5</td>
                    <td className="px-4 py-3 font-mono">141 GB · 4.8 TB/s</td>
                    <td className="px-4 py-3 font-mono font-bold">$3.95/hr</td>
                    <td className="px-4 py-3 text-muted">
                      70B+ FP16 or long-context 70–123B on one card
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">8× H100 SXM5 (NVLink)</td>
                    <td className="px-4 py-3 font-mono">640 GB · NVLink</td>
                    <td className="px-4 py-3 font-mono font-bold">$25.60/hr</td>
                    <td className="px-4 py-3 text-muted">
                      DeepSeek 685B MoE, high-traffic production APIs
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Policy: always certify on the cheapest tier that passes all three SLA gates; escalate
              L40S → H100/H200 only on diagnosed OOM with KV-cache evidence.
            </p>
          </section>

          {/* 03 */}
          <section
            id="vram-math"
            aria-label="The VRAM and KV-Cache Sizing Math"
            className="scroll-mt-24 border-t border-ink pt-10"
          >
            <SectionHeading
              num="03"
              eyebrow="The VRAM & KV-Cache Sizing Math"
              title="Three terms. One inequality. No guessing."
            />
            <Formula>Total (GB) = Weights (GB) + KV-Cache (GB) + 2.0 GB runtime — must be ≤ usable VRAM</Formula>

            <h3 className="mt-6 text-sm font-extrabold uppercase tracking-widest">
              Weights — parameters × bytes per parameter
            </h3>
            <Formula>Weights (GB) = Parameters (B) × Bytes Per Param</Formula>
            <div className="mt-3 overflow-hidden rounded-lg border border-ink">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="bg-ink font-mono text-[11px] uppercase tracking-widest text-canvas">
                    <th className="px-4 py-3">Precision</th>
                    <th className="px-4 py-3">Bytes / param</th>
                    <th className="px-4 py-3">70B example</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/20 bg-[#F5F1E9]">
                  <tr>
                    <td className="px-4 py-3 font-bold">FP16 / BF16</td>
                    <td className="px-4 py-3 font-mono">2.0</td>
                    <td className="px-4 py-3 font-mono">140.0 GB</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">FP8</td>
                    <td className="px-4 py-3 font-mono">1.0</td>
                    <td className="px-4 py-3 font-mono">70.0 GB</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">INT4 / AWQ / GGUF Q4</td>
                    <td className="px-4 py-3 font-mono">0.5</td>
                    <td className="px-4 py-3 font-mono">35.0 GB</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="mt-6 text-sm font-extrabold uppercase tracking-widest">
              Dynamic KV-cache — the term everyone omits
            </h3>
            <Formula>
              KV-Cache (GB) = (2 × layers × hidden_size × context_len × concurrency ×
              precision_bytes) / 10^9
            </Formula>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Factor 2 = keys + values per layer. Every concurrent user (or parallel stream)
              multiplies the cache linearly: double the users, double the KV-cache. Precision bytes
              follow the same table as weights (FP16 2.0, FP8 1.0, INT4 0.5).
            </p>

            <h3 className="mt-6 text-sm font-extrabold uppercase tracking-widest">
              Runtime overhead — 2.0 GB, always
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              CUDA context plus vLLM PagedAttention block tables reserve ~2.0&nbsp;GB before a single
              token is generated. Budgets that omit it pass simulation and OOM in production at
              95%+ saturation.
            </p>

            <div className="mt-4 rounded-lg border border-ink bg-ink p-5 text-canvas">
              <p className="text-[11px] font-bold uppercase tracking-widest text-canvas/60">
                Active-user impact — why 1 user fits and 5 users OOM
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-canvas/85">
                Weights are fixed; KV-cache grows with concurrency. A Mac Mini or RTX 3090 that
                serves one developer smoothly can crash the moment five teammates send simultaneous
                requests — same model, same precision, 5× KV-cache. Size for peak concurrency, not
                idle single-user.
              </p>
            </div>

            <h3 className="mt-6 text-sm font-extrabold uppercase tracking-widest">Worked examples</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <article className="panel rounded-lg border border-ink p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
                  27B on Mac Mini 24GB (INT4)
                </p>
                <p className="mt-2 font-mono text-[12px] leading-relaxed">
                  Weights = 27 × 0.5 = 13.5 GB
                  <br />
                  + runtime 2.0 GB → 15.5 GB base
                  <br />
                  1 user: KV ≈ 4.0 GB → total ≈ 19.5 GB ✓ fits
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  At 5 users KV-cache reaches ~24.5&nbsp;GB on top of weights — total exceeds usable
                  ~18&nbsp;GB and the system forces CPU swap (2–5 tok/s). Fix: drop context,
                  serialize users, or move to a 48&nbsp;GB tier.
                </p>
              </article>
              <article className="panel rounded-lg border border-ink p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
                  70B on 10× 24GB GPUs (TP=10)
                </p>
                <p className="mt-2 font-mono text-[12px] leading-relaxed">
                  FP16 weights 140 GB / 10 = 14.00 GB/card
                  <br />
                  KV + runtime share ≈ 3.07 GB/card
                  <br />≈ 17.07 GB per card ✓ fits
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  22.8&nbsp;GB usable per 24&nbsp;GB card → ~6.9&nbsp;GB headroom per card for
                  context bursts. TP=10 turns an impossible single-card load into a comfortable
                  sharded deployment.
                </p>
              </article>
            </div>

            <Code title="sizing.py · the full check GPUProof runs per candidate">
{`def fits(params_b, bytes_per_param, layers, hidden, ctx, users, vram_gb, usable=0.95):
    weights = params_b * bytes_per_param
    kv = 2 * layers * hidden * ctx * users * bytes_per_param / 1e9
    total = weights + kv + 2.0  # runtime: CUDA + PagedAttention tables
    return total <= vram_gb * usable, round(total, 2)

# 27B INT4, 1 user, Mac Mini 24GB (usable ~18GB): fits at ~19.5GB w/ tuned reserve
# same config, 5 users: KV ~24.5GB -> total over usable -> CPU swap / OOM`}
            </Code>
          </section>

          {/* 04 */}
          <section
            id="model-lineup"
            aria-label="2026 Popular Model Lineup and Hardware Cheat Sheet"
            className="scroll-mt-24 border-t border-ink pt-10"
          >
            <SectionHeading
              num="04"
              eyebrow="2026 Popular Model Lineup & Hardware Cheat Sheet"
              title="Sixteen models. Minimum viable hardware each."
            />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Minimum local hardware = single-developer, INT4-class quantization, 4K context unless
              noted. Recommended Nebius GPU = the cheapest tier that clears weights + KV-cache + 2GB
              runtime with headroom for 8–16 concurrent streams. Raise precision or context →
              re-run the §03 math.
            </p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-ink">
              <table className="w-full min-w-[760px] text-left text-[12px]">
                <thead>
                  <tr className="bg-ink font-mono text-[11px] uppercase tracking-widest text-canvas">
                    <th className="px-4 py-3">Model</th>
                    <th className="px-4 py-3">Params</th>
                    <th className="px-4 py-3">Min local HW</th>
                    <th className="px-4 py-3">Min quant</th>
                    <th className="px-4 py-3">Nebius GPU</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/20 bg-[#F5F1E9]">
                  <tr>
                    <td className="px-4 py-3 font-bold">Llama 3.1 8B</td>
                    <td className="px-4 py-3 font-mono">8B</td>
                    <td className="px-4 py-3">Mac Mini 16GB / RTX 3060 12GB</td>
                    <td className="px-4 py-3 font-mono">INT4 (FP16 on 24GB)</td>
                    <td className="px-4 py-3 font-bold">L40S 48GB</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">Gemma 4 12B</td>
                    <td className="px-4 py-3 font-mono">12B</td>
                    <td className="px-4 py-3">Mac Mini 24GB / RTX 3060 12GB</td>
                    <td className="px-4 py-3 font-mono">INT4</td>
                    <td className="px-4 py-3 font-bold">L40S 48GB</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">gpt-oss 20B</td>
                    <td className="px-4 py-3 font-mono">20B</td>
                    <td className="px-4 py-3">Mac Mini 24GB / RTX 4090 24GB</td>
                    <td className="px-4 py-3 font-mono">INT4</td>
                    <td className="px-4 py-3 font-bold">L40S 48GB</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">Codestral 22B</td>
                    <td className="px-4 py-3 font-mono">22B</td>
                    <td className="px-4 py-3">Mac Mini 24GB / RTX 4090 24GB</td>
                    <td className="px-4 py-3 font-mono">INT4</td>
                    <td className="px-4 py-3 font-bold">L40S 48GB</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">Qwen 3.6 27B</td>
                    <td className="px-4 py-3 font-mono">27B</td>
                    <td className="px-4 py-3">Mac Mini 24GB / RTX 4090 24GB</td>
                    <td className="px-4 py-3 font-mono">INT4</td>
                    <td className="px-4 py-3 font-bold">L40S 48GB</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">Qwen3-Coder 30B</td>
                    <td className="px-4 py-3 font-mono">30B</td>
                    <td className="px-4 py-3">MacBook Pro 48GB / Dual 3090</td>
                    <td className="px-4 py-3 font-mono">INT4</td>
                    <td className="px-4 py-3 font-bold">L40S 48GB (FP8)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">Gemma 4 31B</td>
                    <td className="px-4 py-3 font-mono">31B</td>
                    <td className="px-4 py-3">MacBook Pro 48GB / Dual 3090</td>
                    <td className="px-4 py-3 font-mono">INT4</td>
                    <td className="px-4 py-3 font-bold">L40S 48GB (FP8)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">DeepSeek R1 32B</td>
                    <td className="px-4 py-3 font-mono">32B</td>
                    <td className="px-4 py-3">MacBook Pro 48GB / Dual 3090</td>
                    <td className="px-4 py-3 font-mono">INT4</td>
                    <td className="px-4 py-3 font-bold">L40S 48GB (FP8)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">GLM-5 32B</td>
                    <td className="px-4 py-3 font-mono">32B</td>
                    <td className="px-4 py-3">MacBook Pro 48GB / Dual 3090</td>
                    <td className="px-4 py-3 font-mono">INT4</td>
                    <td className="px-4 py-3 font-bold">L40S 48GB (FP8)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">DeepSeek V4 Flash 38B</td>
                    <td className="px-4 py-3 font-mono">38B</td>
                    <td className="px-4 py-3">MacBook Pro 64GB / Dual 3090</td>
                    <td className="px-4 py-3 font-mono">INT4 (FP8 on 48GB+)</td>
                    <td className="px-4 py-3 font-bold">L40S 48GB (FP8)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">Llama 3.3 70B</td>
                    <td className="px-4 py-3 font-mono">70B</td>
                    <td className="px-4 py-3">Mac Studio 128GB / Quad 3090</td>
                    <td className="px-4 py-3 font-mono">INT4</td>
                    <td className="px-4 py-3 font-bold">H200 141GB (FP16) · H100 (FP8)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">Llama 4 Scout 70B</td>
                    <td className="px-4 py-3 font-mono">70B</td>
                    <td className="px-4 py-3">Mac Studio 128GB / Quad 3090</td>
                    <td className="px-4 py-3 font-mono">INT4</td>
                    <td className="px-4 py-3 font-bold">H200 141GB (FP16) · H100 (FP8)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">Qwen 2.5 72B</td>
                    <td className="px-4 py-3 font-mono">72B</td>
                    <td className="px-4 py-3">Mac Studio 128GB / Quad 3090</td>
                    <td className="px-4 py-3 font-mono">INT4</td>
                    <td className="px-4 py-3 font-bold">H200 141GB (FP16) · H100 (FP8)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">gpt-oss 120B</td>
                    <td className="px-4 py-3 font-mono">120B</td>
                    <td className="px-4 py-3">Mac Studio 192GB / 8× 4090</td>
                    <td className="px-4 py-3 font-mono">INT4</td>
                    <td className="px-4 py-3 font-bold">H100 80GB (INT4/FP8)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">Mistral Large 123B</td>
                    <td className="px-4 py-3 font-mono">123B</td>
                    <td className="px-4 py-3">Mac Studio 192GB / 8× 4090</td>
                    <td className="px-4 py-3 font-mono">INT4</td>
                    <td className="px-4 py-3 font-bold">H200 141GB</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold">DeepSeek V4 Pro 685B MoE</td>
                    <td className="px-4 py-3 font-mono">685B MoE</td>
                    <td className="px-4 py-3">Not local — cluster only</td>
                    <td className="px-4 py-3 font-mono">FP8 (active ~37B)</td>
                    <td className="px-4 py-3 font-bold">8× H100 640GB NVLink</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              MoE note: DeepSeek V4 Pro totals 685B but activates a ~37B-equivalent expert subset per
              token — weights still must fit (FP8 ≈ 685&nbsp;GB → NVLink pool), while per-token
              compute tracks the active slice. Do not size MoE by active params alone.
            </p>
          </section>

          {/* 05 */}
          <section
            id="local-to-nebius"
            aria-label="Bridging Local Development to Nebius Cloud"
            className="scroll-mt-24 border-t border-ink pt-10"
          >
            <SectionHeading
              num="05"
              eyebrow="Bridging Local Development to Nebius Cloud"
              title="Prototype local. Produce on Nebius."
            />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <article className="panel rounded-lg border border-ink p-4">
                <p className="text-sm font-bold">Stay local when</p>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[12px] leading-relaxed text-muted">
                  <li>Single-developer prototyping, prompt iteration, offline drafts.</li>
                  <li>Confidential data that cannot leave the machine.</li>
                  <li>INT4 quality is acceptable and concurrency is 1–2 users.</li>
                  <li>No uptime or latency SLA is attached to the output.</li>
                </ul>
              </article>
              <article className="rounded-lg border border-ink bg-ink p-4 text-canvas">
                <p className="text-sm font-bold">Migrate to Nebius when</p>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[12px] leading-relaxed text-canvas/85">
                  <li>Multi-user concurrency (KV-cache exceeds local usable VRAM).</li>
                  <li>Low-latency SLA: P95 must hold under 2,000&nbsp;ms.</li>
                  <li>70B+ models, FP8/FP16 precision, or 8K+ context windows.</li>
                  <li>24/7 API availability with measured cost per 1K queries.</li>
                </ul>
              </article>
            </div>

            <Code title="production.sh · turnkey vLLM serve (certified pattern)">
{`vllm serve Qwen/Qwen3-32B-FP8 \\
  --dtype fp8 \\
  --max-model-len 8192 \\
  --gpu-memory-utilization 0.95 \\
  --tensor-parallel-size 1 \\
  --port 8000

# flags are load-bearing:
# --gpu-memory-utilization 0.95 matches pre-flight usable-VRAM math (5% fragmentation reserve)
# --max-model-len 8192 caps KV-cache before PagedAttention offload on the certified tier
# --dtype fp8 halves weights + KV vs BF16; re-certify before changing any flag`}
            </Code>

            <Code title="local.sh · same model on a Mac Mini / RTX workstation">
{`# MLX (Apple Silicon, unified memory)
mlx_lm.generate --model mlx-community/Qwen3-32B-4bit --max-tokens 512 --temp 0.2

# Ollama / llama.cpp (RTX + GGUF offload fallback)
ollama run qwen3:32b-instruct-q4_K_M
# or: llama-cli -m qwen3-32b-q4_k_m.gguf -c 4096 -n 512 --temp 0.2

# rule: local INT4 for drafts; Nebius FP8 for anything multi-user or SLA-bound`}
            </Code>
          </section>

          {/* 06 */}
          <section
            id="sla-failures"
            aria-label="Production SLAs and Failure Taxonomy"
            className="scroll-mt-24 border-t border-ink pt-10"
          >
            <SectionHeading
              num="06"
              eyebrow="Production SLAs & Failure Taxonomy"
              title="Three gates. Five failure modes. No discretion."
            />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              The policy engine is pure code — no LLM vote, no temperature, no retries-to-pass. A
              candidate ships only if all three gates pass on the same measured run.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="panel rounded-lg border border-ink border-l-4 border-l-ink p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
                  Gate 1 · Latency
                </p>
                <p className="mt-1 text-xl font-extrabold tracking-tight">P95 ≤ 2,000ms</p>
                <p className="mt-1 text-[12px] text-muted">
                  End-to-end on vLLM at certified batch × context. Bandwidth-bound tail.
                </p>
              </div>
              <div className="panel rounded-lg border border-ink border-l-4 border-l-ship p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
                  Gate 2 · Accuracy
                </p>
                <p className="mt-1 text-xl font-extrabold tracking-tight">AST/JSON ≥ 85%</p>
                <p className="mt-1 text-[12px] text-muted">
                  Tool-call AST match + strict JSON-schema validation. One bad key fails.
                </p>
              </div>
              <div className="panel rounded-lg border border-ink border-l-4 border-l-block p-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
                  Gate 3 · Reliability
                </p>
                <p className="mt-1 text-xl font-extrabold tracking-tight">Error ≤ 5%</p>
                <p className="mt-1 text-[12px] text-muted">
                  Any OOM, timeout, or schema failure counts. No sampling tricks.
                </p>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-ink">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="bg-ink font-mono text-[11px] uppercase tracking-widest text-canvas">
                    <th className="px-4 py-3">Failure</th>
                    <th className="px-4 py-3">Signature</th>
                    <th className="px-4 py-3">Fix</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/20 bg-[#F5F1E9]">
                  <tr>
                    <td className="px-4 py-3 font-mono font-bold">OOM_FATAL</td>
                    <td className="px-4 py-3 text-muted">CUDA OOM; KV-cache exceeded usable VRAM</td>
                    <td className="px-4 py-3 text-muted">Escalate tier, lower precision, or cut max-model-len</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-mono font-bold">LATENCY_BREACH</td>
                    <td className="px-4 py-3 text-muted">P95 tail over 2,000ms under concurrency</td>
                    <td className="px-4 py-3 text-muted">H100 bandwidth tier, cap streams, shorten context</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-mono font-bold">SCHEMA_VIOLATION</td>
                    <td className="px-4 py-3 text-muted">Valid JSON, wrong keys / types</td>
                    <td className="px-4 py-3 text-muted">Constrain grammar, re-validate against schema</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-mono font-bold">TOOL_MISFIRE</td>
                    <td className="px-4 py-3 text-muted">Wrong function or ungrounded args</td>
                    <td className="px-4 py-3 text-muted">Tighten tool spec, lower temp, add arg checks</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-mono font-bold">TRUNCATION</td>
                    <td className="px-4 py-3 text-muted">max-tokens cut mid-JSON</td>
                    <td className="px-4 py-3 text-muted">Raise max-tokens or shrink prompt context</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* 07 */}
          <section
            id="audit-fingerprint"
            aria-label="Reproducible Audit Fingerprint"
            className="scroll-mt-24 border-t border-ink pt-10"
          >
            <SectionHeading
              num="07"
              eyebrow="Reproducible Audit Fingerprint"
              title="Certifications an auditor can re-hash offline"
            />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Engineering leads and auditors do not accept screenshots of latency numbers — they
              accept digests. Every GPUProof certificate binds the seeded prompt set, the measured
              metrics payload, and the verdict into one FNV-1a hash. Change one token, one gate
              value, or one spend figure and the digest breaks. Replays on identical seeds must
              reproduce the twin digest; otherwise the run was not the certified workload.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <article className="panel rounded-lg border border-ink p-4">
                <p className="text-sm font-bold">Why it matters</p>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[12px] leading-relaxed text-muted">
                  <li>Proves the benchmark replayed the certified prompts — no silent substitution.</li>
                  <li>Blocks metric tampering: latency, accuracy, and spend are inside the hash.</li>
                  <li>Verifiable without GPUProof servers — pure offline Python.</li>
                </ul>
              </article>
              <article className="panel rounded-lg border border-ink p-4">
                <p className="text-sm font-bold">What is hashed</p>
                <p className="mt-2 font-mono text-[12px] leading-relaxed">
                  twin_digest + seed + request_count
                  <br />+ p95_ms + accuracy + error_rate
                  <br />+ gpu + precision + spend_usd
                </p>
              </article>
            </div>

            <Code title="verify.py · offline FNV-1a verification (no dependencies)">
{`def fnv1a(s: str) -> str:
    h = 0x811C9DC5
    for b in s.encode():
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"fnv1a:{h:06x}"

payload = "|".join([
    "twin:fnv1a:9d31bc", "seed:42", "reqs:200",
    "p95:1240", "acc:0.93", "err:0.02",
    "gpu:H100-80GB", "dtype:fp8", "spend:0.42",
])
print(fnv1a(payload))  # must equal certificate.digest
# match    -> evidence untampered, verdict stands
# mismatch -> prompts, metrics, or spend changed; reject`}
            </Code>

            <div className="mt-4 rounded-lg border border-ink bg-ink p-5 text-canvas">
              <p className="text-[11px] font-bold uppercase tracking-widest text-canvas/60">
                Handoff checklist
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-canvas/85">
                <li>Copy the serving command from the certificate — model, dtype, max-len pre-filled.</li>
                <li>Pin concurrency and context at or below certified values until a soak re-run.</li>
                <li>Budget from measured $/1K queries (audit spend ÷ replayed requests).</li>
                <li>Attach the digest + PDF so reviewers can re-hash evidence offline.</li>
              </ol>
              <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold">
                <Link
                  href="/new"
                  className="cursor-pointer rounded-lg bg-canvas px-5 py-2.5 text-ink transition-all hover:bg-white"
                >
                  Certify This Config →
                </Link>
                <Link
                  href="/dashboard"
                  className="cursor-pointer rounded-lg border border-canvas/40 px-5 py-2.5 text-canvas transition-colors hover:border-canvas"
                >
                  View Audit Portfolio
                </Link>
              </div>
            </div>
          </section>

          <p className="border-t border-ink pt-6 text-center text-[11px] uppercase tracking-widest text-muted">
            GPUProof Docs · Deterministic · Audit-grade · Local → Nebius
          </p>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
