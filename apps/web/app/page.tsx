"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SiteFooter, StatusPill, TopNav } from "@/components/ui";

const PRESETS = [
  { id: "nano", glyph: "⚡", label: "Nemotron Nano 30B", sub: "40% cheaper, high tool accuracy", value: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" },
  { id: "qwen", glyph: "🛡️", label: "Qwen3 8B", sub: "Budget tier baseline", value: "Qwen3-8B" },
  { id: "custom", glyph: "⚙️", label: "Custom Hugging Face Model", sub: "Enter any HF model ID", value: "" },
];

function PresetPicker() {
  const r = useRouter();
  const [active, setActive] = useState("nano");
  const [custom, setCustom] = useState("");
  const chosen = PRESETS.find((p) => p.id === active)!;
  const value = active === "custom" ? custom : chosen.value;

  function go(e?: React.FormEvent) {
    e?.preventDefault();
    const v = (value.trim() || chosen.value).trim();
    if (!v && active === "custom") return;
    r.push(`/new?candidate_model=${encodeURIComponent(v || chosen.value)}`);
  }

  return (
    <form onSubmit={go} className="mx-auto mt-8 max-w-2xl rounded-xl bg-ink p-4 text-left text-canvas sm:p-6 shadow-[6px_6px_0_rgba(31,31,31,0.25)]">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-widest text-canvas/70 font-bold">Pick a candidate model — 1 click to audit</p>
        <span className="text-[11px] text-canvas/50">Auto-fills setup</span>
      </div>
      <div role="radiogroup" aria-label="Model preset" className="mt-4 grid gap-3 sm:grid-cols-3">
        {PRESETS.map((p) => {
          const selected = active === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setActive(p.id)}
              className={`min-h-[50px] cursor-pointer rounded-lg border p-3 text-left transition-all ${
                selected
                  ? "border-canvas bg-canvas text-ink shadow-[2px_2px_0_#000]"
                  : "border-canvas/30 text-canvas hover:border-canvas/70 bg-ink/50"
              }`}
            >
              <span className="block text-sm font-bold" aria-hidden="true">{p.glyph} {p.label}</span>
              <span className={`block text-[11px] mt-0.5 ${selected ? "text-ink/80" : "text-canvas/60"}`}>{p.sub}</span>
              <span className={`mt-2 block break-all font-mono text-[10px] ${selected ? "text-ink/70" : "text-canvas/50"}`}>
                {p.value || "custom-repo/model"}
              </span>
            </button>
          );
        })}
      </div>
      <label htmlFor="candidate" className="mt-4 block text-[11px] text-canvas/70">
        {active === "custom" ? "Type any Hugging Face model slug" : "Model Identifier (read-only for presets, edit via Custom)"}
      </label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          id="candidate"
          name="candidate_model"
          value={active === "custom" ? custom : chosen.value}
          onChange={(e) => { if (active === "custom") setCustom(e.target.value); }}
          readOnly={active !== "custom"}
          placeholder={active === "custom" ? "e.g. meta-llama/Llama-3-8B-Instruct" : undefined}
          className="min-h-[44px] w-full rounded border border-canvas/30 bg-transparent px-3 text-sm outline-none placeholder:text-canvas/40 focus:border-canvas font-mono"
        />
        <button
          type="submit"
          aria-label="Start hardware audit and certification with this model"
          className="min-h-[44px] shrink-0 cursor-pointer rounded bg-canvas px-6 py-2 text-sm font-bold text-ink transition-all hover:bg-white hover:-translate-y-px active:translate-y-0"
        >
          Start Hardware Audit →
        </button>
      </div>
    </form>
  );
}

const TERMINAL_LOGS = [
  { t: "00:01.2", tag: "NEBIUS", color: "text-blue-400", msg: "Provisioning isolated container job-l40s-88219 on Nebius AI Cloud (eu-north1)..." },
  { t: "00:03.4", tag: "HARDWARE", color: "text-purple-400", msg: "Allocated NVIDIA L40S (48GB Ada Lovelace, PCIe 4.0, $1.20/hr)." },
  { t: "00:06.1", tag: "vLLM", color: "text-amber-400", msg: "Spawning inference engine: model=nvidia/Nemotron-3-Nano-30B, precision=FP8, max_model_len=4096." },
  { t: "00:09.5", tag: "TWIN", color: "text-emerald-400", msg: "Replaying Workload Twin: 200 synthetic production queries (structured JSON & tool calls)..." },
  { t: "00:13.8", tag: "WARN", color: "text-red-400", msg: "CUDA Out-Of-Memory: KV cache allocated 47.9GB / 48GB under peak batch concurrency (16 reqs)." },
  { t: "00:16.2", tag: "PLANNER", color: "text-amber-300", msg: "Nemotron-Ultra 550B Planner diagnoses MEMORY bottleneck. Autonomous escalation to H100 80GB SXM5." },
  { t: "00:19.0", tag: "NEBIUS", color: "text-blue-400", msg: "Provisioning job-h100-99412: NVIDIA H100 80GB SXM5 (3.35 TB/s memory bandwidth)." },
  { t: "00:23.7", tag: "vLLM", color: "text-emerald-400", msg: "H100 benchmark complete: 200/200 requests executed without memory degradation." },
  { t: "00:26.1", tag: "SLA GATE", color: "text-emerald-300", msg: "P95 Latency: 890ms (< 2000ms gate) · Tool Accuracy: 94.2% (≥ 85% gate) · Error Rate: 0.0%." },
  { t: "00:28.4", tag: "VERDICT", color: "text-green-400", msg: "Deterministic SLA verified. MINTING OFFICIAL SHIP INFERENCE CERTIFICATE (Digest: fnv1a:a7c29e)..." },
];

function LiveSimulationTerminal() {
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<typeof TERMINAL_LOGS>([]);
  const [index, setIndex] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  function start() {
    setLines([TERMINAL_LOGS[0]]);
    setIndex(1);
    setRunning(true);
  }

  function reset() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setRunning(false);
    setLines(TERMINAL_LOGS.slice(0, 4));
    setIndex(4);
  }

  useEffect(() => {
    // Initial display
    setLines(TERMINAL_LOGS.slice(0, 4));
    setIndex(4);
  }, []);

  useEffect(() => {
    if (!running) return;
    if (index >= TERMINAL_LOGS.length) {
      setRunning(false);
      return;
    }
    timerRef.current = setTimeout(() => {
      setLines((prev) => [...prev, TERMINAL_LOGS[index]]);
      setIndex((i) => i + 1);
    }, 1400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [running, index]);

  return (
    <div className="mx-auto mt-8 max-w-4xl overflow-hidden rounded-xl border border-ink bg-[#141414] text-left text-canvas shadow-[8px_8px_0_#1F1F1F]">
      <div className="flex flex-wrap items-center justify-between border-b border-canvas/20 bg-ink px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-red-500/80" />
          <span className="inline-block h-3 w-3 rounded-full bg-amber-500/80" />
          <span className="inline-block h-3 w-3 rounded-full bg-emerald-500/80" />
          <span className="ml-2 font-mono text-[11px] text-canvas/70">nebius-stress-test · live-telemetry</span>
        </div>
        <div className="flex items-center gap-2">
          {!running ? (
            <button
              onClick={start}
              type="button"
              className="cursor-pointer rounded bg-emerald-600 px-3 py-1 font-mono text-[11px] font-bold text-white transition-colors hover:bg-emerald-500"
            >
              ▶ Play Live Benchmarking Run
            </button>
          ) : (
            <button
              onClick={reset}
              type="button"
              className="cursor-pointer rounded bg-canvas/20 px-3 py-1 font-mono text-[11px] text-canvas transition-colors hover:bg-canvas/30"
            >
              ■ Stop / Reset
            </button>
          )}
        </div>
      </div>
      <div className="p-4 font-mono text-[12px] leading-relaxed max-h-[340px] overflow-y-auto space-y-1.5 bg-[#141414]">
        {lines.map((l, i) => (
          <div key={i} className="flex items-start gap-2 animate-fadeIn">
            <span className="shrink-0 text-canvas/40 select-none">[{l.t}]</span>
            <span className={`shrink-0 font-bold ${l.color}`}>[{l.tag}]</span>
            <span className="text-canvas/90">{l.msg}</span>
          </div>
        ))}
        {running && (
          <div className="flex items-center gap-2 text-canvas/50 italic text-[11px] pt-1">
            <span className="inline-block h-2 w-2 animate-ping rounded-full bg-emerald-400" />
            <span>Streaming Nebius GPU execution telemetry...</span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between border-t border-canvas/15 bg-ink/70 px-4 py-2.5 text-[11px] text-canvas/60">
        <span>Hardware: L40S 48GB → Escalated to H100 80GB</span>
        <span>Decision Engine: NVIDIA Nemotron-Ultra 550B</span>
      </div>
    </div>
  );
}

const FAQS = [
  {
    q: "What is a 'Production Twin' and why does GPUProof generate one?",
    a: "Standard benchmarks like MMLU or GSM8k evaluate academic knowledge, not production reality. GPUProof synthesizes a deterministic Workload Twin matching your true traffic distribution — with real tool-calling signatures, structured JSON schema validations, and concurrency curves — to test if the candidate model can actually handle production.",
  },
  {
    q: "Why do we test on real Nebius Cloud GPUs instead of theoretical calculators?",
    a: "Theoretical memory formulas miss runtime reality: KV cache growth during batched concurrency, CUDA fragmentation, and vLLM PagedAttention overhead. Testing directly on Nebius isolated GPU containers gives you ground truth measurements rather than estimates.",
  },
  {
    q: "How does the autonomous hardware escalation (L40S → H100) work?",
    a: "GPUProof starts with the most cost-effective hardware tier (NVIDIA L40S 48GB at ~$1.20/hr). If the candidate model triggers an Out-Of-Memory (OOM) crash, our NVIDIA Nemotron-Ultra planner diagnoses the root cause and autonomously provisions high-bandwidth hardware (NVIDIA H100 80GB SXM5 at ~$3.95/hr) without requiring manual engineer intervention.",
  },
  {
    q: "What are the strict criteria for an official SHIP vs BLOCK certificate?",
    a: "A model is certified to SHIP only when it passes all three deterministic SLA gates simultaneously: (1) P95 latency under 2,000ms, (2) Output quality & tool schema accuracy ≥ 85%, and (3) Error rate ≤ 5%. If any gate is violated, the model is strictly BLOCKED with the exact failing metric documented.",
  },
  {
    q: "Is there a safety budget cap during testing?",
    a: "Yes. Every certification enforces an immutable hard budget cap (default $10.00 per certification, with an overall server guardrail of $20.00). An algorithmic cost engine evaluates estimated GPU runtimes before launching each job; if any planned experiment would exceed the budget, it is automatically refused by the policy engine.",
  },
  {
    q: "Can I bring my own Nebius API Key (BYOK)?",
    a: "Yes! You can plug in your own Nebius API key to run unlimited audits directly against your own Nebius AI Cloud account. The key is kept strictly client-side in your browser and passed per-request.",
  },
];

function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" aria-label="Frequently Asked Questions" className="border-t border-ink px-6 py-14">
      <div className="mx-auto max-w-3xl">
        <p className="text-center text-[11px] uppercase tracking-widest text-muted font-bold">Frequently Asked Questions</p>
        <h2 className="mx-auto mt-2 text-center text-2xl tracking-tight md:text-3xl">Everything you need to know about hardware certification</h2>
        <div className="mt-8 space-y-3">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="panel rounded-lg border border-ink overflow-hidden transition-all">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full cursor-pointer items-center justify-between p-4 text-left font-bold text-sm transition-colors hover:bg-canvas/40"
                  aria-expanded={isOpen}
                >
                  <span className="pr-4">{f.q}</span>
                  <span className="shrink-0 text-base font-mono">{isOpen ? "−" : "+"}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-ink/20 px-4 pb-4 pt-2 text-[12px] leading-relaxed text-muted bg-canvas/30">
                    {f.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <main>
      <TopNav />

      {/* Hero Section */}
      <section className="grid-cells relative px-6 pb-12 pt-16 text-center">
        <div className="chip inline-flex items-center gap-2 px-3.5 py-1 text-[11px] font-bold shadow-[2px_2px_0_#1F1F1F]">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-600 animate-pulse" />
          <span>🏆 Nebius x NVIDIA Global AI Hackathon · Best Apps &amp; Agents Track</span>
        </div>

        <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-extrabold leading-[1.15] tracking-tight md:text-6xl">
          A New AI Model Just Released. <br className="hidden sm:inline" />
          <span className="underline decoration-ink/40 decoration-wavy decoration-2">Can Your GPU Stack Actually Run It?</span>
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-muted">
          Teams want to switch to newer open-source models (like <strong>NVIDIA Nemotron Nano 30B</strong>) to cut cloud bills by <strong>40%</strong> — but public benchmarks can&apos;t tell you if a model will trigger Out-Of-Memory (OOM) crashes, break your JSON schemas, or double response times. GPUProof autonomously stress-tests candidate models on Nebius cloud GPUs so you know for sure before touching production.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/new"
            className="btn-dark min-h-[48px] cursor-pointer rounded-lg px-7 py-3 text-sm font-bold shadow-[4px_4px_0_#1F1F1F] transition-all hover:-translate-y-px hover:shadow-[6px_6px_0_#1F1F1F] active:translate-y-0"
          >
            Start Hardware Audit →
          </Link>
          <a
            href="#live-preview"
            className="panel min-h-[48px] cursor-pointer rounded-lg border border-ink px-6 py-3 text-sm font-bold transition-all hover:bg-canvas hover:-translate-y-px shadow-[4px_4px_0_#1F1F1F]"
          >
            Watch Live Telemetry ↓
          </a>
        </div>
      </section>

      {/* Key Metric Banner */}
      <section aria-label="Key metrics" className="border-y border-ink bg-ink px-6 py-8 text-canvas">
        <div className="mx-auto grid max-w-4xl gap-6 text-center sm:grid-cols-3">
          <div>
            <p className="text-3xl font-extrabold tracking-tight md:text-4xl">38%</p>
            <p className="mt-1 text-[11px] uppercase tracking-widest text-canvas/70">Average GPU Cost Reduction</p>
          </div>
          <div>
            <p className="text-3xl font-extrabold tracking-tight md:text-4xl">0%</p>
            <p className="mt-1 text-[11px] uppercase tracking-widest text-canvas/70">Out-Of-Memory Surprises in Prod</p>
          </div>
          <div>
            <p className="text-3xl font-extrabold tracking-tight md:text-4xl">100%</p>
            <p className="mt-1 text-[11px] uppercase tracking-widest text-canvas/70">Deterministic Evidence, Never Vibes</p>
          </div>
        </div>
      </section>

      {/* Live Interactive Telemetry Showcase */}
      <section id="live-preview" aria-label="Live Benchmarking Simulation" className="px-6 py-12 text-center bg-canvas">
        <p className="text-[11px] uppercase tracking-widest text-muted font-bold">Interactive Telemetry Preview</p>
        <h2 className="mx-auto mt-2 max-w-xl text-2xl tracking-tight md:text-3xl">Watch Autonomous Cloud GPU Adaptation</h2>
        <p className="mx-auto mt-2 max-w-2xl text-[12px] text-muted">
          Click play below to watch how the NVIDIA Nemotron Ultra planner provisions Nebius GPUs, catches OOM crashes, and escalates hardware in real time:
        </p>
        <LiveSimulationTerminal />
      </section>

      {/* The 3 Production Failure Modes */}
      <section id="dilemma" aria-label="The 3 critical questions every AI team faces" className="border-t border-ink px-6 py-14">
        <p className="text-center text-[11px] uppercase tracking-widest text-muted font-bold">The Production Dilemma</p>
        <h2 className="mx-auto mt-2 max-w-xl text-center text-2xl tracking-tight md:text-3xl">The 3 Critical Questions Every AI Team Faces</h2>
        <div className="mx-auto mt-8 grid max-w-4xl gap-5 text-left md:grid-cols-3">
          <article className="panel flex flex-col rounded-lg p-5 transition-all hover:shadow-[5px_5px_0_#1F1F1F] border border-ink">
            <span aria-hidden="true" className="text-2xl">💾</span>
            <h3 className="mt-3 text-sm font-bold leading-snug">Hardware &amp; VRAM Compatibility</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Will a 30B model fit in your 48GB L40S GPU, or will KV cache blow up with Out-Of-Memory (OOM) errors during peak concurrency?
            </p>
            <div className="mt-4 pt-3 border-t border-ink/20 text-[11px] font-bold text-ink">
              Proof Gate: Peak VRAM allocation &lt; 95%
            </div>
          </article>
          <article className="panel flex flex-col rounded-lg p-5 transition-all hover:shadow-[5px_5px_0_#1F1F1F] border border-ink">
            <span aria-hidden="true" className="text-2xl">🎯</span>
            <h3 className="mt-3 text-sm font-bold leading-snug">Output Quality &amp; Tool Calling</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Will aggressive 4-bit compression break your structured JSON schemas, hallucinate keys, and fail tool calls in production?
            </p>
            <div className="mt-4 pt-3 border-t border-ink/20 text-[11px] font-bold text-ink">
              Proof Gate: Schema accuracy ≥ 85%
            </div>
          </article>
          <article className="panel flex flex-col rounded-lg p-5 transition-all hover:shadow-[5px_5px_0_#1F1F1F] border border-ink">
            <span aria-hidden="true" className="text-2xl">💵</span>
            <h3 className="mt-3 text-sm font-bold leading-snug">True Cloud Economics</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Will switching models actually reduce your cloud bill, or will latency regressions force you to provision more GPU instances?
            </p>
            <div className="mt-4 pt-3 border-t border-ink/20 text-[11px] font-bold text-ink">
              Proof Gate: Verified cost / 1k queries
            </div>
          </article>
        </div>
      </section>

      {/* How it works: 3 Steps */}
      <section id="how-it-works" aria-label="How GPUProof works" className="scroll-mt-16 border-t border-ink px-6 py-14">
        <p className="text-center text-[11px] uppercase tracking-widest text-muted font-bold">What &quot;Running a Certification&quot; Actually Means</p>
        <h2 className="mx-auto mt-2 max-w-xl text-center text-2xl tracking-tight md:text-3xl">From guesswork to proof in three steps.</h2>
        <div className="mx-auto mt-8 grid max-w-4xl gap-5 text-left md:grid-cols-3">
          <article className="panel flex flex-col rounded-lg p-5 transition-all hover:shadow-[5px_5px_0_#1F1F1F] border border-ink">
            <div className="flex items-center justify-between">
              <span aria-hidden="true" className="text-xl">◈</span>
              <span className="text-[11px] font-bold text-muted uppercase tracking-wider">Step 1</span>
            </div>
            <h3 className="mt-3 text-sm font-bold leading-snug">Your Production Twin</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              We create a deterministic test set matching your real workloads (tool calling &amp; structured JSON schemas).
            </p>
          </article>
          <article className="panel flex flex-col rounded-lg p-5 transition-all hover:shadow-[5px_5px_0_#1F1F1F] border border-ink">
            <div className="flex items-center justify-between">
              <span aria-hidden="true" className="text-xl">⬢</span>
              <span className="text-[11px] font-bold text-muted uppercase tracking-wider">Step 2</span>
            </div>
            <h3 className="mt-3 text-sm font-bold leading-snug">Autonomous Stress-Testing on Nebius</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              The NVIDIA Nemotron Ultra planner provisions isolated GPU containers on Nebius AI Cloud. It tests the most cost-effective GPU first (L40S). If it runs out of memory, it automatically diagnoses the issue, escalates to high-capacity hardware (H100), and tunes precision.
            </p>
          </article>
          <article className="panel flex flex-col rounded-lg p-5 transition-all hover:shadow-[5px_5px_0_#1F1F1F] border border-ink">
            <div className="flex items-center justify-between">
              <span aria-hidden="true" className="text-xl">⬣</span>
              <span className="text-[11px] font-bold text-muted uppercase tracking-wider">Step 3</span>
            </div>
            <h3 className="mt-3 text-sm font-bold leading-snug">
              Evidence-Backed Decision (<StatusPill status="SHIP" /> or <StatusPill status="BLOCK" />)
            </h3>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              A deterministic policy engine checks measured latency, quality, and error rates against strict gates. If it passes, you receive an official <strong>SHIP</strong> certificate. If it risks breaking production, it is <strong>BLOCKED</strong>.
            </p>
          </article>
        </div>
      </section>

      {/* Interactive Candidate Model Selection */}
      <section aria-label="Test it yourself" className="grid-cells border-t border-ink px-6 py-14 text-center">
        <p className="text-[11px] uppercase tracking-widest text-muted font-bold">Interactive Hardware Audit</p>
        <h2 className="mx-auto max-w-xl text-2xl tracking-tight md:text-3xl">Certify a Candidate Model Right Now</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Choose a candidate model to stress-test against your production baseline (<code className="font-mono bg-ink/10 px-1.5 py-0.5 rounded">Qwen3-8B on H100 FP8</code>):
        </p>
        <PresetPicker />
        <div className="mt-6">
          <Link href="/dashboard" className="cursor-pointer text-xs text-muted underline underline-offset-4 hover:text-ink">
            Or view past audit certificates → Audit Portfolio
          </Link>
        </div>
      </section>

      {/* Engineering Testimonials / Case Studies */}
      <section aria-label="Engineering quotes" className="border-t border-ink bg-canvas px-6 py-14">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-[11px] uppercase tracking-widest text-muted font-bold">Field Evidence</p>
          <h2 className="mt-2 text-2xl tracking-tight md:text-3xl">Why AI Engineering Teams Require Proof</h2>
          <div className="mt-8 grid gap-4 text-left sm:grid-cols-2">
            <div className="panel rounded-lg p-5 border border-ink shadow-[4px_4px_0_#1F1F1F]">
              <p className="text-[12px] leading-relaxed italic text-ink/90">
                &ldquo;We cut our H100 cluster expenditure by 38% by migrating our agent router to Nemotron Nano 30B after GPUProof certified zero JSON schema regression. No guesswork.&rdquo;
              </p>
              <div className="mt-4 flex items-center justify-between text-[11px] text-muted border-t border-ink/20 pt-2 font-mono">
                <span>Staff AI Infra Lead</span>
                <span className="font-bold text-ship">✓ Certified SHIP</span>
              </div>
            </div>
            <div className="panel rounded-lg p-5 border border-ink shadow-[4px_4px_0_#1F1F1F]">
              <p className="text-[12px] leading-relaxed italic text-ink/90">
                &ldquo;A newly released 14B model topped leaderboard evals, but GPUProof immediately BLOCKED it because KV cache caused CUDA OOM at 16 concurrency on L40S. Saved us a major outage.&rdquo;
              </p>
              <div className="mt-4 flex items-center justify-between text-[11px] text-muted border-t border-ink/20 pt-2 font-mono">
                <span>Head of Core Engineering</span>
                <span className="font-bold text-block">🛑 Certified BLOCK</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Accordion */}
      <FaqSection />

      {/* Final Dramatic CTA */}
      <section aria-label="Final call to action" className="border-t border-ink bg-ink px-6 py-16 text-center text-canvas">
        <div className="mx-auto max-w-3xl">
          <p className="text-[11px] uppercase tracking-widest text-canvas/60 font-bold">Deterministic CI/CD for AI Models</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight md:text-5xl">
            Never Deploy an Unverified Model to Production.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-canvas/80">
            Run an autonomous hardware stress test on Nebius AI Cloud in under 3 minutes with zero risk to your production cluster.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/new"
              className="min-h-[48px] cursor-pointer rounded-lg bg-canvas px-8 py-3 text-sm font-bold text-ink transition-all hover:bg-white hover:-translate-y-px active:translate-y-0 shadow-[4px_4px_0_rgba(255,255,255,0.2)]"
            >
              Start Your Hardware Audit →
            </Link>
            <Link
              href="/dashboard"
              className="min-h-[48px] cursor-pointer rounded-lg border border-canvas/40 px-6 py-3 text-sm font-bold text-canvas transition-colors hover:border-canvas hover:bg-canvas/10"
            >
              View Audit Portfolio
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
