"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SiteFooter, StatusPill, TopNav } from "@/components/ui";
import { ModelAdvisorFab } from "@/components/ModelAdvisorDrawer";
import HardwareProfiler from "@/components/HardwareProfiler";

const PRESETS = [
  { id: "qwen27b", glyph: "⚡", label: "Qwen 3.6 27B", sub: "Most downloaded open-weight; runs on single 24GB GPU", value: "Qwen/Qwen3.6-27B-Instruct" },
  { id: "deepseek-v4", glyph: "🧠", label: "DeepSeek V4 Pro", sub: "Reasoning king · MIT · 80.6% SWE-bench Verified", value: "deepseek-ai/DeepSeek-V4-Pro" },
  { id: "llama4", glyph: "🦙", label: "Llama 4 Scout", sub: "10M context window on single high-end GPU", value: "meta-llama/Llama-4-Scout" },
  { id: "gemma4", glyph: "💎", label: "Gemma 4 31B", sub: "Google Apache 2.0 · Best single-GPU all-rounder", value: "google/gemma-4-31b-it" },
  { id: "gpt-oss", glyph: "🍎", label: "gpt-oss 20B", sub: "OpenAI open weights · Fast on 16GB Mac Mini", value: "openai/gpt-oss-20b" },
  { id: "codestral", glyph: "💻", label: "Codestral 2501", sub: "Mistral Apache 2.0 · IDE autocomplete standard", value: "mistralai/Codestral-2501" },
  { id: "custom", glyph: "⚙️", label: "Bring Any Model", sub: "Paste ANY Hugging Face URL or ID", value: "" },
];

function PresetPicker() {
  const r = useRouter();
  const [active, setActive] = useState("qwen27b");
  const [custom, setCustom] = useState("");
  const chosen = PRESETS.find((p) => p.id === active) || PRESETS[0];
  const value = active === "custom" ? custom : chosen.value;

  function go(e?: React.FormEvent) {
    e?.preventDefault();
    const raw = (value.trim() || chosen.value).trim();
    if (!raw && active === "custom") return;
    // Extract clean HF repo id if URL was entered
    const clean = raw
      .replace(/^(?:https?:\/\/)?(?:www\.)?(?:huggingface\.co|hf\.co)\//i, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
    const parts = clean.split("/").filter(Boolean);
    const resolved =
      parts.length >= 2
        ? parts[0] === "models" && parts.length >= 3
          ? `${parts[1]}/${parts[2]}`
          : `${parts[0]}/${parts[1]}`
        : clean;
    r.push(`/new?candidate_model=${encodeURIComponent(resolved || chosen.value)}`);
  }

  return (
    <form onSubmit={go} className="mx-auto mt-8 max-w-2xl rounded-xl bg-ink p-4 text-left text-canvas sm:p-6 shadow-[6px_6px_0_rgba(31,31,31,0.25)]">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-widest text-canvas/70 font-bold">Pick a candidate model — 1 click to audit</p>
        <span className="text-[11px] text-canvas/50">Auto-fills setup</span>
      </div>
      <HardwareProfiler compact />
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
        {active === "custom" ? "Bring ANY model: Paste Hugging Face URL or repo slug" : "Model Identifier (read-only for presets, edit via Custom)"}
      </label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          id="candidate"
          name="candidate_model"
          value={active === "custom" ? custom : chosen.value}
          onChange={(e) => { if (active === "custom") setCustom(e.target.value); }}
          readOnly={active !== "custom"}
          placeholder={active === "custom" ? "e.g. https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct" : undefined}
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

function DatacenterEngraving() {
  return (
    <svg
      viewBox="0 0 600 392"
      role="img"
      aria-label="Pen-and-ink engraving of a Nebius GPU datacenter cluster"
      className="w-full h-auto text-ink"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* plate frame */}
      <rect x="8" y="8" width="584" height="376" strokeWidth="1.5" />
      <rect x="15" y="15" width="570" height="362" strokeWidth="0.75" opacity="0.4" />
      <path d="M8 30 V8 H30 M570 8 H592 V30 M592 362 V384 H570 M30 384 H8 V362" strokeWidth="2" />
      {/* sun */}
      <g>
        <circle cx="508" cy="66" r="22" strokeWidth="1.5" />
        <circle cx="508" cy="66" r="15.5" strokeWidth="1" opacity="0.7" />
        <circle cx="508" cy="66" r="2.4" fill="currentColor" stroke="none" />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * Math.PI) / 6;
          const x1 = 508 + Math.cos(a) * 26;
          const y1 = 66 + Math.sin(a) * 26;
          const x2 = 508 + Math.cos(a) * 33;
          const y2 = 66 + Math.sin(a) * 33;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="1.1" />;
        })}
      </g>
      {/* clouds */}
      <g strokeWidth="1.25">
        <path d="M52 100 c8-14 28-16 36-6 c6-8 22-8 26 2 c10-4 24 2 22 12 c-2 8-12 10-22 10 H70 c-12 0-22-8-18-18 Z" />
        <path d="M404 54 c6-10 22-12 28-4 c5-6 18-6 21 2 c8-3 19 1 17 9 c-1 6-9 8-17 8 h-35 c-9 0-17-7-14-15 Z" />
      </g>
      {/* birds */}
      <g strokeWidth="1.4">
        <path d="M140 62 q6-6 12 0 q6-6 12 0" />
        <path d="M172 48 q5-5 10 0 q5-5 10 0" />
        <path d="M208 70 q5-5 10 0 q5-5 10 0" />
        <path d="M252 50 q4-4 8 0 q4-4 8 0" />
        <path d="M332 76 q5-5 10 0 q5-5 10 0" />
      </g>

      {/* main hall */}
      <g>
        {/* stepped platform */}
        <rect x="110" y="290" width="380" height="10" strokeWidth="1.5" fill="currentColor" fillOpacity="0.04" />
        <rect x="124" y="280" width="352" height="10" strokeWidth="1.5" fill="currentColor" fillOpacity="0.04" />
        <rect x="138" y="270" width="324" height="10" strokeWidth="1.5" fill="currentColor" fillOpacity="0.06" />
        {/* hall body */}
        <rect x="150" y="150" width="300" height="120" strokeWidth="1.75" fill="#EFEBE4" />
        {/* roof */}
        <path d="M136 150 L300 96 L464 150 Z" strokeWidth="1.75" fill="#EFEBE4" />
        <path d="M170 150 L300 114 L430 150" strokeWidth="1" opacity="0.8" />
        {/* pediment labels */}
        <text x="300" y="138" textAnchor="middle" fontSize="11.5" fontWeight="800" letterSpacing="1.6" stroke="none" fill="currentColor" fontFamily="monospace">
          NEBIUS · GPU CLUSTER
        </text>
        <text x="300" y="148" textAnchor="middle" fontSize="7.5" letterSpacing="2.2" stroke="none" fill="currentColor" opacity="0.7" fontFamily="monospace">
          EU-NORTH1 · DETERMINISTIC
        </text>
        {/* 6 rack bays */}
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const x = 162 + i * 48;
          return (
            <g key={i}>
              <rect x={x} y={162} width={36} height={96} strokeWidth="1.2" fill="#EFEBE4" />
              {[0, 1, 2, 3, 4].map((r) => (
                <g key={r}>
                  <rect x={x + 4} y={168 + r * 17} width={28} height={11} strokeWidth="0.9" />
                  <line x1={x + 7} y1={173.5 + r * 17} x2={x + 21} y2={173.5 + r * 17} strokeWidth="0.8" opacity="0.7" />
                  <circle cx={x + 28} cy={173.5 + r * 17} r={1.5} fill="currentColor" stroke="none" opacity={r === 2 ? 0.95 : 0.5} />
                </g>
              ))}
            </g>
          );
        })}
        {/* roof power emblem — clean mast + bolt */}
        <g strokeWidth="1.5">
          <line x1="300" y1="76" x2="300" y2="92" />
          <circle cx="300" cy="74" r="1.8" fill="currentColor" stroke="none" />
          <path d="M303 88 L293 102 H299 L296 112 L308 97 H302 L305 88 Z" fill="currentColor" fillOpacity="0.12" />
        </g>
      </g>

      {/* left annex */}
      <g strokeWidth="1.5">
        <rect x="52" y="212" width="80" height="58" fill="#EFEBE4" />
        <path d="M48 212 L92 190 L136 212 Z" fill="#EFEBE4" />
        <rect x="62" y="224" width="14" height="12" strokeWidth="1" />
        <rect x="81" y="224" width="14" height="12" strokeWidth="1" />
        <rect x="100" y="224" width="14" height="12" strokeWidth="1" />
        <rect x="80" y="242" width="24" height="28" strokeWidth="1.1" />
        <line x1="92" y1="242" x2="92" y2="270" strokeWidth="0.9" />
      </g>
      {/* right annex */}
      <g strokeWidth="1.5">
        <rect x="468" y="212" width="80" height="58" fill="#EFEBE4" />
        <path d="M464 212 L508 190 L552 212 Z" fill="#EFEBE4" />
        <rect x="478" y="224" width="14" height="12" strokeWidth="1" />
        <rect x="497" y="224" width="14" height="12" strokeWidth="1" />
        <rect x="516" y="224" width="14" height="12" strokeWidth="1" />
        <rect x="496" y="242" width="24" height="28" strokeWidth="1.1" />
        <line x1="508" y1="242" x2="508" y2="270" strokeWidth="0.9" />
      </g>

      {/* short horizontal conduits — no diagonal crossing */}
      <g strokeWidth="1.1" opacity="0.85">
        <line x1="132" y1="258" x2="150" y2="258" />
        <line x1="450" y1="258" x2="468" y2="258" />
        <circle cx="141" cy="258" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="459" cy="258" r="1.6" fill="currentColor" stroke="none" />
      </g>

      {/* side labels — below annexes, clear of art */}
      <g fontFamily="monospace" stroke="none" fill="currentColor">
        <rect x="30" y="276" width="124" height="26" fill="#EFEBE4" stroke="none" />
        <rect x="446" y="276" width="138" height="26" fill="#EFEBE4" stroke="none" />
        <text x="92" y="287" textAnchor="middle" fontSize="9.5" fontWeight="800" letterSpacing="0.3">L40S 48GB · ADA</text>
        <text x="92" y="297" textAnchor="middle" fontSize="7.5" opacity="0.7" letterSpacing="0.8">$1.20/HR · ENTRY</text>
        <text x="515" y="287" textAnchor="middle" fontSize="9.5" fontWeight="800" letterSpacing="0.3">H100 80GB SXM5</text>
        <text x="515" y="297" textAnchor="middle" fontSize="7.5" opacity="0.7" letterSpacing="0.8">3.35 TB/S · ESCALATION</text>
      </g>
      {/* label leader ticks */}
      <g strokeWidth="1.1">
        <line x1="92" y1="270" x2="92" y2="276" />
        <line x1="508" y1="270" x2="508" y2="276" />
        <circle cx="92" cy="272" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="508" cy="272" r="1.4" fill="currentColor" stroke="none" />
      </g>

      {/* bottom readout */}
      <g fontFamily="monospace" stroke="none" fill="currentColor">
        <text x="300" y="328" fontSize="9" textAnchor="middle" letterSpacing="1.6" opacity="0.85">P95 890MS · TOOL ACC 94.2% · ERR 0.0%</text>
      </g>
      {/* dimension line */}
      <g strokeWidth="1">
        <line x1="150" y1="344" x2="450" y2="344" />
        <path d="M150 340 v8 M450 340 v8" />
        <path d="M150 344 l12-3.5 v7 Z M450 344 l-12-3.5 v7 Z" fill="currentColor" stroke="none" />
        <text x="300" y="360" textAnchor="middle" fontSize="8.5" letterSpacing="2.2" stroke="none" fill="currentColor" fontFamily="monospace" opacity="0.8">
          48GB → 80GB · AUTONOMOUS ESCALATION
        </text>
      </g>
      {/* ground hatching — symmetric, below labels */}
      <g strokeWidth="0.9" opacity="0.55">
        <line x1="30" y1="310" x2="110" y2="310" />
        <line x1="40" y1="316" x2="100" y2="316" />
        <line x1="490" y1="310" x2="570" y2="310" />
        <line x1="500" y1="316" x2="560" y2="316" />
      </g>
    </svg>
  );
}

export default function Home() {
  return (
    <main>
      <TopNav />

      {/* Hero — Editorial Split 2-Column (Titan reference) */}
      <section className="grid grid-cols-1 lg:grid-cols-2 border-b border-ink/20 min-h-[580px]">
        {/* Left Column */}
        <div className="p-8 sm:p-12 lg:p-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-ink/20 text-left">
          <Link href="/#how-it-works" className="inline-flex items-center gap-2 group w-fit">
            <span className="rounded-full bg-amber-500/15 border border-amber-600/30 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
              NEW
            </span>
            <span className="text-[12px] text-ink/80 group-hover:underline">
              Nebius x NVIDIA Global AI Hackathon · Best Apps &amp; Agents Track ▸
            </span>
          </Link>

          <div className="my-8">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.08] text-ink">
              Make your model<br />
              prove it on<br />
              real hardware.
            </h1>
            <div className="mt-8 flex flex-wrap items-center gap-6">
              <Link
                href="/new"
                className="rounded-full bg-ink px-8 py-3.5 text-xs font-bold uppercase tracking-widest text-canvas shadow-[3px_3px_0_rgba(31,31,31,0.25)] transition-all hover:bg-black hover:-translate-y-px active:translate-y-0"
              >
                Start Hardware Audit →
              </Link>
              <a
                href="#how-it-works"
                className="text-xs font-bold uppercase tracking-wider text-ink transition-colors hover:text-muted inline-flex items-center gap-1.5"
              >
                <span>See how it works</span>
                <span aria-hidden="true">▸</span>
              </a>
            </div>
          </div>

          <div className="pt-6 border-t border-ink/10 flex items-end justify-between gap-4">
            <p className="max-w-md text-[13px] leading-relaxed text-muted font-mono">
              The deterministic CI/CD pipeline for AI models. Built for the era of open-source model acceleration.
            </p>
            <a
              href="#live-preview"
              aria-label="Scroll to live preview"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink/30 text-ink/70 hover:border-ink hover:text-ink transition-colors"
            >
              ↓
            </a>
          </div>
        </div>

        {/* Right Column */}
        <div className="p-8 sm:p-12 lg:p-16 flex flex-col justify-between text-left bg-canvas gap-10">
          <div className="flex-1 flex items-center">
            <DatacenterEngraving />
          </div>
          <div className="pt-8 border-t border-ink/20">
            <div className="grid grid-cols-3 gap-6">
              <div>
                <p className="text-[11px] text-muted uppercase tracking-wider">Average GPU Cost Cut</p>
                <p className="mt-1 text-3xl sm:text-4xl font-extrabold tracking-tight text-ink">38%</p>
              </div>
              <div>
                <p className="text-[11px] text-muted uppercase tracking-wider">Out-Of-Memory Surprises</p>
                <p className="mt-1 text-3xl sm:text-4xl font-extrabold tracking-tight text-ink">0%</p>
              </div>
              <div>
                <p className="text-[11px] text-muted uppercase tracking-wider">Deterministic Evidence</p>
                <p className="mt-1 text-3xl sm:text-4xl font-extrabold tracking-tight text-ink">100%</p>
              </div>
            </div>
            <div className="mt-6 flex items-center gap-1.5 text-[11px] text-muted">
              <span>ⓘ</span>
              <Link href="/docs" className="underline hover:text-ink">See SLA Policy &amp; Gate Disclosures</Link>
            </div>
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

      {/* How it works: 3-Step Connected Pipeline */}
      <section id="how-it-works" aria-label="How GPUProof works" className="scroll-mt-16 border-t border-ink px-6 py-14">
        <p className="text-center text-[11px] uppercase tracking-widest text-muted font-bold">How It Works</p>
        <h2 className="mx-auto mt-2 max-w-2xl text-center text-2xl tracking-tight md:text-3xl">How It Works: Three Steps From Guesswork To Proof</h2>
        <p className="mx-auto mt-3 max-w-xl text-center font-mono text-[12px] leading-relaxed text-muted">
          Follow the data left → right: twin it, stress it, certify it.
        </p>
        <div className="relative mx-auto mt-10 max-w-5xl">
          {/* Dotted pipeline connector — desktop data-flow line */}
          <div aria-hidden="true" className="pointer-events-none absolute left-[18%] right-[18%] top-[26px] hidden md:block">
            <div className="border-t-2 border-dotted border-ink/30" />
            <span className="absolute -top-[13px] left-[31%] flex h-6 w-6 items-center justify-center rounded-full border border-ink bg-canvas text-[12px] font-bold leading-none">
              →
            </span>
            <span className="absolute -top-[13px] left-[66%] flex h-6 w-6 items-center justify-center rounded-full border border-ink bg-canvas text-[12px] font-bold leading-none">
              →
            </span>
            <span className="absolute -top-[3px] left-1/2 h-[6px] w-[6px] -translate-x-1/2 rounded-full bg-emerald-600 animate-pulse" />
          </div>
          <div className="relative grid gap-5 text-left md:grid-cols-3">
            <article className="panel group relative flex flex-col rounded-lg border border-ink p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-[4px_4px_0_#1F1F1F]">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-ink bg-ink text-canvas transition-transform duration-200 group-hover:scale-105">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                </div>
                <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">Step 01</span>
              </div>
              <h3 className="mt-4 text-sm font-bold leading-snug">01 / Shadow Workload Twin</h3>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                Replays your actual JSON schemas, tool calls, and concurrency curves.
              </p>
              <div className="mt-4 border-t border-ink/20 pt-3 font-mono text-[11px] font-bold text-ink/70">
                Input → Twin JSON
              </div>
            </article>
            <article className="panel group relative flex flex-col rounded-lg border border-ink p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-[4px_4px_0_#1F1F1F]">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-ink bg-ink text-canvas transition-transform duration-200 group-hover:scale-105">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <rect x="9" y="9" width="6" height="6" />
                    <line x1="9" y1="1" x2="9" y2="4" />
                    <line x1="15" y1="1" x2="15" y2="4" />
                    <line x1="9" y1="20" x2="9" y2="23" />
                    <line x1="15" y1="20" x2="15" y2="23" />
                    <line x1="20" y1="9" x2="23" y2="9" />
                    <line x1="20" y1="14" x2="23" y2="14" />
                    <line x1="1" y1="9" x2="4" y2="9" />
                    <line x1="1" y1="14" x2="4" y2="14" />
                  </svg>
                </div>
                <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">Step 02</span>
              </div>
              <h3 className="mt-4 text-sm font-bold leading-snug">02 / Autonomous Cloud Stress-Test</h3>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                Tests L40S 48GB first. If it OOMs, the Nemotron-Ultra planner auto-escalates to H100 80GB SXM5.
              </p>
              <div className="mt-4 border-t border-ink/20 pt-3 font-mono text-[11px] font-bold text-ink/70">
                L40S 48GB → H100 80GB
              </div>
            </article>
            <article className="panel group relative flex flex-col rounded-lg border border-ink p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-[4px_4px_0_#1F1F1F]">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-ink bg-ink text-canvas transition-transform duration-200 group-hover:scale-105">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <polyline points="9 12 11 14 15 10" />
                  </svg>
                </div>
                <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">Step 03</span>
              </div>
              <h3 className="mt-4 text-sm font-bold leading-snug">03 / Deterministic Certification</h3>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                Automated SLA verification mints an official SHIP or BLOCK certificate.
              </p>
              <div className="mt-4 flex items-center gap-2 border-t border-ink/20 pt-3">
                <StatusPill status="SHIP" /> <span className="text-[11px] text-muted">or</span> <StatusPill status="BLOCK" />
              </div>
            </article>
          </div>
          {/* Mobile flow hint */}
          <p aria-hidden="true" className="mt-4 text-center font-mono text-[11px] text-muted md:hidden">
            ↓ follows top → bottom on mobile ↓
          </p>
        </div>
      </section>

      {/* Interactive Candidate Model Selection */}
      <section id="candidate-picker" aria-label="Test it yourself" className="grid-cells scroll-mt-16 border-t border-ink px-6 py-14 text-center">
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
      <ModelAdvisorFab />
    </main>
  );
}
