"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteFooter, TopNav } from "@/components/ui";

/* ————————————————————————————————————————————————
   Interactive Hardware Sizing Widget
   Client-side planning estimates: weights + KV-cache + 2GB runtime.
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
  {
    id: "qwen27",
    label: "Qwen 3.6 27B",
    slug: "Qwen/Qwen3.6-27B-Instruct",
    paramsB: 27,
    layers: 64,
    hidden: 5120,
    blurb: "Single-GPU friendly",
  },
  {
    id: "llama70",
    label: "Llama 3.3 70B",
    slug: "meta-llama/Llama-3.3-70B-Instruct",
    paramsB: 70,
    layers: 80,
    hidden: 8192,
    blurb: "Needs multi-GPU / cloud",
  },
  {
    id: "ds38",
    label: "DeepSeek V4 Flash 38B",
    slug: "deepseek-ai/DeepSeek-V4-Flash",
    paramsB: 38,
    layers: 48,
    hidden: 5120,
    blurb: "Reasoning value pick",
  },
  {
    id: "glm32",
    label: "GLM-5 32B",
    slug: "THUDM/glm-5-32b",
    paramsB: 32,
    layers: 64,
    hidden: 5120,
    blurb: "Agent tool-calling",
  },
  {
    id: "gptoss20",
    label: "gpt-oss 20B",
    slug: "openai/gpt-oss-20b",
    paramsB: 20,
    layers: 48,
    hidden: 4096,
    blurb: "Fits 16GB Mac Mini",
  },
  {
    id: "codestral22",
    label: "Codestral 22B",
    slug: "mistralai/Codestral-22B-v0.1",
    paramsB: 22,
    layers: 56,
    hidden: 6144,
    blurb: "IDE code completion",
  },
  {
    id: "gemma31",
    label: "Gemma 4 31B",
    slug: "google/gemma-4-31b-it",
    paramsB: 31,
    layers: 62,
    hidden: 5376,
    blurb: "All-round single GPU",
  },
];

type HwGroup = "Apple Silicon" | "Local PC & Homelab" | "Nebius Cloud";
type HwTarget = {
  key: string;
  label: string;
  gb: number;
  group: HwGroup;
  memory: string;
  bandwidth: number;
  factor: number;
  priceHr?: number;
};
const HW_GROUPS: HwGroup[] = [
  "Apple Silicon",
  "Local PC & Homelab",
  "Nebius Cloud",
];
const HW_TARGETS: HwTarget[] = [
  {
    key: "mini16",
    label: "Mac Mini 16GB",
    gb: 16,
    group: "Apple Silicon",
    memory: "16 GB Unified",
    bandwidth: 120,
    factor: 1,
  },
  {
    key: "mini24",
    label: "Mac Mini 24GB",
    gb: 24,
    group: "Apple Silicon",
    memory: "24 GB Unified",
    bandwidth: 120,
    factor: 1,
  },
  {
    key: "mbp36",
    label: "MacBook Pro 36GB",
    gb: 36,
    group: "Apple Silicon",
    memory: "36 GB Unified",
    bandwidth: 150,
    factor: 1,
  },
  {
    key: "mbp64",
    label: "MacBook Pro 64GB",
    gb: 64,
    group: "Apple Silicon",
    memory: "64 GB Unified",
    bandwidth: 400,
    factor: 1.05,
  },
  {
    key: "studio128",
    label: "Mac Studio 128GB",
    gb: 128,
    group: "Apple Silicon",
    memory: "128 GB Unified",
    bandwidth: 800,
    factor: 1.1,
  },
  {
    key: "studio192",
    label: "Mac Studio 192GB",
    gb: 192,
    group: "Apple Silicon",
    memory: "192 GB Unified",
    bandwidth: 800,
    factor: 1.1,
  },
  {
    key: "rtx4090",
    label: "RTX 4090 24GB",
    gb: 24,
    group: "Local PC & Homelab",
    memory: "24 GB VRAM",
    bandwidth: 1008,
    factor: 1.6,
  },
  {
    key: "dual3090",
    label: "Dual RTX 3090 48GB",
    gb: 48,
    group: "Local PC & Homelab",
    memory: "2 × 24GB VRAM",
    bandwidth: 936,
    factor: 1.4,
  },
  {
    key: "quad3090",
    label: "Quad RTX 3090 96GB",
    gb: 96,
    group: "Local PC & Homelab",
    memory: "4 × 24GB VRAM",
    bandwidth: 936,
    factor: 1.4,
  },
  {
    key: "l40s",
    label: "1× L40S 48GB",
    gb: 48,
    group: "Nebius Cloud",
    memory: "48 GB VRAM",
    bandwidth: 864,
    factor: 2.2,
    priceHr: 1.35,
  },
  {
    key: "h100",
    label: "1× H100 80GB",
    gb: 80,
    group: "Nebius Cloud",
    memory: "80 GB VRAM",
    bandwidth: 3350,
    factor: 3.2,
    priceHr: 3.2,
  },
  {
    key: "h100x8",
    label: "8× H100 640GB",
    gb: 640,
    group: "Nebius Cloud",
    memory: "8 × 80GB VRAM",
    bandwidth: 3350,
    factor: 3.2,
    priceHr: 25.6,
  },
];
const CLOUD_TIERS = [
  { key: "L40S", label: "1× L40S 48GB", gb: 48, price: 1.35, tp: 1, perf: 1 },
  { key: "H100", label: "1× H100 80GB", gb: 80, price: 3.2, tp: 1, perf: 2.6 },
  {
    key: "H100",
    label: "8× H100 640GB",
    gb: 640,
    price: 25.6,
    tp: 8,
    perf: 4.5,
  },
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
  const [hub, setHub] = useState<{
    slug: string;
    state: "checking" | "valid" | "missing" | "offline";
  }>({ slug: "", state: "checking" });
  const [hwKey, setHwKey] = useState("mini24");
  const [group, setGroup] = useState<HwGroup>("Apple Silicon");
  const [gpuCount, setGpuCount] = useState(2);
  const [users, setUsers] = useState(1);
  const [cli, setCli] = useState<"vLLM" | "Ollama">("vLLM");
  const [copyState, setCopyState] = useState("");
  const slug = customSlug.trim();
  const validSlug =
    /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(slug);

  useEffect(() => {
    if (!validSlug) return;
    const controller = new AbortController();
    let cancelled = false;
    setHub({ slug, state: "checking" });
    const timer = setTimeout(async () => {
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(
          `https://huggingface.co/api/models/${slug}`,
          { signal: controller.signal },
        );
        if (!cancelled)
          setHub({
            slug,
            state: response.ok
              ? "valid"
              : response.status === 404
                ? "missing"
                : "offline",
          });
      } catch {
        if (!cancelled) setHub({ slug, state: "offline" });
      } finally {
        clearTimeout(timeout);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [slug, validSlug]);

  const base = WIDGET_MODELS.find((m) => m.id === modelId) ?? WIDGET_MODELS[0];
  const paramsB = estimateParamsFromSlug(slug);
  const model = validSlug
    ? {
        ...base,
        slug,
        label: slug.split("/")[1],
        paramsB,
        layers: Math.round(28 + paramsB * 0.7),
        hidden: paramsB >= 60 ? 8192 : paramsB >= 25 ? 5120 : 4096,
      }
    : base;
  const hw: HwTarget =
    hwKey === "custom"
      ? {
          key: "custom",
          label: `${gpuCount}× RTX 3090`,
          gb: gpuCount * 24,
          group: "Local PC & Homelab",
          memory: `${gpuCount} × 24GB VRAM`,
          bandwidth: 936,
          factor: 1.4,
        }
      : (HW_TARGETS.find((h) => h.key === hwKey) ?? HW_TARGETS[1]);
  const kvPerUser = (2 * model.layers * model.hidden * CTX_TOKENS * 2) / 1e9;
  const kv = kvPerUser * users;
  const fp16 = model.paramsB * 2 + kv + RUNTIME_GB;
  const int4 = model.paramsB * 0.5 + kv + RUNTIME_GB;
  const fp8 = model.paramsB + kv + RUNTIME_GB;
  const native = fp16 <= hw.gb;
  const fits = int4 <= hw.gb;
  const weights = model.paramsB * (native ? 2 : 0.5);
  const total = weights + kv + RUNTIME_GB;
  const headroom = Math.max(0, hw.gb - total);
  const overflow = Math.max(0, total - hw.gb);
  const scale = Math.max(hw.gb, total);
  const tier = CLOUD_TIERS.find((t) => fp8 <= t.gb * 0.95) ?? CLOUD_TIERS[2];
  const cloudFits = fp8 <= tier.gb * 0.95;
  const speed = Math.max(
    2,
    Math.min(
      65,
      Math.round((55 / Math.pow(model.paramsB / 8, 0.7)) * hw.factor),
    ),
  );
  const cloudSpeed = Math.round((1600 / model.paramsB) * tier.perf);
  const costPer1k =
    (tier.price * TOKENS_PER_QUERY * 1000) / (cloudSpeed * 3600);
  const ollamaModel = !validSlug
    ? (
        { llama70: "llama3.3:70b", gptoss20: "gpt-oss:20b" } as Record<
          string,
          string
        >
      )[modelId]
    : undefined;
  const command =
    cli === "vLLM"
      ? `vllm serve ${model.slug} --quantization fp8 --max-model-len ${CTX_TOKENS} --max-num-seqs ${users} --tensor-parallel-size ${tier.tp} --gpu-memory-utilization 0.95`
      : ollamaModel
        ? `ollama run ${ollamaModel}`
        : `# Select a GGUF conversion of ${model.slug}\nollama run hf.co/<owner>/<model-GGUF>:Q4_K_M`;
  useEffect(() => {
    setCopyState("");
  }, [command]);
  useEffect(() => {
    if (!copyState) return;
    const timer = setTimeout(() => setCopyState(""), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);
  const auditHref = `/new?${new URLSearchParams({
    candidate_model: model.slug,
    target_gpu: tier.key,
    hardware: hw.key,
    tensor_parallel_size: String(tier.tp),
    concurrency: String(users),
    context_len: String(CTX_TOKENS),
    precision: "FP8",
  })}`;
  const allocations = [
    { label: "Weights", value: weights, color: "bg-ink" },
    { label: "KV-cache", value: kv, color: "bg-[#C88B38]" },
    { label: "Runtime", value: RUNTIME_GB, color: "bg-[#A49D91]" },
    { label: "Headroom", value: headroom, color: "bg-[#81A28B]" },
  ];
  const hubText = !validSlug
    ? "Use owner/model format"
    : hub.slug !== slug || hub.state === "checking"
      ? "Checking Hub…"
      : hub.state === "valid"
        ? "✓ Hub Validated"
        : hub.state === "missing"
          ? "Model not found"
          : "Hub unavailable";
  const selection = (active: boolean) =>
    `cursor-pointer rounded-xl border text-left transition-all duration-200 motion-reduce:transition-none motion-safe:hover:-translate-y-0.5 active:scale-[0.98] ${active ? "border-ink bg-ink text-canvas shadow-md" : "border-ink/10 bg-white/50 hover:border-ink/35 hover:bg-white/80"}`;

  return (
    <div
      id="sizing"
      className="scroll-mt-8 overflow-hidden rounded-2xl border border-ink/15 bg-[#F8F6F1] text-left shadow-[0_16px_48px_-20px_#5c514b50,0_2px_6px_#5c514b08]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/10 px-5 py-3 text-[11px] sm:px-6">
        <span className="font-bold">
          GPUProof <span className="mx-2 font-normal text-ink/30">/</span>{" "}
          Hardware workbench
        </span>
        <span className="flex items-center gap-2 text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-ship" />
          Live estimates · no sign-up
        </span>
      </div>
      <div className="grid lg:grid-cols-[1.05fr_1fr]">
        <div className="min-w-0 space-y-6 p-5 sm:p-6">
          <section aria-labelledby="model-heading">
            <h2
              id="model-heading"
              className="flex items-center gap-2 text-sm font-bold"
            >
              <span className="text-[11px] text-muted">01 /</span> Choose your
              model
            </h2>
            <div
              className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"
              aria-label="Model selection"
            >
              {WIDGET_MODELS.slice(0, 5).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={!slug && m.id === modelId}
                  onClick={() => {
                    setModelId(m.id);
                    setCustomSlug("");
                  }}
                  className={`${selection(!slug && m.id === modelId)} min-h-[65px] px-3 py-2.5`}
                  title={m.blurb}
                >
                  <span className="block text-[11px] font-bold">
                    {m.label.replace(/ (Flash )?\d+B$/, "")}
                  </span>
                  <span
                    className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] ${!slug && m.id === modelId ? "bg-white/15 text-canvas" : "bg-ink/5 text-muted"}`}
                  >
                    {m.paramsB}B parameters
                  </span>
                </button>
              ))}
              <a
                href="#hf-slug"
                className="flex min-h-[65px] items-center justify-center rounded-xl border border-dashed border-ink/20 px-3 text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
              >
                + Custom model
              </a>
            </div>
            <label
              htmlFor="hf-slug"
              className="mb-1.5 mt-3 flex flex-wrap justify-between gap-1 text-[10px] text-muted"
            >
              Hugging Face repository{" "}
              {slug && (
                <span
                  role="status"
                  className={
                    hubText.includes("Validated") ? "text-ship" : "text-muted"
                  }
                >
                  {hubText}
                </span>
              )}
            </label>
            <input
              id="hf-slug"
              value={customSlug}
              onChange={(e) => setCustomSlug(e.target.value)}
              placeholder="owner/model-name"
              spellCheck={false}
              autoComplete="off"
              aria-describedby="model-help"
              className="min-h-[42px] w-full rounded-lg border border-ink/15 bg-[#EDEAE3]/70 px-3 text-xs shadow-inner placeholder:text-muted focus:border-ink"
            />
            <p
              id="model-help"
              className="mt-1.5 text-[10px] leading-relaxed text-muted"
            >
              {slug
                ? "Custom architecture is estimated from the name (30B default). Hub validation confirms repository existence only."
                : "Pick a preset or size any public Hub repository."}
            </p>
          </section>
          <section aria-labelledby="hardware-heading">
            <h2
              id="hardware-heading"
              className="flex items-center gap-2 text-sm font-bold"
            >
              <span className="text-[11px] text-muted">02 /</span> Set your
              hardware target
            </h2>
            <div
              className="mt-3 flex rounded-lg bg-[#E8E4DC] p-1"
              aria-label="Hardware families"
            >
              {HW_GROUPS.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={group === g}
                  onClick={() => {
                    setGroup(g);
                    setHwKey(HW_TARGETS.find((h) => h.group === g)!.key);
                  }}
                  className={`min-h-[40px] min-w-0 flex-1 cursor-pointer rounded-md px-1 text-[10px] font-bold transition-all motion-reduce:transition-none ${group === g ? "bg-[#FFFEFA] text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                >
                  {g}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {HW_TARGETS.filter((h) => h.group === group).map((h) => (
                <button
                  key={h.key}
                  type="button"
                  aria-pressed={h.key === hwKey}
                  onClick={() => setHwKey(h.key)}
                  className={`${selection(h.key === hwKey)} px-3 py-2.5`}
                >
                  <span className="flex items-start justify-between gap-1 text-[11px] font-bold">
                    {h.label}
                    <span
                      aria-hidden="true"
                      className={
                        h.key === hwKey ? "text-[#A9C8AC]" : "text-ink/20"
                      }
                    >
                      {h.key === hwKey ? "●" : "○"}
                    </span>
                  </span>
                  <span
                    className={`mt-1.5 block text-[9px] ${h.key === hwKey ? "text-canvas/80" : "text-muted"}`}
                  >
                    {h.memory}
                  </span>
                  <span
                    className={`mt-1 block text-[9px] ${h.key === hwKey ? "text-canvas/80" : "text-muted"}`}
                  >
                    {h.bandwidth.toLocaleString()} GB/s
                    {h.memory.includes("×") ? " / GPU" : ""}
                  </span>
                </button>
              ))}
            </div>
            {group === "Local PC & Homelab" && (
              <div
                className={`mt-2 rounded-xl border p-3 ${hwKey === "custom" ? "border-ink/40 bg-white/80" : "border-ink/10"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    aria-pressed={hwKey === "custom"}
                    onClick={() => setHwKey("custom")}
                    className="min-h-10 cursor-pointer text-left text-[11px] font-bold"
                  >
                    {hwKey === "custom" ? "● " : "+ "}Custom Multi-GPU
                    <span className="mt-1 block text-[10px] font-normal text-muted">
                      RTX 3090 · 24GB per GPU
                    </span>
                  </button>
                  <div className="flex items-center rounded-lg border border-ink/15 bg-white/70">
                    <button
                      type="button"
                      aria-label="Remove GPU"
                      disabled={gpuCount <= 2}
                      onClick={() => {
                        setGpuCount(gpuCount - 1);
                        setHwKey("custom");
                      }}
                      className="h-10 w-9 cursor-pointer disabled:opacity-30"
                    >
                      −
                    </button>
                    <input
                      aria-label="Custom GPU count"
                      type="number"
                      min={2}
                      max={64}
                      value={gpuCount}
                      onChange={(e) => {
                        setGpuCount(
                          Math.min(
                            64,
                            Math.max(
                              2,
                              Math.trunc(Number(e.target.value) || 2),
                            ),
                          ),
                        );
                        setHwKey("custom");
                      }}
                      className="h-10 w-12 bg-transparent text-center text-xs"
                    />
                    <button
                      type="button"
                      aria-label="Add GPU"
                      disabled={gpuCount >= 64}
                      onClick={() => {
                        setGpuCount(gpuCount + 1);
                        setHwKey("custom");
                      }}
                      className="h-10 w-9 cursor-pointer disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-muted">
                  {gpuCount * 24} GB pooled · TP={gpuCount} · 936 GB/s per GPU
                </p>
                <p className="mt-1 text-[9px] leading-relaxed text-muted">
                  Capacity estimate. Tensor parallelism requires compatible
                  model head counts and GPU interconnects.
                </p>
              </div>
            )}
          </section>
          <section
            aria-labelledby="traffic-heading"
            className="border-t border-ink/10 pt-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="traffic-heading" className="text-sm font-bold">
                <span className="mr-2 text-[11px] text-muted">03 /</span>Dial in
                traffic
              </h2>
              <output
                htmlFor="active-users"
                className="rounded-md bg-ink px-2.5 py-1 text-xs tabular-nums text-canvas"
              >
                {users} {users === 1 ? "user" : "users"}
              </output>
            </div>
            <input
              id="active-users"
              aria-label="Active users"
              type="range"
              min={1}
              max={50}
              value={users}
              onChange={(e) => setUsers(Number(e.target.value))}
              className="mt-4 h-5 w-full cursor-pointer accent-[#1F1F1F]"
            />
            <div className="mt-1 grid grid-cols-3 gap-2">
              {[
                { n: 1, title: "1 User", text: "Local dev" },
                { n: 5, title: "5 Users", text: "Small team" },
                { n: 25, title: "25+ Users", text: "Production API" },
              ].map((u) => (
                <button
                  key={u.n}
                  type="button"
                  onClick={() => setUsers(u.n)}
                  className={`min-h-11 cursor-pointer text-left text-[10px] transition-colors hover:text-ink ${users === u.n ? "text-ink" : "text-muted"}`}
                >
                  <span className="block font-bold">{u.title}</span>
                  <span className="block text-[9px]">{u.text}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 flex items-center gap-2 rounded-lg bg-[#EDE9E0] px-3 py-2 text-[10px] text-muted">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#C88B38]" />
              {CTX_TOKENS.toLocaleString()} cached tokens / user · ~
              {r1(kvPerUser)} GB each
            </p>
          </section>
        </div>
        <aside
          aria-label="Hardware feasibility board"
          className="min-w-0 border-t border-ink/10 bg-[#F0EEE7] p-5 sm:p-6 lg:border-l lg:border-t-0"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold">Hardware feasibility</h2>
            <span className="rounded-full border border-ship/20 bg-ship/5 px-2 py-1 text-[9px] text-ship">
              ● LIVE
            </span>
          </div>
          <p
            className="mt-2 truncate text-[11px] text-muted"
            title={model.slug}
          >
            {model.label} <span className="text-ink/30">/</span> {hw.label}
          </p>
          <div className="mt-6 flex items-end justify-between gap-2">
            <div>
              <p className="text-[10px] text-muted">
                Estimated memory footprint
              </p>
              <p className="mt-1 text-3xl font-semibold tracking-tighter tabular-nums">
                {r1(total)}
                <span className="ml-1 text-sm font-normal text-muted">
                  / {hw.gb} GB
                </span>
              </p>
            </div>
            <span className="mb-1 rounded-md border border-ink/15 px-2 py-1 text-[10px]">
              {native ? "FP16" : "INT4"}
            </span>
          </div>
          <div
            className="relative mt-4"
            role="img"
            aria-label={`Memory allocation: ${allocations.map((a) => `${a.label} ${r1(a.value)} GB`).join(", ")}. ${r1(overflow)} GB over capacity.`}
          >
            <div className="flex h-9 overflow-hidden rounded-lg bg-ink/5 shadow-inner">
              {allocations.map((a) => (
                <div
                  key={a.label}
                  title={`${a.label}: ${r1(a.value)} GB`}
                  className={`${a.color} h-full shrink-0 border-r border-white/30 last:border-0 transition-[width] duration-500 ease-out motion-reduce:transition-none`}
                  style={{ width: `${(a.value / scale) * 100}%` }}
                />
              ))}
            </div>
            {overflow > 0 && (
              <div
                className="pointer-events-none absolute inset-y-0 right-0 rounded-r-lg border-l-2 border-[#AD3B36] bg-red-700/25 transition-[width] duration-500 motion-reduce:transition-none"
                style={{
                  width: `${(overflow / scale) * 100}%`,
                  backgroundImage:
                    "repeating-linear-gradient(135deg, transparent, transparent 4px, #ad3b3640 4px, #ad3b3640 6px)",
                }}
              />
            )}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {allocations.map((a) => (
              <div key={a.label}>
                <dt className="flex items-center gap-1.5 text-[9px] text-muted">
                  <span className={`h-1.5 w-1.5 rounded-sm ${a.color}`} />
                  {a.label}
                </dt>
                <dd className="mt-1 text-xs font-bold tabular-nums">
                  {r1(a.value)}{" "}
                  <span className="font-normal text-muted">GB</span>
                </dd>
              </div>
            ))}
          </dl>
          <div
            aria-live="polite"
            className={`mt-5 rounded-xl border p-3.5 ${native ? "border-ship/20 bg-[#E4ECE2]" : fits ? "border-[#BD8933]/25 bg-[#F3E9D5]" : "border-red-800/20 bg-[#F3DFDC]"}`}
          >
            <p
              className={`text-[12px] font-bold ${native ? "text-ship" : fits ? "text-[#775010]" : "text-[#A1322C]"}`}
            >
              {native
                ? "● RUNS NATIVELY (FP16)"
                : fits
                  ? "● RUNS QUANTIZED (INT4)"
                  : "● REQUIRES CLOUD (OOM)"}
            </p>
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink/80">
              {native
                ? "Full precision. No weight compression needed."
                : fits
                  ? `Fits in 4-bit at ~${speed} tok/s. Quality impact depends on the model.`
                  : "Exceeds device memory. Loading may fail or offload to slower CPU RAM."}
            </p>
            {overflow > 0 && (
              <p className="mt-2 text-[10px] font-bold text-[#A1322C] motion-safe:animate-[pulse_1s_ease-in-out_2]">
                ⚠ +{r1(overflow)} GB Over Capacity
                {group === "Apple Silicon" ? " (OOM)" : " (CUDA OOM)"}
              </p>
            )}
          </div>
          <div className="mb-3 mt-6 flex items-center gap-3 text-[10px] text-muted">
            <span>Your hardware vs. Nebius Cloud</span>
            <span className="h-px flex-1 bg-ink/10" />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="min-w-0 rounded-xl border border-ink/10 bg-white/40 p-3">
              <p className="text-[10px] font-bold">Your Setup</p>
              <p className="mt-1 min-h-8 text-[9px] text-muted">{hw.label}</p>
              <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums">
                {fits ? `~${speed}` : "—"}
                <span className="ml-1 text-[9px] font-normal text-muted">
                  tok/s
                </span>
              </p>
              <p
                className={`mt-1 text-[9px] ${fits ? "text-ship" : "text-[#A1322C]"}`}
              >
                {fits
                  ? `${r1(headroom)} GB headroom`
                  : `${r1(overflow)} GB short`}
              </p>
              <p className="mt-3 border-t border-ink/10 pt-2 text-[10px] font-bold">
                {hw.priceHr
                  ? `$${hw.priceHr.toFixed(2)}/hr`
                  : "$0.00/hr (Free)"}
              </p>
              <p className="mt-1 text-[9px] text-muted">
                {hw.priceHr
                  ? "Illustrative GPU rate"
                  : "Hardware & electricity excluded"}
              </p>
            </div>
            <div className="min-w-0 rounded-xl border border-ship/25 bg-[#E8EEE4] p-3">
              <p className="text-[10px] font-bold text-ship">
                Nebius Cloud Upgrade
              </p>
              <p className="mt-1 min-h-8 text-[9px] text-muted">
                {cloudFits ? tier.label : "Larger cluster needed"}
              </p>
              <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums">
                {cloudFits ? `~${cloudSpeed}` : "—"}
                <span className="ml-1 text-[9px] font-normal text-muted">
                  tok/s FP8
                </span>
              </p>
              <p className="mt-1 text-[9px] text-ship">
                {cloudFits
                  ? `${r1(tier.gb - fp8)} GB headroom`
                  : "Exceeds listed cloud tiers"}
              </p>
              <p className="mt-3 border-t border-ship/15 pt-2 text-[10px] font-bold">
                {cloudFits ? `$${tier.price.toFixed(2)}/hr` : "Custom sizing"}
              </p>
              <p className="mt-1 text-[9px] text-muted">
                {cloudFits
                  ? `~$${costPer1k.toFixed(2)} / 1k queries`
                  : "Reduce concurrency to fit"}
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl bg-ink text-canvas">
            <div className="flex items-center justify-between border-b border-white/10 px-3">
              <div className="flex gap-3" aria-label="CLI runtime">
                {(["vLLM", "Ollama"] as const).map((name) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={cli === name}
                    onClick={() => setCli(name)}
                    className={`min-h-10 cursor-pointer border-b-2 text-[10px] ${cli === name ? "border-[#A9C8AC] text-canvas" : "border-transparent text-canvas/60 hover:text-canvas"}`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(command);
                    setCopyState("✓ Copied");
                  } catch {
                    setCopyState("Select to copy");
                  }
                }}
                className="min-h-10 cursor-pointer text-[10px] text-canvas/80 hover:text-white"
                aria-live="polite"
              >
                {copyState || "Copy"}
              </button>
            </div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all p-3 text-[10px] leading-relaxed">
              <code>{command}</code>
            </pre>
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-muted">
            {cli === "vLLM"
              ? "Cloud launch template. Requires a supported model and FP8-capable runtime."
              : ollamaModel
                ? "Runs the Ollama catalog build locally; precision and context may differ from this estimate."
                : "Ollama needs a compatible GGUF repository. Replace placeholders before running."}
          </p>
          <Link
            href={auditHref}
            className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-ink px-3 py-3 text-center text-[11px] font-bold text-canvas shadow-sm transition-all motion-safe:hover:-translate-y-0.5 hover:bg-[#33332E] active:scale-[0.98] motion-reduce:transition-none"
          >
            Test Run on Nebius Cloud GPU <span aria-hidden="true">→</span>
          </Link>
          <p className="mt-3 text-[9px] leading-relaxed text-muted">
            Estimates, not benchmarks. KV-cache uses a conservative attention
            approximation. Bandwidth varies by hardware generation. Cost assumes{" "}
            {TOKENS_PER_QUERY} output tokens/query; listed rates are
            illustrative.
          </p>
        </aside>
      </div>
    </div>
  );
}

const USE_CASES = [
  {
    glyph: "🍎",
    title: "The Mac Mini & Solo Dev",
    problem: "You want to run Qwen or gpt-oss locally without spending money.",
    solution:
      "Find the precision that fits your unified memory before downloading the weights.",
  },
  {
    glyph: "🖥️",
    title: "The Homelab & Multi-GPU Builder",
    problem: "You have 2 to 10+ consumer GPUs and want to run 70B+ models.",
    solution:
      "Explore pooled VRAM, tensor parallelism, and context limits before you buy the next GPU.",
  },
  {
    glyph: "🏭",
    title: "The Production Engineering Team",
    problem:
      "Internal tools or customer APIs need guaranteed P95 latency (<2,000ms) under concurrent load.",
    solution:
      "Compare cloud capacity and estimated costs, then benchmark your workload on Nebius GPUs.",
  },
];

const CLOUD_ROWS = [
  {
    gpu: "1× L40S 48GB",
    vram: "48GB",
    hr: "$1.35/hr",
    best: "27–38B models · best value",
    per1k: "≈$3.18 / 1k queries",
  },
  {
    gpu: "1× H100 80GB",
    vram: "80GB",
    hr: "$3.20/hr",
    best: "70B models · fastest single GPU",
    per1k: "≈$2.90 / 1k queries",
  },
  {
    gpu: "8× H100 640GB",
    vram: "640GB",
    hr: "$25.60/hr",
    best: "70B+ at 25-user concurrency",
    per1k: "Priced per cluster audit",
  },
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
    <section
      aria-label="Frequently asked questions"
      className="border-t border-ink/20 px-4 py-6 sm:px-6 sm:py-8"
    >
      <div className="mx-auto max-w-3xl">
        <p className="text-center font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
          FAQ
        </p>
        <h2 className="mt-1 text-center text-xl tracking-tight sm:text-2xl">
          Straight answers, no hype
        </h2>
        <div className="mt-4 space-y-2">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                className="overflow-hidden rounded-xl border border-ink/15 bg-[#F8F6F1]"
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full cursor-pointer items-center justify-between p-3 text-left text-sm font-bold"
                  aria-expanded={isOpen}
                >
                  <span className="pr-3">{f.q}</span>
                  <span className="shrink-0 font-mono">
                    {isOpen ? "−" : "+"}
                  </span>
                </button>
                {isOpen && (
                  <p className="border-t border-ink/15 px-3 py-2.5 text-[12px] leading-relaxed text-muted">
                    {f.a}
                  </p>
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

      {/* Hero */}
      <section className="border-b border-ink/10 px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-block rounded-full border border-ink/15 bg-white/30 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-widest">
            Hardware Sizing & Cloud Audit Engine
          </p>
          <h1 className="mt-3 text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
            Your model. Your hardware. Know what fits.
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">
            Size memory, explore concurrency, and compare local hardware with
            cloud GPUs. Get a working plan before your first deployment.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/new"
              className="rounded bg-ink px-6 py-3 text-xs font-bold uppercase tracking-widest text-canvas shadow-sm transition-all hover:-translate-y-px hover:bg-black"
            >
              Start Hardware Audit →
            </Link>
            <Link
              href="/docs"
              className="rounded border border-ink px-6 py-3 text-xs font-bold uppercase tracking-widest transition-all hover:-translate-y-px hover:shadow-sm"
            >
              Explore Documentation →
            </Link>
          </div>
        </div>

        {/* Widget, directly in the flow */}
        <div className="mx-auto mt-8 max-w-6xl">
          <SizingWidget />
          <p className="mt-2 text-center font-mono text-[11px] text-muted">
            Weights + per-user KV-cache + 2 GB runtime. Actual memory depends on
            architecture, quantization, and system usage.
          </p>
        </div>
      </section>

      {/* 3 plain-English use cases */}
      <section
        aria-label="Who GPUProof is for"
        className="border-b border-ink/10 px-4 py-8 sm:px-6 sm:py-10"
      >
        <div className="mx-auto max-w-6xl">
          <p className="text-center font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
            Who it&apos;s for
          </p>
          <h2 className="mx-auto mt-1 max-w-xl text-center text-xl tracking-tight sm:text-2xl">
            Built for the way you deploy
          </h2>
          <div className="mt-4 grid gap-3 text-left md:grid-cols-3">
            {USE_CASES.map((c, i) => (
              <article
                key={c.title}
                className="flex flex-col border-t border-ink/20 px-1 py-4"
              >
                <span className="text-[11px] text-muted">0{i + 1} /</span>
                <h3 className="mt-2 text-sm font-bold leading-snug">
                  {c.title}
                </h3>
                <p className="mt-2 text-[12px] leading-relaxed">{c.problem}</p>
                <p className="mt-1.5 border-t border-ink/15 pt-2 text-[12px] leading-relaxed">
                  {c.solution}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* How it works — compact */}
      <section
        aria-label="How GPUProof works"
        className="border-b border-ink/10 px-4 py-8 sm:px-6 sm:py-10"
      >
        <div className="mx-auto max-w-6xl">
          <p className="text-center font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
            How it works
          </p>
          <h2 className="mx-auto mt-1 max-w-xl text-center text-xl tracking-tight sm:text-2xl">
            Guesswork to proof in three steps
          </h2>
          <div className="mt-4 grid gap-3 text-left md:grid-cols-3">
            <article className="rounded-xl border border-ink/15 bg-[#F8F6F1] p-4">
              <p className="font-mono text-[11px] font-bold text-muted">
                STEP 01
              </p>
              <h3 className="mt-1 text-sm font-bold">Size it</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                Pick any model and hardware above. Weights, KV-cache, and
                runtime overhead are computed instantly.
              </p>
            </article>
            <article className="rounded-xl border border-ink/15 bg-[#F8F6F1] p-4">
              <p className="font-mono text-[11px] font-bold text-muted">
                STEP 02
              </p>
              <h3 className="mt-1 text-sm font-bold">Load it</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                Dial users from 1 to 25 and watch KV-cache grow. See exactly
                where local VRAM runs out.
              </p>
            </article>
            <article className="rounded-xl border border-ink/15 bg-[#F8F6F1] p-4">
              <p className="font-mono text-[11px] font-bold text-muted">
                STEP 03
              </p>
              <h3 className="mt-1 text-sm font-bold">Ship it</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                Run the full audit on Nebius Cloud GPUs. P95 under 2,000ms earns
                a SHIP certificate with receipts.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* Cloud benchmarks — compact table */}
      <section
        id="cloud"
        aria-label="Nebius cloud benchmarks and pricing"
        className="scroll-mt-16 border-b border-ink/10 px-4 py-8 sm:px-6 sm:py-10"
      >
        <div className="mx-auto max-w-6xl">
          <p className="text-center font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
            Cloud benchmarks
          </p>
          <h2 className="mx-auto mt-1 max-w-xl text-center text-xl tracking-tight sm:text-2xl">
            Which Nebius GPU for production?
          </h2>
          <div className="mx-auto mt-4 max-w-4xl overflow-hidden rounded-xl border border-ink/15 bg-[#F8F6F1]">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-ink font-mono text-[11px] uppercase tracking-wider text-muted">
                  <th scope="col" className="px-3 py-2">
                    GPU
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    VRAM
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    $/hr
                  </th>
                  <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                    Best for
                  </th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {CLOUD_ROWS.map((r) => (
                  <tr
                    key={r.gpu}
                    className="border-b border-ink/15 last:border-0"
                  >
                    <td className="px-3 py-2 font-bold">
                      {r.gpu}
                      <span className="block font-sans text-[11px] font-normal text-muted sm:hidden">
                        {r.best}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{r.vram}</td>
                    <td className="px-3 py-2 text-right font-bold">{r.hr}</td>
                    <td className="hidden px-3 py-2 font-sans text-muted sm:table-cell">
                      {r.best} · {r.per1k}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-center text-[12px] text-muted">
            Every audit replays 200+ production queries and gates on P95 &lt;
            2,000ms · accuracy ≥ 85% · error rate ≤ 5%.{" "}
            <Link
              href="/dashboard"
              className="underline underline-offset-4 hover:text-ink"
            >
              See certified results →
            </Link>
          </p>
        </div>
      </section>

      <FaqSection />

      {/* Final CTA — compact */}
      <section
        aria-label="Final call to action"
        className="bg-ink px-4 py-6 text-center text-canvas sm:px-6 sm:py-8"
      >
        <div className="mx-auto max-w-2xl">
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-canvas/60">
            Stop guessing VRAM
          </p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Size it in seconds. Certify it in minutes.
          </h2>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/new"
              className="min-h-[44px] rounded bg-canvas px-6 py-3 text-sm font-bold text-ink transition-all hover:bg-white"
            >
              Start Hardware Audit →
            </Link>
            <Link
              href="/dashboard"
              className="min-h-[44px] rounded border border-canvas/40 px-6 py-3 text-sm font-bold text-canvas transition-colors hover:border-canvas"
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
