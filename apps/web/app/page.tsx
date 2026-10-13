"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SiteFooter, TopNav } from "@/components/ui";

/* ————————————————————————————————————————————————
   Interactive Hardware Sizing Widget
   Pure client-side math, zero waiting. Same formulas
   as the audit engine: weights + KV-cache + 2GB runtime.
   ———————————————————————————————————————————————— */

type WidgetModel = {
  id: string;
  label: string;
  slug: string;
  paramsB: number;
  layers: number;
  hidden: number;
  blurb: string;
};

const WIDGET_MODELS: WidgetModel[] = [
  { id: "qwen27", label: "Qwen 3.6 27B", slug: "Qwen/Qwen3.6-27B-Instruct", paramsB: 27, layers: 64, hidden: 5120, blurb: "Single-GPU friendly" },
  { id: "llama70", label: "Llama 3.3 70B", slug: "meta-llama/Llama-3.3-70B-Instruct", paramsB: 70, layers: 80, hidden: 8192, blurb: "Needs multi-GPU / cloud" },
  { id: "ds38", label: "DeepSeek V4 Flash 38B", slug: "deepseek-ai/DeepSeek-V4-Flash", paramsB: 38, layers: 48, hidden: 5120, blurb: "Reasoning value pick" },
  { id: "glm32", label: "GLM-5 32B", slug: "THUDM/glm-5-32b", paramsB: 32, layers: 64, hidden: 5120, blurb: "Agent tool-calling" },
  { id: "gptoss20", label: "gpt-oss 20B", slug: "openai/gpt-oss-20b", paramsB: 20, layers: 48, hidden: 4096, blurb: "Fits 16GB Mac Mini" },
  { id: "codestral22", label: "Codestral 22B", slug: "mistralai/Codestral-22B-v0.1", paramsB: 22, layers: 56, hidden: 6144, blurb: "IDE code completion" },
  { id: "gemma31", label: "Gemma 4 31B", slug: "google/gemma-4-31b-it", paramsB: 31, layers: 62, hidden: 5376, blurb: "All-round single GPU" },
];

type HwGroup = "Apple Silicon" | "Local PC / Homelab" | "Nebius Cloud";
type HwTarget = {
  key: string;
  label: string;
  gb: number;
  group: HwGroup;
  note: string;
  priceHr?: number;
  factor: number;
};

const HW_TARGETS: HwTarget[] = [
  { key: "mini16", label: "Mac Mini 16GB", gb: 16, group: "Apple Silicon", note: "Unified memory", factor: 1 },
  { key: "mini24", label: "Mac Mini 24GB", gb: 24, group: "Apple Silicon", note: "Unified memory", factor: 1 },
  { key: "mbp36", label: "MacBook Pro 36GB", gb: 36, group: "Apple Silicon", note: "M-series Pro/Max", factor: 1 },
  { key: "mbp64", label: "MacBook Pro 64GB", gb: 64, group: "Apple Silicon", note: "M-series Max", factor: 1.05 },
  { key: "mbp128", label: "MacBook Pro 128GB", gb: 128, group: "Apple Silicon", note: "M-series Ultra", factor: 1.05 },
  { key: "studio128", label: "Mac Studio 128GB", gb: 128, group: "Apple Silicon", note: "Desktop Ultra", factor: 1.1 },
  { key: "studio192", label: "Mac Studio 192GB", gb: 192, group: "Apple Silicon", note: "Max unified memory", factor: 1.1 },
  { key: "pc24", label: "PC 24GB RAM", gb: 24, group: "Local PC / Homelab", note: "CPU offload · slow", factor: 0.5 },
  { key: "rtx4090", label: "RTX 4090 24GB", gb: 24, group: "Local PC / Homelab", note: "Single discrete GPU", factor: 1.6 },
  { key: "dual3090", label: "Dual RTX 3090 48GB", gb: 48, group: "Local PC / Homelab", note: "2× 24GB · TP=2", factor: 1.4 },
  { key: "quad3090", label: "Quad RTX 3090 96GB", gb: 96, group: "Local PC / Homelab", note: "4× 24GB · TP=4", factor: 1.4 },
  { key: "tenx", label: "Custom 10× GPUs", gb: 240, group: "Local PC / Homelab", note: "10× 24GB · TP=10", factor: 1.3 },
  { key: "l40s", label: "1× L40S 48GB", gb: 48, group: "Nebius Cloud", note: "$1.35/hr · value tier", priceHr: 1.35, factor: 2.2 },
  { key: "h100", label: "1× H100 80GB", gb: 80, group: "Nebius Cloud", note: "$3.20/hr · flagship", priceHr: 3.2, factor: 3.2 },
  { key: "h100x8", label: "8× H100 640GB", gb: 640, group: "Nebius Cloud", note: "$25.60/hr · cluster", priceHr: 25.6, factor: 3.2 },
];

const USER_OPTIONS = [
  { n: 1, label: "1 User", sub: "Personal developer testing" },
  { n: 5, label: "5 Users", sub: "Small team / internal tool" },
  { n: 25, label: "25 Users", sub: "Production customer API" },
];

const CLOUD_TIERS = [
  { label: "1× L40S 48GB", gb: 48, price: 1.35, tp: 1, perf: 1.0 },
  { label: "1× H100 80GB", gb: 80, price: 3.2, tp: 1, perf: 2.6 },
  { label: "8× H100 640GB", gb: 640, price: 25.6, tp: 8, perf: 4.5 },
];

const CTX_TOKENS = 4096;
const RUNTIME_GB = 2.0;
const TOKENS_PER_QUERY = 500;

function estimateParamsFromSlug(slug: string): number {
  const m = slug.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  if (m) {
    const v = parseFloat(m[1]);
    if (v >= 1 && v <= 800) return v;
  }
  return 30;
}

function r1(n: number) {
  return Math.round(n * 10) / 10;
}

function SizingWidget() {
  const [modelId, setModelId] = useState("qwen27");
  const [customSlug, setCustomSlug] = useState("");
  const [hwKey, setHwKey] = useState("mini24");
  const [users, setUsers] = useState(1);
  const [copied, setCopied] = useState(false);

  const useCustom = customSlug.trim().length > 0;
  const base = WIDGET_MODELS.find((m) => m.id === modelId) ?? WIDGET_MODELS[0];
  const model: WidgetModel = useCustom
    ? (() => {
        const paramsB = estimateParamsFromSlug(customSlug.trim());
        return {
          id: "custom",
          label: customSlug.trim(),
          slug: customSlug.trim(),
          paramsB,
          layers: Math.round(28 + paramsB * 0.7),
          hidden: paramsB >= 60 ? 8192 : paramsB >= 25 ? 5120 : 4096,
          blurb: "Custom slug · arch estimated",
        };
      })()
    : base;
  const hw = HW_TARGETS.find((h) => h.key === hwKey) ?? HW_TARGETS[1];

  const math = useMemo(() => {
    const wFp16 = model.paramsB * 2;
    const wFp8 = model.paramsB * 1;
    const wInt4 = model.paramsB * 0.5;
    // KV-cache (FP16): 2 (K+V) × layers × hidden × ctx × users × 2 bytes
    const kvPerUser = (2 * model.layers * model.hidden * CTX_TOKENS * 2) / 1e9;
    const kv = kvPerUser * users;
    const tFp16 = wFp16 + kv + RUNTIME_GB;
    const tFp8 = wFp8 + kv + RUNTIME_GB;
    const tInt4 = wInt4 + kv + RUNTIME_GB;
    const fitsFp16 = tFp16 <= hw.gb;
    const fitsInt4 = tInt4 <= hw.gb;
    const localTokps = Math.max(
      2,
      Math.min(65, Math.round((55 / Math.pow(model.paramsB / 8, 0.7)) * hw.factor))
    );
    // Sweet-spot Nebius tier: cheapest tier that holds the FP8 production footprint.
    const tier =
      CLOUD_TIERS.find((t) => tFp8 <= t.gb) ?? CLOUD_TIERS[CLOUD_TIERS.length - 1];
    const baseTokps = 1600 / model.paramsB;
    const prodTokps = Math.round(baseTokps * tier.perf);
    const qph = (prodTokps * 3600) / TOKENS_PER_QUERY;
    const costPer1k = qph > 0 ? (tier.price / (qph / 1000)) : 0;
    const vllm = `python -m vllm.entrypoints.openai.api_server --model ${model.slug} --tensor-parallel-size ${tier.tp} --quantization fp8 --max-model-len 4096 --gpu-memory-utilization 0.95 --port 8000`;
    return { wFp16, wFp8, wInt4, kvPerUser, kv, tFp16, tFp8, tInt4, fitsFp16, fitsInt4, localTokps, tier, prodTokps, costPer1k, vllm };
  }, [model, hw, users]);

  const auditHref = `/new?candidate_model=${encodeURIComponent(model.slug)}`;

  async function copyVllm() {
    try {
      await navigator.clipboard.writeText(math.vllm);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const verdict = math.fitsFp16
    ? { tone: "fits" as const, title: "✓ Fits native FP16", body: `~${r1(math.tFp16)}GB of ${hw.gb}GB used. Run it full-precision at ~${math.localTokps} tok/s — no quantization needed.` }
    : math.fitsInt4
      ? { tone: "quant" as const, title: "◐ Requires 4-bit quantization", body: `FP16 needs ~${r1(math.tFp16)}GB but you have ${hw.gb}GB. INT4 fits at ~${r1(math.tInt4)}GB VRAM at ~${math.localTokps} tok/s — expect small quality loss on tool-calling schemas.` }
      : { tone: "oom" as const, title: "✕ Out of memory", body: `Even INT4 needs ~${r1(math.tInt4)}GB vs ${hw.gb}GB available. Split across more GPUs or move this workload to Nebius Cloud below.` };

  return (
    <div id="sizing" className="scroll-mt-16 overflow-hidden rounded-xl border border-ink bg-[#F5F1E9] text-left shadow-[6px_6px_0_#1F1F1F]">
      <div className="grid lg:grid-cols-[1fr_360px]">
        {/* Controls */}
        <div className="p-4 sm:p-5">
          {/* 1. Model */}
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">1 · Pick a model</p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Model selection">
            {WIDGET_MODELS.map((m) => {
              const active = !useCustom && m.id === modelId;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => { setModelId(m.id); setCustomSlug(""); }}
                  className={`cursor-pointer rounded border px-2.5 py-1.5 text-left font-mono text-[11px] font-bold transition-all ${active ? "border-ink bg-ink text-canvas shadow-[2px_2px_0_rgba(31,31,31,0.25)]" : "border-ink/30 text-ink hover:border-ink"}`}
                  title={`${m.slug} · ${m.blurb}`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-center">
            <label htmlFor="hf-slug" className="shrink-0 font-mono text-[11px] text-muted">or any Hugging Face slug:</label>
            <input
              id="hf-slug"
              value={customSlug}
              onChange={(e) => setCustomSlug(e.target.value)}
              placeholder="e.g. meta-llama/Llama-3.3-70B-Instruct"
              spellCheck={false}
              className="min-h-[40px] w-full rounded border border-ink/30 bg-transparent px-2.5 font-mono text-[12px] outline-none placeholder:text-ink/30 focus:border-ink"
            />
          </div>

          {/* 2. Hardware */}
          <p className="mt-4 font-mono text-[11px] font-bold uppercase tracking-widest text-muted">2 · Pick your hardware</p>
          {(["Apple Silicon", "Local PC / Homelab", "Nebius Cloud"] as HwGroup[]).map((g) => (
            <div key={g} className="mt-2">
              <p className="text-[11px] font-bold text-ink/70">{g}</p>
              <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label={g}>
                {HW_TARGETS.filter((h) => h.group === g).map((h) => {
                  const active = h.key === hwKey;
                  return (
                    <button
                      key={h.key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setHwKey(h.key)}
                      className={`cursor-pointer rounded border px-2.5 py-1.5 font-mono text-[11px] font-bold transition-all ${active ? "border-ink bg-ink text-canvas shadow-[2px_2px_0_rgba(31,31,31,0.25)]" : "border-ink/30 text-ink hover:border-ink"}`}
                      title={`${h.gb}GB · ${h.note}`}
                    >
                      {h.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* 3. Users */}
          <p className="mt-4 font-mono text-[11px] font-bold uppercase tracking-widest text-muted">3 · Active users / concurrency</p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label="Active users">
            {USER_OPTIONS.map((u) => {
              const active = u.n === users;
              return (
                <button
                  key={u.n}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setUsers(u.n)}
                  className={`cursor-pointer rounded border px-3 py-2 text-left transition-all ${active ? "border-ink bg-ink text-canvas shadow-[2px_2px_0_rgba(31,31,31,0.25)]" : "border-ink/30 hover:border-ink"}`}
                >
                  <span className="block text-[13px] font-bold">{u.label}</span>
                  <span className={`block text-[11px] ${active ? "text-canvas/70" : "text-muted"}`}>{u.sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live results */}
        <aside aria-live="polite" className="border-t border-ink bg-ink p-4 text-canvas sm:p-5 lg:border-l lg:border-t-0">
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-canvas/60">Live result · zero waiting</p>
          <p className="mt-1 truncate font-mono text-[12px] font-bold" title={model.slug}>{model.label} <span className="font-normal text-canvas/50">· {model.paramsB}B</span></p>
          <p className="font-mono text-[11px] text-canvas/50">{hw.label} · {users} user{users > 1 ? "s" : ""} × {CTX_TOKENS.toLocaleString()} ctx</p>

          {/* Memory math */}
          <div className="mt-3 rounded-md border border-canvas/20 bg-canvas/5 p-3 font-mono text-[11px]">
            <p className="text-[10px] font-bold uppercase tracking-widest text-canvas/60">Memory math</p>
            <dl className="mt-1.5 space-y-1">
              <div className="flex justify-between gap-2"><dt className="text-canvas/70">Weights FP16</dt><dd className="font-bold">{r1(math.wFp16)} GB</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-canvas/70">Weights FP8</dt><dd className="font-bold">{r1(math.wFp8)} GB</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-canvas/70">Weights INT4</dt><dd className="font-bold">{r1(math.wInt4)} GB</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-canvas/70">KV-cache ({users}×{CTX_TOKENS / 1024}K)</dt><dd className="font-bold">+{r1(math.kv)} GB</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-canvas/70">Runtime overhead</dt><dd className="font-bold">+{RUNTIME_GB.toFixed(1)} GB</dd></div>
              <div className="mt-1 flex justify-between gap-2 border-t border-canvas/20 pt-1.5"><dt className="font-bold">Total FP16 / INT4</dt><dd className="font-bold">{r1(math.tFp16)} / {r1(math.tInt4)} GB</dd></div>
            </dl>
          </div>

          {/* Verdict */}
          <div className={`mt-2.5 rounded-md border p-3 ${verdict.tone === "fits" ? "border-emerald-400/60 bg-emerald-500/10" : verdict.tone === "quant" ? "border-amber-400/60 bg-amber-500/10" : "border-red-400/60 bg-red-500/10"}`}>
            <p className={`text-[12px] font-bold ${verdict.tone === "fits" ? "text-emerald-300" : verdict.tone === "quant" ? "text-amber-300" : "text-red-300"}`}>{verdict.title}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-canvas/80">{verdict.body}</p>
          </div>

          {/* User impact */}
          <p className="mt-2.5 text-[11px] leading-relaxed text-canvas/75">
            <strong className="text-canvas">Why users matter:</strong> each active user holds ~{r1(math.kvPerUser)}GB of KV-cache.
            Going 1 → {users} user{users > 1 ? "s" : ""} adds ~{r1(math.kv - math.kvPerUser)}GB — that growth, not the weights, is what pushes local setups into offload.
          </p>

          {/* Nebius path */}
          <div className="mt-2.5 rounded-md border border-canvas/20 bg-canvas/5 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-canvas/60">Nebius cloud upgrade path</p>
            <p className="mt-1 text-[12px] font-bold">{math.tier.label} · ${math.tier.price.toFixed(2)}/hr</p>
            <p className="mt-0.5 font-mono text-[11px] text-canvas/70">≈${math.costPer1k.toFixed(2)} / 1k queries · ~{math.prodTokps} tok/s FP8</p>
            <div className="relative mt-2 rounded bg-black/50 p-2 pr-16 font-mono text-[10px] leading-relaxed text-canvas/85">
              <code className="break-all">{math.vllm}</code>
              <button type="button" onClick={copyVllm} className="absolute right-1.5 top-1.5 cursor-pointer rounded bg-canvas px-2 py-1 font-mono text-[10px] font-bold text-ink hover:bg-white">
                {copied ? "✓ Copied" : "Copy"}
              </button>
            </div>
          </div>

          <Link href={auditHref} className="mt-3 block min-h-[44px] rounded bg-canvas px-4 py-2.5 text-center text-sm font-bold text-ink transition-all hover:bg-white">
            Run Full Cloud Audit on Nebius →
          </Link>
        </aside>
      </div>
    </div>
  );
}

/* ————————————————————————————————————————————————
   Page sections (tight spacing, no dead zones)
   ———————————————————————————————————————————————— */

const USE_CASES = [
  {
    glyph: "🍎",
    title: "The Solo Developer & Mac Mini User",
    problem: "You want to run Qwen or gpt-oss locally without spending money.",
    solution: "GPUProof tells you the exact quantization (4-bit vs 8-bit) that fits your RAM without cooking your machine.",
  },
  {
    glyph: "🖥️",
    title: "The Homelab & Multi-GPU Builder",
    problem: "You have 2 to 10+ consumer GPUs and want to run 70B+ models.",
    solution: "GPUProof calculates Tensor Parallelism (TP) distribution and context limits before you buy hardware.",
  },
  {
    glyph: "🏭",
    title: "The Production Engineering Team",
    problem: "Internal tools or customer APIs need guaranteed P95 latency (<2,000ms) under concurrent load.",
    solution: "Audit and deploy on Nebius Cloud GPUs (L40S, H100, H200) with turnkey vLLM scripts and exact hourly economics.",
  },
];

const CLOUD_ROWS = [
  { gpu: "1× L40S 48GB", vram: "48GB", hr: "$1.35/hr", best: "27–38B models · best value", per1k: "≈$3.18 / 1k queries" },
  { gpu: "1× H100 80GB", vram: "80GB", hr: "$3.20/hr", best: "70B models · fastest single GPU", per1k: "≈$2.90 / 1k queries" },
  { gpu: "8× H100 640GB", vram: "640GB", hr: "$25.60/hr", best: "70B+ at 25-user concurrency", per1k: "Priced per cluster audit" },
];

const FAQS = [
  {
    q: "How is this different from asking ChatGPT what GPU I need?",
    a: "Chatbots guess from training data and routinely suggest GPUs that OOM on your workload. GPUProof computes exact memory math — weights per precision plus KV-cache for your user count plus runtime overhead — then verifies it with a real benchmark run on Nebius Cloud GPUs.",
  },
  {
    q: "Why does adding users increase memory so much?",
    a: "Every active user holds their own KV-cache (roughly layers × hidden size × context length). Weights stay fixed, but 25 concurrent users can add 50–250GB of cache on a 70B model. That is why a setup that fits one user OOMs in production.",
  },
  {
    q: "When should I move from local hardware to Nebius Cloud?",
    a: "When even 4-bit weights plus your KV-cache exceed local VRAM, or when you need guaranteed P95 latency under 2,000ms for other people. The widget above names the cheapest Nebius GPU that holds your FP8 footprint.",
  },
  {
    q: "What does the full cloud audit do?",
    a: "It replays 200+ realistic production queries against your model on a real Nebius GPU, measures P95 latency, output accuracy, and error rate, and mints a SHIP or BLOCK certificate with the exact numbers — so deploys stop being guesses.",
  },
];

function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section aria-label="Frequently asked questions" className="border-t border-ink/20 px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-3xl">
        <p className="text-center font-mono text-[11px] font-bold uppercase tracking-widest text-muted">FAQ</p>
        <h2 className="mt-1 text-center text-xl tracking-tight sm:text-2xl">Straight answers, no hype</h2>
        <div className="mt-4 space-y-2">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="overflow-hidden rounded-lg border border-ink bg-[#F5F1E9]">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full cursor-pointer items-center justify-between p-3 text-left text-sm font-bold"
                  aria-expanded={isOpen}
                >
                  <span className="pr-3">{f.q}</span>
                  <span className="shrink-0 font-mono">{isOpen ? "−" : "+"}</span>
                </button>
                {isOpen && <p className="border-t border-ink/15 px-3 py-2.5 text-[12px] leading-relaxed text-muted">{f.a}</p>}
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

      {/* Hero */}
      <section className="border-b border-ink/20 px-4 pb-6 pt-6 sm:px-6 sm:pt-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-block rounded-full border border-ink px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-widest">Hardware Sizing & Cloud Audit Engine</p>
          <h1 className="mt-3 text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
            Know What Hardware Your AI Model Actually Needs.
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">
            From a 16GB Mac Mini to a 10-GPU Nebius cloud cluster. Get instant, mathematically exact memory math,
            multi-GPU sizing, and production economics — without vague ChatGPT hallucinations.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Link href="/new" className="rounded bg-ink px-6 py-3 text-xs font-bold uppercase tracking-widest text-canvas shadow-[3px_3px_0_rgba(31,31,31,0.25)] transition-all hover:-translate-y-px hover:bg-black">
              Start Hardware Audit →
            </Link>
            <Link href="/docs" className="rounded border border-ink px-6 py-3 text-xs font-bold uppercase tracking-widest transition-all hover:-translate-y-px hover:shadow-[3px_3px_0_rgba(31,31,31,0.25)]">
              Explore Documentation →
            </Link>
          </div>
        </div>

        {/* Widget, directly in the flow */}
        <div className="mx-auto mt-5 max-w-6xl">
          <SizingWidget />
          <p className="mt-2 text-center font-mono text-[11px] text-muted">
            Math: weights (params × bytes/param) + KV-cache (2 × layers × hidden × 4096 ctx × users × 2B) + 2.0GB runtime · FP16 2B · FP8 1B · INT4 0.5B
          </p>
        </div>
      </section>

      {/* 3 plain-English use cases */}
      <section aria-label="Who GPUProof is for" className="border-b border-ink/20 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-center font-mono text-[11px] font-bold uppercase tracking-widest text-muted">Who it&apos;s for</p>
          <h2 className="mx-auto mt-1 max-w-xl text-center text-xl tracking-tight sm:text-2xl">Three setups, three exact answers</h2>
          <div className="mt-4 grid gap-3 text-left md:grid-cols-3">
            {USE_CASES.map((c) => (
              <article key={c.title} className="flex flex-col rounded-lg border border-ink bg-[#F5F1E9] p-4 transition-all hover:shadow-[4px_4px_0_#1F1F1F]">
                <span aria-hidden="true" className="text-xl">{c.glyph}</span>
                <h3 className="mt-2 text-sm font-bold leading-snug">{c.title}</h3>
                <p className="mt-2 text-[12px] leading-relaxed"><strong className="text-muted">Problem:</strong> {c.problem}</p>
                <p className="mt-1.5 border-t border-ink/15 pt-2 text-[12px] leading-relaxed"><strong>Solution:</strong> {c.solution}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* How it works — compact */}
      <section aria-label="How GPUProof works" className="border-b border-ink/20 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-center font-mono text-[11px] font-bold uppercase tracking-widest text-muted">How it works</p>
          <h2 className="mx-auto mt-1 max-w-xl text-center text-xl tracking-tight sm:text-2xl">Guesswork to proof in three steps</h2>
          <div className="mt-4 grid gap-3 text-left md:grid-cols-3">
            <article className="rounded-lg border border-ink bg-[#F5F1E9] p-4">
              <p className="font-mono text-[11px] font-bold text-muted">STEP 01</p>
              <h3 className="mt-1 text-sm font-bold">Size it</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">Pick any model and hardware above. Weights, KV-cache, and runtime overhead are computed instantly.</p>
            </article>
            <article className="rounded-lg border border-ink bg-[#F5F1E9] p-4">
              <p className="font-mono text-[11px] font-bold text-muted">STEP 02</p>
              <h3 className="mt-1 text-sm font-bold">Load it</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">Dial users from 1 to 25 and watch KV-cache grow. See exactly where local VRAM runs out.</p>
            </article>
            <article className="rounded-lg border border-ink bg-[#F5F1E9] p-4">
              <p className="font-mono text-[11px] font-bold text-muted">STEP 03</p>
              <h3 className="mt-1 text-sm font-bold">Ship it</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">Run the full audit on Nebius Cloud GPUs. P95 under 2,000ms earns a SHIP certificate with receipts.</p>
            </article>
          </div>
        </div>
      </section>

      {/* Cloud benchmarks — compact table */}
      <section id="cloud" aria-label="Nebius cloud benchmarks and pricing" className="scroll-mt-16 border-b border-ink/20 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-center font-mono text-[11px] font-bold uppercase tracking-widest text-muted">Cloud benchmarks</p>
          <h2 className="mx-auto mt-1 max-w-xl text-center text-xl tracking-tight sm:text-2xl">Which Nebius GPU for production?</h2>
          <div className="mx-auto mt-4 max-w-4xl overflow-hidden rounded-lg border border-ink bg-[#F5F1E9]">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-ink font-mono text-[11px] uppercase tracking-wider text-muted">
                  <th scope="col" className="px-3 py-2">GPU</th>
                  <th scope="col" className="px-3 py-2 text-right">VRAM</th>
                  <th scope="col" className="px-3 py-2 text-right">$/hr</th>
                  <th scope="col" className="hidden px-3 py-2 sm:table-cell">Best for</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {CLOUD_ROWS.map((r) => (
                  <tr key={r.gpu} className="border-b border-ink/15 last:border-0">
                    <td className="px-3 py-2 font-bold">{r.gpu}<span className="block font-sans text-[11px] font-normal text-muted sm:hidden">{r.best}</span></td>
                    <td className="px-3 py-2 text-right">{r.vram}</td>
                    <td className="px-3 py-2 text-right font-bold">{r.hr}</td>
                    <td className="hidden px-3 py-2 font-sans text-muted sm:table-cell">{r.best} · {r.per1k}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-center text-[12px] text-muted">
            Every audit replays 200+ production queries and gates on P95 &lt; 2,000ms · accuracy ≥ 85% · error rate ≤ 5%.{" "}
            <Link href="/dashboard" className="underline underline-offset-4 hover:text-ink">See certified results →</Link>
          </p>
        </div>
      </section>

      <FaqSection />

      {/* Final CTA — compact */}
      <section aria-label="Final call to action" className="bg-ink px-4 py-6 text-center text-canvas sm:px-6 sm:py-8">
        <div className="mx-auto max-w-2xl">
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-canvas/60">Stop guessing VRAM</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Size it in seconds. Certify it in minutes.</h2>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Link href="/new" className="min-h-[44px] rounded bg-canvas px-6 py-3 text-sm font-bold text-ink transition-all hover:bg-white">
              Start Hardware Audit →
            </Link>
            <Link href="/dashboard" className="min-h-[44px] rounded border border-canvas/40 px-6 py-3 text-sm font-bold text-canvas transition-colors hover:border-canvas">
              View Audit Portfolio
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
