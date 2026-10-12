"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusPill, TopNav } from "@/components/ui";

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
  return (<form onSubmit={go} className="mx-auto mt-8 max-w-2xl rounded-xl bg-ink p-4 text-left text-canvas sm:p-5">
    <p className="text-[11px] uppercase tracking-widest text-canvas/60">Pick a candidate model — 1 click</p>
    <div role="radiogroup" aria-label="Model preset" className="mt-3 grid gap-2 sm:grid-cols-3">
      {PRESETS.map((p) => {
        const selected = active === p.id;
        return (<button key={p.id} type="button" role="radio" aria-checked={selected}
          onClick={() => setActive(p.id)}
          className={`min-h-[44px] cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors ${selected ? "border-canvas bg-canvas text-ink" : "border-canvas/30 text-canvas hover:border-canvas/70"}`}>
          <span className="block text-sm font-bold" aria-hidden="true">{p.glyph} {p.label}</span>
          <span className={`block text-[11px] ${selected ? "text-ink/70" : "text-canvas/60"}`}>{p.sub}</span>
          <span className={`mt-1 block break-all font-mono text-[11px] ${selected ? "text-ink/70" : "text-canvas/50"}`}>{p.value || "any-model-id"}</span>
        </button>);
      })}
    </div>
    <label htmlFor="candidate" className="mt-3 block text-[11px] text-canvas/70">
      {active === "custom" ? "Type any Hugging Face model ID" : "Model ID (editable via Custom)"}
    </label>
    <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
      <input id="candidate" name="candidate_model"
        value={active === "custom" ? custom : chosen.value}
        onChange={(e) => { if (active === "custom") setCustom(e.target.value); }}
        readOnly={active !== "custom"}
        placeholder={active === "custom" ? "e.g. meta-llama/Llama-3-8B-Instruct" : undefined}
        className="min-h-[44px] w-full rounded border border-canvas/30 bg-transparent px-3 text-sm outline-none placeholder:text-canvas/40 focus:border-canvas" />
      <button type="submit" aria-label="Start hardware audit and certification with this model"
        className="min-h-[44px] shrink-0 cursor-pointer rounded bg-canvas px-5 py-2 text-sm font-bold text-ink transition-colors hover:bg-white">Start Hardware Audit &amp; Certification →</button>
    </div>
  </form>);
}

export default function Home() {
  return (<main>
    <TopNav />
    <section className="grid-cells relative px-6 pb-10 pt-14 text-center">
      <div className="chip inline-flex items-center gap-2 px-3 py-1 text-[11px]">
        <span>🏆 Nebius x NVIDIA Global AI Hackathon · Best Apps &amp; Agents Track</span>
      </div>
      <h1 className="mx-auto mt-6 max-w-3xl text-4xl leading-tight tracking-tight md:text-6xl">A New AI Model Just Released. Can Your GPU Stack Actually Run It?</h1>
      <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted">Teams want to switch to newer open-source models to cut cloud bills by 40% — but public benchmarks can&apos;t tell you if a model will trigger Out-Of-Memory (OOM) crashes, break your JSON schemas, or regress response times. GPUProof autonomously stress-tests candidate models on Nebius cloud GPUs so you know for sure before touching production.</p>
    </section>
    <section aria-label="Key metrics" className="border-y border-ink bg-ink px-6 py-8 text-canvas">
      <div className="mx-auto grid max-w-4xl gap-6 text-center sm:grid-cols-3">
        <div><p className="text-3xl font-bold tracking-tight md:text-4xl">38%</p><p className="mt-1 text-[11px] uppercase tracking-widest text-canvas/70">Average GPU Cost Reduction</p></div>
        <div><p className="text-3xl font-bold tracking-tight md:text-4xl">0%</p><p className="mt-1 text-[11px] uppercase tracking-widest text-canvas/70">Out-Of-Memory Surprises in Production</p></div>
        <div><p className="text-3xl font-bold tracking-tight md:text-4xl">100%</p><p className="mt-1 text-[11px] uppercase tracking-widest text-canvas/70">Deterministic Evidence, Never Vibes</p></div>
      </div>
    </section>
    <section aria-label="The 3 critical questions every AI team faces" className="px-6 py-12">
      <p className="text-center text-[11px] uppercase tracking-widest text-muted">The production dilemma</p>
      <h2 className="mx-auto mt-2 max-w-xl text-center text-2xl tracking-tight md:text-3xl">The 3 Critical Questions Every AI Team Faces</h2>
      <div className="mx-auto mt-8 grid max-w-4xl gap-4 text-left md:grid-cols-3">
        <article className="panel flex flex-col rounded-lg p-5 transition-shadow hover:shadow-[4px_4px_0_#1F1F1F]">
          <span aria-hidden="true" className="text-xl">💾</span>
          <h3 className="mt-3 text-sm font-bold leading-snug">Hardware &amp; VRAM Compatibility</h3>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">Will a 30B model fit in your 48GB L40S GPU, or will KV cache blow up with Out-Of-Memory (OOM) errors during peak concurrency?</p>
        </article>
        <article className="panel flex flex-col rounded-lg p-5 transition-shadow hover:shadow-[4px_4px_0_#1F1F1F]">
          <span aria-hidden="true" className="text-xl">🎯</span>
          <h3 className="mt-3 text-sm font-bold leading-snug">Output Quality &amp; Tool Calling</h3>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">Will aggressive 4-bit compression break your structured JSON schemas and function calls in production?</p>
        </article>
        <article className="panel flex flex-col rounded-lg p-5 transition-shadow hover:shadow-[4px_4px_0_#1F1F1F]">
          <span aria-hidden="true" className="text-xl">💵</span>
          <h3 className="mt-3 text-sm font-bold leading-snug">True Cloud Economics</h3>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">Will switching models actually reduce your cloud bill, or will latency regressions force you to provision more GPU instances?</p>
        </article>
      </div>
    </section>
    <section id="how-it-works" aria-label="How GPUProof works" className="scroll-mt-16 border-t border-ink px-6 py-12">
      <p className="text-center text-[11px] uppercase tracking-widest text-muted">What &quot;Running a Certification&quot; Actually Means</p>
      <h2 className="mx-auto mt-2 max-w-xl text-center text-2xl tracking-tight md:text-3xl">From guesswork to proof in three steps.</h2>
      <div className="mx-auto mt-8 grid max-w-4xl gap-4 text-left md:grid-cols-3">
        <article className="panel flex flex-col rounded-lg p-5 transition-shadow hover:shadow-[4px_4px_0_#1F1F1F]">
          <div className="flex items-center justify-between"><span aria-hidden="true" className="text-xl">◈</span><span className="text-[11px] font-bold text-muted">Step 1</span></div>
          <h3 className="mt-3 text-sm font-bold leading-snug">Your Production Twin</h3>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">We create a deterministic test set matching your real workloads (tool calling &amp; structured JSON).</p>
        </article>
        <article className="panel flex flex-col rounded-lg p-5 transition-shadow hover:shadow-[4px_4px_0_#1F1F1F]">
          <div className="flex items-center justify-between"><span aria-hidden="true" className="text-xl">⬢</span><span className="text-[11px] font-bold text-muted">Step 2</span></div>
          <h3 className="mt-3 text-sm font-bold leading-snug">Autonomous Stress-Testing on Nebius</h3>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">The NVIDIA Nemotron Ultra planner provisions isolated GPU containers on Nebius AI Cloud. It tests the most cost-effective GPU first (L40S). If it runs out of memory, it automatically diagnoses the issue, escalates to high-capacity hardware (H100), and tunes precision.</p>
        </article>
        <article className="panel flex flex-col rounded-lg p-5 transition-shadow hover:shadow-[4px_4px_0_#1F1F1F]">
          <div className="flex items-center justify-between"><span aria-hidden="true" className="text-xl">⬣</span><span className="text-[11px] font-bold text-muted">Step 3</span></div>
          <h3 className="mt-3 text-sm font-bold leading-snug">Evidence-Backed Decision (<StatusPill status="SHIP" /> or <StatusPill status="BLOCK" />)</h3>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">A deterministic policy engine checks measured latency, quality, and error rates against strict gates. If it passes, you receive an official <strong>SHIP</strong> certificate. If it risks breaking production, it is <strong>BLOCKED</strong>.</p>
        </article>
      </div>
    </section>
    <section aria-label="Test it yourself" className="grid-cells border-t border-ink px-6 py-12 text-center">
      <h2 className="mx-auto max-w-xl text-2xl tracking-tight md:text-3xl">Test It Yourself: Certify a Candidate Model</h2>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted">Choose a new model to stress-test against your production baseline (<code className="font-mono">Qwen3-8B on H100 FP8</code>):</p>
      <PresetPicker />
      <div className="mt-6">
        <Link href="/dashboard" className="cursor-pointer text-xs text-muted underline underline-offset-4 hover:text-ink">Or view already-certified audits → Audit Portfolio</Link>
      </div>
    </section>
    <section className="border-t border-ink px-6 py-10 text-center">
      <p className="text-[11px] leading-relaxed text-muted">Built with Nebius AI Cloud (Serverless Jobs + Token Factory) · NVIDIA Nemotron (Ultra 550B &amp; Nano 30B) · vLLM · Next.js · FastAPI</p>
    </section>
  </main>);
}
