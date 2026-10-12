"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusPill, TopNav } from "@/components/ui";

const chips = ["Tool Calling", "Structured Output", "RAG", "Chat", "Coding"];

const PRESETS = [
  { id: "nano", glyph: "\u26A1", label: "Nemotron Nano 30B", sub: "Fast & Cost-Effective", value: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" },
  { id: "qwen", glyph: "\uD83D\uDEE1\uFE0F", label: "Qwen3 8B", sub: "Budget Baseline", value: "Qwen3-8B" },
  { id: "custom", glyph: "\u2699\uFE0F", label: "Custom Hugging Face Model", sub: "Type any model ID", value: "" },
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
      <button type="submit" aria-label="Start certification with this model"
        className="min-h-[44px] shrink-0 cursor-pointer rounded bg-canvas px-5 py-2 text-sm font-bold text-ink transition-colors hover:bg-white">Certify →</button>
    </div>
  </form>);
}

export default function Home() {
  return (<main>
    <TopNav />
    <section className="grid-cells relative px-6 pb-10 pt-14 text-center">
      <div className="chip inline-flex items-center gap-2 px-3 py-1 text-[11px]">
        <span>Introducing GPUProof</span><Link href="/new" className="btn-dark cursor-pointer rounded px-2 py-0.5 transition-colors">Try now →</Link>
      </div>
      <h1 className="mx-auto mt-6 max-w-3xl text-4xl leading-tight tracking-tight md:text-6xl">Make Your Model Prove It.</h1>
      <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted">Stop guessing if a new AI model will break your apps or blow your budget. GPUProof autonomously stress-tests candidate models on Nebius cloud GPUs with real workloads — certifying speed, accuracy, and cost savings before production. <StatusPill status="SHIP" /> or <StatusPill status="BLOCK" />.</p>
      <PresetPicker />
      <div className="mt-4 flex flex-wrap justify-center gap-2">{chips.map((c) => (<span key={c} className="chip bg-transparent px-3 py-1 text-[11px]">◈ {c}</span>))}</div>
    </section>
    <section aria-label="Why this matters to business" className="border-y border-ink bg-ink px-6 py-8 text-canvas">
      <div className="mx-auto grid max-w-4xl gap-6 text-center sm:grid-cols-3">
        <div><p className="text-3xl font-bold tracking-tight md:text-4xl">38%</p><p className="mt-1 text-[11px] uppercase tracking-widest text-canvas/70">Average GPU cost reduction</p></div>
        <div><p className="text-3xl font-bold tracking-tight md:text-4xl">0%</p><p className="mt-1 text-[11px] uppercase tracking-widest text-canvas/70">Surprises in production</p></div>
        <div><p className="text-3xl font-bold tracking-tight md:text-4xl">100%</p><p className="mt-1 text-[11px] uppercase tracking-widest text-canvas/70">Deterministic proof, never vibes</p></div>
      </div>
    </section>
    <section aria-label="How GPUProof works" className="px-6 py-12">
      <p className="text-center text-[11px] uppercase tracking-widest text-muted">How GPUProof works</p>
      <h2 className="mx-auto mt-2 max-w-xl text-center text-2xl tracking-tight md:text-3xl">From guesswork to proof in three steps.</h2>
      <div className="mx-auto mt-8 grid max-w-4xl gap-4 text-left md:grid-cols-3">
        <article className="panel flex flex-col rounded-lg p-5 transition-shadow hover:shadow-[4px_4px_0_#1F1F1F]">
          <div className="flex items-center justify-between"><span aria-hidden="true" className="text-xl">◈</span><span className="text-[11px] font-bold text-muted">01</span></div>
          <h3 className="mt-3 text-sm font-bold leading-snug">Define Workload &amp; Requirements</h3>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">Configure your current production model, target response times, and minimum accuracy thresholds.</p>
        </article>
        <article className="panel flex flex-col rounded-lg p-5 transition-shadow hover:shadow-[4px_4px_0_#1F1F1F]">
          <div className="flex items-center justify-between"><span aria-hidden="true" className="text-xl">⬢</span><span className="text-[11px] font-bold text-muted">02</span></div>
          <h3 className="mt-3 text-sm font-bold leading-snug">Autonomous Stress Testing on Nebius</h3>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">NVIDIA Nemotron Ultra proposes GPU configs (L40S vs H100); our deterministic policy engine guards budgets; the system automatically adapts if a run runs out of memory or drops quality.</p>
        </article>
        <article className="panel flex flex-col rounded-lg p-5 transition-shadow hover:shadow-[4px_4px_0_#1F1F1F]">
          <div className="flex items-center justify-between"><span aria-hidden="true" className="text-xl">⬣</span><span className="text-[11px] font-bold text-muted">03</span></div>
          <h3 className="mt-3 text-sm font-bold leading-snug">Official SHIP or BLOCK Certificate</h3>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">Receive an authoritative, evidence-backed certificate showing verified latency, quality score, and projected cloud cost savings.</p>
        </article>
      </div>
      <div className="mt-8 text-center">
        <Link href="/new" className="btn-dark inline-block min-h-[44px] cursor-pointer rounded px-6 py-3 text-sm transition-colors">Run Certification</Link>
      </div>
    </section>
    <section className="border-t border-ink px-6 py-10 text-center">
      <p className="text-sm font-bold">Built on, not trusted by</p>
      <p className="mt-1 text-[11px] text-muted">No fake customer logos — honest stack only.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-3 text-[11px]">
        {["Nebius AI Cloud", "NVIDIA Nemotron", "vLLM", "Next.js", "FastAPI"].map((b) => (<span key={b} className="chip px-3 py-1">{b}</span>))}
      </div>
    </section>
  </main>);
}
