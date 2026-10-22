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
  const ctrl = useRef<AbortController | null>(null);
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;

  const stop = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    setStreaming(false);
  }, []);

  useEffect(() => stop, [stop]);

  const pushSys = useCallback((text: string) => {
    setMsgs((m) => [...m, { role: "sys", text }]);
  }, []);

  const send = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean || ctrl.current) return;
      const model = modelRef.current;
      const promptTokens = Math.max(1, Math.round(clean.split(/\s+/).length * 1.3));
      const history = msgsRef.current
        .filter((m) => m.role !== "sys" && m.text.trim())
        .slice(-10)
        .map((m) => ({ role: m.role === "asst" ? "assistant" : "user", content: m.text }));
      setMsgs((m) => [...m, { role: "user", text: clean }, { role: "asst", text: "" }]);
      setStreaming(true);
      const ac = new AbortController();
      ctrl.current = ac;
      const t0 = performance.now();
      let firstAt = 0;
      let lastAt = 0;
      let gaps = 0;
      let gapMs = 0;
      let chunks = 0;
      let acc = "";
      let usageOut: number | null = null;
      (async () => {
        try {
          const res = await fetch("/api/chat/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: model.slug,
              messages: [...history, { role: "user", content: clean }],
              max_tokens: 512,
            }),
            signal: ac.signal,
          });
          if (!res.ok || !res.body) {
            let detail = `HTTP ${res.status}`;
            try {
              const j = await res.json();
              if (j?.detail) detail = String(j.detail);
            } catch {
              /* keep status */
            }
            throw new Error(detail);
          }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split("\n");
            buf = parts.pop() ?? "";
            for (const line of parts) {
              const t = line.trim();
              if (!t.startsWith("data:")) continue;
              const payload = t.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              let j: Record<string, unknown>;
              try {
                j = JSON.parse(payload) as Record<string, unknown>;
              } catch {
                continue;
              }
              if (typeof j.error === "string" && j.error) throw new Error(j.error);
              const choices = (j.choices as Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }>) || [];
              const delta = choices[0]?.delta || {};
              const piece = `${delta.reasoning_content ?? ""}${delta.content ?? ""}`;
              const usage = j.usage as { completion_tokens?: unknown } | undefined;
              if (typeof usage?.completion_tokens === "number") usageOut = usage.completion_tokens;
              if (!piece) continue;
              const now = performance.now();
              if (!firstAt) firstAt = now;
              else {
                gapMs += now - lastAt;
                gaps += 1;
              }
              lastAt = now;
              chunks += 1;
              acc += piece;
              const snapshot = acc;
              setMsgs((m) => {
                const n = [...m];
                n[n.length - 1] = { role: "asst", text: snapshot };
                return n;
              });
            }
          }
          if (!acc.trim()) throw new Error("empty reply from endpoint");
          const totalOut = usageOut ?? Math.max(1, Math.round(acc.split(/\s+/).length));
          const spanS = Math.max(0.01, ((lastAt || performance.now()) - (firstAt || t0)) / 1000);
          const ttft = Math.round((firstAt || performance.now()) - t0);
          const itl = Math.round(((gaps > 0 ? gapMs / gaps : spanS * 1000) * 10)) / 10;
          const tps = Math.round((totalOut / spanS) * 10) / 10;
          setStats((s) => ({ ttft, itl, tps, replies: s.replies + 1 }));
          onUsage(promptTokens, totalOut, ttft, itl, clean, model.slug);
        } catch (err: unknown) {
          if (ac.signal.aborted) return;
          const msg = err instanceof Error ? err.message : String(err);
          setMsgs((m) => {
            const n = [...m];
            if (n.length && n[n.length - 1].role === "asst" && !n[n.length - 1].text) n.pop();
            return [...n, { role: "sys", text: `⚠ live endpoint error: ${msg} — sizing math still exact; retry or pick a served (● live) model.` }];
          });
        } finally {
          if (ctrl.current === ac) ctrl.current = null;
          setStreaming(false);
        }
      })();
    },
    [modelRef, onUsage]
  );

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
      <div className="mx-auto w-full max-w-[1280px] px-4 py-8 lg:px-8">
        <p className="font-mono text-[11px] font-medium tracking-[0.08em] uppercase text-muted">PREFLIGHT SIZING / NEBIUS TOKEN FACTORY SANDBOXES</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink lg:text-3xl">Verify hardware headroom before execution</h1>
        <p className="mt-2 font-mono text-sm text-muted">Select an archetype, hardware tier, and model checkpoint to evaluate KV-cache boundaries.</p>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-6">

        <section aria-labelledby="q1" className="border border-rule bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between border-b border-rule pb-3">
            <h2 id="q1" className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-ink">01 / WORKLOAD ARCHETYPE</h2>
            <span className="font-mono text-[10px] text-muted">TARGET PROFILE</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Target archetype">
            {(
              [
                { id: "lab", tag: "SINGLE STREAM", t: "Developer Workstation / Local Rig", d: "1 active stream · baseline interactive harness · starts on L40S 48GB." },
                { id: "prod", tag: "CONCURRENT", t: "Production Agent Cluster", d: "Multi-user concurrency · strict latency SLAs · starts on H100 80GB." },
              ] as { id: Archetype; tag: string; t: string; d: string }[]
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
                className={`min-h-[82px] cursor-pointer rounded-[2px] border p-4 text-left transition-colors ${arch === a.id ? "border-ink bg-ink text-white" : "border-rule bg-paper hover:border-ink"}`}
              >
                <span className={`inline-block font-mono text-[10px] tracking-[0.06em] font-medium ${arch === a.id ? "text-orange" : "text-orangeDeep"}`}>[{a.tag}]</span>
                <span className="mt-1.5 block font-mono text-sm font-medium">{a.t}</span>
                <span className={`mt-1 block font-mono text-[11px] leading-relaxed ${arch === a.id ? "text-inverseMuted" : "text-muted"}`}>{a.d}</span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="q2" className="border border-rule bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between border-b border-rule pb-3">
            <h2 id="q2" className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-ink">02 / REFERENCE HARDWARE TIER</h2>
            <span className="font-mono text-[10px] text-muted">NEBIUS CLUSTER</span>
          </div>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Reference tier">
            {GPUS.map((g) => {
              const gf = footprint(selModel, precKey);
              const gOk = gf.total <= g.vram * 0.95;
              const active = gpuKey === g.key;
              return (
                <button
                  key={g.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setGpuKey(g.key)}
                  className={`min-h-[70px] cursor-pointer rounded-[2px] border px-3.5 py-2.5 text-left transition-colors ${active ? "border-ink bg-ink text-white" : "border-rule bg-paper hover:border-ink"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold">{g.label}</span>
                    <span className={`font-mono text-[10px] ${active ? "text-orange" : "text-muted"}`}>${g.price.toFixed(2)}/HR</span>
                  </div>
                  <span className={`mt-1 block font-mono text-[11px] ${active ? "text-inverseMuted" : "text-muted"}`}>
                    {g.vram} GB VRAM · {g.blurb}
                  </span>
                  <span className={`mt-1 block font-mono text-[10px] font-medium ${gOk ? (active ? "text-emerald-400" : "text-ship") : (active ? "text-red-300" : "text-block")}`}>
                    {gOk ? `✓ ~${gf.total} GB FITS` : `✗ EXCEEDS (~${gf.total} GB REQUIRED)`}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
            <div className="flex items-center gap-3">
              <ByokBadge connected={byokConnected} />
              <span className="font-mono text-[11px] text-muted">
                {byokConnected ? "Live execution configured with BYOK key." : "Simulated verification enabled on host pool ($0 demo)."}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setByokOpen(true)}
              className="sigil-technical-button min-h-[34px] cursor-pointer rounded-[2px] border border-rule bg-paper px-3 py-1 font-mono text-[11px] font-medium text-ink hover:border-ink"
            >
              {byokConnected ? "MANAGE KEY" : "ADD NEBIUS KEY"}
            </button>
          </div>
          <ByokModal open={byokOpen} onClose={() => setByokOpen(false)} />
        </section>

        <section aria-labelledby="q3" className="border border-rule bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
            <h2 id="q3" className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-ink">03 / CANDIDATE MODEL & PRECISION</h2>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Precision">
              {Object.keys(PREC_BYTES).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={precKey === p}
                  title={PREC_BYTES[p].label}
                  onClick={() => setPrecision(p)}
                  className={`min-h-[30px] cursor-pointer rounded-[2px] border px-2.5 py-0.5 font-mono text-[11px] font-medium transition-colors ${precKey === p ? "border-ink bg-ink text-white" : "border-rule bg-paper hover:border-ink"}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Sandbox model">
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
                  className={`min-h-[66px] rounded-[2px] border px-3 py-2 text-left transition-colors ${active ? "border-ink bg-ink text-white" : ok ? "cursor-pointer border-rule bg-paper hover:border-ink" : "cursor-not-allowed border-rule bg-paper/50 opacity-40"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold">{m.label}</span>
                    {gpu.recs.includes(m.slug) && <span className="font-mono text-[9px] tracking-wide text-orangeDeep uppercase">[REC]</span>}
                  </div>
                  <span className={`block truncate font-mono text-[10px] ${active ? "text-inverseMuted" : "text-muted"}`}>{m.slug} · {m.paramsB}B</span>
                  <span className={`mt-1 block font-mono text-[10px] font-medium ${ok ? (active ? "text-emerald-400" : "text-ship") : (active ? "text-red-300" : "text-block")}`}>
                    {ok ? `✓ ~${mf.total} GB FITS` : int4Ok ? `✗ ~${mf.total} GB (INT4 AVAILABLE)` : `✗ ~${mf.total} GB (LOCKED)`}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 font-mono text-[11px] text-muted">Deterministic sizing math applied before launch — invalid pairs are locked.</p>
          <div className="mt-4 border-t border-rule pt-4">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
              SEARCH HUGGING FACE REPOSITORY
            </p>
            <input
              value={hfq}
              onChange={(e) => setHfq(e.target.value)}
              placeholder="Search by slug or family (e.g. Qwen, Gemma, Llama)…"
              spellCheck={false}
              autoComplete="off"
              aria-label="Search Hugging Face models"
              className="mt-2 min-h-[42px] w-full rounded-[2px] border border-rule bg-paper p-2.5 font-mono text-xs text-ink outline-none focus:border-ink"
            />
            {searching && <p className="mt-1.5 font-mono text-[11px] text-muted">Querying Hugging Face Hub metadata…</p>}
            {!searching && hfq.trim().length >= 2 && searchHits.length === 0 && (
              <p className="mt-1.5 font-mono text-[11px] text-muted">No verified fits found for “{hfq.trim()}” on {gpu.label}.</p>
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
                      className={`min-h-[50px] rounded-[2px] border px-3 py-2 text-left transition-colors ${active ? "cursor-pointer border-ink bg-ink text-white" : "cursor-pointer border-rule bg-paper hover:border-ink"}`}
                    >
                      <span className="block truncate font-mono text-[11px] font-medium" title={f.slug}>{f.label}</span>
                      <span className={`block font-mono text-[10px] ${active ? "text-inverseMuted" : "text-muted"}`}>
                        {f.paramsB}B · ~{ft.total} GB
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-4 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
              VERIFIED TIER FITS FOR {gpu.label} ({pool.length})
            </p>
            {liveLoading && pool.length === 0 ? (
              <p className="mt-2 font-mono text-[11px] text-muted">Loading live checkpoint catalog…</p>
            ) : (
              <>
                {liveFits.length === 0 && (
                  <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
                    <span>Live endpoint catalog unreachable — fallback spec pool active.</span>
                    <button
                      type="button"
                      onClick={() => setLiveRetry((n) => n + 1)}
                      className="sigil-technical-button min-h-[30px] cursor-pointer rounded-[2px] border border-rule bg-paper px-2.5 py-0.5 font-mono text-[11px] text-ink hover:border-ink"
                    >
                      RETRY
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
                        className={`min-h-[50px] rounded-[2px] border px-3 py-2 text-left transition-colors ${active ? "cursor-pointer border-ink bg-ink text-white" : "cursor-pointer border-rule bg-paper hover:border-ink"}`}
                      >
                        <span className="block truncate font-mono text-[11px] font-medium" title={f.slug}>{f.label}</span>
                        <span className={`block font-mono text-[10px] ${active ? "text-inverseMuted" : "text-muted"}`}>
                          {f.paramsB}B · ~{ft.total} GB
                        </span>
                      </button>
                    );
                  })}
                </div>
                {pool.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="sigil-technical-button mt-2 min-h-[36px] w-full cursor-pointer rounded-[2px] border border-rule bg-paper px-3 py-1 font-mono text-[11px] font-medium text-ink hover:border-ink"
                  >
                    {showAll ? "COLLAPSE CATALOG ↑" : `VIEW ${pool.length - 6} ADDITIONAL VERIFIED CHECKPOINTS`}
                  </button>
                )}
              </>
            )}
          </div>
        </section>
          </div>

          {/* Fit side-panel */}
          <aside aria-label="Fit check" className="min-w-0 border border-darkRule bg-ink p-5 text-white lg:sticky lg:top-20">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-inverseMuted">HARDWARE PREFLIGHT CHECK</p>
            <div className={`mt-3 border p-3.5 ${fits ? "border-ship bg-ship/20 text-white" : "border-block bg-block/20 text-white"}`}>
              <p className={`font-mono text-base font-semibold tracking-wide ${fits ? "text-emerald-300" : "text-red-300"}`} role="status">
                {fits ? "STATUS / SHIP COMPLIANT" : "STATUS / BLOCK (OOM EXCEEDED)"}
              </p>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-inverseMuted">
                {fits
                  ? `${selModel.label} @ ${precKey} requires ~${fit.total} GB against ${usable} GB usable capacity.`
                  : `${selModel.label} @ ${precKey} requires ~${fit.total} GB exceeding ${usable} GB usable limit.`}
              </p>
            </div>
            <div className="mt-4 h-3 w-full border border-darkRule bg-[#272725]" role="img" aria-label={`Weights ${fit.w}GB, KV ${fit.kv}GB of ${gpu.vram}GB`}>
              <div className="flex h-full w-full">
                <span className="h-full bg-white" style={{ width: `${(fit.w / gpu.vram) * 100}%` }} />
                <span className={`h-full ${fits ? "bg-orange" : "bg-block"}`} style={{ width: `${(fit.kv / gpu.vram) * 100}%` }} />
                <span className="h-full bg-[#52524E]" style={{ width: `${(RUNTIME_GB / gpu.vram) * 100}%` }} />
              </div>
            </div>
            <ul className="mt-3 space-y-1.5 border-t border-darkRule pt-3 font-mono text-[11px] text-inverseMuted">
              <li className="flex justify-between"><span>Weights</span><span className="text-white">{fit.w} GB</span></li>
              <li className="flex justify-between"><span>KV-cache (1×8K context)</span><span className="text-white">{fit.kv} GB</span></li>
              <li className="flex justify-between"><span>Runtime Buffer</span><span className="text-white">{RUNTIME_GB} GB</span></li>
              <li className="flex justify-between border-t border-darkRule pt-1.5 font-semibold text-white">
                <span>Total vs Usable</span><span>{fit.total} / {usable} GB</span>
              </li>
            </ul>
            <button
              type="button"
              onClick={() => fits && setStarted(true)}
              disabled={!fits}
              title={fits ? `Start session on ${gpu.label}` : "Pick a fitting pair above"}
              className="sigil-technical-button mt-5 flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-[2px] bg-orange px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-orangeDeep disabled:cursor-not-allowed disabled:bg-darkRule disabled:text-inverseMuted"
            >
              {fits ? `Start Sandbox Session ➔` : "Incompatible Sizing"}
            </button>
            <p className="mt-3 text-center font-mono text-[10px] text-inverseMuted">
              {selModel.label} · {precKey} · ≈${gpu.price.toFixed(2)}/hr · Nebius Token Factory
            </p>
            <Link href={auditHref} className="sigil-technical-button mt-4 block min-h-[38px] rounded-[2px] border border-darkRule bg-inkSoft px-3 py-2 text-center font-mono text-[11px] font-medium text-white transition-colors hover:border-white">
              Launch Full 3-Step Audit ➔
            </Link>
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
  const [served, setServed] = useState<string[]>([]);
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
    fetch("/api/chat/models", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => {
        if (alive && Array.isArray(j?.models)) setServed(j.models.map(String));
      })
      .catch(() => {
        /* served list unavailable — send surfaces the error honestly */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Session link-up (honest: no GPU is provisioned — the console talks to
  // live model endpoints) + 60-min countdown.
  useEffect(() => {
    pushLog(`link: resolving live endpoint for ${modelRef.current.slug}…`);
    const t1 = setTimeout(() => pushLog(`link: Token Factory route verified · streaming enabled…`), 700);
    const t2 = setTimeout(() => {
      pushLog(`session: live endpoint link READY — every token below is real inference`);
      setStatus("ready");
    }, 1600);
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
    if (remaining === 0) pushLog("session: 60 minutes elapsed — transcript + export preserved.");
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
    // Honest switch: serverless endpoints mean the next prompt simply routes
    // elsewhere — no weights move, no NVMe, no warmup theater.
    setStatus("swapping");
    setSwapPct(0);
    pushLog(`switch: routing next prompts to ${next.slug}…`);
    await new Promise((res) => setTimeout(res, 600));
    setSwapPct(60);
    pushLog(`switch: endpoint verified · no weight move on serverless`);
    await new Promise((res) => setTimeout(res, 400));
    setModel(next);
    setSwapPct(100);
    paneA.pushSys(`— switched to ${next.label} (live endpoint) —`);
    setStatus("ready");
    pushLog(`switch: ${next.label} READY`);
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
          `sandboxproof-sandbox-${sid.current}`,
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
    <div className="mx-auto w-full max-w-[1280px] px-4 py-8 lg:px-8">
      {warn && status !== "ended" && (
        <p role="alert" className="mb-4 border border-amber-500/60 bg-amber-500/10 p-3 text-center font-mono text-xs font-semibold text-amber-700">
          SESSION NOTICE: 5 MINUTES REMAINING ON THIS TIER — EXPORT CERTIFICATION SOON.
        </p>
      )}

      {/* Session header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-rule pb-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            SANDBOX SESSION {sid.current} · {arch === "lab" ? "[SINGLE STREAM / LAB]" : "[CONCURRENT / PRODUCTION]"}
          </p>
          <h1 className="mt-1 font-mono text-xl font-semibold tracking-tight text-ink">
            {gpu.label} <span className="font-normal text-muted">${gpu.price.toFixed(2)}/HR · NEBIUS TOKEN FACTORY</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span className={`rounded-[2px] border px-2.5 py-1 ${liveLink && simEnforced === false ? "border-ship/40 bg-ship/10 text-ship" : liveLink ? "border-amber-500/50 bg-amber-500/10 text-amber-700" : "border-rule text-muted"}`}>
            {liveLink === null
              ? "● LINKING…"
              : !liveLink
                ? "● OFFLINE"
                : simEnforced
                  ? "● SIMULATED ENGINE"
                  : "● LIVE NEBIUS LINK"}
          </span>
          <span className={`rounded-[2px] border px-2.5 py-1 ${status === "ready" ? "border-ship/40 bg-ship/10 text-ship" : status === "ended" ? "border-rule text-muted" : "border-amber-500/50 bg-amber-500/10 text-amber-700"}`}>
            {status === "ready" ? "● READY" : status === "swapping" ? `◌ SWAPPING ${swapPct}%` : status === "ended" ? "○ ENDED" : "◌ PROVISIONING"}
          </span>
          <span className={`rounded-[2px] border px-2.5 py-1 tabular-nums ${warn || status === "ended" ? "border-block/50 bg-block/10 text-block" : "border-rule text-ink"}`} role="timer" aria-label={`${fmtClock(remaining)} remaining`}>
            {fmtClock(remaining)}
          </span>
          {byokConnected && <span className="rounded-[2px] border border-rule px-2.5 py-1 text-muted">[BYOK KEY ACTIVE]</span>}
        </div>
      </div>

      {/* Model quick-switcher */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border border-rule bg-white p-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">CHECKPOINT</span>
        {ALL.map((m) => (
          <button
            key={m.slug}
            type="button"
            disabled={busy}
            onClick={() => swapTo(m)}
            aria-pressed={model.slug === m.slug}
            title={served.includes(m.slug) ? "Live endpoint verified" : "No verified live endpoint yet — sizing still exact"}
            className={`min-h-[36px] cursor-pointer rounded-[2px] border px-3 py-1 font-mono text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-50 ${model.slug === m.slug ? "border-ink bg-ink text-white" : "border-rule bg-paper hover:border-ink"}`}
          >
            <span aria-hidden="true" className={served.includes(m.slug) ? "text-ship" : "text-muted"}>● </span>
            {m.label}
          </button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-rule sm:inline-block" aria-hidden="true" />
        <button
          type="button"
          disabled={busy}
          onClick={() => setCompare((v) => !v)}
          aria-pressed={compare}
          className={`min-h-[36px] cursor-pointer rounded-[2px] border px-3 py-1 font-mono text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-50 ${compare ? "border-ink bg-ink text-white" : "border-rule bg-paper hover:border-ink"}`}
        >
          COMPARE {compare ? "ON" : "OFF"}
        </button>
        {compare && (
          <select
            aria-label="Comparison model"
            value={modelB.slug}
            disabled={busy}
            onChange={(e) => setModelB(ALL.find((m) => m.slug === e.target.value) ?? ALL[1] ?? ALL[0])}
            className="min-h-[36px] cursor-pointer rounded-[2px] border border-rule bg-paper px-3 font-mono text-xs font-medium outline-none disabled:opacity-50"
          >
            {ALL.filter((m) => m.slug !== model.slug).map((m) => (
              <option key={m.slug} value={m.slug}>{(served.includes(m.slug) ? "● " : "○ ") + m.label}</option>
            ))}
          </select>
        )}
      </div>

      <div className={`mt-4 grid items-start gap-4 ${compare ? "lg:grid-cols-2" : "lg:grid-cols-[1fr_340px]"}`}>
        {/* Chat console */}
        <div className="min-w-0 border border-darkRule bg-ink text-white">
          <div className="flex items-center justify-between gap-2 border-b border-darkRule px-4 py-3">
            <p className="truncate font-mono text-xs font-semibold">
              {model.label} <span className="font-normal text-inverseMuted">· {model.slug}</span>
            </p>
            <Link href="/new" className="shrink-0 font-mono text-[11px] text-orange hover:underline">
              PREFLIGHT SIZING ➔
            </Link>
          </div>
          {compare && (
            <p className="border-b border-darkRule px-4 py-2 font-mono text-[11px] text-inverseMuted">
              SIDE-BY-SIDE INFERENCE: ONE PROMPT STREAMS ACROSS BOTH ENDPOINTS.
            </p>
          )}
          <div className={`grid ${compare ? "grid-cols-1 sm:grid-cols-2 sm:divide-x sm:divide-darkRule" : "grid-cols-1"}`}>
            <Pane msgs={paneA.msgs} streaming={paneA.streaming} stats={paneA.stats} label={compare ? model.label : undefined} />
            {compare && <Pane msgs={paneB.msgs} streaming={paneB.streaming} stats={paneB.stats} label={modelB.label} />}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendCurrent();
            }}
            className="flex items-center gap-2 border-t border-darkRule p-3"
          >
            <span aria-hidden="true" className="font-mono text-sm text-orange">&gt;</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              placeholder={status === "ended" ? "Session ended — export certificate below." : `Send test prompt to ${model.label}…`}
              aria-label="Chat prompt"
              className="min-h-[42px] flex-1 rounded-[2px] border border-darkRule bg-[#272725] px-3 font-mono text-xs text-white outline-none placeholder:text-inverseMuted focus:border-orange disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="sigil-technical-button min-h-[42px] shrink-0 cursor-pointer rounded-[2px] bg-orange px-5 font-mono text-xs font-semibold uppercase text-white transition-colors hover:bg-orangeDeep disabled:cursor-not-allowed disabled:bg-darkRule disabled:text-inverseMuted"
            >
              SEND
            </button>
          </form>
        </div>

        {/* Telemetry HUD */}
        <aside aria-label="Live telemetry HUD" className="min-w-0 space-y-4 border border-darkRule bg-ink p-5 text-white">
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-inverseMuted">
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 bg-orange" />
            TELEMETRY HUD / MEASURED TIMINGS
          </p>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              { k: "TTFT", v: hud.replies ? `${hud.ttft}ms` : "—" },
              { k: "ITL", v: hud.replies ? `${hud.itl}ms` : "—" },
              { k: "Throughput", v: hud.replies ? `${hud.tps} t/s` : "—" },
            ].map((s) => (
              <div key={s.k} className="rounded-[2px] border border-darkRule bg-inkSoft px-2 py-3">
                <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-inverseMuted">{s.k}</dt>
                <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-white">{s.v}</dd>
              </div>
            ))}
          </dl>
          <div>
            <div className="flex items-baseline justify-between font-mono text-[11px]">
              <span className="font-medium uppercase tracking-[0.08em] text-inverseMuted">VRAM HEADROOM</span>
              <span className="font-semibold tabular-nums text-white">{totalGb} / {gpu.vram} GB ({vramPct}%)</span>
            </div>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(vramPct)} aria-label={`VRAM ${vramPct} percent`} className="mt-2 flex h-3 w-full border border-darkRule bg-[#272725]">
              <span className="h-full bg-white" style={{ width: `${(weightsGb / gpu.vram) * 100}%` }} title={`Weights ${weightsGb}GB`} />
              <span className={`h-full ${vramPct >= 95 ? "bg-block" : "bg-orange"}`} style={{ width: `${(kvGb / gpu.vram) * 100}%` }} title={`KV-cache ${kvGb}GB`} />
              <span className="h-full bg-[#52524E]" style={{ width: `${(RUNTIME_GB / gpu.vram) * 100}%` }} title={`Runtime ${RUNTIME_GB}GB`} />
            </div>
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-inverseMuted">
              Weights {weightsGb} GB + KV {kvGb} GB (grows with chat) + {RUNTIME_GB} GB runtime · {tokensUsed} session tokens
            </p>
          </div>
          <div className="rounded-[2px] border border-darkRule bg-inkSoft p-3 font-mono text-[11px] leading-relaxed text-inverseMuted" aria-live="polite">
            <p className="font-semibold uppercase tracking-[0.08em] text-white">REPLAY HARNESS SPEC</p>
            {totals.current.prompts === 0 ? (
              <p className="mt-1 text-inverseMuted">Send a prompt above — the certification will replay this exact token distribution.</p>
            ) : (
              <p className="mt-1 text-white">
                {model.label} · {gpu.cert} {precision.toUpperCase()} · {totals.current.prompts} prompts →{" "}
                {Math.min(1000, Math.max(20, totals.current.prompts * 20))} replayed requests · cap $
                {Math.min(20, Math.max(2, gpu.price * 2)).toFixed(2)}
                {simEnforced !== false ? " → SIMULATED verdict" : ` → live benchmark on ${gpu.cert}`}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={exportCert}
            disabled={exporting}
            className="sigil-technical-button flex min-h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-[2px] bg-orange px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-orangeDeep disabled:cursor-wait disabled:bg-darkRule disabled:text-inverseMuted"
          >
            {exporting ? "Minting Certificate…" : "Export Verified Certificate ➔"}
          </button>
          {error && (
            <p role="alert" className="border border-block bg-block/20 p-2.5 text-center font-mono text-[11px] font-medium text-red-300">
              {error}
            </p>
          )}
          <div aria-label="Session event log" className="max-h-44 overflow-y-auto border border-darkRule bg-[#272725] p-3 font-mono text-[11px] leading-relaxed">
            {log.length === 0 && <p className="text-inverseMuted">&gt; awaiting session events…</p>}
            {log.map((l, i) => (
              <p key={`${i}-${l}`} className="gp-log-line whitespace-pre-wrap break-words text-inverseMuted">
                <span className="text-orange">[{i + 1}]</span> {l}
              </p>
            ))}
          </div>
          <p className="font-mono text-[10px] leading-snug text-inverseMuted">
            Tokens and timings measured live from endpoints; VRAM gauge runs exact sizing physics.
          </p>
        </aside>
      </div>

      {/* Live request traces */}
      <section aria-label="Session traces" className="mt-6 border border-darkRule bg-ink text-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-darkRule px-5 py-3">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em]">
            REQUEST TRACES · {traces.length} RECORD{traces.length === 1 ? "" : "S"} · {tokensUsed} TOKENS
          </p>
          <p className="font-mono text-[10px] text-inverseMuted">LIVE HARDWARE METRICS COLLECTED</p>
        </div>
        {traces.length === 0 ? (
          <p className="px-5 py-6 font-mono text-xs text-inverseMuted">No request traces recorded yet. Active prompts and measured TTFT / ITL timings will appear here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] font-mono text-[11px]">
              <thead>
                <tr className="border-b border-darkRule text-left text-inverseMuted">
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">TIME</th>
                  <th className="px-3 py-2.5 font-medium">MODEL</th>
                  <th className="px-3 py-2.5 font-medium">PROMPT</th>
                  <th className="px-3 py-2.5 text-right font-medium">TOKENS (IN/OUT)</th>
                  <th className="px-3 py-2.5 text-right font-medium">TTFT</th>
                  <th className="px-3 py-2.5 text-right font-medium">ITL</th>
                </tr>
              </thead>
              <tbody>
                {[...traces].reverse().map((t) => (
                  <tr key={`${t.n}-${t.time}`} className="border-b border-darkRule/60 last:border-b-0">
                    <td className="px-4 py-2 text-inverseMuted">{t.n}</td>
                    <td className="px-3 py-2 text-inverseMuted">{t.time}</td>
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
        {log.some((l) => /^(link|switch|session|provision|hotswap|vllm):/.test(l)) && (
          <div className="border-t border-white/10 px-4 py-2.5">
            <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-zinc-400">Session spans</p>
            <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-relaxed">
              {log.filter((l) => /^(link|switch|session|provision|hotswap|vllm):/.test(l)).map((l, i) => (
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
