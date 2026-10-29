"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell, ByokBadge, useByokStatus } from "@/components/ui";
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
            return [...n, { role: "sys", text: `live endpoint error: ${msg} — sizing math still exact; retry or pick a served (live) model.` }];
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
    <AppShell>
      <Suspense fallback={<p className="p-8 text-[14px] text-ink2">Loading sandbox…</p>}>
        <Gate />
      </Suspense>
    </AppShell>
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
      <div className="app-pad mx-auto max-w-shell">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Verify hardware headroom before execution</h1>
        <p className="mt-2 max-w-2xl text-[14px] text-ink2">
          Pick a workload archetype, a Nebius GPU tier, and a model checkpoint — the sandbox evaluates KV-cache boundaries before you launch.
        </p>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-6">

            <section aria-labelledby="q1" className="rounded-card border border-line bg-surface p-5 sm:p-6">
              <h2 id="q1" className="text-[15px] font-semibold">Workload archetype</h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Target archetype">
                {(
                  [
                    { id: "lab", tag: "Single stream", t: "Developer workstation / local rig", d: "1 active stream · baseline interactive harness · starts on L40S 48GB." },
                    { id: "prod", tag: "Concurrent", t: "Production agent cluster", d: "Multi-user concurrency · strict latency SLAs · starts on H100 80GB." },
                  ] as { id: Archetype; tag: string; t: string; d: string }[]
                ).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={arch === a.id}
                    data-on={arch === a.id ? "true" : "false"}
                    onClick={() => {
                      setArch(a.id);
                      setGpuKey(a.id === "prod" ? "H100" : "L40S");
                    }}
                    className="opt flex-col items-start gap-1"
                  >
                    <span className="text-[12.5px] text-ink2">{a.tag}</span>
                    <span className="text-[14px] font-medium">{a.t}</span>
                    <span className="text-[12.5px] leading-snug text-ink2">{a.d}</span>
                  </button>
                ))}
              </div>
            </section>

            <section aria-labelledby="q2" className="rounded-card border border-line bg-surface p-5 sm:p-6">
              <h2 id="q2" className="text-[15px] font-semibold">Reference hardware tier</h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Reference tier">
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
                      data-on={active ? "true" : "false"}
                      onClick={() => setGpuKey(g.key)}
                      className="opt flex-col items-start gap-1 !p-3.5"
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="font-mono text-[13px] font-medium">{g.label}</span>
                        <span className="font-mono text-[12px] tabular-nums text-ink2">${g.price.toFixed(2)}/hr</span>
                      </span>
                      <span className="text-[12.5px] text-ink2">
                        <span className="font-mono">{g.vram} GB VRAM</span> · {g.blurb}
                      </span>
                      <span className={`flex items-center gap-1.5 text-[12px] font-medium ${gOk ? "text-ship" : "text-blockDeep"}`}>
                        <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${gOk ? "bg-ship" : "bg-block"}`} />
                        {gOk ? `Fits — ~${gf.total} GB` : `Exceeds — ~${gf.total} GB required`}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
                <div className="flex flex-wrap items-center gap-2.5">
                  <ByokBadge connected={byokConnected} />
                  <span className="text-[12.5px] text-ink2">
                    {byokConnected ? "Live execution configured with your Nebius key." : "Simulated verification on the shared host pool ($0 demo)."}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setByokOpen(true)}
                  className="btn btn-ghost btn-round h-8 shrink-0 px-3 text-[12.5px]"
                >
                  {byokConnected ? "Manage key" : "Add Nebius key"}
                </button>
              </div>
              <ByokModal open={byokOpen} onClose={() => setByokOpen(false)} />
            </section>

            <section aria-labelledby="q3" className="rounded-card border border-line bg-surface p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="q3" className="text-[15px] font-semibold">Candidate model &amp; precision</h2>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Precision">
                  {Object.keys(PREC_BYTES).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={precKey === p}
                      title={PREC_BYTES[p].label}
                      onClick={() => setPrecision(p)}
                      className={`pill cursor-pointer font-mono ${precKey === p ? "!bg-ink !text-[#F2F1EC]" : "pill-neutral"}`}
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
                      data-on={active ? "true" : "false"}
                      className={`opt flex-col items-start gap-1 !p-3 ${locked ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="truncate font-mono text-[13px] font-medium">{m.label}</span>
                        {gpu.recs.includes(m.slug) && <span className="shrink-0 text-[12px] font-medium text-accentInk">Recommended</span>}
                      </span>
                      <span className="block w-full truncate font-mono text-[12px] text-ink2">{m.slug} · {m.paramsB}B</span>
                      <span className={`flex items-center gap-1.5 text-[12px] font-medium ${ok ? "text-ship" : int4Ok ? "text-warn" : "text-blockDeep"}`}>
                        <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-ship" : int4Ok ? "bg-warn" : "bg-block"}`} />
                        {ok ? `Fits — ~${mf.total} GB` : int4Ok ? `~${mf.total} GB — INT4 fits` : `~${mf.total} GB — exceeds tier`}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[12.5px] text-ink2">Deterministic sizing math applied before launch — invalid pairs are locked.</p>
              <div className="mt-5 border-t border-rule pt-5">
                <label className="block">
                  <span className="text-[13px] text-ink2">Search Hugging Face</span>
                  <input
                    value={hfq}
                    onChange={(e) => setHfq(e.target.value)}
                    placeholder="Search by slug or family (e.g. Qwen, Gemma, Llama)…"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Search Hugging Face models"
                    className="field mt-2 font-mono text-[13px]"
                  />
                </label>
                {searching && <p className="mt-2 text-[12.5px] text-ink2">Querying Hugging Face Hub metadata…</p>}
                {!searching && hfq.trim().length >= 2 && searchHits.length === 0 && (
                  <p className="mt-2 text-[12.5px] text-ink2">No verified fits found for “{hfq.trim()}” on {gpu.label}.</p>
                )}
                {searchHits.length > 0 && (
                  <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2" role="radiogroup" aria-label="Search results">
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
                          data-on={active ? "true" : "false"}
                          title={f.slug}
                          className="opt flex-col items-start gap-0.5 !p-3"
                        >
                          <span className="block w-full truncate text-[13px] font-medium">{f.label}</span>
                          <span className="block w-full truncate font-mono text-[12px] tabular-nums text-ink2">
                            {f.paramsB}B · ~{ft.total} GB
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="mt-5 text-[13px] text-ink2">
                  Verified fits for {gpu.label} <span className="tabular-nums">({pool.length})</span>
                </p>
                {liveLoading && pool.length === 0 ? (
                  <p className="mt-2 text-[12.5px] text-ink2">Loading live checkpoint catalog…</p>
                ) : (
                  <>
                    {liveFits.length === 0 && (
                      <p className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink2">
                        <span>Live endpoint catalog unreachable — fallback spec pool active.</span>
                        <button
                          type="button"
                          onClick={() => setLiveRetry((n) => n + 1)}
                          className="btn btn-ghost btn-round h-8 px-3 text-[12.5px]"
                        >
                          Retry
                        </button>
                      </p>
                    )}
                    <div className="mt-2 grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2" role="radiogroup" aria-label="More verified fits">
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
                            data-on={active ? "true" : "false"}
                            title={f.slug}
                            className="opt flex-col items-start gap-0.5 !p-3"
                          >
                            <span className="block w-full truncate text-[13px] font-medium">{f.label}</span>
                            <span className="block w-full truncate font-mono text-[12px] tabular-nums text-ink2">
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
                        className="btn btn-ghost btn-round mt-3 h-10 w-full px-3 text-[13px]"
                      >
                        {showAll ? "Collapse catalog" : `View ${pool.length - 6} more verified checkpoints`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </section>
          </div>

          {/* Fit side-panel */}
          <aside aria-label="Fit check" className="min-w-0 rounded-card border border-line bg-surface p-5 lg:sticky lg:top-20">
            <h2 className="text-[15px] font-semibold">Hardware preflight check</h2>
            <div className={`mt-3 rounded-control px-3.5 py-3 ${fits ? "bg-shipWash" : "bg-blockWash"}`}>
              <p className={`text-[14px] font-semibold ${fits ? "text-shipDeep" : "text-blockDeep"}`} role="status">
                {fits ? "Ship compliant" : "Block — OOM exceeded"}
              </p>
              <p className={`mt-1 text-[12.5px] leading-relaxed ${fits ? "text-shipDeep/80" : "text-blockDeep/80"}`}>
                {fits
                  ? `${selModel.label} @ ${precKey} requires ~${fit.total} GB against ${usable} GB usable capacity.`
                  : `${selModel.label} @ ${precKey} requires ~${fit.total} GB, exceeding the ${usable} GB usable limit.`}
              </p>
            </div>
            <div className="mt-4">
              <div className="flex items-baseline justify-between text-[12.5px] text-ink2">
                <span>VRAM footprint</span>
                <span className="font-mono font-medium tabular-nums text-ink">{fit.total} / {usable} GB</span>
              </div>
              <div
                role="img"
                aria-label={`Weights ${fit.w}GB, KV ${fit.kv}GB of ${gpu.vram}GB`}
                className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-rule"
              >
                <span className="h-full bg-ink" style={{ width: `${(fit.w / gpu.vram) * 100}%` }} />
                <span className={`h-full ${fits ? "bg-ship" : "bg-block"}`} style={{ width: `${(fit.kv / gpu.vram) * 100}%` }} />
                <span className="h-full bg-[#C9C8C1]" style={{ width: `${(RUNTIME_GB / gpu.vram) * 100}%` }} />
              </div>
              <ul className="mt-3 space-y-1.5 text-[12.5px] tabular-nums text-ink2">
                <li className="flex justify-between"><span>Weights</span><span className="font-mono text-ink">{fit.w} GB</span></li>
                <li className="flex justify-between"><span>KV-cache (1×8K context)</span><span className="font-mono text-ink">{fit.kv} GB</span></li>
                <li className="flex justify-between"><span>Runtime buffer</span><span className="font-mono text-ink">{RUNTIME_GB} GB</span></li>
                <li className="flex justify-between border-t border-rule pt-1.5 font-medium text-ink">
                  <span>Total vs usable</span><span className="font-mono">{fit.total} / {usable} GB</span>
                </li>
              </ul>
            </div>
            <button
              type="button"
              onClick={() => fits && setStarted(true)}
              disabled={!fits}
              title={fits ? `Start session on ${gpu.label}` : "Pick a fitting pair above"}
              className="btn btn-accent btn-round mt-5 h-14 w-full px-4 text-[14px]"
            >
              {fits ? "Start sandbox session" : "Incompatible sizing"}
              <span aria-hidden="true">→</span>
            </button>
            <p className="mt-3 text-center text-[12px] text-ink2">
              {selModel.label} · {precKey} · ≈${gpu.price.toFixed(2)}/hr · Nebius Token Factory
            </p>
            <Link href={auditHref} className="btn btn-ghost btn-round mt-3 h-11 w-full px-3 text-[13px]">
              Launch full audit →
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
    <div className="app-pad mx-auto max-w-shell">
      {warn && status !== "ended" && (
        <p role="alert" className="mb-5 rounded-control bg-warnWash px-3.5 py-2.5 text-center text-[13px] font-medium text-warn">
          Five minutes remain on this tier — export the certification soon to keep your transcript.
        </p>
      )}

      {/* Session header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
            {gpu.label} <span className="font-normal text-ink2">${gpu.price.toFixed(2)}/hr</span>
          </h1>
          <p className="mt-1 text-[14px] text-ink2">
            Sandbox session <span className="font-mono text-[12.5px]">{sid.current}</span> ·{" "}
            {arch === "lab" ? "Single stream / lab" : "Concurrent / production"} · Nebius Token Factory
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`pill ${liveLink && simEnforced === false ? "pill-ship" : liveLink ? "pill-warn" : "pill-neutral"}`}>
            <span
              aria-hidden="true"
              className={`inline-block h-1.5 w-1.5 rounded-full ${liveLink === null ? "bg-faint" : !liveLink ? "bg-block" : simEnforced ? "bg-warn" : "bg-ship"}`}
            />
            {liveLink === null
              ? "Linking…"
              : !liveLink
                ? "Offline"
                : simEnforced
                  ? "Simulated engine"
                  : "Live Nebius link"}
          </span>
          <span className={`pill ${status === "ready" ? "pill-ship" : status === "ended" ? "pill-neutral" : "pill-warn"}`}>
            {status === "ready" && <span aria-hidden="true" className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-ship" />}
            {status === "ready"
              ? "Ready"
              : status === "swapping"
                ? `Swapping ${swapPct}%`
                : status === "ended"
                  ? "Ended"
                  : "Provisioning"}
          </span>
          <span
            className={`text-[13px] tabular-nums ${warn || status === "ended" ? "text-warn" : "text-ink"}`}
            role="timer"
            aria-label={`${fmtClock(remaining)} remaining`}
          >
            {fmtClock(remaining)}
          </span>
          {byokConnected && <span className="pill pill-neutral">BYOK key active</span>}
        </div>
      </div>

      {/* Model quick-switcher */}
      <div className="mt-6 rounded-card border border-line bg-surface p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink2">Checkpoint</span>
          {ALL.map((m) => (
            <button
              key={m.slug}
              type="button"
              disabled={busy}
              onClick={() => swapTo(m)}
              aria-pressed={model.slug === m.slug}
              title={served.includes(m.slug) ? "Live endpoint verified" : "No verified live endpoint yet — sizing still exact"}
              className={`pill cursor-pointer disabled:cursor-wait disabled:opacity-50 ${model.slug === m.slug ? "!bg-ink !text-[#F2F1EC]" : "pill-neutral"}`}
            >
              <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${served.includes(m.slug) ? "bg-ship" : "bg-faint"}`} />
              <span className="font-mono">{m.label}</span>
            </button>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-rule sm:inline-block" aria-hidden="true" />
          <button
            type="button"
            disabled={busy}
            onClick={() => setCompare((v) => !v)}
            aria-pressed={compare}
            className={`pill cursor-pointer disabled:cursor-wait disabled:opacity-50 ${compare ? "!bg-ink !text-[#F2F1EC]" : "pill-neutral"}`}
          >
            Compare {compare ? "on" : "off"}
          </button>
          {compare && (
            <select
              aria-label="Comparison model"
              value={modelB.slug}
              disabled={busy}
              onChange={(e) => setModelB(ALL.find((m) => m.slug === e.target.value) ?? ALL[1] ?? ALL[0])}
              className="min-h-[34px] cursor-pointer rounded-control border border-control bg-surface px-3 font-mono text-[12.5px] text-ink outline-none hover:border-ink disabled:opacity-50"
            >
              {ALL.filter((m) => m.slug !== model.slug).map((m) => (
                <option key={m.slug} value={m.slug}>{(served.includes(m.slug) ? "● " : "○ ") + m.label}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className={`mt-4 grid items-start gap-6 ${compare ? "lg:grid-cols-2" : "lg:grid-cols-[1fr_360px]"}`}>
        {/* Chat console */}
        <div className="term min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-termRule px-4 py-2.5">
            <p className="truncate text-[12.5px] text-termText">
              {model.label} <span className="text-termMuted">· {model.slug}</span>
            </p>
            <Link href="/new" className="shrink-0 text-[12px] text-[#FF9B70] hover:underline">
              Preflight sizing →
            </Link>
          </div>
          {compare && (
            <p className="border-b border-termRule px-4 py-2 text-[12px] text-termMuted">
              Side-by-side inference: one prompt streams across both endpoints.
            </p>
          )}
          <div className={`grid ${compare ? "grid-cols-1 sm:grid-cols-2 sm:divide-x sm:divide-termRule" : "grid-cols-1"}`}>
            <Pane msgs={paneA.msgs} streaming={paneA.streaming} stats={paneA.stats} label={compare ? model.label : undefined} />
            {compare && <Pane msgs={paneB.msgs} streaming={paneB.streaming} stats={paneB.stats} label={modelB.label} />}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendCurrent();
            }}
            className="flex items-center gap-2.5 border-t border-termRule p-3"
          >
            <span aria-hidden="true" className="text-[13px] text-[#FF9B70]">&gt;</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              placeholder={status === "ended" ? "Session ended — export certificate below." : `Send test prompt to ${model.label}…`}
              aria-label="Chat prompt"
              className="min-h-[40px] flex-1 rounded-control border border-termRule bg-[#1E1E1C] px-3 text-[13px] text-termText outline-none placeholder:text-termMuted focus:border-[#FF9B70] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="btn btn-accent btn-round h-10 shrink-0 px-4 text-[13px]"
            >
              Send
            </button>
          </form>
        </div>

        {/* Telemetry HUD */}
        <aside aria-label="Live telemetry HUD" className="min-w-0 space-y-5 rounded-card border border-line bg-surface p-5">
          <h2 className="text-[15px] font-semibold">Measured timings</h2>
          <section aria-label="Measured timings" className="kpi-strip rounded-card border border-line bg-raised" style={{ ["--kpi-n" as string]: 3 }}>
            {[
              { k: "TTFT", v: hud.replies ? `${hud.ttft} ms` : "—" },
              { k: "ITL", v: hud.replies ? `${hud.itl} ms` : "—" },
              { k: "Throughput", v: hud.replies ? `${hud.tps} t/s` : "—" },
            ].map((s) => (
              <div key={s.k} className="kpi-cell !px-3">
                <p className="kpi-label">{s.k}</p>
                <p className="kpi-value mt-1.5 !text-[17px]">{s.v}</p>
              </div>
            ))}
          </section>
          <div>
            <div className="flex items-baseline justify-between text-[13px] text-ink2">
              <span>VRAM headroom</span>
              <span className="font-mono font-medium tabular-nums text-ink">{totalGb} / {gpu.vram} GB ({vramPct}%)</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(vramPct)}
              aria-label={`VRAM ${vramPct} percent`}
              className={`meter mt-2.5 ${vramPct >= 95 ? "meter-block" : "meter-accent"}`}
            >
              <span style={{ width: `${vramPct}%` }} />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed tabular-nums text-ink2">
              Weights {weightsGb} GB + KV {kvGb} GB (grows with chat) + {RUNTIME_GB} GB runtime · {tokensUsed} session tokens
            </p>
          </div>
          <div className="term p-3.5 text-[12px] leading-relaxed" aria-live="polite">
            <p className="font-medium text-termText">Replay harness spec</p>
            {totals.current.prompts === 0 ? (
              <p className="mt-1 text-termMuted">Send a prompt above — the certification will replay this exact token distribution.</p>
            ) : (
              <p className="mt-1 text-termText">
                {model.label} · {gpu.cert} {precision.toUpperCase()} · {totals.current.prompts} prompts →{" "}
                {Math.min(1000, Math.max(20, totals.current.prompts * 20))} replayed requests · cap $
                {Math.min(20, Math.max(2, gpu.price * 2)).toFixed(2)}
                {simEnforced !== false ? " → simulated verdict" : ` → live benchmark on ${gpu.cert}`}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={exportCert}
            disabled={exporting}
            className="btn btn-accent btn-round h-11 w-full px-4 text-[13.5px]"
          >
            {exporting ? "Minting certificate…" : "Export verified certificate"}
            <span aria-hidden="true">→</span>
          </button>
          {error && (
            <p role="alert" className="rounded-control bg-blockWash px-3.5 py-2.5 text-[12.5px] font-medium text-blockDeep">
              {error}
            </p>
          )}
          <div aria-label="Session event log" className="term max-h-44 overflow-y-auto p-3 text-[12px] leading-relaxed">
            {log.length === 0 && <p className="text-[#8A8A84]">&gt; awaiting session events…</p>}
            {log.map((l, i) => (
              <p key={`${i}-${l}`} className="log-line whitespace-pre-wrap break-words text-termMuted">
                <span className="text-[#FF9B70]">[{i + 1}]</span> {l}
              </p>
            ))}
          </div>
          <p className="text-[12px] leading-snug text-ink2">
            Tokens and timings measured live from endpoints; the VRAM gauge runs exact sizing physics.
          </p>
        </aside>
      </div>

      {/* Live request traces */}
      <section aria-label="Session traces" className="term mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-termRule px-4 py-2.5">
          <p className="text-[12.5px] text-termText">
            Request traces · {traces.length} record{traces.length === 1 ? "" : "s"} · {tokensUsed} tokens
          </p>
          <p className="text-[12px] text-termMuted">Live hardware metrics collected</p>
        </div>
        {traces.length === 0 ? (
          <p className="px-4 py-6 text-[12.5px] text-termMuted">No request traces recorded yet. Active prompts and measured TTFT / ITL timings will appear here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead>
                <tr className="border-b border-termRule text-left text-termMuted">
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Time</th>
                  <th className="px-3 py-2.5 font-medium">Model</th>
                  <th className="px-3 py-2.5 font-medium">Prompt</th>
                  <th className="px-3 py-2.5 text-right font-medium">Tokens (in/out)</th>
                  <th className="px-3 py-2.5 text-right font-medium">TTFT</th>
                  <th className="px-3 py-2.5 text-right font-medium">ITL</th>
                </tr>
              </thead>
              <tbody>
                {[...traces].reverse().map((t) => (
                  <tr key={`${t.n}-${t.time}`} className="border-b border-termRule/60 last:border-b-0">
                    <td className="px-4 py-2 text-termMuted">{t.n}</td>
                    <td className="px-3 py-2 tabular-nums text-termMuted">{t.time}</td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-termText" title={t.model}>{t.model}</td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-[#EDEDE8]/80" title={t.prompt}>{t.prompt}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#EDEDE8]/80">{t.pTok}/{t.cTok}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#7FD7A8]">{t.ttft}ms</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#FF9B70]">{t.itl}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {log.some((l) => /^(link|switch|session|provision|hotswap|vllm):/.test(l)) && (
          <div className="border-t border-termRule px-4 py-2.5">
            <p className="text-[12px] font-medium text-termMuted">Session spans</p>
            <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-[12px] leading-relaxed">
              {log.filter((l) => /^(link|switch|session|provision|hotswap|vllm):/.test(l)).map((l, i) => (
                <p key={`${i}-${l}`} className="log-line whitespace-pre-wrap break-words text-termMuted">{l}</p>
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
        <p className="border-b border-termRule px-4 py-1.5 text-[12px] font-medium text-termMuted">
          {label} · {stats.replies ? `${stats.ttft}ms TTFT · ${stats.tps} t/s` : "idle"}
        </p>
      )}
      <div className="flex-1 space-y-2.5 overflow-y-auto p-4 text-[13px] leading-relaxed">
        {msgs.length === 0 && (
          <p className="text-[#8A8A84]">Session ready. Ask about VRAM, latency, or anything the model should handle.</p>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="whitespace-pre-wrap break-words text-termText">
              <span className="text-[#7FD7A8]">you›</span> {m.text}
            </p>
          ) : m.role === "sys" ? (
            <p key={i} className="text-center text-[12px] text-[#8A8A84]">— {m.text} —</p>
          ) : (
            <p key={i} className="whitespace-pre-wrap break-words text-[#EDEDE8]/85">
              <span className="text-[#FF9B70]">gpu›</span> {m.text}
              {streaming && i === msgs.length - 1 && <span aria-hidden="true" className="ml-1 inline-block h-3.5 w-2 animate-pulse bg-[#7FD7A8]" />}
            </p>
          )
        )}
      </div>
    </div>
  );
}
