"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ByokBadge, ExecutionModeToggle, TopNav, useByokStatus } from "@/components/ui";
import ByokModal from "@/components/ByokModal";
import { hfModels } from "@/lib/hf";
import { buildByokHeaders } from "@/components/byok";
import { buildExecutionHeaders, enableDevSimFromQuery, getExecutionMode, isDevSim, useExecutionMode } from "@/components/executionMode";
import {
  detectHardware,
  fetchNativeHardwareProfile,
  type DetectedHardware,
} from "@/lib/hardwareDetector";

/** Shipped UI is real-only: the simulator switch renders only in dev. */
const ALLOW_SIM = process.env.NEXT_PUBLIC_ALLOW_SIM === "1";

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

type BackendTruth =
  | { state: "unknown" }
  | { state: "live" }
  | { state: "sim" }
  | { state: "down" };

/**
 * Proof of a real backend: a reachable health endpoint whose `simulator`
 * flag is "false". Tries the Next proxy first, then the backend URL
 * directly. Unreachable or simulator-enforced backends must block
 * mint/provision — never silently simulate.
 */
async function fetchBackendTruth(): Promise<BackendTruth> {
  const urls = ["/api/health", `${API_BASE}/health`];
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      const raw = j?.simulator;
      const enforced = raw === true || String(raw ?? "").trim().toLowerCase() === "true";
      return { state: enforced ? "sim" : "live" };
    } catch {
      continue;
    }
  }
  return { state: "down" };
}

function backendTruthLine(t: BackendTruth): { text: string; cls: string } {
  if (t.state === "live") return { text: "⚡ LIVE — backend simulator=false · real execution", cls: "text-emerald-300" };
  if (t.state === "sim") return { text: "🧪 SIMULATED — backend enforces simulator · minting blocked", cls: "text-amber-300" };
  if (t.state === "down") return { text: "⛔ BACKEND UNREACHABLE — live backend required", cls: "text-red-300" };
  return { text: "◌ Checking live backend status…", cls: "text-canvas/60" };
}

/* ==========================================================================
   Verify Hardware Fit — 3-step sizing cockpit
   Step 1 Pick Model · Step 2 Choose Hardware · Step 3 Workload Intent
   Sizing: M_weights = P·b/8 · M_KV = 2·L·Hkv·Dhead·Ctx·Conc·s · +1.8GB
   ========================================================================== */

type PrecisionKey = "BF16" | "FP8" | "INT4" | "GGUF";

const PRECISION: Record<PrecisionKey, { bytes: number; label: string; hint: string; backend: string }> = {
  BF16: { bytes: 2, label: "BF16", hint: "2 bytes/param · full fidelity", backend: "BF16" },
  FP8: { bytes: 1, label: "FP8", hint: "1 byte/param · production default", backend: "FP8" },
  INT4: { bytes: 0.5, label: "INT4 AWQ/GPTQ", hint: "0.5 byte/param + metadata", backend: "INT4" },
  GGUF: { bytes: 0.58, label: "GGUF Q4_K_M", hint: "≈0.58 byte/param · CPU offload", backend: "INT4" },
};

const RUNTIME_GB = 1.8; // PyTorch allocator + CUDA context + PagedAttention tables
const USABLE_FRACTION = 0.95;

type CuratedModel = {
  slug: string;
  label: string;
  tag: string;
  paramsB: number;
  layers: number;
  kvHeads: number;
  headDim: number;
  maxCtx: number;
};

const CURATED: CuratedModel[] = [
  { slug: "Qwen/Qwen3.8-27B", label: "Qwen3.8 27B", tag: "Newest dense Qwen · 256K context", paramsB: 27.8, layers: 64, kvHeads: 8, headDim: 128, maxCtx: 262144 },
  { slug: "deepseek-ai/DeepSeek-V3", label: "DeepSeek V4 Flash 38B", tag: "High throughput, fast MoE", paramsB: 38, layers: 60, kvHeads: 8, headDim: 128, maxCtx: 64000 },
  { slug: "google/gemma-3-27b-it", label: "Gemma 4 31B", tag: "Google frontier open weights", paramsB: 31, layers: 62, kvHeads: 16, headDim: 128, maxCtx: 131072 },
  { slug: "zai-org/GLM-4.5", label: "GLM-5 32B", tag: "Agentic & tool-calling benchmark", paramsB: 32, layers: 64, kvHeads: 8, headDim: 128, maxCtx: 131072 },
  { slug: "meta-llama/Llama-3.3-70B-Instruct", label: "Llama 3.3 70B", tag: "Enterprise standard baseline", paramsB: 70.6, layers: 80, kvHeads: 8, headDim: 128, maxCtx: 131072 },
  { slug: "mistralai/Codestral-22B-v0.1", label: "Codestral 22B", tag: "Autonomous code generation", paramsB: 22, layers: 48, kvHeads: 8, headDim: 128, maxCtx: 32768 },
];

/**
 * Small-machine picks — research-backed best models for 8–24GB laptops and
 * 16GB Apple Silicon (Q4_K_M/Ollama figures, 2026 guides). 8B class ≈ 5GB,
 * 12B ≈ 7–8GB, 3B ≈ 2GB: comfortable inside small unified-memory pools.
 */
const SMALL: CuratedModel[] = [
  { slug: "Qwen/Qwen3-8B", label: "Qwen3 8B", tag: "Best all-rounder for 16GB Macs · ~5GB", paramsB: 8.2, layers: 36, kvHeads: 8, headDim: 128, maxCtx: 32768 },
  { slug: "meta-llama/Llama-3.1-8B-Instruct", label: "Llama 3.1 8B", tag: "Ecosystem default · ~5GB", paramsB: 8.0, layers: 32, kvHeads: 8, headDim: 128, maxCtx: 131072 },
  { slug: "google/gemma-3-12b-it", label: "Gemma 3 12B", tag: "Quality ceiling for 16GB · ~7GB", paramsB: 12.2, layers: 48, kvHeads: 8, headDim: 256, maxCtx: 131072 },
  { slug: "Qwen/Qwen2.5-Coder-7B-Instruct", label: "Qwen2.5 Coder 7B", tag: "Best small coder · ~4.5GB", paramsB: 7.6, layers: 28, kvHeads: 4, headDim: 128, maxCtx: 131072 },
  { slug: "mistralai/Mistral-7B-Instruct-v0.3", label: "Mistral 7B", tag: "Lightest 7B · max KV headroom", paramsB: 7.3, layers: 32, kvHeads: 8, headDim: 128, maxCtx: 32768 },
  { slug: "meta-llama/Llama-3.2-3B-Instruct", label: "Llama 3.2 3B", tag: "Instant on any laptop · ~2GB", paramsB: 3.2, layers: 28, kvHeads: 8, headDim: 128, maxCtx: 131072 },
];

type HwGroup = "Apple Silicon" | "NVIDIA Consumer / Homelab" | "Nebius Production Cloud";

type HwItem = {
  key: string;
  group: HwGroup;
  label: string;
  sub: string;
  memoryGB: number;
  bandwidthGBs: number;
  priceHr?: number;
  certGpu: string;
};

const HARDWARE: HwItem[] = [
  // Apple Silicon
  { key: "MAC_MINI_M4_16GB", group: "Apple Silicon", label: "Mac mini M4 · 16GB", sub: "Unified memory", memoryGB: 16, bandwidthGBs: 120, certGpu: "L40S" },
  { key: "MAC_MINI_M4_24GB", group: "Apple Silicon", label: "Mac mini M4 · 24GB", sub: "Unified memory", memoryGB: 24, bandwidthGBs: 120, certGpu: "L40S" },
  { key: "MAC_MINI_M4_32GB", group: "Apple Silicon", label: "Mac mini M4 · 32GB", sub: "Unified memory", memoryGB: 32, bandwidthGBs: 120, certGpu: "L40S" },
  { key: "MBP_MAX_36GB", group: "Apple Silicon", label: "MacBook Pro Max · 36GB", sub: "Unified memory", memoryGB: 36, bandwidthGBs: 400, certGpu: "L40S" },
  { key: "MBP_MAX_64GB", group: "Apple Silicon", label: "MacBook Pro Max · 64GB", sub: "Unified memory", memoryGB: 64, bandwidthGBs: 400, certGpu: "L40S" },
  { key: "MBP_MAX_128GB", group: "Apple Silicon", label: "MacBook Pro Max · 128GB", sub: "Unified memory", memoryGB: 128, bandwidthGBs: 400, certGpu: "H100" },
  { key: "STUDIO_M5_ULTRA_128GB", group: "Apple Silicon", label: "Mac Studio M5 Ultra · 128GB", sub: "Unified memory", memoryGB: 128, bandwidthGBs: 1200, certGpu: "H100" },
  { key: "STUDIO_M5_ULTRA_256GB", group: "Apple Silicon", label: "Mac Studio M5 Ultra · 256GB", sub: "Unified memory", memoryGB: 256, bandwidthGBs: 1200, certGpu: "H200" },
  { key: "STUDIO_M5_ULTRA_512GB", group: "Apple Silicon", label: "Mac Studio M5 Ultra · 512GB", sub: "Unified memory", memoryGB: 512, bandwidthGBs: 1200, certGpu: "H200" },
  // NVIDIA homelab
  { key: "RTX3060_12GB", group: "NVIDIA Consumer / Homelab", label: "Single RTX 3060 · 12GB", sub: "local dev", memoryGB: 12, bandwidthGBs: 360, certGpu: "L40S" },
  { key: "RTX4090_24GB", group: "NVIDIA Consumer / Homelab", label: "Single RTX 4090 · 24GB", sub: "consumer flagship", memoryGB: 24, bandwidthGBs: 1008, certGpu: "L40S" },
  { key: "DUAL_3090_48GB", group: "NVIDIA Consumer / Homelab", label: "Dual RTX 3090 · 48GB", sub: "NVLink pooled", memoryGB: 48, bandwidthGBs: 1800, certGpu: "L40S" },
  { key: "QUAD_3090_96GB", group: "NVIDIA Consumer / Homelab", label: "Quad RTX 3090 · 96GB", sub: "homelab cluster", memoryGB: 96, bandwidthGBs: 3700, certGpu: "H100" },
  { key: "RTX6000_ADA_48GB", group: "NVIDIA Consumer / Homelab", label: "RTX 6000 Ada · 48GB ECC", sub: "workstation ECC", memoryGB: 48, bandwidthGBs: 960, certGpu: "L40S" },
  // Nebius cloud
  { key: "L40S_48GB", group: "Nebius Production Cloud", label: "L40S · 48GB", sub: "entry tier", memoryGB: 48, bandwidthGBs: 864, priceHr: 1.35, certGpu: "L40S" },
  { key: "RTXPRO6000_96GB", group: "Nebius Production Cloud", label: "RTX PRO 6000 Server · 96GB", sub: "large VRAM", memoryGB: 96, bandwidthGBs: 1800, priceHr: 1.8, certGpu: "H100" },
  { key: "H100_80GB", group: "Nebius Production Cloud", label: "H100 SXM5 · 80GB", sub: "standard Hopper", memoryGB: 80, bandwidthGBs: 3350, priceHr: 4.5, certGpu: "H100" },
  { key: "H200_141GB", group: "Nebius Production Cloud", label: "H200 · 141GB", sub: "large context", memoryGB: 141, bandwidthGBs: 4800, priceHr: 5.4, certGpu: "H200" },
  { key: "H100X8_640GB", group: "Nebius Production Cloud", label: "8× H100 Cluster · 640GB", sub: "8-GPU · InfiniBand", memoryGB: 640, bandwidthGBs: 26800, priceHr: 36.0, certGpu: "H100" },
  { key: "B200_180GB", group: "Nebius Production Cloud", label: "B200 · 180GB", sub: "frontier Blackwell", memoryGB: 180, bandwidthGBs: 8000, priceHr: 8.5, certGpu: "B200" },
];

// Legacy keys from shareable URLs → new catalog keys.
const LEGACY_GPU_MAP: Record<string, string> = {
  L40S: "L40S_48GB",
  H100: "H100_80GB",
  H200: "H200_141GB",
  H100X8: "H100X8_640GB",
  RTX4090: "RTX4090_24GB",
  DUAL_RTX3090: "DUAL_3090_48GB",
};

type Intent = {
  id: string;
  icon: string;
  title: string;
  desc: string;
  concurrency: number;
  context: number;
  precision?: PrecisionKey;
  custom?: boolean;
};

const INTENTS: Intent[] = [
  { id: "chat", icon: "💬", title: "Interactive Chat / Coding", desc: "Single user, fast decode", concurrency: 1, context: 4096 },
  { id: "rag", icon: "📑", title: "Document RAG / Legal AI", desc: "Long context 16k–32k, heavy KV-cache", concurrency: 4, context: 24576 },
  { id: "agent", icon: "🤖", title: "Multi-Agent / Tool Calling", desc: "Strict schema compliance, FP8/BF16", concurrency: 8, context: 8192, precision: "FP8" },
  { id: "saas", icon: "⚡", title: "High-Throughput SaaS API", desc: "25–50+ concurrent, continuous batching", concurrency: 32, context: 8192 },
  { id: "custom", icon: "🔧", title: "Custom workload", desc: "Dial in your own concurrency & context below", concurrency: 0, context: 0, custom: true },
];

type HfHit = { id: string; likes?: number; downloads?: number; updatedAt?: string };

type HfFilter = "trending" | "latest" | "used";

const HF_FILTERS: Record<HfFilter, { sort: string; label: string; hint: string }> = {
  trending: { sort: "likes", label: "🔥 Trending", hint: "Most liked on Hugging Face" },
  latest: { sort: "lastModified", label: "🆕 Latest", hint: "Recently updated on Hugging Face" },
  used: { sort: "downloads", label: "⬇ Most used", hint: "Most downloaded on Hugging Face" },
};

function fmtCompact(n?: number) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

function timeAgo(iso?: string) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function extractHfRepoId(input: string): string {
  const s = (input || "").trim();
  const cleaned = s
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:huggingface\.co|hf\.co)\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length >= 2) {
    if (parts[0] === "models" && parts.length >= 3) return `${parts[1]}/${parts[2]}`;
    return `${parts[0]}/${parts[1]}`;
  }
  return s;
}

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

export default function New() {
  return (
    <main>
      <TopNav />
      <Suspense fallback={<p className="p-8 font-mono text-sm">Loading cockpit…</p>}>
        <Cockpit />
      </Suspense>
    </main>
  );
}

function Cockpit() {
  const r = useRouter();
  const q = useSearchParams();
  const [mode] = useExecutionMode();
  const effMode = ALLOW_SIM ? mode : "real";
  const byokConnected = useByokStatus();
  const [byokOpen, setByokOpen] = useState(false);
  // Backend-truthful mode: probed from /api/health, refreshed before submit.
  const [backendTruth, setBackendTruth] = useState<BackendTruth>({ state: "unknown" });
  useEffect(() => {
    let alive = true;
    enableDevSimFromQuery();
    fetchBackendTruth().then((t) => {
      if (alive) setBackendTruth(t);
    });
    return () => {
      alive = false;
    };
  }, []);

  const [modelInput, setModelInput] = useState(q.get("candidate_model") || "");
  const [precision, setPrecision] = useState<PrecisionKey>(() => {
    const p = (q.get("precision") || "FP8").toUpperCase();
    return (["BF16", "FP8", "INT4", "GGUF"] as PrecisionKey[]).includes(p as PrecisionKey) ? (p as PrecisionKey) : "FP8";
  });
  const [useAuto, setUseAuto] = useState(true);
  const [hwKey, setHwKey] = useState(() => {
    const raw = (q.get("target_gpu") || q.get("gpu") || "H100_80GB").toUpperCase();
    return LEGACY_GPU_MAP[raw] ?? HARDWARE.find((h) => h.key === raw)?.key ?? "H100_80GB";
  });
  // Hardware counts only after explicit confirmation — auto-detect filling in
  // must not self-complete Step 2 behind the user's back.
  const [hwConfirmed, setHwConfirmed] = useState(() => !!(q.get("target_gpu") || q.get("gpu")));
  const [intentId, setIntentId] = useState(() => {
    if (!q.get("concurrency") && !q.get("users") && !q.get("context_len")) return "";
    const u = Number(q.get("concurrency") || q.get("users") || 1);
    const c = Number(q.get("context_len") || 4096);
    return INTENTS.find((t) => !t.custom && t.concurrency === u && t.context === c)?.id ?? "custom";
  });
  const [concurrency, setConcurrency] = useState(() => {
    const u = Number(q.get("concurrency") || q.get("users") || 1);
    return Number.isFinite(u) && u >= 1 ? Math.min(128, Math.round(u)) : 1;
  });
  const [contextLen, setContextLen] = useState(() => {
    const c = Number(q.get("context_len") || 4096);
    return Number.isFinite(c) && c >= 512 ? Math.min(131072, Math.round(c)) : 4096;
  });

  const [detected, setDetected] = useState<DetectedHardware | null>(null);
  const [nativeTried, setNativeTried] = useState(false);
  const [backendFit, setBackendFit] = useState<{ params_b?: number; layers?: number; hidden?: number; license?: string; note?: string } | null>(null);
  const [hfConfig, setHfConfig] = useState<{ layers?: number; kvHeads?: number; headDim?: number; hidden?: number; maxCtx?: number; paramsB?: number } | null>(null);
  const [hfHits, setHfHits] = useState<HfHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [hfFilter, setHfFilter] = useState<HfFilter>("trending");
  const [hfOpen, setHfOpen] = useState(false);
  const [poolRaw, setPoolRaw] = useState<Array<{ id: string; paramsB: number; likes: number }>>([]);
  const [showPoolAll, setShowPoolAll] = useState(false);

  // Fits-browser pool: top liked text-gen models with known param counts.
  // Fit is computed locally per render vs current hardware + workload.
  useEffect(() => {
    let alive = true;
    hfModels({ sort: "likes", direction: "-1", limit: "60", filter: "text-generation", expand: "safetensors" })
      .then((j) => {
        if (!alive || !Array.isArray(j)) return;
        const out: Array<{ id: string; paramsB: number; likes: number }> = [];
        for (const x of j) {
          const id = typeof x?.id === "string" ? x.id : "";
          const total = x?.safetensors?.total;
          if (!id || !id.includes("/") || typeof total !== "number" || !(total > 0)) continue;
          if (out.some((o) => o.id.toLowerCase() === id.toLowerCase())) continue;
          out.push({ id, paramsB: Math.round((total / 1e9) * 10) / 10, likes: typeof x.likes === "number" ? x.likes : 0 });
        }
        setPoolRaw(out);
      })
      .catch(() => {
        /* offline — chips + search still work */
      });
    return () => {
      alive = false;
    };
  }, []);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const repoId = useMemo(() => extractHfRepoId(modelInput), [modelInput]);
  const isRepoId = repoId.includes("/");
  const curated = useMemo(() => [...CURATED, ...SMALL].find((c) => c.slug.toLowerCase() === repoId.toLowerCase()), [repoId]);

  // Auto-detect: instant browser fingerprint, then native bridge upgrade.
  useEffect(() => {
    try {
      setDetected(detectHardware());
    } catch {
      /* fingerprint unavailable */
    }
    let alive = true;
    fetchNativeHardwareProfile()
      .then((d) => {
        if (alive && d) setDetected(d);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setNativeTried(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Live HF dropdown: free-text search + filterable browse list (latest / trending / most-used).
  useEffect(() => {
    const text = modelInput.trim();
    if (text.includes("/") || /^https?:/i.test(text)) {
      setHfHits([]);
      return;
    }
    if (!text && !hfOpen) {
      setHfHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({
          sort: HF_FILTERS[hfFilter].sort,
          direction: "-1",
          limit: "8",
        });
        if (text.length >= 2) params.set("search", text);
        params.set("expand", "safetensors");
        const j = await hfModels(Object.fromEntries(params.entries()));
        setHfHits(
          j.filter((x) => typeof x?.id === "string").map((x) => ({ id: String(x.id), likes: typeof x.likes === "number" ? x.likes : undefined, downloads: typeof x.downloads === "number" ? x.downloads : undefined, updatedAt: typeof x.lastModified === "string" ? x.lastModified : undefined }))
        );
      } catch {
        /* offline — curated chips still work */
      } finally {
        setSearching(false);
      }
    }, text.length >= 2 ? 450 : 150);
    return () => clearTimeout(timer);
  }, [modelInput, hfFilter, hfOpen]);

  // Live inspection: backend proxy + raw config.json for P/L/Hkv/Dhead/maxCtx.
  useEffect(() => {
    if (!isRepoId) {
      setBackendFit(null);
      setHfConfig(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setInspecting(true);
      try {
        const [proxy, cfg, meta] = await Promise.allSettled([
          fetch(`/api/models/inspect?query=${encodeURIComponent(repoId)}`).then((x) => (x.ok ? x.json() : null)),
          fetch(`https://huggingface.co/${repoId}/raw/main/config.json`).then((x) => (x.ok ? x.json() : null)),
          fetch(`https://huggingface.co/api/models/${encodeURIComponent(repoId)}`).then((x) => (x.ok ? x.json() : null)),
        ]);
        if (!alive) return;
        if (proxy.status === "fulfilled" && proxy.value) setBackendFit(proxy.value);
        const c = cfg.status === "fulfilled" ? (cfg.value as Record<string, unknown> | null) : null;
        const m = meta.status === "fulfilled" ? (meta.value as Record<string, unknown> | null) : null;
        if (c || m) {
          const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
          const heads = num(c?.["num_key_value_heads"]) ?? num(c?.["num_attention_heads"]);
          const hidden = num(c?.["hidden_size"]);
          const attnHeads = num(c?.["num_attention_heads"]);
          const headDim = num(c?.["head_dim"]) ?? (hidden && attnHeads ? Math.round(hidden / attnHeads) : undefined);
          const maxCtx =
            num(c?.["max_position_embeddings"]) ??
            num(c?.["max_seq_len"]) ??
            num((c?.["rope_scaling"] as Record<string, unknown> | undefined)?.["original_max_position_embeddings"]);
          const safe = (m?.["safetensors"] as Record<string, unknown> | undefined)?.["total"];
          setHfConfig({
            layers: num(c?.["num_hidden_layers"]),
            kvHeads: heads,
            headDim,
            hidden,
            maxCtx,
            paramsB: typeof safe === "number" ? Math.round((safe / 1e9) * 10) / 10 : undefined,
          });
        }
      } catch {
        /* keep curated fallback */
      } finally {
        if (alive) setInspecting(false);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [repoId, isRepoId]);

  // --- Exact sizing: M_weights = P·b/8 · M_KV = 2·L·Hkv·Dhead·Ctx·Conc·s ---
  const arch = useMemo(() => {
    const layers = curated?.layers ?? hfConfig?.layers ?? backendFit?.layers ?? 48;
    const kvHeads = curated?.kvHeads ?? hfConfig?.kvHeads ?? 8;
    const headDim = curated?.headDim ?? hfConfig?.headDim ?? 128;
    const paramsB = curated?.paramsB ?? hfConfig?.paramsB ?? backendFit?.params_b ?? 30;
    const maxCtx = curated?.maxCtx ?? hfConfig?.maxCtx;
    return { layers, kvHeads, headDim, paramsB, maxCtx };
  }, [curated, hfConfig, backendFit]);

  const bytes = PRECISION[precision].bytes;
  const weightsGb = Math.round((arch.paramsB * bytes + (precision === "INT4" || precision === "GGUF" ? 0.35 : 0)) * 100) / 100;
  const kvGb =
    Math.round(((2 * arch.layers * arch.kvHeads * arch.headDim * contextLen * concurrency * bytes) / 1e9) * 100) / 100;
  const totalGb = Math.round((weightsGb + kvGb + RUNTIME_GB) * 100) / 100;

  const manualHw = HARDWARE.find((h) => h.key === hwKey) ?? HARDWARE.find((h) => h.key === "H100_80GB")!;
  const autoBandwidth = detected
    ? /RTX|NVIDIA|GeForce/i.test(`${detected.gpuRenderer} ${detected.label}`)
      ? 1000
      : /Studio|Ultra/i.test(detected.label)
        ? 1200
        : /Max/i.test(detected.label)
          ? 400
          : 300
    : 400;
  const effectiveHw: HwItem = useAuto
    ? {
        key: "AUTO",
        group: "Apple Silicon",
        label: detected ? detected.badge || detected.label : "Detecting local machine…",
        sub: detected ? `${detected.label} · ${detected.method === "cli-bridge" ? "native probe" : "browser fingerprint"}` : "WebGL + native bridge",
        memoryGB: detected?.usableGB ?? 16,
        bandwidthGBs: autoBandwidth,
        certGpu: "L40S",
      }
    : manualHw;

  const usableGb = Math.round(effectiveHw.memoryGB * USABLE_FRACTION * 100) / 100;
  const headroomGb = Math.round((usableGb - totalGb) * 100) / 100;
  const pct = effectiveHw.memoryGB > 0 ? Math.round((totalGb / effectiveHw.memoryGB) * 1000) / 10 : 0;

  // Latency cliff: decode streams full weights per token → time = weights / bandwidth.
  const decodeMs = Math.round(((weightsGb / Math.max(1, effectiveHw.bandwidthGBs)) * 1000 * (1 + concurrency * 0.03)) * 10) / 10;
  const sloMs = intentId === "chat" ? 60 : 150;
  const oom = totalGb > usableGb;
  const latencyCliff = !oom && decodeMs > sloMs && concurrency >= 4;
  const blocked = oom || latencyCliff;
  const tight = !blocked && pct >= 85;

  const verdictNote = oom
    ? `CUDA OOM risk — needs ~${totalGb}GB but only ${usableGb}GB usable on ${effectiveHw.label}.`
    : latencyCliff
      ? `PCIe latency cliff — ~${decodeMs}ms/token decode exceeds the ${sloMs}ms SLO for this intent on ${effectiveHw.bandwidthGBs} GB/s bandwidth.`
      : tight
        ? `Fits with tight headroom — ${headroomGb}GB free. Safe for a sandbox, watch batch growth.`
        : `Safe headroom — ${headroomGb}GB free with latency within SLO (~${decodeMs}ms/token).`;

  const seg = (gb: number) => `${Math.max(0, Math.min(100, (gb / effectiveHw.memoryGB) * 100))}%`;
  const freeGb = Math.max(0, headroomGb);
  const sandboxCost = effectiveHw.priceHr != null ? effectiveHw.priceHr : 0;
  const sandboxHref = `/sandbox?model=${encodeURIComponent(repoId || modelInput)}&gpu=${encodeURIComponent(useAuto ? "AUTO" : manualHw.certGpu)}&precision=${precision}&context=${contextLen}&concurrency=${concurrency}`;
  const certGpu = useAuto ? "L40S" : manualHw.certGpu;

  // Progressive verdict: the banner stays neutral with a step checklist until
  // all 3 steps are done — no SHIP/BLOCK judgment on half-made selections.
  const modelDone = isRepoId;
  const hwDone = hwConfirmed;
  const intentDone = intentId !== "";
  const allDone = modelDone && hwDone && intentDone;
  const nextStep = !modelDone ? 1 : !hwDone ? 2 : !intentDone ? 3 : 0;

  // Fits-browser: pool footprint vs CURRENT hardware + workload, per precision.
  const fitsUsable = effectiveHw.memoryGB * USABLE_FRACTION;
  function poolTotal(paramsB: number, prec: PrecisionKey) {
    const b = PRECISION[prec].bytes;
    const L = paramsB >= 65 ? 80 : paramsB >= 30 ? 64 : paramsB >= 14 ? 48 : 32;
    const H = paramsB >= 65 ? 8192 : paramsB >= 14 ? 5120 : 4096;
    const w = paramsB * b + (prec === "INT4" || prec === "GGUF" ? 0.35 : 0);
    const kv = (2 * L * H * contextLen * concurrency * b) / 1e9;
    return Math.round((w + kv + RUNTIME_GB) * 100) / 100;
  }
  const fitCounts = useMemo(() => {
    const c: Record<PrecisionKey, number> = { BF16: 0, FP8: 0, INT4: 0, GGUF: 0 };
    for (const item of poolRaw) {
      (Object.keys(c) as PrecisionKey[]).forEach((p) => {
        if (poolTotal(item.paramsB, p) <= fitsUsable) c[p] += 1;
      });
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolRaw, fitsUsable, contextLen, concurrency]);
  const fitsNow = useMemo(
    () =>
      poolRaw
        .map((item) => ({ ...item, total: poolTotal(item.paramsB, precision) }))
        .filter((item) => item.total <= fitsUsable)
        .sort((a, b) => b.likes - a.likes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [poolRaw, fitsUsable, contextLen, concurrency, precision]
  );

  function pickIntent(id: string) {
    const t = INTENTS.find((x) => x.id === id);
    if (!t) return;
    setIntentId(id);
    if (!t.custom) {
      setConcurrency(t.concurrency);
      setContextLen(Math.min(t.context, arch.maxCtx ?? t.context));
      if (t.precision) setPrecision(t.precision);
    }
    setError("");
  }

  function tweakConcurrency(v: number) {
    setConcurrency(Math.max(1, Math.min(128, Math.round(v) || 1)));
    setIntentId("custom");
  }

  function tweakContext(v: number) {
    setContextLen(Math.max(512, Math.min(131072, Math.round(v) || 512)));
    setIntentId("custom");
  }

  async function mint(e: React.FormEvent) {
    e.preventDefault();
    if (!modelDone) {
      setError(
        !repoId.trim()
          ? "Step 1: pick a trending chip or search Hugging Face to choose your model."
          : "Step 1: enter a valid Hugging Face repo (org/model) or pick a suggestion."
      );
      return;
    }
    if (!hwDone) {
      setError("Step 2: confirm your hardware — use the auto-detected machine or pick manual — before minting.");
      return;
    }
    if (!intentDone) {
      setError("Step 3: pick a workload intent (or dial in Custom) to lock the verdict before minting.");
      return;
    }
    if (blocked) {
      setError(
        oom
          ? `BLOCKED: this footprint (~${totalGb}GB) exceeds ${effectiveHw.label}. Pick a larger tier or drop precision before minting.`
          : `BLOCKED: decode latency (~${decodeMs}ms/token) breaches the ${sloMs}ms SLO. Drop concurrency/context or move to higher bandwidth.`
      );
      return;
    }
    // Real-only gate: require proof of a live backend before minting.
    // Unreachable OR simulator-enforced backends block — never simulate.
    setStatus("Verifying live backend…");
    const truth = await fetchBackendTruth();
    setBackendTruth(truth);
    if (truth.state === "down") {
      setError("Backend unreachable — live backend required. Is the backend running? Try refreshing.");
      setStatus("");
      return;
    }
    if (truth.state === "sim" && !isDevSim()) {
      setError("Live backend required — backend enforces simulator. Minting is blocked until the backend runs with a live runner.");
      setStatus("");
      return;
    }
    setError("");
    setSubmitting(true);
    setStatus("Spins up test container → Replaying queries → Evaluating SLA…");
    try {
      // Shipped UI is real-only: always request live execution.
      // Dev (NEXT_PUBLIC_ALLOW_SIM=1) keeps the toggle choice.
      // Local dev bypass (?devsim=1) runs honestly as "sim" — labeled SIMULATED everywhere.
      const execMode = ALLOW_SIM ? getExecutionMode() : truth.state === "sim" ? "sim" : "real";
      const headers = { "Content-Type": "application/json", ...buildByokHeaders(), ...buildExecutionHeaders(execMode) };
      const budget = effectiveHw.priceHr != null ? Math.min(20, Math.max(2, effectiveHw.priceHr * 2)) : 2;
      const payload = {
        candidate_model: repoId,
        current_model: "Qwen3-8B",
        gpu_type: certGpu,
        precision: PRECISION[precision].backend,
        concurrency,
        context_len: contextLen,
        requests: 200,
        budget_usd: budget,
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
      if (!res.ok) {
        let detail = `(${res.status})`;
        try {
          const j = await res.json();
          if (j?.detail) detail = Array.isArray(j.detail) ? j.detail.map((d: { msg?: string }) => d.msg).join("; ") : String(j.detail);
        } catch {
          /* keep status */
        }
        throw new Error(`Couldn't start the benchmark ${detail}. Please try again.`);
      }
      const j = await res.json();
      const ctrl2 = new AbortController();
      const timer2 = setTimeout(() => ctrl2.abort(), 20000);
      let s: Response;
      try {
        s = await fetch(`/api/certifications/${j.id}/start`, {
          method: "POST",
          headers: { ...buildByokHeaders(), ...buildExecutionHeaders(execMode) },
          signal: ctrl2.signal,
        });
      } finally {
        clearTimeout(timer2);
      }
      if (!s.ok) throw new Error("Benchmark was created but couldn't launch. Please open the timeline and retry.");
      try {
        const items = JSON.parse(localStorage.getItem("sandboxproof-certs") || "[]");
        items.unshift({ id: j.id, candidate: repoId, status: "RUNNING", spend: 0, experiments: 0, simulated: execMode !== "real", created_at: new Date().toISOString() });
        localStorage.setItem("sandboxproof-certs", JSON.stringify(items.slice(0, 20)));
      } catch {
        /* storage unavailable */
      }
      r.push(`/certificate/${j.id}`);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(/failed to fetch|networkerror|load failed|abort|not reachable|fetch/i.test(raw) ? "Backend unavailable — the test API isn't reachable right now. Ensure the backend is running and try again." : raw);
      setStatus("");
      setSubmitting(false);
    }
  }

  const hwGroups: HwGroup[] = ["Apple Silicon", "NVIDIA Consumer / Homelab", "Nebius Production Cloud"];

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/15 pb-4">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Verify Hardware Fit</h1>
          <p className="mt-1 font-mono text-sm leading-relaxed text-muted">
            Pick a model, pick hardware, profile traffic. Exact VRAM math before you spend a dollar on GPUs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ByokBadge connected={byokConnected} />
          <button
            type="button"
            onClick={() => setByokOpen(true)}
            className="min-h-[40px] cursor-pointer rounded-xl border border-ink/25 px-3 py-1.5 font-mono text-xs font-bold transition-colors hover:border-ink"
          >
            🔑 BYOK / API Key
          </button>
        </div>
      </div>
      <ByokModal open={byokOpen} onClose={() => setByokOpen(false)} />

      {/* Step progress — clickable, scrolls to each step */}
      <ol aria-label="Sizing progress" className="mt-5 flex items-center gap-2 font-mono text-xs font-bold">
        {["Pick model", "Choose hardware", "Workload intent"].map((label, i) => {
          const done = i === 0 ? modelDone : i === 1 ? hwDone : intentDone;
          const current = nextStep === 0 ? 3 : nextStep;
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => document.getElementById(`step-${i + 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                aria-label={`Go to step ${i + 1}: ${label}${done ? " (done)" : current === i + 1 ? " (current)" : ""}`}
                className="flex cursor-pointer items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono ${done ? "border-ink bg-ink text-canvas" : current === i + 1 ? "border-ink text-ink" : "border-ink/25 text-muted"}`}>
                  {done ? "✓" : i + 1}
                </span>
                <span className={done || current === i + 1 ? "text-ink" : "text-muted"}>{label}</span>
              </button>
              {i < 2 && <span aria-hidden="true" className="mx-1 h-px flex-1 bg-ink/15" />}
            </li>
          );
        })}
      </ol>

      <form onSubmit={mint} noValidate className="mt-5 grid items-start gap-5 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-5">
          {/* ================= STEP 1 ================= */}
          <section id="step-1" aria-labelledby="step1" className="scroll-mt-24 rounded-2xl border border-ink/15 bg-[#F5F1E9] p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-sm font-bold text-canvas">1</span>
              <div>
                <h2 id="step1" className="text-base font-bold tracking-tight">Pick model</h2>
                <p className="mt-0.5 font-mono text-xs text-muted">Trending 2026 lineup, or import anything live from Hugging Face.</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Trending 2026 models">
              {CURATED.map((m) => {
                const active = curated?.slug === m.slug;
                return (
                  <button
                    key={m.slug}
                    type="button"
                    onClick={() => {
                      setModelInput(m.slug);
                      setError("");
                    }}
                    aria-pressed={active}
                    title={`${m.slug} · ${m.tag}`}
                    className={`min-h-[40px] cursor-pointer rounded-full border px-3 py-1.5 font-mono text-xs font-bold transition-colors ${active ? "border-ink bg-ink text-canvas" : "border-ink/25 bg-transparent hover:border-ink"}`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 font-mono text-[11px] font-bold uppercase tracking-widest text-muted">💻 Small-machine picks — 8–24GB laptops &amp; 16GB Macs</p>
            <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-label="Small laptop-friendly models">
              {SMALL.map((m) => {
                const active = curated?.slug === m.slug;
                return (
                  <button
                    key={m.slug}
                    type="button"
                    onClick={() => {
                      setModelInput(m.slug);
                      setError("");
                    }}
                    aria-pressed={active}
                    title={`${m.slug} · ${m.tag}`}
                    className={`min-h-[40px] cursor-pointer rounded-full border px-3 py-1.5 font-mono text-xs font-bold transition-colors ${active ? "border-ink bg-ink text-canvas" : "border-ink/25 bg-transparent hover:border-ink"}`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 font-mono text-[11px] text-muted">{curated ? `${curated.tag} · ${curated.slug}` : "Tap a chip for pinned arch specs, or search below."}</p>

            <label htmlFor="hf-search" className="mt-4 block font-mono text-sm font-bold">
              Live Hugging Face search &amp; import
            </label>
            <div role="group" aria-label="Hugging Face list filter" className="mt-2 flex flex-wrap gap-1.5">
              {(Object.keys(HF_FILTERS) as HfFilter[]).map((f) => {
                const active = hfFilter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={active}
                    title={HF_FILTERS[f].hint}
                    onClick={() => {
                      setHfFilter(f);
                      setHfOpen(true);
                    }}
                    className={`min-h-[36px] cursor-pointer rounded-full border px-3 py-1 font-mono text-[11px] font-bold transition-colors ${active ? "border-ink bg-ink text-canvas" : "border-ink/25 bg-transparent hover:border-ink"}`}
                  >
                    {HF_FILTERS[f].label}
                  </button>
                );
              })}
            </div>
            <div className="relative z-20 mt-1">
              <input
                id="hf-search"
                role="combobox"
                aria-expanded={hfOpen && !isRepoId}
                aria-controls="hf-listbox"
                aria-autocomplete="list"
                value={modelInput}
                onChange={(e) => {
                  setModelInput(e.target.value);
                  setHfOpen(true);
                }}
                onFocus={() => setHfOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setHfOpen(false);
                }}
                placeholder="Search models or paste a Hugging Face URL…"
                spellCheck={false}
                autoComplete="off"
                className="min-h-[44px] w-full rounded-xl border border-ink/25 bg-transparent p-2.5 font-mono text-sm outline-none focus:border-ink"
              />
              {hfOpen && !isRepoId && (
                <>
                  <button
                    type="button"
                    aria-label="Close model list"
                    tabIndex={-1}
                    onClick={() => setHfOpen(false)}
                    className="fixed inset-0 z-10 cursor-default bg-transparent"
                  />
                  <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-ink bg-[#F5F1E9]">
                    {modelInput.trim().length < 2 && (
                      <div className="border-b border-ink/10">
                        <p className="px-3 pb-1 pt-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted">
                          Pinned 2026 lineup
                        </p>
                        <ul>
                          {CURATED.map((m) => (
                            <li key={m.slug}>
                              <button
                                type="button"
                                onClick={() => {
                                  setModelInput(m.slug);
                                  setHfOpen(false);
                                  setError("");
                                }}
                                className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-ink/5"
                              >
                                <span className="truncate font-mono text-xs font-bold">{m.label}</span>
                                <span className="shrink-0 font-mono text-[10px] text-muted">{m.paramsB}B · pinned</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        <p className="px-3 pb-1 pt-2 font-mono text-[10px] font-bold uppercase tracking-widest text-muted">
                          💻 Small-machine picks
                        </p>
                        <ul>
                          {SMALL.map((m) => (
                            <li key={m.slug}>
                              <button
                                type="button"
                                onClick={() => {
                                  setModelInput(m.slug);
                                  setHfOpen(false);
                                  setError("");
                                }}
                                className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-ink/5"
                              >
                                <span className="truncate font-mono text-xs font-bold">{m.label}</span>
                                <span className="shrink-0 font-mono text-[10px] text-muted">{m.paramsB}B · laptop</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        <p className="px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-muted">
                          {HF_FILTERS[hfFilter].label} · live on Hugging Face
                        </p>
                      </div>
                    )}
                    <ul id="hf-listbox" role="listbox" aria-label="Hugging Face models" className="max-h-64 overflow-auto py-1">
                      {searching && hfHits.length === 0 ? (
                        <li className="px-3 py-2 font-mono text-xs text-muted">Searching huggingface.co…</li>
                      ) : hfHits.length === 0 ? (
                        <li className="px-3 py-2 font-mono text-xs text-muted">
                          No live results — paste any Hugging Face URL to import directly.
                        </li>
                      ) : (
                        hfHits.map((h) => (
                          <li key={h.id} role="option" aria-selected={false}>
                            <button
                              type="button"
                              onClick={() => {
                                setModelInput(h.id);
                                setHfOpen(false);
                                setError("");
                              }}
                              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-ink/5"
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-mono text-xs font-bold">{h.id}</span>
                                <span className="block font-mono text-[10px] text-muted">
                                  {hfFilter === "latest" && timeAgo(h.updatedAt)
                                    ? `updated ${timeAgo(h.updatedAt)} · ♥ ${fmtCompact(h.likes)}`
                                    : hfFilter === "used"
                                      ? `↓ ${fmtCompact(h.downloads)} downloads · ♥ ${fmtCompact(h.likes)}`
                                      : `♥ ${fmtCompact(h.likes)} likes · ↓ ${fmtCompact(h.downloads)}`}
                                </span>
                              </span>
                              <span className="shrink-0 font-mono text-[10px] font-bold">import →</span>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </>
              )}
            </div>

            {/* Inspected config: P, L, H_KV, D_head, max ctx */}
            <div aria-live="polite" className="mt-3 rounded-xl border border-ink/15 bg-canvas/70 p-3">
              {inspecting && !curated && !hfConfig && !backendFit ? (
                <p className="font-mono text-xs text-muted">🔍 Inspecting model config…</p>
              ) : isRepoId ? (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-sm font-bold">{repoId}</p>
                    {(backendFit?.license || curated) && (
                      <span className="rounded-full border border-ship/30 bg-ship/10 px-2 py-0.5 font-mono text-[10px] font-bold text-ship">
                        {backendFit?.license ?? "open weights"}
                      </span>
                    )}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
                    {[
                      { k: "Params P", v: `${arch.paramsB}B` },
                      { k: "Layers L", v: String(arch.layers) },
                      { k: "KV heads Hkv", v: String(arch.kvHeads) },
                      { k: "Head dim D", v: String(arch.headDim) },
                      { k: "Max ctx", v: arch.maxCtx ? `${fmt(arch.maxCtx)}` : "—" },
                    ].map((s) => (
                      <div key={s.k} className="rounded-xl border border-ink/15 bg-white/50 px-2 py-2">
                        <dt className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">{s.k}</dt>
                        <dd className="mt-0.5 font-mono text-sm font-bold">{s.v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2 font-mono text-[11px] leading-snug text-muted">
                    {curated ? `Pinned 2026 spec · ${curated.tag}.` : hfConfig?.layers ? "Live config.json from Hugging Face." : (backendFit?.note ?? "Heuristic arch estimate — live config pending.")}
                    {arch.maxCtx && contextLen > arch.maxCtx ? ` ⚠ Requested ${fmt(contextLen)} exceeds model max ${fmt(arch.maxCtx)}.` : ""}
                  </p>
                </div>
              ) : (
                <p className="font-mono text-xs text-muted">Type at least org/model — P · L · Hkv · Dhead · max context appear here.</p>
              )}
            </div>

            <div className="mt-4">
              <span id="prec-label" className="block font-mono text-xs font-bold uppercase tracking-wider text-muted">Precision</span>
              <div role="radiogroup" aria-labelledby="prec-label" className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {(Object.keys(PRECISION) as PrecisionKey[]).map((p) => {
                  const active = precision === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      title={PRECISION[p].hint}
                      onClick={() => setPrecision(p)}
                      className={`min-h-[52px] cursor-pointer rounded-xl border px-2 py-2 text-left transition-colors ${active ? "border-ink bg-ink text-canvas" : "border-ink/25 hover:border-ink"}`}
                    >
                      <span className="block font-mono text-xs font-bold">{PRECISION[p].label}</span>
                      <span className={`block font-mono text-[10px] leading-snug ${active ? "text-canvas/75" : "text-muted"}`}>{PRECISION[p].hint}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 font-mono text-[11px] text-muted" aria-live="polite">
                {poolRaw.length === 0
                  ? "Counting leaderboard fits…"
                  : `Leaderboard fits for this setup — BF16 ${fitCounts.BF16} · FP8 ${fitCounts.FP8} · INT4 ${fitCounts.INT4} · GGUF ${fitCounts.GGUF} of ${poolRaw.length} (live pool)`}
              </p>
            </div>

            {/* Fits-browser: live models that fit the CURRENT hardware + workload */}
            <div className="mt-3 rounded-xl border border-ink/15 bg-canvas/70 p-3">
              <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
                ✓ Fits {concurrency}×{fmt(contextLen)} on {useAuto ? "auto-detected" : manualHw.label} @ {precision}
              </p>
              {poolRaw.length === 0 ? (
                <p className="mt-1.5 font-mono text-[11px] text-muted">Loading the live pool — chips and search above work regardless.</p>
              ) : fitsNow.length === 0 ? (
                <p className="mt-1.5 font-mono text-[11px] text-muted">
                  No leaderboard fits at {precision} under this load — drop precision, shrink context/concurrency, or paste any URL above.
                </p>
              ) : (
                <>
                  <ul className="mt-2 grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2">
                    {(showPoolAll ? fitsNow : fitsNow.slice(0, 8)).map((f) => {
                      const active = extractHfRepoId(modelInput).toLowerCase() === f.id.toLowerCase();
                      return (
                        <li key={f.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setModelInput(f.id);
                              setHfOpen(false);
                              setError("");
                            }}
                            className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${active ? "border-ink bg-ink text-canvas" : "border-ink/15 hover:border-ink"}`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-mono text-[11px] font-bold">{f.id}</span>
                              <span className={`block font-mono text-[10px] ${active ? "text-canvas/70" : "text-muted"}`}>
                                {f.paramsB}B · ♥ {f.likes} · ~{f.total}GB ✓
                              </span>
                            </span>
                            <span className="shrink-0 font-mono text-[10px] font-bold">pick →</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {fitsNow.length > 8 && (
                    <button
                      type="button"
                      onClick={() => setShowPoolAll((v) => !v)}
                      className="mt-2 min-h-[40px] w-full cursor-pointer rounded-xl border border-dashed border-ink/30 px-3 py-2 font-mono text-[11px] font-bold transition-colors hover:border-ink"
                    >
                      {showPoolAll ? "Show less ↑" : `+ ${fitsNow.length - 8} more fits`}
                    </button>
                  )}
                </>
              )}
            </div>
          </section>

          {/* ================= STEP 2 ================= */}
          <section id="step-2" aria-labelledby="step2" className="scroll-mt-24 rounded-2xl border border-ink/15 bg-[#F5F1E9] p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-sm font-bold text-canvas">2</span>
              <div>
                <h2 id="step2" className="text-base font-bold tracking-tight">Choose hardware</h2>
                <p className="mt-0.5 font-mono text-xs text-muted">Auto-detected machine, or the full manual spectrum.</p>
              </div>
            </div>

            {/* Auto-detect card */}
            <div className="mt-4 rounded-xl border border-ink/15 bg-canvas p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-sm font-bold">
                  📍 Auto-Detected: {detected ? `${detected.badge || detected.label}` : nativeTried ? "detection unavailable" : "detecting…"}
                </p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={useAuto}
                  onClick={() => {
                    setUseAuto((v) => !v);
                    setHwConfirmed(true);
                  }}
                  className={`min-h-[36px] cursor-pointer rounded-full border px-3 py-1 font-mono text-xs font-bold transition-colors ${useAuto ? "border-ink bg-ink text-canvas" : "border-ink/25 hover:border-ink"}`}
                >
                  {useAuto ? "Auto: ON" : "Auto: OFF"}
                </button>
              </div>
              <p className="mt-1 font-mono text-[11px] leading-snug text-muted">
                {detected
                  ? `${detected.label} · ~${detected.usableGB}GB usable · ${detected.confidence} confidence · ${detected.method === "cli-bridge" ? "native probe via /api/system/hardware" : "browser fingerprint"}`
                  : "Integrates hardwareDetector.ts + /api/system/hardware. Toggle OFF for manual selection."}
              </p>
              {useAuto && !!detected && !hwConfirmed && (
                <button
                  type="button"
                  onClick={() => setHwConfirmed(true)}
                  className="mt-2 min-h-[44px] w-full cursor-pointer rounded-xl border border-ink bg-ink px-3 py-2 font-mono text-xs font-bold text-canvas transition-colors hover:bg-black"
                >
                  ✓ Use this machine ({detected.usableGB}GB) →
                </button>
              )}
              {hwConfirmed && (
                <p className="mt-2 font-mono text-[11px] font-bold text-ship">
                  ✓ Hardware confirmed — {useAuto ? "auto-detected machine" : manualHw.label}
                </p>
              )}
            </div>

            {!useAuto && (
              <div className="mt-4 space-y-4">
                {hwGroups.map((g) => (
                  <div key={g}>
                    <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">{g}</p>
                    <div role="radiogroup" aria-label={g} className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {HARDWARE.filter((h) => h.group === g).map((h) => {
                        const active = hwKey === h.key;
                        return (
                          <button
                            key={h.key}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => {
                              setHwKey(h.key);
                              setHwConfirmed(true);
                            }}
                            className={`min-h-[52px] cursor-pointer rounded-xl border px-3 py-2 text-left transition-colors ${active ? "border-ink bg-ink text-canvas" : "border-ink/25 hover:border-ink"}`}
                          >
                            <span className="block font-mono text-xs font-bold">{h.label}</span>
                            <span className={`block font-mono text-[11px] ${active ? "text-canvas/75" : "text-muted"}`}>
                              {h.memoryGB}GB · {h.bandwidthGBs >= 1000 ? `${(h.bandwidthGBs / 1000).toFixed(1)} TB/s` : `${h.bandwidthGBs} GB/s`}{h.priceHr != null ? ` · $${h.priceHr.toFixed(2)}/hr` : ""} · {h.sub}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ================= STEP 3 ================= */}
          <section id="step-3" aria-labelledby="step3" className="scroll-mt-24 rounded-2xl border border-ink/15 bg-[#F5F1E9] p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-sm font-bold text-canvas">3</span>
              <div>
                <h2 id="step3" className="text-base font-bold tracking-tight">Workload intent &amp; traffic</h2>
                <p className="mt-0.5 font-mono text-xs text-muted">Right-size concurrency and context — stop overspending on idle VRAM.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Workload intent">
              {INTENTS.map((t) => {
                const active = intentId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => pickIntent(t.id)}
                    className={`min-h-[88px] cursor-pointer rounded-xl border p-3 text-left transition-colors ${t.custom ? "sm:col-span-2" : ""} ${active ? "border-ink bg-ink text-canvas" : "border-ink/25 bg-canvas/50 hover:border-ink"}`}
                  >
                    <span aria-hidden="true" className="text-xl">{t.icon}</span>
                    <span className="mt-1 block font-mono text-sm font-bold">{t.title}</span>
                    <span className={`block font-mono text-[11px] leading-snug ${active ? "text-canvas/75" : "text-muted"}`}>{t.desc}</span>
                    <span className={`mt-1 block font-mono text-[11px] ${active ? "text-canvas/85" : "text-muted"}`}>
                      {t.custom
                        ? `${concurrency} concurrent · ${fmt(contextLen)} ctx — your numbers`
                        : `${t.concurrency} concurrent · ${fmt(t.context)} ctx`}{active ? " · ✓ Selected" : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="conc" className="font-mono text-xs font-bold">Concurrency</label>
                  <input
                    id="conc-num"
                    type="number"
                    aria-label="Exact concurrency"
                    min={1}
                    max={128}
                    value={concurrency}
                    onChange={(e) => tweakConcurrency(Number(e.target.value))}
                    className="w-20 rounded-lg border border-ink/25 bg-transparent px-2 py-1 font-mono text-xs font-bold outline-none focus:border-ink"
                  />
                </div>
                <input
                  id="conc"
                  type="range"
                  min={1}
                  max={64}
                  value={Math.min(concurrency, 64)}
                  onChange={(e) => tweakConcurrency(Number(e.target.value))}
                  className="mt-1 min-h-[44px] w-full cursor-pointer"
                />
                <div className="flex justify-between font-mono text-[10px] text-muted"><span>1 solo</span><span>64 SaaS (type up to 128)</span></div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="ctx" className="font-mono text-xs font-bold">Context</label>
                  <input
                    id="ctx-num"
                    type="number"
                    aria-label="Exact context length"
                    min={512}
                    max={131072}
                    step={512}
                    value={contextLen}
                    onChange={(e) => tweakContext(Number(e.target.value))}
                    className="w-24 rounded-lg border border-ink/25 bg-transparent px-2 py-1 font-mono text-xs font-bold outline-none focus:border-ink"
                  />
                </div>
                <input
                  id="ctx"
                  type="range"
                  min={1024}
                  max={arch.maxCtx ? Math.min(131072, arch.maxCtx) : 32768}
                  step={1024}
                  value={Math.min(contextLen, arch.maxCtx ?? contextLen)}
                  onChange={(e) => tweakContext(Number(e.target.value))}
                  className="mt-1 min-h-[44px] w-full cursor-pointer"
                />
                <div className="flex justify-between font-mono text-[10px] text-muted"><span>1K</span><span>{arch.maxCtx ? `${Math.round(arch.maxCtx / 1024)}K max` : "32K"}</span></div>
              </div>
            </div>

            <details className="mt-3 rounded-xl border border-ink/15 bg-canvas p-3 font-mono text-[11px] leading-relaxed">
              <summary className="cursor-pointer font-bold">Exact sizing math</summary>
              <p className="mt-2">M(weights) = P × b/8 = {arch.paramsB}B × {bytes} = {weightsGb}GB</p>
              <p>M(KV) = 2 × L × Hkv × Dhead × Ctx × Conc × s = 2×{arch.layers}×{arch.kvHeads}×{arch.headDim}×{fmt(contextLen)}×{concurrency}×{bytes} = {kvGb}GB</p>
              <p>M(total) = {weightsGb} + {kvGb} + {RUNTIME_GB} (allocator) = {totalGb}GB</p>
            </details>
          </section>
        </div>

        {/* RIGHT — live results */}
        <aside aria-label="Live sizing results" className="min-w-0 rounded-2xl border border-ink/15 bg-ink p-5 text-canvas lg:sticky lg:top-20">
          <p className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest text-canvas/60">
            <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            Real-time fit
          </p>

          {!allDone ? (
            <div className="mt-3 rounded-xl border border-dashed border-canvas/40 bg-canvas/5 p-4">
              <p className="font-mono text-xl font-bold tracking-tight text-canvas/90" role="status">
                {nextStep === 1 ? "STEP 1 →" : nextStep === 2 ? "STEP 2 →" : "STEP 3 →"}
              </p>
              <p className="mt-1 font-mono text-[12px] leading-relaxed text-canvas/70">
                {nextStep === 1
                  ? "Pick a trending chip or search Hugging Face — live memory math starts here."
                  : nextStep === 2
                    ? "Detecting your machine — one moment…"
                    : "Almost there — pick a workload intent to lock your SHIP / BLOCK verdict."}
              </p>
              <ol className="mt-2 space-y-1 font-mono text-[11px] text-canvas/60">
                <li>{modelDone ? "✓" : "○"} 1 · Model{modelDone ? ` — ${repoId}` : ""}</li>
                <li>{hwDone ? "✓" : "○"} 2 · Hardware{hwDone ? ` — ${useAuto ? "auto-detected" : manualHw.label}` : " — confirm in Step 2"}</li>
                <li>{intentDone ? "✓" : "○"} 3 · Workload</li>
              </ol>
            </div>
          ) : (
            <div className={`mt-3 rounded-xl border p-4 ${blocked ? "border-block bg-block text-white" : tight ? "border-amber-400 bg-amber-400 text-ink" : "border-ship bg-ship text-white"}`}>
              <p className="font-mono text-xl font-bold tracking-tight" role="status">
                {blocked ? "BLOCK ✗" : "SHIP ✓"}
              </p>
              <p className="mt-1 font-mono text-[12px] leading-relaxed">{verdictNote}</p>
            </div>
          )}

          <p className="mt-2 text-center font-mono text-[11px] font-bold" aria-live="polite">
            {effMode === "real" ? (
              <span className="text-sky-300">⚡ Live mode — estimates now, real benchmark on {certGpu} at mint.</span>
            ) : (
              <span className="text-canvas/60">🧪 Simulator mode — estimates now, real benchmark on {certGpu} at mint.</span>
            )}
          </p>

          {/* Stacked memory breakdown */}
          <div className="mt-4 rounded-xl border border-canvas/20 bg-canvas/5 p-3">
            <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-canvas/70">
              Memory — {useAuto ? "auto-detected" : manualHw.label} ({effectiveHw.memoryGB}GB)
            </p>
            <div
              role="img"
              aria-label={modelDone ? `Weights ${weightsGb}GB, KV-cache ${kvGb}GB, runtime ${RUNTIME_GB}GB, free ${freeGb}GB of ${effectiveHw.memoryGB}GB` : "Memory breakdown appears once a model is picked"}
              className="mt-2 flex h-4 w-full overflow-hidden rounded-full border border-canvas/30 bg-canvas/10"
            >
              {modelDone && (
                <>
                  <span className="h-full bg-canvas" style={{ width: seg(weightsGb) }} title={`Weights ${weightsGb}GB`} />
                  <span className={`h-full ${oom ? "bg-red-400" : "bg-emerald-400"}`} style={{ width: seg(kvGb) }} title={`KV-cache ${kvGb}GB`} />
                  <span className="h-full bg-[#3B82F6]" style={{ width: seg(RUNTIME_GB) }} title={`Runtime ${RUNTIME_GB}GB`} />
                </>
              )}
            </div>
            <ul className="mt-2 space-y-1 font-mono text-[11px] text-canvas/80">
              <li className="flex justify-between"><span><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-sm bg-canvas" />Weights</span><span>{modelDone ? `${weightsGb}GB` : "—"}</span></li>
              <li className="flex justify-between"><span><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />KV-cache</span><span>{modelDone ? `${kvGb}GB` : "—"}</span></li>
              <li className="flex justify-between"><span><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#3B82F6]" />Runtime allocator</span><span>{modelDone ? `${RUNTIME_GB}GB` : "—"}</span></li>
              <li className="flex justify-between font-bold"><span>Free headroom</span><span>{modelDone ? `${freeGb}GB (${pct}% used)` : "—"}</span></li>
            </ul>
            <p className="mt-2 font-mono text-[11px] text-canvas/60">
              {modelDone ? (
                <>Usable {usableGb}GB (95%) · decode ~{decodeMs}ms/token on {effectiveHw.bandwidthGBs >= 1000 ? `${(effectiveHw.bandwidthGBs / 1000).toFixed(1)} TB/s` : `${effectiveHw.bandwidthGBs} GB/s`}
                {sandboxCost > 0 ? ` · 1-hr sandbox ≈ $${sandboxCost.toFixed(2)}` : " · local run $0"}</>
              ) : (
                "Numbers appear here live once a model is picked in Step 1."
              )}
            </p>
          </div>

          {ALLOW_SIM && (
            <div className="mt-4">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-canvas/60">Execution mode</p>
              <div className="mt-1.5 [&>div]:border-canvas/30 [&>div]:bg-transparent [&_button]:!text-canvas/70 [&_button[class*='bg-ink']]:!bg-canvas [&_button[class*='bg-ink']]:!text-ink">
                <ExecutionModeToggle />
              </div>
            </div>
          )}

          {/* Backend-truthful mode — one honest line, from /api/health */}
          {(() => {
            const line = backendTruthLine(backendTruth);
            return (
              <p aria-live="polite" className={`mt-2 text-center font-mono text-[11px] font-bold ${line.cls}`}>
                Backend: {line.text}
              </p>
            );
          })()}

          {allDone ? (
            <Link
              href={sandboxHref}
              className="mt-4 flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-canvas/40 px-4 py-3 font-mono text-sm font-bold transition-colors hover:bg-canvas/10"
            >
              🚀 Launch 1-Hour Live Sandbox →
            </Link>
          ) : (
            <span
              aria-disabled="true"
              title="Finish all 3 steps to unlock actions"
              className="mt-4 flex min-h-[52px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-canvas/20 px-4 py-3 font-mono text-sm font-bold text-canvas/40"
            >
              🚀 Launch 1-Hour Live Sandbox →
            </span>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-canvas px-4 py-3 font-mono text-sm font-bold text-ink transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-70"
          >
            {submitting ? "Minting…" : "📜 Mint Cryptographic Certification →"}
          </button>
          <p className="mt-2 text-center font-mono text-[11px] leading-relaxed text-canvas/60">
            Sandbox replays live traffic for 1 hour{sandboxCost > 0 ? ` (≈$${sandboxCost.toFixed(2)})` : ""}. Mint runs the full audit → <span className="underline">/certificate/[id]</span>.
          </p>

          <div aria-live="polite" className="mt-2 min-h-[20px] text-center">
            {status && submitting ? (
              <p className="font-mono text-[11px] text-canvas/80">{status}</p>
            ) : (
              <p className="font-mono text-[11px] text-canvas/50">
                {concurrency} streams · {fmt(contextLen)} ctx · {precision} · {effMode === "real" ? "live GPU" : "simulator"}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-2 rounded-xl border border-red-400/50 bg-red-500/15 p-2 text-center font-mono text-[11px] font-bold text-red-200">
              {error}
            </p>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-canvas/20 pt-3 font-mono text-[11px]">
            <div>
              <dt className="font-bold text-canvas/60">Testing</dt>
              <dd className="break-all text-[10px] text-canvas/85">{repoId || "—"}</dd>
            </div>
            <div>
              <dt className="font-bold text-canvas/60">Target</dt>
              <dd className="text-[10px] text-canvas/85">{useAuto ? `auto → ${certGpu}` : `${manualHw.label} → ${certGpu}`}</dd>
            </div>
          </dl>
        </aside>
      </form>
    </div>
  );
}
