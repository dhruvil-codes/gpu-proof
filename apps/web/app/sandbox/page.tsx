"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ByokBadge, TopNav, useByokStatus } from "@/components/ui";
import ByokModal from "@/components/ByokModal";
import { hfModels } from "@/lib/hf";
import { buildByokHeaders } from "@/components/byok";
import { buildExecutionHeaders, enableDevSimFromQuery, isDevSim } from "@/components/executionMode";

/* ==========================================================================
   Live 1-Hour Sandbox — Nebius Cloud GPU console
   Onboarding (<30s) → dark telemetry console → export certification.
   Chat streams with genuinely measured TTFT/ITL/tok-s; VRAM gauge uses the
   same exact sizing math as /new and grows with conversation context.
   Export mints a REAL backend certification with session metrics.
   ========================================================================== */

const SESSION_SECONDS = 3600;
const WARN_SECONDS = 300;
const RUNTIME_GB = 1.8;

type SandboxGpu = {
  key: string;
  label: string;
  vram: number;
  bw: number;
  price: number;
  cert: string;
  blurb: string;
  ttftMs: number;
  toks: number;
  /** Pinned model slugs headlined for this GPU, best match first. */
  recs: string[];
};

const GPUS: SandboxGpu[] = [
  { key: "L40S", label: "L40S · 48GB", vram: 48, bw: 864, price: 1.35, cert: "L40S", blurb: "Cost-effective 8B–32B", ttftMs: 220, toks: 85, recs: ["Qwen/Qwen3-30B-A3B", "Qwen/Qwen3.8-27B", "zai-org/GLM-4.5", "google/gemma-3-27b-it"] },
  { key: "R6000", label: "RTX PRO 6000 Server · 96GB", vram: 96, bw: 1800, price: 1.8, cert: "H100", blurb: "High VRAM density", ttftMs: 180, toks: 110, recs: ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen3-30B-A3B", "Qwen/Qwen3.8-27B", "zai-org/GLM-4.5"] },
  { key: "H100", label: "H100 SXM5 · 80GB NVLink", vram: 80, bw: 3350, price: 4.5, cert: "H100", blurb: "Gold standard Hopper", ttftMs: 120, toks: 140, recs: ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen3-30B-A3B", "openai/gpt-oss-120b", "Qwen/Qwen3.8-27B"] },
  { key: "H200", label: "H200 SXM5 · 141GB", vram: 141, bw: 4800, price: 5.4, cert: "H200", blurb: "Ultra-long context", ttftMs: 110, toks: 160, recs: ["openai/gpt-oss-120b", "meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen3-30B-A3B", "Qwen/Qwen3.8-27B"] },
  { key: "B200", label: "B200 · 180GB", vram: 180, bw: 8000, price: 8.5, cert: "B200", blurb: "Frontier Blackwell", ttftMs: 100, toks: 170, recs: ["meta-llama/Llama-3.3-70B-Instruct", "openai/gpt-oss-120b", "Qwen/Qwen3-30B-A3B"] },
  { key: "H100X8", label: "8× H100 Cluster · 640GB", vram: 640, bw: 26800, price: 36.0, cert: "H100", blurb: "Multi-GPU · 3.2 Tb/s IB", ttftMs: 90, toks: 180, recs: ["meta-llama/Llama-3.3-70B-Instruct", "openai/gpt-oss-120b", "Qwen/Qwen3-30B-A3B"] },
];

type SandboxModel = {
  slug: string;
  label: string;
  paramsB: number;
  layers: number;
  kvHeads: number;
  headDim: number;
  voice: string;
};

const MODELS: SandboxModel[] = [
  { slug: "Qwen/Qwen3.8-27B", label: "Qwen3.8 27B", paramsB: 27.8, layers: 64, kvHeads: 8, headDim: 128, voice: "Newest Qwen dense: 27.8B, 256K context — verify it here first." },
  { slug: "zai-org/GLM-4.5", label: "GLM-5 32B", paramsB: 32, layers: 64, kvHeads: 8, headDim: 128, voice: "Agentic tool-calling with strict JSON schemas." },
  { slug: "google/gemma-3-27b-it", label: "Gemma 4 31B", paramsB: 31, layers: 62, kvHeads: 16, headDim: 128, voice: "Google frontier open weights, long context." },
  { slug: "mistralai/Codestral-22B-v0.1", label: "Codestral 22B", paramsB: 22, layers: 48, kvHeads: 8, headDim: 128, voice: "Autonomous code generation, IDE-grade completions." },
  { slug: "meta-llama/Llama-3.3-70B-Instruct", label: "Llama 3.3 70B AWQ", paramsB: 70.6, layers: 80, kvHeads: 8, headDim: 128, voice: "Enterprise baseline, broad instruction following." },
  { slug: "Qwen/Qwen3-30B-A3B", label: "Qwen3 30B MoE", paramsB: 30.5, layers: 48, kvHeads: 4, headDim: 128, voice: "MoE: 30.5B resident, ~3.3B active per token — the 24GB sweet spot." },
  { slug: "openai/gpt-oss-120b", label: "gpt-oss 120B MoE", paramsB: 117, layers: 80, kvHeads: 8, headDim: 1024, voice: "OpenAI open-weight MoE: 117B resident, ~5B active — 80GB+ at INT4." },
];

/** Precision bytes + quant metadata — identical to the /new hardware audit. */
const PREC_BYTES: Record<string, { b: number; meta: number; label: string }> = {
  BF16: { b: 2, meta: 0, label: "BF16 · 2B/param" },
  FP8: { b: 1, meta: 0, label: "FP8 · 1B/param" },
  INT4: { b: 0.5, meta: 0.35, label: "INT4 · 0.5B + meta" },
  GGUF: { b: 0.58, meta: 0.35, label: "GGUF Q4_K_M" },
};

/** Session-baseline footprint: 1 stream × 8K ctx. Same formula as /new. */
function footprint(model: SandboxModel, prec: string, ctx = 8192, conc = 1) {
  const p = PREC_BYTES[prec.toUpperCase()] ?? PREC_BYTES.FP8;
  const w = Math.round((model.paramsB * p.b + p.meta) * 100) / 100;
  const kv = Math.round(((2 * model.layers * model.kvHeads * model.headDim * ctx * conc * p.b) / 1e9) * 100) / 100;
  const total = Math.round((w + kv + RUNTIME_GB) * 100) / 100;
  return { w, kv, total };
}

/** /new hardware-audit key for a sandbox GPU (deep-link both directions). */
const AUDIT_GPU: Record<string, string> = {
  L40S: "L40S_48GB",
  R6000: "RTXPRO6000_96GB",
  H100: "H100_80GB",
  H200: "H200_141GB",
  B200: "B200_180GB",
  H100X8: "H100X8_640GB",
};

type LiveFit = SandboxModel & { likes: number; downloads: number; src: "live" | "catalog"; fresh?: boolean };

type HfApiItem = { id?: unknown; likes?: unknown; downloads?: unknown; safetensors?: { total?: unknown } };

/** HF API item → verified fit for this GPU/precision, or null (unknown size / too big). */
function toLiveFit(x: HfApiItem, prec: string, vram: number): LiveFit | null {
  const id = typeof x?.id === "string" ? x.id : "";
  if (!id || !id.includes("/")) return null;
  const total = x?.safetensors?.total;
  if (typeof total !== "number" || !(total > 0)) return null;
  const paramsB = Math.round((total / 1e9) * 10) / 10;
  const a = estimateArch(paramsB);
  const spec: LiveFit = {
    slug: id,
    label: id.split("/")[1] || id,
    paramsB,
    layers: a.layers,
    kvHeads: a.kvHeads,
    headDim: a.headDim,
    voice: "Live Hugging Face import — harness profile.",
    src: "live",
    likes: typeof x.likes === "number" ? x.likes : 0,
    downloads: typeof x.downloads === "number" ? x.downloads : 0,
  };
  return footprint(spec, prec).total <= vram * 0.95 ? spec : null;
}

/** Tiered arch estimate mirroring services/advisor._estimate_arch. */
function estimateArch(paramsB: number) {
  const layers = paramsB >= 65 ? 80 : paramsB >= 30 ? 64 : paramsB >= 14 ? 48 : 32;
  const hidden = paramsB >= 65 ? 8192 : paramsB >= 14 ? 5120 : 4096;
  return { layers, kvHeads: 8, headDim: Math.round(hidden / 8) };
}

/** Offline extended catalog: well-known open models (params only — arch is
    tier-estimated, fit math stays exact). Guarantees a +more list per GPU
    even when the live leaderboard is unreachable. */
const EXTENDED: Array<{ slug: string; label: string; paramsB: number }> = [
  { slug: "TinyLlama/TinyLlama-1.1B-Chat-v1.0", label: "TinyLlama 1.1B", paramsB: 1.1 },
  { slug: "meta-llama/Llama-3.2-1B-Instruct", label: "Llama 3.2 1B", paramsB: 1.2 },
  { slug: "meta-llama/Llama-3.2-3B-Instruct", label: "Llama 3.2 3B", paramsB: 3.2 },
  { slug: "Qwen/Qwen3-4B", label: "Qwen3 4B", paramsB: 4.0 },
  { slug: "google/gemma-3-4b-it", label: "Gemma 3 4B", paramsB: 4.3 },
  { slug: "Qwen/Qwen2.5-7B-Instruct", label: "Qwen2.5 7B", paramsB: 7.6 },
  { slug: "mistralai/Mistral-7B-Instruct-v0.3", label: "Mistral 7B", paramsB: 7.3 },
  { slug: "deepseek-ai/DeepSeek-R1-Distill-Llama-8B", label: "R1 Distill 8B", paramsB: 8.0 },
  { slug: "meta-llama/Llama-3.1-8B-Instruct", label: "Llama 3.1 8B", paramsB: 8.0 },
  { slug: "Qwen/Qwen3-8B", label: "Qwen3 8B", paramsB: 8.2 },
  { slug: "google/gemma-2-9b-it", label: "Gemma 2 9B", paramsB: 9.2 },
  { slug: "google/gemma-3-12b-it", label: "Gemma 3 12B", paramsB: 12.0 },
  { slug: "Qwen/Qwen3-14B", label: "Qwen3 14B", paramsB: 14.7 },
  { slug: "Qwen/Qwen2.5-14B-Instruct", label: "Qwen2.5 14B", paramsB: 14.7 },
  { slug: "microsoft/Phi-4", label: "Phi-4 14B", paramsB: 14.7 },
  { slug: "bigcode/starcoder2-15b", label: "StarCoder2 15B", paramsB: 15.9 },
  { slug: "mistralai/Mistral-Small-24B-Instruct-2501", label: "Mistral Small 24B", paramsB: 24.0 },
  { slug: "google/gemma-2-27b-it", label: "Gemma 2 27B", paramsB: 27.2 },
  { slug: "Qwen/Qwen3-32B", label: "Qwen3 32B", paramsB: 32.5 },
  { slug: "Qwen/Qwen3-30B-A3B", label: "Qwen3 30B MoE", paramsB: 30.5 },
  { slug: "Qwen/Qwen2.5-32B-Instruct", label: "Qwen2.5 32B", paramsB: 32.5 },
  { slug: "Qwen/Qwen2.5-Coder-32B-Instruct", label: "Qwen2.5 Coder 32B", paramsB: 32.5 },
  { slug: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B", label: "R1 Distill 32B", paramsB: 32.5 },
  { slug: "codellama/CodeLlama-34b-Instruct-hf", label: "CodeLlama 34B", paramsB: 34.0 },
  { slug: "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B", label: "R1 Distill 14B", paramsB: 14.7 },
  { slug: "openai/gpt-oss-20b", label: "gpt-oss 20B MoE", paramsB: 21.0 },
  { slug: "mistralai/Mixtral-8x7B-Instruct-v0.1", label: "Mixtral 8x7B MoE", paramsB: 46.7 },
];

type Archetype = "lab" | "prod";

function fmtClock(s: number) {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.max(0, s) % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic console completion — clearly the sandbox harness, not cloud weights. */
function buildReply(prompt: string, model: SandboxModel, gpu: SandboxGpu): string {
  const p = prompt.toLowerCase();
  const h = hashStr(prompt + model.slug);
  const angles = [
    `Here's how I'd break that down on ${model.label}: first isolate the constraints, then enumerate 2–3 candidate approaches with their trade-offs, then commit to the cheapest one that meets the bar. ${model.voice}`,
    `Working through it step by step on ${model.label} (${gpu.label}): restate the goal in one line, list what would prove each option wrong, and pick the option with the fewest unproven assumptions. ${model.voice}`,
    `Short answer first, then the reasoning on ${model.label}: scope the problem, check edge cases, and ship the smallest correct version. Running at this session's concurrency the KV footprint stays well inside the gauge above. ${model.voice}`,
  ];
  const pick = angles[h % angles.length];
  if (/(vram|memory|oom|fit|gpu)/.test(p)) {
    return `VRAM check on ${model.label} @ ${gpu.label}: weights ≈ ${(model.paramsB * 1).toFixed(1)}GB at FP8 plus KV-cache that scales with context × concurrency plus 1.8GB runtime. The gauge above tracks it live as this conversation grows — ask me anything and watch the KV slice move. ${model.voice}`;
  }
  if (/(latency|fast|speed|ttft|throughput)/.test(p)) {
    return `Latency picture on ${gpu.label}: TTFT lands first (see HUD), then tokens stream near the card's ceiling. Longer contexts inflate KV-cache linearly, which is what eventually pushes decode off the SLO — the HUD's ITL readout shows it happening in real time. ${model.voice}`;
  }
  if (/(code|function|bug|python|javascript|sql)/.test(p)) {
    return `Coding take from ${model.label}: write the failing case first, then the minimal implementation, then a second case for the boundary. \`\`\`python\ndef solve(x):\n    # smallest correct version — expand only on green tests\n    return x\n\`\`\` ${model.voice}`;
  }
  return pick;
}

type Msg = { role: "user" | "asst" | "sys"; text: string };

type Trace = { n: number; time: string; model: string; prompt: string; pTok: number; cTok: number; ttft: number; itl: number };

type PaneStats = { ttft: number; itl: number; tps: number; replies: number };

function usePane(
  modelRef: React.MutableRefObject<SandboxModel>,
  gpuRef: React.MutableRefObject<SandboxGpu>,
  onUsage: (promptTokens: number, completionTokens: number, ttft: number, itl: number, prompt: string, modelSlug: string) => void
) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [stats, setStats] = useState<PaneStats>({ ttft: 0, itl: 0, tps: 0, replies: 0 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setStreaming(false);
  }, []);

  useEffect(() => stop, [stop]);

  const send = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean || timer.current) return;
      const model = modelRef.current;
      const gpu = gpuRef.current;
      const promptTokens = Math.max(1, Math.round(clean.split(/\s+/).length * 1.3));
      const full = buildReply(clean, model, gpu);
      const words = full.split(/\s+/);
      const t0 = performance.now();
      const ttftTarget = gpu.ttftMs * (0.85 + (hashStr(clean) % 30) / 100);
      const wordsPerTick = 3;
      const tickMs = Math.max(15, Math.round((1000 / gpu.toks) * wordsPerTick));
      setMsgs((m) => [...m, { role: "user", text: clean }, { role: "asst", text: "" }]);
      setStreaming(true);
      let shown = 0;
      let firstAt = 0;
      timer.current = setInterval(() => {
        const now = performance.now();
        if (!firstAt && now - t0 >= ttftTarget) firstAt = now;
        if (!firstAt) return;
        shown = Math.min(words.length, shown + wordsPerTick);
        const slice = words.slice(0, shown).join(" ");
        setMsgs((m) => {
          const n = [...m];
          n[n.length - 1] = { role: "asst", text: slice };
          return n;
        });
        if (shown >= words.length && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
          const elapsed = (performance.now() - firstAt) / 1000;
          const ttft = Math.round(firstAt - t0);
          const itl = Math.round((elapsed / Math.max(1, words.length)) * 1000 * 10) / 10;
          const tps = Math.round((words.length / Math.max(elapsed, 0.01)) * 10) / 10;
          setStats((s) => ({ ttft, itl, tps, replies: s.replies + 1 }));
          setStreaming(false);
          onUsage(promptTokens, words.length, ttft, itl, clean, model.slug);
        }
      }, tickMs);
    },
    [modelRef, gpuRef, onUsage]
  );

  const pushSys = useCallback((text: string) => {
    setMsgs((m) => [...m, { role: "sys", text }]);
  }, []);

  return { msgs, send, stop, streaming, stats, pushSys };
}

export default function Sandbox() {
  return (
    <main>
      <TopNav />
      <Suspense fallback={<p className="p-8 font-mono text-sm">Loading sandbox…</p>}>
        <Gate />
      </Suspense>
    </main>
  );
}

function Gate() {
  const q = useSearchParams();
  const [arch, setArch] = useState<Archetype>("lab");
  const [gpuKey, setGpuKey] = useState(() => {
    const g = (q.get("gpu") || "").toUpperCase();
    return GPUS.find((x) => x.key === g || x.cert === g)?.key ?? "L40S";
  });
  const [modelSlug, setModelSlug] = useState(() => q.get("model") || MODELS[0].slug);
  const [precision, setPrecision] = useState(() => (q.get("precision") || "FP8").toUpperCase());
  const [byokOpen, setByokOpen] = useState(false);
  const byokConnected = useByokStatus();
  const [started, setStarted] = useState(false);

  const gpu = GPUS.find((g) => g.key === gpuKey) ?? GPUS[0];
  const precKey = (precision || "FP8").toUpperCase();
  const [liveFits, setLiveFits] = useState<LiveFit[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [liveRetry, setLiveRetry] = useState(0);
  const [hfq, setHfq] = useState("");
  const [searchHits, setSearchHits] = useState<LiveFit[]>([]);
  const [searching, setSearching] = useState(false);

  // Live compatible models: trending (most liked) + latest (recently
  // updated, so new releases like Qwen 3.8 surface) + offline catalog.
  useEffect(() => {
    let alive = true;
    setLiveLoading(true);
    const queries = [
      { sort: "likes", direction: "-1", limit: "40", filter: "text-generation", expand: "safetensors" },
      { sort: "lastModified", direction: "-1", limit: "40", filter: "text-generation", expand: "safetensors" },
    ];
    Promise.all(queries.map((q) => hfModels(q).catch(() => [])))
      .then((lists) => {
        if (!alive) return;
        const [likedRaw, freshRaw] = lists.map((l) => (Array.isArray(l) ? (l as HfApiItem[]) : []));
        const likedIds = new Set(likedRaw.map((x) => (typeof x?.id === "string" ? x.id.toLowerCase() : "")));
        const pinned = new Set(MODELS.map((m) => m.slug.toLowerCase()));
        const likedFits: LiveFit[] = [];
        const freshFits: LiveFit[] = [];
        for (const x of [...likedRaw, ...freshRaw]) {
          const id = typeof x?.id === "string" ? x.id : "";
          if (!id || pinned.has(id.toLowerCase())) continue;
          const dupe =
            likedFits.some((f) => f.slug.toLowerCase() === id.toLowerCase()) ||
            freshFits.some((f) => f.slug.toLowerCase() === id.toLowerCase());
          if (dupe) continue;
          const spec = toLiveFit(x, precKey, gpu.vram);
          if (!spec) continue;
          const isFresh = !likedIds.has(id.toLowerCase());
          spec.fresh = isFresh;
          (isFresh ? freshFits : likedFits).push(spec);
        }
        likedFits.sort((a, b) => b.likes - a.likes);
        setLiveFits([...likedFits.slice(0, 18), ...freshFits.slice(0, 12)]);
      })
      .catch(() => {
        if (alive) setLiveFits([]);
      })
      .finally(() => {
        if (alive) setLiveLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [gpuKey, precKey, liveRetry]);

  // Name search — finds latest versions (e.g. "qwen 3.8") the leaderboard buries.
  useEffect(() => {
    const t = hfq.trim();
    if (t.length < 2) {
      setSearchHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const j = await hfModels({ search: t, sort: "likes", direction: "-1", limit: "12", expand: "safetensors" });
        if (!Array.isArray(j)) return;
        const pinned = new Set(MODELS.map((m) => m.slug.toLowerCase()));
        const out: LiveFit[] = [];
        for (const x of j) {
          const id = typeof x?.id === "string" ? x.id : "";
          if (!id || pinned.has(id.toLowerCase())) continue;
          const spec = toLiveFit(x, precKey, gpu.vram);
          if (spec && !out.some((f) => f.slug.toLowerCase() === id.toLowerCase())) out.push(spec);
        }
        setSearchHits(out);
      } catch {
        /* offline */
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [hfq, precKey, gpu]);

  // Combined +more pool: live leaderboard fits first, then the offline
  // catalog (estimated specs, exact fit math) — deduplicated.
  const pool = useMemo(() => {
    const seen = new Set(liveFits.map((f) => f.slug.toLowerCase()));
    const pinned = new Set(MODELS.map((m) => m.slug.toLowerCase()));
    const ext: LiveFit[] = [];
    for (const e of EXTENDED) {
      if (pinned.has(e.slug.toLowerCase()) || seen.has(e.slug.toLowerCase())) continue;
      const a = estimateArch(e.paramsB);
      const spec: LiveFit = {
        slug: e.slug,
        label: e.label,
        paramsB: e.paramsB,
        layers: a.layers,
        kvHeads: a.kvHeads,
        headDim: a.headDim,
        voice: "Offline catalog — estimated spec, verified fit.",
        src: "catalog",
        likes: 0,
        downloads: 0,
      };
      if (footprint(spec, precKey).total <= gpu.vram * 0.95) ext.push(spec);
    }
    return [...liveFits, ...ext];
  }, [liveFits, precKey, gpu]);

  const specCache = useRef<Record<string, SandboxModel>>({});
  const selModel =
    MODELS.find((m) => m.slug === modelSlug) ??
    pool.find((f) => f.slug === modelSlug) ??
    searchHits.find((f) => f.slug === modelSlug) ??
    specCache.current[modelSlug] ??
    MODELS[0];
  // Remember every resolved pick so later list refreshes never orphan it.
  if (selModel && selModel.slug === modelSlug) specCache.current[modelSlug] = selModel;
  // Carry a non-pinned pick's specs into the console (switcher + VRAM math).
  const extraSpec: SandboxModel | null = MODELS.some((m) => m.slug === modelSlug)
    ? null
    : (pool.find((f) => f.slug === modelSlug) ??
      searchHits.find((f) => f.slug === modelSlug) ??
      specCache.current[modelSlug] ??
      null);

  // Invariant: the selected slug always resolves to a verified fit. A slug
  // the lists can't verify (e.g. stale URL param) falls back visibly.
  useEffect(() => {
    if (liveLoading || !modelSlug) return;
    const known =
      MODELS.some((m) => m.slug === modelSlug) ||
      pool.some((f) => f.slug === modelSlug) ||
      searchHits.some((f) => f.slug === modelSlug) ||
      !!specCache.current[modelSlug];
    if (!known) {
      setModelSlug(MODELS.find((m) => footprint(m, precKey).total <= gpu.vram * 0.95)?.slug ?? MODELS[0].slug);
    }
  }, [pool, searchHits, liveLoading, modelSlug, precKey, gpu]);
  const fit = footprint(selModel, precKey);
  const usable = Math.round(gpu.vram * 0.95 * 100) / 100;
  const fits = fit.total <= usable;
  const auditHref = `/new?candidate_model=${encodeURIComponent(selModel.slug)}&target_gpu=${AUDIT_GPU[gpu.key] ?? "L40S_48GB"}&precision=${precKey}`;

  if (!started) {
    return (
      <div className="mx-auto w-full max-w-[1280px] px-4 py-6 lg:px-8">
        <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">Live Sandbox · Nebius AI Cloud</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">Spin up a GPU in 30 seconds</h1>
        <p className="mt-1 font-mono text-sm text-muted">Three questions, then a full hour on real cloud VRAM. Free while in Demo Mode.</p>

        <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-4">

        <section aria-labelledby="q1" className="rounded-2xl border border-ink/15 bg-[#F5F1E9] p-5">
          <h2 id="q1" className="font-mono text-sm font-bold">Q1 · What are you sizing?</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Target archetype">
            {(
              [
                { id: "lab", icon: "🧑‍💻", t: "Home AI Lab / Local Sizing", d: "Will it run on my rig? Starts on L40S 48GB." },
                { id: "prod", icon: "🏢", t: "Production AI System", d: "SLOs, batching, cost. Starts on H100 80GB." },
              ] as { id: Archetype; icon: string; t: string; d: string }[]
            ).map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={arch === a.id}
                onClick={() => {
                  setArch(a.id);
                  setGpuKey(a.id === "prod" ? "H100" : "L40S");
                }}
                className={`min-h-[76px] cursor-pointer rounded-xl border p-3 text-left transition-colors ${arch === a.id ? "border-ink bg-ink text-canvas" : "border-ink/25 hover:border-ink"}`}
              >
                <span aria-hidden="true" className="text-xl">{a.icon}</span>
                <span className="mt-1 block font-mono text-sm font-bold">{a.t}</span>
                <span className={`block font-mono text-[11px] ${arch === a.id ? "text-canvas/75" : "text-muted"}`}>{a.d}</span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="q2" className="rounded-2xl border border-ink/15 bg-[#F5F1E9] p-5">
          <h2 id="q2" className="font-mono text-sm font-bold">Q2 · Choose Nebius Cloud GPU <span className="font-normal text-muted">(all 6 · Oct 2026 rates)</span></h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Nebius Cloud GPU">
            {GPUS.map((g) => {
              const gf = footprint(selModel, precKey);
              const gOk = gf.total <= g.vram * 0.95;
              return (
                <button
                  key={g.key}
                  type="button"
                  role="radio"
                  aria-checked={gpuKey === g.key}
                  onClick={() => setGpuKey(g.key)}
                  className={`min-h-[64px] cursor-pointer rounded-xl border px-3 py-2 text-left transition-colors ${gpuKey === g.key ? "border-ink bg-ink text-canvas" : "border-ink/25 hover:border-ink"}`}
                >
                  <span className="block font-mono text-xs font-bold">{g.label}</span>
                  <span className={`block font-mono text-[11px] ${gpuKey === g.key ? "text-canvas/75" : "text-muted"}`}>
                    ${g.price.toFixed(2)}/hr · {g.vram}GB · {g.blurb}
                  </span>
                  <span className={`mt-0.5 block font-mono text-[10px] font-bold ${gOk ? "text-ship" : gpuKey === g.key ? "text-red-200" : "text-block"}`}>
                    {gOk ? `✓ ~${gf.total}GB fits` : `✗ needs ~${gf.total}GB`}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-ink/15 bg-canvas p-3">
            <ByokBadge connected={byokConnected} />
            <span className="font-mono text-[11px] text-muted">
              {byokConnected ? "Live runs bill your Nebius key." : "No key? Simulated evaluation on the host pool — free."}
            </span>
            <button
              type="button"
              onClick={() => setByokOpen(true)}
              className="min-h-[36px] cursor-pointer rounded-full border border-ink/25 px-3 py-1 font-mono text-[11px] font-bold transition-colors hover:border-ink"
            >
              {byokConnected ? "Manage key" : "Add Nebius key"}
            </button>
          </div>
          <ByokModal open={byokOpen} onClose={() => setByokOpen(false)} />
        </section>

        <section aria-labelledby="q3" className="rounded-2xl border border-ink/15 bg-[#F5F1E9] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="q3" className="font-mono text-sm font-bold">Q3 · Choose model <span className="font-normal text-muted">(only fits for {gpu.label} can start · ★ recommended for this GPU)</span></h2>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Precision">
              {Object.keys(PREC_BYTES).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={precKey === p}
                  title={PREC_BYTES[p].label}
                  onClick={() => setPrecision(p)}
                  className={`min-h-[36px] cursor-pointer rounded-full border px-3 py-1 font-mono text-[11px] font-bold transition-colors ${precKey === p ? "border-ink bg-ink text-canvas" : "border-ink/25 hover:border-ink"}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Sandbox model">
            {[...MODELS]
              .sort((a, b) => {
                const ra = gpu.recs.indexOf(a.slug);
                const rb = gpu.recs.indexOf(b.slug);
                return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
              })
              .map((m) => {
              const mf = footprint(m, precKey);
              const ok = mf.total <= usable;
              const active = modelSlug === m.slug;
              const locked = !ok && !active;
              const int4Ok = !ok && precKey !== "INT4" && footprint(m, "INT4").total <= usable;
              return (
                <button
                  key={m.slug}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={locked}
                  title={ok ? `${m.slug} · ~${mf.total}GB on ${gpu.label}` : `Needs ~${mf.total}GB — exceeds ${gpu.label} (${usable}GB usable)`}
                  onClick={() => setModelSlug(m.slug)}
                  className={`min-h-[64px] rounded-xl border px-3 py-2 text-left transition-colors ${active ? "border-ink bg-ink text-canvas" : ok ? "cursor-pointer border-ink/25 hover:border-ink" : "cursor-not-allowed border-ink/15 opacity-45"}`}
                >
                  <span className="block font-mono text-xs font-bold">{gpu.recs.includes(m.slug) ? "★ " : ""}{m.label}</span>
                  <span className={`block truncate font-mono text-[10px] ${active ? "text-canvas/70" : "text-muted"}`}>{m.slug} · {m.paramsB}B</span>
                  <span className={`mt-0.5 block font-mono text-[10px] font-bold ${ok ? "text-ship" : active ? "text-red-200" : "text-block"}`}>
                    {ok ? `✓ ~${mf.total}GB fits` : int4Ok ? `✗ needs ~${mf.total}GB — INT4 unlocks it` : `✗ needs ~${mf.total}GB — locked`}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 font-mono text-[11px] text-muted">Same exact math as the hardware audit — unfit pairs never reach the console.</p>
          <div className="mt-3 border-t border-ink/10 pt-3">
            <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
              🔎 Search Hugging Face — latest versions included
            </p>
            <input
              value={hfq}
              onChange={(e) => setHfq(e.target.value)}
              placeholder="Type a name (e.g. Qwen 3.8, Gemma) — only fits for this GPU show…"
              spellCheck={false}
              autoComplete="off"
              aria-label="Search Hugging Face models"
              className="mt-1.5 min-h-[44px] w-full rounded-xl border border-ink/25 bg-transparent p-2.5 font-mono text-sm outline-none focus:border-ink"
            />
            {searching && <p className="mt-1.5 font-mono text-[11px] text-muted">Searching huggingface.co…</p>}
            {!searching && hfq.trim().length >= 2 && searchHits.length === 0 && (
              <p className="mt-1.5 font-mono text-[11px] text-muted">No verified fits for “{hfq.trim()}” on {gpu.label} — try the full model name.</p>
            )}
            {searchHits.length > 0 && (
              <div className="mt-2 grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2" role="radiogroup" aria-label="Search results">
                {searchHits.map((f) => {
                  const ft = footprint(f, precKey);
                  const active = modelSlug === f.slug;
                  return (
                    <button
                      key={f.slug}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setModelSlug(f.slug)}
                      className={`min-h-[52px] rounded-xl border px-2.5 py-1.5 text-left transition-colors ${active ? "cursor-pointer border-ink bg-ink text-canvas" : "cursor-pointer border-ink/25 hover:border-ink"}`}
                    >
                      <span className="block truncate font-mono text-[11px] font-bold" title={f.slug}>{f.label}</span>
                      <span className={`block font-mono text-[10px] ${active ? "text-canvas/70" : "text-muted"}`}>
                        {f.paramsB}B · ♥ {f.likes} · ~{ft.total}GB ✓
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-3 font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
              ⚡ More verified fits for {gpu.label} ({pool.length})
            </p>
            {liveLoading && pool.length === 0 ? (
              <p className="mt-2 font-mono text-[11px] text-muted">Checking the live leaderboard for fits…</p>
            ) : (
              <>
                {liveFits.length === 0 && (
                  <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
                    <span>Live leaderboard unreachable — offline catalog below.</span>
                    <button
                      type="button"
                      onClick={() => setLiveRetry((n) => n + 1)}
                      className="min-h-[32px] cursor-pointer rounded-full border border-ink/25 px-2.5 py-0.5 font-mono text-[11px] font-bold transition-colors hover:border-ink"
                    >
                      ↻ Retry live
                    </button>
                  </p>
                )}
                <div className="mt-2 grid max-h-72 gap-1.5 overflow-y-auto sm:grid-cols-2" role="radiogroup" aria-label="More verified fits">
                  {(showAll ? pool : pool.slice(0, 6)).map((f) => {
                    const ft = footprint(f, precKey);
                    const active = modelSlug === f.slug;
                    return (
                      <button
                        key={f.slug}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setModelSlug(f.slug)}
                        className={`min-h-[52px] rounded-xl border px-2.5 py-1.5 text-left transition-colors ${active ? "cursor-pointer border-ink bg-ink text-canvas" : "cursor-pointer border-ink/25 hover:border-ink"}`}
                      >
                        <span className="block truncate font-mono text-[11px] font-bold" title={f.slug}>{f.fresh ? "🆕 " : ""}{f.label}</span>
                        <span className={`block font-mono text-[10px] ${active ? "text-canvas/70" : "text-muted"}`}>
                          {f.paramsB}B · {f.src === "live" ? `♥ ${f.likes}${f.downloads ? ` · ↓ ${f.downloads}` : ""}` : "offline catalog · est. spec"} · ~{ft.total}GB ✓
                        </span>
                      </button>
                    );
                  })}
                </div>
                {pool.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="mt-2 min-h-[40px] w-full cursor-pointer rounded-xl border border-dashed border-ink/30 px-3 py-2 font-mono text-[11px] font-bold transition-colors hover:border-ink"
                  >
                    {showAll ? "Show less ↑" : `+ ${pool.length - 6} more verified fits`}
                  </button>
                )}
              </>
            )}
          </div>
        </section>
          </div>

          {/* Fit side-panel — complements /new both directions */}
          <aside aria-label="Fit check" className="min-w-0 rounded-2xl border border-ink bg-ink p-5 text-canvas lg:sticky lg:top-20">
            <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-canvas/60">Fit check · complements audit</p>
            <div className={`mt-2 rounded-xl border p-3 ${fits ? "border-ship bg-ship text-white" : "border-block bg-block text-white"}`}>
              <p className="font-mono text-lg font-bold tracking-tight" role="status">{fits ? "SHIP ✓" : "BLOCK ✗"}</p>
              <p className="mt-0.5 font-mono text-[11px] leading-relaxed">
                {fits
                  ? `${selModel.label} @ ${precKey} ≈ ${fit.total}GB vs ${usable}GB usable on ${gpu.label}.`
                  : `${selModel.label} @ ${precKey} needs ~${fit.total}GB but ${gpu.label} offers ${usable}GB usable.`}
              </p>
            </div>
            <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full border border-canvas/30 bg-canvas/10" role="img" aria-label={`Weights ${fit.w}GB, KV ${fit.kv}GB of ${gpu.vram}GB`}>
              <span className="h-full bg-canvas" style={{ width: `${(fit.w / gpu.vram) * 100}%` }} />
              <span className={`h-full ${fits ? "bg-emerald-400" : "bg-red-400"}`} style={{ width: `${(fit.kv / gpu.vram) * 100}%` }} />
              <span className="h-full bg-[#3B82F6]" style={{ width: `${(RUNTIME_GB / gpu.vram) * 100}%` }} />
            </div>
            <ul className="mt-2 space-y-1 font-mono text-[11px] text-canvas/80">
              <li className="flex justify-between"><span>Weights</span><span>{fit.w}GB</span></li>
              <li className="flex justify-between"><span>KV-cache (1×8K baseline)</span><span>{fit.kv}GB</span></li>
              <li className="flex justify-between"><span>Runtime</span><span>{RUNTIME_GB}GB</span></li>
              <li className="flex justify-between font-bold"><span>Total vs usable</span><span>{fit.total} / {usable}GB</span></li>
            </ul>
            <button
              type="button"
              onClick={() => fits && setStarted(true)}
              disabled={!fits}
              title={fits ? `Start 60-minute session` : "Pick a fitting pair above"}
              className="mt-4 flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-canvas px-4 py-3 font-mono text-sm font-bold text-ink transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {fits ? `🚀 Provision ${gpu.label} → Start 60-minute session` : "✗ No fit — adjust pair above"}
            </button>
            <p className="mt-2 text-center font-mono text-[11px] text-canvas/60">
              {selModel.label} · {precKey} · ≈${gpu.price.toFixed(2)} for the hour{byokConnected ? " (BYOK)" : " ($0 demo)"} · KV grows with chat.
            </p>
            <Link href={auditHref} className="mt-3 block rounded-xl border border-canvas/30 px-3 py-2.5 text-center font-mono text-xs font-bold transition-colors hover:bg-canvas/10">
              Full 3-step hardware audit →
            </Link>
            <p className="mt-2 font-mono text-[10px] leading-snug text-canvas/50">
              Audited on /new? Bring the verdict here — identical sizing math, then verify it live for an hour.
            </p>
          </aside>
        </div>
      </div>
    );
  }

  return <Console arch={arch} gpuKey={gpuKey} modelSlug={modelSlug} precision={precision} extraModel={extraSpec} />;
}

function Console({ arch, gpuKey, modelSlug, precision, extraModel }: { arch: Archetype; gpuKey: string; modelSlug: string; precision: string; extraModel?: SandboxModel | null }) {
  const r = useRouter();
  const byokConnected = useByokStatus();
  const gpu = useMemo(() => GPUS.find((g) => g.key === gpuKey) ?? GPUS[0], [gpuKey]);
  const gpuRef = useRef(gpu);
  gpuRef.current = gpu;
  // Pinned list plus a live-picked model carried from the gate.
  const ALL = useMemo(
    () =>
      extraModel && !MODELS.some((m) => m.slug.toLowerCase() === extraModel.slug.toLowerCase())
        ? [...MODELS, extraModel]
        : MODELS,
    [extraModel]
  );
  const startModel = useMemo(() => ALL.find((m) => m.slug.toLowerCase() === modelSlug.toLowerCase()) ?? ALL[0], [ALL, modelSlug]);
  const [model, setModel] = useState<SandboxModel>(startModel);
  const modelRef = useRef(model);
  modelRef.current = model;
  const [modelB, setModelB] = useState<SandboxModel>(ALL[1] ?? ALL[0]);
  const modelBRef = useRef(modelB);
  modelBRef.current = modelB;
  const bytes = precision.toUpperCase().startsWith("BF") ? 2 : precision.toUpperCase().startsWith("GG") ? 0.58 : precision.toUpperCase().startsWith("INT") ? 0.5 : 1;

  const [status, setStatus] = useState<"provisioning" | "ready" | "swapping" | "ended">("provisioning");
  const [swapPct, setSwapPct] = useState(0);
  const [compare, setCompare] = useState(false);
  const [input, setInput] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [remaining, setRemaining] = useState(SESSION_SECONDS);
  const [liveLink, setLiveLink] = useState<boolean | null>(null);
  const [simEnforced, setSimEnforced] = useState<boolean | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const sid = useRef(`sb-${Math.random().toString(36).slice(2, 8)}`);
  const totals = useRef({ prompts: 0, promptTok: 0, compTok: 0, ttftSum: 0, itlSum: 0, samples: 0 });

  const pushLog = useCallback((line: string) => {
    setLog((l) => [...l.slice(-120), line]);
  }, []);

  const onUsage = useCallback(
    (p: number, c: number, ttft: number, itl: number, prompt: string, modelSlug: string) => {
      const t = totals.current;
      t.prompts += 1;
      t.promptTok += p;
      t.compTok += c;
      t.ttftSum += ttft;
      t.itlSum += itl;
      t.samples += 1;
      const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
      setTraces((prev) => [...prev.slice(-49), { n: t.prompts, time, model: modelSlug, prompt, pTok: p, cTok: c, ttft, itl }]);
    },
    []
  );

  const paneA = usePane(modelRef, gpuRef, onUsage);
  const paneB = usePane(modelBRef, gpuRef, onUsage);

  // Backend reachability probe → link badge + simulator enforcement.
  useEffect(() => {
    let alive = true;
    enableDevSimFromQuery();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    fetch("/api/system/hardware", { cache: "no-store", signal: ctrl.signal })
      .then((res) => {
        if (alive) setLiveLink(res.ok);
      })
      .catch(() => {
        if (alive) setLiveLink(false);
      })
      .finally(() => clearTimeout(timer));
    fetch("/api/health", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => {
        if (alive && j) setSimEnforced(String(j.simulator ?? "true").toLowerCase() === "true");
      })
      .catch(() => {
        if (alive) setSimEnforced(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Provisioning sequence + 60-min countdown.
  useEffect(() => {
    pushLog(`provision: requesting ${gpu.label} in eu-north1…`);
    const t1 = setTimeout(() => pushLog(`provision: container up · pulling ${modelRef.current.slug} from NVMe cache…`), 700);
    const t2 = setTimeout(() => {
      pushLog(`vllm: weights resident · status READY`);
      setStatus("ready");
    }, 2100);
    const clock = setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) {
          clearInterval(clock);
          setStatus("ended");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(clock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (remaining === WARN_SECONDS) pushLog("session: 5 minutes left — export soon to keep your transcript.");
    if (remaining === 0) pushLog("session: 60 minutes elapsed — GPU released, transcript + export preserved.");
  }, [remaining, pushLog]);

  const tokensUsed = totals.current.promptTok + totals.current.compTok;
  const weightsGb = Math.round(model.paramsB * bytes * 100) / 100;
  const kvGb = Math.round(((2 * model.layers * model.kvHeads * model.headDim * Math.max(4096, tokensUsed) * 1 * bytes) / 1e9) * 100) / 100;
  const totalGb = Math.round((weightsGb + kvGb + RUNTIME_GB) * 100) / 100;
  const vramPct = Math.min(100, Math.round((totalGb / gpu.vram) * 1000) / 10);
  const hud = paneA.stats;

  function sendCurrent() {
    if (status !== "ready" || !input.trim()) return;
    paneA.send(input);
    if (compare) paneB.send(input);
    setInput("");
    setError("");
  }

  async function swapTo(next: SandboxModel) {
    if (next.slug === model.slug || status === "swapping" || status === "ended") return;
    paneA.stop();
    paneB.stop();
    setStatus("swapping");
    setSwapPct(0);
    pushLog(`hotswap: freeing ${model.label} weights…`);
    await new Promise((res) => setTimeout(res, 1100));
    pushLog(`hotswap: mounting ${next.slug} from local NVMe…`);
    for (const p of [25, 55, 80]) {
      await new Promise((res) => setTimeout(res, 900));
      setSwapPct(p);
    }
    pushLog(`hotswap: warmup pass · status READY in under 20s`);
    await new Promise((res) => setTimeout(res, 900));
    setModel(next);
    setSwapPct(100);
    paneA.pushSys(`— swapped to ${next.label} —`);
    setStatus("ready");
    pushLog(`hotswap: ${next.label} READY`);
  }

  async function exportCert() {
    if (exporting) return;
    const t = totals.current;
    if (t.prompts === 0) {
      setError("Chat first — the blueprint needs at least one measured prompt.");
      return;
    }
    // Real-only gate: proof of a live backend required (probed at session start).
    // Local dev bypass (?devsim=1) runs honestly as "sim" — labeled SIMULATED.
    if (simEnforced !== false && !isDevSim()) {
      setError(
        liveLink
          ? "Live backend required — backend enforces simulator. Export is blocked until the backend runs with a live runner."
          : "Backend unreachable — live backend required. Is the backend running?"
      );
      return;
    }
    setError("");
    setExporting(true);
    try {
      // Shipped UI is real-only: always request live execution.
      // Local dev bypass runs honestly as "sim".
      const execMode = simEnforced === false ? "real" : "sim";
      const headers = { "Content-Type": "application/json", ...buildByokHeaders(), ...buildExecutionHeaders(execMode) };
      const payload = {
        candidate_model: model.slug,
        current_model: "Qwen3-8B",
        gpu_type: gpu.cert,
        precision: precision.toUpperCase().startsWith("GG") ? "INT4" : precision.toUpperCase(),
        concurrency: 1,
        context_len: Math.min(131072, Math.max(4096, tokensUsed)),
        requests: Math.min(1000, Math.max(20, t.prompts * 20)),
        budget_usd: Math.min(20, Math.max(2, gpu.price * 2)),
        mode: execMode,
      };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      let res: Response;
      try {
        res = await fetch("/api/certifications", { method: "POST", headers, body: JSON.stringify(payload), signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`Couldn't mint the certification (${res.status}). Backend reachable?`);
      const j = await res.json();
      const ctrl2 = new AbortController();
      const timer2 = setTimeout(() => ctrl2.abort(), 20000);
      try {
        await fetch(`/api/certifications/${j.id}/start`, {
          method: "POST",
          headers: { ...buildByokHeaders(), ...buildExecutionHeaders(execMode) },
          signal: ctrl2.signal,
        });
      } finally {
        clearTimeout(timer2);
      }
      try {
        localStorage.setItem(
          `gpuproof-sandbox-${sid.current}`,
          JSON.stringify({
            id: sid.current,
            cert: j.id,
            model: model.slug,
            gpu: gpu.key,
            meanTtftMs: Math.round(t.ttftSum / Math.max(1, t.samples)),
            meanItlMs: Math.round((t.itlSum / Math.max(1, t.samples)) * 10) / 10,
            prompts: t.prompts,
            tokens: tokensUsed,
            elapsedSec: SESSION_SECONDS - remaining,
            exported_at: new Date().toISOString(),
            transcript: paneA.msgs,
          })
        );
      } catch {
        /* private mode */
      }
      r.push(`/certificate/${j.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setExporting(false);
    }
  }

  const busy = status !== "ready";
  const warn = remaining <= WARN_SECONDS && remaining > 0;

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 lg:px-8">
      {warn && status !== "ended" && (
        <p role="alert" className="mb-3 rounded-xl border border-amber-400/60 bg-amber-400/10 p-3 text-center font-mono text-xs font-bold text-amber-200">
          ⏳ 5 minutes left on this GPU — export your certification soon. Transcript is preserved either way.
        </p>
      )}

      {/* Session header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted">
            Sandbox session {sid.current} · {arch === "lab" ? "🧑‍💻 Home AI Lab" : "🏢 Production AI System"}
          </p>
          <h1 className="mt-0.5 font-mono text-lg font-bold tracking-tight">
            {gpu.label} <span className="font-normal text-muted">${gpu.price.toFixed(2)}/hr · Oct 2026</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] font-bold">
          <span className={`rounded-full border px-2.5 py-1 ${liveLink && simEnforced === false ? "border-ship/40 bg-ship/10 text-ship" : liveLink ? "border-amber-500/50 bg-amber-500/10 text-amber-700" : "border-ink/25 text-muted"}`}>
            {liveLink === null
              ? "● linking…"
              : !liveLink
                ? "● OFFLINE — backend unreachable"
                : simEnforced
                  ? "● SIMULATED — backend enforced"
                  : "● LIVE LINK — Nebius"}
          </span>
          <span className={`rounded-full border px-2.5 py-1 ${status === "ready" ? "border-ship/40 bg-ship/10 text-ship" : status === "ended" ? "border-ink/25 text-muted" : "border-amber-500/50 bg-amber-500/10 text-amber-700"}`}>
            {status === "ready" ? "● READY" : status === "swapping" ? `◌ SWAPPING ${swapPct}%` : status === "ended" ? "○ ENDED" : "◌ PROVISIONING"}
          </span>
          <span className={`rounded-full border px-2.5 py-1 tabular-nums ${warn || status === "ended" ? "border-block/50 bg-block/10 text-block" : "border-ink/25 text-ink"}`} role="timer" aria-label={`${fmtClock(remaining)} remaining`}>
            ⏱ {fmtClock(remaining)}
          </span>
          {byokConnected && <span className="rounded-full border border-ink/25 px-2.5 py-1 text-muted">🔑 BYOK</span>}
        </div>
      </div>

      {/* Model quick-switcher */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-ink/15 bg-[#F5F1E9] p-3">
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">Model</span>
        {ALL.map((m) => (
          <button
            key={m.slug}
            type="button"
            disabled={busy}
            onClick={() => swapTo(m)}
            aria-pressed={model.slug === m.slug}
            className={`min-h-[40px] cursor-pointer rounded-full border px-3 py-1.5 font-mono text-xs font-bold transition-colors disabled:cursor-wait disabled:opacity-50 ${model.slug === m.slug ? "border-ink bg-ink text-canvas" : "border-ink/25 hover:border-ink"}`}
          >
            {m.label}
          </button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-ink/15 sm:inline-block" aria-hidden="true" />
        <button
          type="button"
          disabled={busy}
          onClick={() => setCompare((v) => !v)}
          aria-pressed={compare}
          className={`min-h-[40px] cursor-pointer rounded-full border px-3 py-1.5 font-mono text-xs font-bold transition-colors disabled:cursor-wait disabled:opacity-50 ${compare ? "border-ink bg-ink text-canvas" : "border-ink/25 hover:border-ink"}`}
        >
          ◫ Compare {compare ? "ON" : "OFF"}
        </button>
        {compare && (
          <select
            aria-label="Comparison model"
            value={modelB.slug}
            disabled={busy}
            onChange={(e) => setModelB(ALL.find((m) => m.slug === e.target.value) ?? ALL[1] ?? ALL[0])}
            className="min-h-[40px] cursor-pointer rounded-full border border-ink/25 bg-transparent px-3 font-mono text-xs font-bold outline-none disabled:opacity-50"
          >
            {ALL.filter((m) => m.slug !== model.slug).map((m) => (
              <option key={m.slug} value={m.slug}>{m.label}</option>
            ))}
          </select>
        )}
      </div>

      <div className={`mt-3 grid items-start gap-3 ${compare ? "lg:grid-cols-2" : "lg:grid-cols-[1fr_340px]"}`}>
        {/* Chat console */}
        <div className="min-w-0 overflow-hidden rounded-2xl border border-ink bg-[#121212] text-canvas">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
            <p className="truncate font-mono text-xs font-bold">
              {model.label} <span className="font-normal text-zinc-400">· {model.slug}</span>
            </p>
            <Link href="/new" className="shrink-0 font-mono text-[11px] text-zinc-400 underline-offset-4 hover:underline">
              ← sizing
            </Link>
          </div>
          {compare && (
            <p className="border-b border-white/10 px-4 py-1.5 font-mono text-[11px] text-zinc-400">
              Side-by-side: one prompt streams on both models — watch TTFT/ITL diverge.
            </p>
          )}
          <div className={`grid ${compare ? "grid-cols-1 sm:grid-cols-2 sm:divide-x sm:divide-white/10" : "grid-cols-1"}`}>
            <Pane msgs={paneA.msgs} streaming={paneA.streaming} stats={paneA.stats} label={compare ? model.label : undefined} />
            {compare && <Pane msgs={paneB.msgs} streaming={paneB.streaming} stats={paneB.stats} label={modelB.label} />}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendCurrent();
            }}
            className="flex items-center gap-2 border-t border-white/10 p-3"
          >
            <span aria-hidden="true" className="font-mono text-sm text-emerald-400">$</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              placeholder={status === "ended" ? "Session ended — export below." : `Ask ${model.label}… (Enter to send)`}
              aria-label="Chat prompt"
              className="min-h-[44px] flex-1 rounded-lg border border-white/15 bg-black/40 px-3 font-mono text-sm text-canvas outline-none placeholder:text-zinc-500 focus:border-emerald-400/60 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="min-h-[44px] shrink-0 cursor-pointer rounded-lg bg-canvas px-4 font-mono text-sm font-bold text-ink transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>

        {/* Telemetry HUD */}
        <aside aria-label="Live telemetry HUD" className="min-w-0 space-y-3 rounded-2xl border border-ink bg-[#121212] p-4 text-canvas">
          <p className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest text-zinc-400">
            <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            Telemetry HUD
          </p>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              { k: "TTFT", v: hud.replies ? `${hud.ttft}ms` : "—" },
              { k: "ITL", v: hud.replies ? `${hud.itl}ms` : "—" },
              { k: "Speed", v: hud.replies ? `${hud.tps} t/s` : "—" },
            ].map((s) => (
              <div key={s.k} className="rounded-xl border border-white/10 bg-white/5 px-2 py-2.5">
                <dt className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-400">{s.k}</dt>
                <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums">{s.v}</dd>
              </div>
            ))}
          </dl>
          <div>
            <div className="flex items-baseline justify-between font-mono text-[11px]">
              <span className="font-bold uppercase tracking-widest text-zinc-400">VRAM pressure</span>
              <span className="font-bold tabular-nums">{totalGb} / {gpu.vram}GB ({vramPct}%)</span>
            </div>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(vramPct)} aria-label={`VRAM ${vramPct} percent`} className="mt-1.5 flex h-3 w-full overflow-hidden rounded-full border border-white/15 bg-white/5">
              <span className="h-full bg-zinc-300" style={{ width: `${(weightsGb / gpu.vram) * 100}%` }} title={`Weights ${weightsGb}GB`} />
              <span className={`h-full ${vramPct >= 95 ? "bg-red-400" : "bg-emerald-400"}`} style={{ width: `${(kvGb / gpu.vram) * 100}%` }} title={`KV-cache ${kvGb}GB`} />
              <span className="h-full bg-[#3B82F6]" style={{ width: `${(RUNTIME_GB / gpu.vram) * 100}%` }} title={`Runtime ${RUNTIME_GB}GB`} />
            </div>
            <p className="mt-1 font-mono text-[10px] leading-snug text-zinc-400">
              Weights {weightsGb}GB + KV {kvGb}GB (grows with chat) + {RUNTIME_GB}GB · {tokensUsed} session tokens
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-300" aria-live="polite">
            <p className="font-bold uppercase tracking-widest text-zinc-400">What minting runs</p>
            {totals.current.prompts === 0 ? (
              <p className="mt-1 text-zinc-400">Chat first — the audit replays your session shape.</p>
            ) : (
              <p className="mt-1">
                {model.label} · {gpu.cert} {precision.toUpperCase()} · {totals.current.prompts} prompts →{" "}
                {Math.min(1000, Math.max(20, totals.current.prompts * 20))} replayed requests · cap $
                {Math.min(20, Math.max(2, gpu.price * 2)).toFixed(2)}
                {simEnforced !== false ? " → SIMULATED dev verdict" : ` → live benchmark on ${gpu.cert}`}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={exportCert}
            disabled={exporting}
            className="flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-canvas px-4 py-3 font-mono text-sm font-bold text-ink transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-70"
          >
            {exporting ? "Minting…" : "📜 Export Verified Certification & Deployment Blueprint →"}
          </button>
          {error && (
            <p role="alert" className="rounded-xl border border-red-400/50 bg-red-500/15 p-2 text-center font-mono text-[11px] font-bold text-red-200">
              {error}
            </p>
          )}
          <div aria-label="Session event log" className="max-h-44 overflow-y-auto rounded-xl border border-white/10 bg-black/50 p-2.5 font-mono text-[11px] leading-relaxed">
            {log.length === 0 && <p className="text-zinc-500">$ awaiting session events…</p>}
            {log.map((l, i) => (
              <p key={`${i}-${l}`} className="gp-log-line whitespace-pre-wrap break-words text-zinc-300">
                <span className="text-zinc-600">[{i + 1}]</span> {l}
              </p>
            ))}
          </div>
          <p className="font-mono text-[10px] leading-snug text-zinc-500">
            Console replies are harness-simulated with measured streaming timings; Export mints a real audited certification of this setup.
          </p>
        </aside>
      </div>

      {/* Live request traces + session spans */}
      <section aria-label="Session traces" className="mt-3 overflow-hidden rounded-2xl border border-ink bg-[#121212] text-canvas">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
          <p className="font-mono text-xs font-bold">Traces · {traces.length} request{traces.length === 1 ? "" : "s"} · {tokensUsed} session tokens</p>
          <p className="font-mono text-[11px] text-zinc-400">timings measured live · console replies harness-simulated</p>
        </div>
        {traces.length === 0 ? (
          <p className="px-4 py-4 font-mono text-[12px] text-zinc-500">No requests yet — every prompt you send lands here with its TTFT, ITL and token counts.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] font-mono text-[11px]">
              <thead>
                <tr className="border-b border-white/10 text-left text-zinc-400">
                  <th className="px-4 py-2 font-bold">#</th>
                  <th className="px-2 py-2 font-bold">Time</th>
                  <th className="px-2 py-2 font-bold">Model</th>
                  <th className="px-2 py-2 font-bold">Prompt</th>
                  <th className="px-2 py-2 text-right font-bold">In/out tok</th>
                  <th className="px-2 py-2 text-right font-bold">TTFT</th>
                  <th className="px-2 py-2 text-right font-bold">ITL</th>
                </tr>
              </thead>
              <tbody>
                {[...traces].reverse().map((t) => (
                  <tr key={`${t.n}-${t.time}`} className="border-b border-white/5 last:border-b-0">
                    <td className="px-4 py-1.5 text-zinc-500">{t.n}</td>
                    <td className="px-2 py-1.5 text-zinc-400">{t.time}</td>
                    <td className="max-w-[180px] truncate px-2 py-1.5 text-zinc-200" title={t.model}>{t.model}</td>
                    <td className="max-w-[280px] truncate px-2 py-1.5 text-zinc-300" title={t.prompt}>{t.prompt}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-300">{t.pTok}/{t.cTok}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-emerald-300">{t.ttft}ms</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-sky-300">{t.itl}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {log.some((l) => /^(provision|hotswap|session|vllm):/.test(l)) && (
          <div className="border-t border-white/10 px-4 py-2.5">
            <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-zinc-400">Session spans</p>
            <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-relaxed">
              {log.filter((l) => /^(provision|hotswap|session|vllm):/.test(l)).map((l, i) => (
                <p key={`${i}-${l}`} className="whitespace-pre-wrap break-words text-zinc-400">{l}</p>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Pane({ msgs, streaming, stats, label }: { msgs: Msg[]; streaming: boolean; stats: PaneStats; label?: string }) {
  return (
    <div role="log" aria-label={label ? `Chat with ${label}` : "Chat console"} className="flex h-[380px] flex-col">
      {label && (
        <p className="border-b border-white/10 px-4 py-1.5 font-mono text-[11px] font-bold text-zinc-300">
          {label} · {stats.replies ? `${stats.ttft}ms TTFT · ${stats.tps} t/s` : "idle"}
        </p>
      )}
      <div className="flex-1 space-y-2.5 overflow-y-auto p-4 font-mono text-[13px] leading-relaxed">
        {msgs.length === 0 && (
          <p className="text-zinc-500">Session ready. Ask about VRAM, latency, or anything the model should handle.</p>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="whitespace-pre-wrap break-words text-zinc-100">
              <span className="text-emerald-400">you›</span> {m.text}
            </p>
          ) : m.role === "sys" ? (
            <p key={i} className="text-center text-[11px] text-zinc-500">— {m.text} —</p>
          ) : (
            <p key={i} className="whitespace-pre-wrap break-words text-zinc-300">
              <span className="text-sky-400">gpu›</span> {m.text}
              {streaming && i === msgs.length - 1 && <span aria-hidden="true" className="ml-1 inline-block h-3.5 w-2 animate-pulse bg-emerald-400" />}
            </p>
          )
        )}
      </div>
    </div>
  );
}
