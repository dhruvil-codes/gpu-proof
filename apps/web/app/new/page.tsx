"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ByokBadge, ExecutionModeToggle, TopNav, useByokStatus } from "@/components/ui";
import ByokModal from "@/components/ByokModal";
import { buildByokHeaders } from "@/components/byok";
import { buildExecutionHeaders, getExecutionMode } from "@/components/executionMode";
import HardwareProfiler from "@/components/HardwareProfiler";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

type FormState = {
  candidate_model: string;
  current_model: string;
  requests: number;
  budget_usd: number;
  /** Breakscale stress operating point: parallel streams. */
  concurrency: number;
  /** Breakscale stress operating point: context window tokens. */
  context_len: number;
  /** Target cloud GPU for the saturation verdict (catalog key). */
  target_gpu: string;
  /** Inference precision driving the KV/weights math. */
  precision: string;
};

const NANO = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";

// Breakscale stress calibration stops — sliders snap to these indices.
// Concurrency: parallel streams. Context: tokens (2048 included so the
// Smoke preset lands exactly on a stop; the five required stops
// 1024 / 4096 / 8192 / 16384 / 32768 are all present).
const CONCURRENCY_STEPS = [1, 4, 8, 16, 24, 32];
const CONTEXT_STEPS = [1024, 2048, 4096, 8192, 16384, 32768];

const BYTES_PER_PRECISION: Record<string, number> = {
  BF16: 2,
  FP16: 2,
  FP8: 1,
  INT8: 1,
  INT4: 0.5,
};

const STRESS_TARGET_GPUS = [
  { key: "L40S", label: "L40S 48GB", vram_gb: 48, price: 1.35 },
  { key: "H100", label: "H100 80GB", vram_gb: 80, price: 3.2 },
  { key: "A100", label: "A100 80GB", vram_gb: 80, price: 2.1 },
  { key: "H200", label: "H200 141GB", vram_gb: 141, price: 3.95 },
];

/** Desktop telemetry comparison: local workstation vs cloud tiers. */
const TELEMETRY_COMPARE_GPUS = [
  { key: "LOCAL", label: "Local PC 24GB", vram_gb: 24, note: "RTX 4090 / 3090" },
  { key: "L40S", label: "Nebius L40S 48GB", vram_gb: 48, note: "$1.35/hr · entry" },
  { key: "H100", label: "H100 80GB", vram_gb: 80, note: "$3.20/hr · escalation" },
];

const PRECISION_OPTIONS = ["BF16", "FP8", "INT4"];

const POPULAR_PROD_MODELS = [
  // The Big Five
  { label: "Qwen 3.6 27B", slug: "Qwen/Qwen3.6-27B-Instruct", tag: "Apache 2.0" },
  { label: "DeepSeek V4 Pro", slug: "deepseek-ai/DeepSeek-V4-Pro", tag: "MIT · SWE 80.6%" },
  { label: "Llama 4 Scout", slug: "meta-llama/Llama-4-Scout", tag: "Meta · 10M Ctx" },
  { label: "Gemma 4 31B", slug: "google/gemma-4-31b-it", tag: "Apache 2.0" },
  { label: "Codestral 2501", slug: "mistralai/Codestral-2501", tag: "Apache 2.0" },
  // Mac Mini & Single 24GB
  { label: "gpt-oss 20B", slug: "openai/gpt-oss-20b", tag: "Mac Mini 16GB" },
  { label: "Qwen3-Coder 30B", slug: "Qwen/Qwen3-Coder-30B-A3B", tag: "RTX 4090 24GB" },
  { label: "Phi-4 14B", slug: "microsoft/phi-4", tag: "MIT" },
  // Frontier Contenders
  { label: "Kimi K2.6", slug: "moonshotai/Kimi-K2.6-Instruct", tag: "SWE-bench Pro" },
  { label: "GLM-5 32B", slug: "THUDM/glm-5-32b", tag: "MIT" },
];

type StressPreset = {
  id: string;
  glyph: string;
  title: string;
  focus: string;
  detail: string;
  values: Partial<FormState>;
};

// Breakscale one-click testing presets: load the system until it breaks.
const TEMPLATES: StressPreset[] = [
  {
    id: "smoke",
    glyph: "💨",
    title: "Smoke Test",
    focus: "Quick cold-start and sanity test.",
    detail: "8 streams · 2K context · ~$0.50 cap",
    values: { concurrency: 8, context_len: 2048, budget_usd: 0.5, requests: 50 },
  },
  {
    id: "production",
    glyph: "✅",
    title: "Production SLA Gate",
    focus: "Recommended standard.",
    detail: "16 streams · 4K context · ~$2.50 cap",
    values: { concurrency: 16, context_len: 4096, budget_usd: 2.5, requests: 200 },
  },
  {
    id: "soak",
    glyph: "🔥",
    title: "Breakscale Soak Test",
    focus: "Stress to failure limit.",
    detail: "32 streams · 8K context · ~$8.00 cap",
    values: { concurrency: 32, context_len: 8192, budget_usd: 8.0, requests: 500 },
  },
];

type ModelFit = {
  model_slug: string;
  display_name: string;
  params_b: number;
  layers: number;
  hidden: number;
  license?: string;
  note?: string;
  weights_fp16_gb: number;
  weights_fp8_gb: number;
  weights_int4_gb: number;
  total_local_int4_gb: number;
  total_prod_fp8_gb: number;
  local_status: string;
  local_verdict: string;
  recommended_cloud_gpu: string;
  recommended_cloud_label: string;
  recommended_cloud_price: number;
  deploy_stack?: {
    local_dev?: string;
    production_cloud?: string;
    commercial_license?: string;
  };
};

function extractHfRepoId(input: string): string {
  const s = (input || "").trim();
  const cleaned = s
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:huggingface\.co|hf\.co)\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length >= 2) {
    if (parts[0] === "models" && parts.length >= 3) {
      return `${parts[1]}/${parts[2]}`;
    }
    return `${parts[0]}/${parts[1]}`;
  }
  return s;
}

export default function New() {
  return (
    <main>
      <TopNav />
      <Suspense fallback={<p className="p-8 text-sm">Loading form…</p>}>
        <NewForm />
      </Suspense>
    </main>
  );
}

function NewForm() {
  const r = useRouter();
  const q = useSearchParams();
  const prefill = q.get("candidate_model") || "Nemotron-3-Nano-30B";
  const [form, setForm] = useState<FormState>({
    candidate_model: prefill,
    current_model: "Qwen3-8B",
    requests: 200,
    budget_usd: 2.5,
    concurrency: 16,
    context_len: 4096,
    target_gpu: "H100",
    precision: "FP8",
  });

  const [extractedSlug, setExtractedSlug] = useState<string | null>(null);
  const [modelFit, setModelFit] = useState<ModelFit | null>(null);
  const [inspecting, setInspecting] = useState(false);

  // Sync candidate from query parameter
  useEffect(() => {
    const v = q.get("candidate_model");
    if (v && v !== form.candidate_model) {
      const clean = extractHfRepoId(v);
      setForm((f) => ({ ...f, candidate_model: clean }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Dynamic Hugging Face inspection & hardware sizing on candidate change
  useEffect(() => {
    const query = form.candidate_model.trim();
    if (!query) {
      setModelFit(null);
      setExtractedSlug(null);
      return;
    }

    // Check if input looks like a full URL
    const isUrl = /^(https?:\/\/)?(www\.)?(huggingface\.co|hf\.co)/i.test(query);
    const clean = extractHfRepoId(query);
    if (isUrl && clean !== query) {
      setExtractedSlug(clean);
    } else {
      setExtractedSlug(null);
    }

    const timer = setTimeout(async () => {
      setInspecting(true);
      try {
        const res = await fetch(`/api/models/inspect?query=${encodeURIComponent(clean)}`);
        if (res.ok) {
          const data = await res.json();
          setModelFit(data);
        }
      } catch {
        // graceful offline fallback
      } finally {
        setInspecting(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [form.candidate_model]);

  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [byokOpen, setByokOpen] = useState(false);
  const byokConnected = useByokStatus();

  // --- Breakscale live KV-cache & VRAM failure calculation -----------------
  // KV (GB) = 2 * layers * hidden * context_len * concurrency * bytes / 1e9.
  // Total   = weights + KV + 2GB runtime. OOM when total > vram * 0.95.
  // Runs client-side on every slider move so the warning appears *before*
  // the user spends budget on a doomed run.
  const stressArch = {
    layers: modelFit?.layers ?? 48,
    hidden: modelFit?.hidden ?? 5120,
    params_b: modelFit?.params_b ?? 30,
    archKnown: !!modelFit,
  };
  const stressBytes = BYTES_PER_PRECISION[form.precision] ?? 2;
  const stressWeightsGb = Math.round(stressArch.params_b * stressBytes * 100) / 100;
  const stressKvGb =
    Math.round((2 * stressArch.layers * stressArch.hidden * form.context_len * form.concurrency * stressBytes) / 1e9 * 100) /
    100;
  const stressTotalGb = Math.round((stressWeightsGb + stressKvGb + 2) * 100) / 100;
  function saturationFor(vramGb: number) {
    const usable = Math.round(vramGb * 0.95 * 100) / 100;
    const pct = vramGb > 0 ? Math.round((stressTotalGb / vramGb) * 1000) / 10 : 0;
    return {
      usableGb: usable,
      pct,
      headroomGb: Math.round((usable - stressTotalGb) * 100) / 100,
      oom: stressTotalGb > usable,
      tight: !!(stressTotalGb <= usable && pct >= 85),
    };
  }
  const stressLocal = saturationFor(24);
  const stressL40s = saturationFor(48);
  const stressH100 = saturationFor(80);
  const stressTargetVram =
    STRESS_TARGET_GPUS.find((g) => g.key === form.target_gpu)?.vram_gb ?? 80;
  const stressTargetSat = saturationFor(stressTargetVram);
  const stress = {
    weightsGb: stressWeightsGb,
    kvGb: stressKvGb,
    totalGb: stressTotalGb,
    bytes: stressBytes,
    oom: stressTargetSat.oom,
    tight: stressTargetSat.tight,
    targetPct: stressTargetSat.pct,
    targetHeadroom: stressTargetSat.headroomGb,
  };

  // --- Projected breaking point: max parallel streams before CUDA OOM -----
  // Solves weights + perStreamKV * C + 2GB runtime <= vram * 0.95 for C.
  const perStreamKvGb =
    (2 * stressArch.layers * stressArch.hidden * form.context_len * stressBytes) / 1e9;
  const kvBudgetGb = stressTargetSat.usableGb - stressWeightsGb - 2;
  const maxSafeStreams =
    perStreamKvGb > 0 ? Math.max(0, Math.floor(kvBudgetGb / perStreamKvGb)) : 0;
  const nextBreakStep = CONCURRENCY_STEPS.find((s) => s > maxSafeStreams) ?? null;

  // --- VRAM allocation gauge segments (weights / KV / 2GB system overhead) --
  const gaugeSegs = [
    { key: "weights", label: "Weights", gb: stressWeightsGb, color: "#1F1F1F" },
    { key: "kv", label: "KV-Cache", gb: stressKvGb, color: "#9A6B0F" },
    { key: "sys", label: "System", gb: 2, color: "#A8A29E" },
  ];
  const gaugeCap = stressTargetVram > 0 ? stressTargetVram : 1;

  function stepConcurrency(dir: 1 | -1) {
    setForm((f) => {
      const i = CONCURRENCY_STEPS.indexOf(f.concurrency);
      const next = CONCURRENCY_STEPS[Math.min(CONCURRENCY_STEPS.length - 1, Math.max(0, (i < 0 ? 3 : i) + dir))];
      return { ...f, concurrency: next };
    });
    setActiveTemplate(null);
  }
  function stepContext(dir: 1 | -1) {
    setForm((f) => {
      const i = CONTEXT_STEPS.indexOf(f.context_len);
      const next = CONTEXT_STEPS[Math.min(CONTEXT_STEPS.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))];
      return { ...f, context_len: next };
    });
    setActiveTemplate(null);
  }
  function formatTokens(n: number) {
    return `${n.toLocaleString("en-US")} tokens (${n >= 1024 ? `${Math.round(n / 1024)}K` : `${n}`})`;
  }

  function applyTemplate(id: string) {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setForm((f) => ({ ...f, ...t.values }));
    setActiveTemplate(id);
  }

  function handleCandidateChange(val: string) {
    const clean = extractHfRepoId(val);
    setForm((f) => ({ ...f, candidate_model: val }));
    if (val !== clean && (val.includes("huggingface.co") || val.includes("hf.co"))) {
      setExtractedSlug(clean);
    } else {
      setExtractedSlug(null);
    }
    setActiveTemplate(null);
  }

  function applyExtractedSlug() {
    if (extractedSlug) {
      setForm((f) => ({ ...f, candidate_model: extractedSlug }));
      setExtractedSlug(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const cleanCandidate = extractHfRepoId(form.candidate_model);
    const cleanCurrent = extractHfRepoId(form.current_model);

    if (!cleanCandidate.trim()) errs.candidate_model = "Candidate model is required.";
    if (!cleanCurrent.trim()) errs.current_model = "Current deployment is required.";
    if (!(form.requests >= 20 && form.requests <= 1000)) errs.requests = "Requests must be 20–1000.";
    if (!(form.budget_usd >= 0.05 && form.budget_usd <= 10)) errs.budget_usd = "Budget must be $0.05–$10.";
    if (!CONCURRENCY_STEPS.includes(form.concurrency))
      errs.concurrency = `Concurrency must be one of ${CONCURRENCY_STEPS.join(", ")}.`;
    if (!CONTEXT_STEPS.includes(form.context_len))
      errs.context_len = `Context must be one of ${CONTEXT_STEPS.map((c) => c.toLocaleString()).join(", ")}.`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (stress.oom) {
      setMsg(
        `Starting test run… (⚠️ ${stress.totalGb}GB projected on ${form.target_gpu} — testing failure limit.)`
      );
    } else {
      setMsg("Starting test run… Replaying queries on test GPU container...");
    }
    try {
      const mode = getExecutionMode();
      const byokHeaders = buildByokHeaders();
      const execHeaders = buildExecutionHeaders(mode);
      const payload = {
        ...form,
        candidate_model: cleanCandidate,
        current_model: cleanCurrent,
        gpu_type: form.target_gpu,
        mode,
      };

      // Try Next.js server proxy first (/api/certifications), fallback to direct API
      let res: Response;
      try {
        res = await fetch("/api/certifications", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...byokHeaders, ...execHeaders },
          body: JSON.stringify(payload),
        });
      } catch {
        res = await fetch(`${API}/certifications`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...byokHeaders, ...execHeaders },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      const j = await res.json();
      setMsg(
        `Benchmark created [${j.id}] · launching test container...${j.byok_used ? " (Nebius Live Key)" : ""}${
          j.mode ? ` [${j.mode === "real" ? "⚡ Live GPU" : "🧪 Simulator"}]` : ""
        }`
      );

      let s: Response;
      try {
        s = await fetch(`/api/certifications/${j.id}/start`, {
          method: "POST",
          headers: { ...byokHeaders, ...execHeaders },
        });
      } catch {
        s = await fetch(`${API}/certifications/${j.id}/start`, {
          method: "POST",
          headers: { ...byokHeaders, ...execHeaders },
        });
      }

      if (!s.ok) throw new Error(`start failed: ${s.status}`);
      try {
        const items = JSON.parse(localStorage.getItem("gpuproof-certs") || "[]");
        items.unshift({
          id: j.id,
          candidate: cleanCandidate,
          status: "RUNNING",
          spend: 0,
          experiments: 0,
          simulated: true,
          created_at: new Date().toISOString(),
        });
        localStorage.setItem("gpuproof-certs", JSON.stringify(items.slice(0, 20)));
      } catch {}
      r.push(`/timeline/${j.id}`);
    } catch (err: unknown) {
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)} — is backend running? Try refreshing or checking http://localhost:8000`);
    }
  }

  const set = (k: keyof FormState, v: string | number) => {
    setForm((f) => ({ ...f, [k]: v }));
    setActiveTemplate(null);
  };
  const field =
    "mt-1 min-h-[44px] w-full rounded border border-ink bg-transparent p-2 text-sm outline-none focus:border-black font-mono";
  const label = "block text-sm font-bold";
  const helper = "mt-1 block text-[11px] leading-relaxed text-muted";

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-5 lg:px-8">
      {/* Compact header + BYOK status on one row */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/20 pb-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight lg:text-2xl">Hardware Sizing &amp; Live Cloud Benchmark</h1>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Test any open-source model under real user traffic. Verify if it fits your local machine or benchmark it on a Nebius Cloud GPU.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Execution mode">
          <ByokBadge connected={byokConnected} />
          <button
            type="button"
            onClick={() => setByokOpen(true)}
            className="min-h-[40px] cursor-pointer rounded border border-ink px-3 py-1.5 text-xs font-bold transition-all hover:-translate-y-px hover:shadow-[4px_4px_0_rgba(31,31,31,0.25)]"
          >
            🔑 BYOK / API Key
          </button>
        </div>
      </div>
      <ByokModal open={byokOpen} onClose={() => setByokOpen(false)} />

      {/* Human-friendly explanation banner */}
      <div className="mt-3 rounded-lg border border-ink/30 bg-[#F5F1E9] p-3 text-xs leading-relaxed text-ink/90 shadow-[2px_2px_0_#1F1F1F]">
        <p className="font-bold flex items-center gap-1.5 text-ink">
          <span>💡</span> What this benchmark test actually does:
        </p>
        <p className="mt-1 text-muted">
          We spin up an isolated test container on Nebius Cloud (or the free local simulator), replay <strong>{form.requests} realistic user queries</strong> at <strong>{form.concurrency} concurrent streams</strong>, and measure real-world VRAM usage, P95 response speed, and output accuracy. If it passes, you get a turnkey <code className="font-mono bg-ink/10 px-1 py-0.5 rounded">vllm serve</code> command and exact hourly cost to deploy in production.
        </p>
      </div>

      {/* One-click presets — full-width strip above the master-detail grid */}
      <div className="mt-3" role="group" aria-label="One-click testing presets">
        <p className="text-[11px] uppercase tracking-widest text-muted">
          One-click testing presets — load it until it breaks
        </p>
        <div className="mt-2 grid gap-2 text-left sm:grid-cols-3">
          {TEMPLATES.map((t) => {
            const selected = activeTemplate === t.id;
            const recommended = t.id === "production";
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t.id)}
                aria-pressed={selected}
                aria-label={`${t.title}: ${t.detail}. ${t.focus}`}
                className={`min-h-[44px] cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-all ${
                  selected
                    ? "border-ink bg-ink text-canvas shadow-[4px_4px_0_rgba(31,31,31,0.25)]"
                    : "border-ink bg-[#F5F1E9] hover:shadow-[4px_4px_0_#1F1F1F]"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="block text-[13px] font-bold" aria-hidden="true">
                    {t.glyph} {t.title}
                  </span>
                  {recommended && (
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${
                        selected ? "border-canvas/40 text-canvas" : "border-ink text-ink"
                      }`}
                    >
                      Recommended
                    </span>
                  )}
                </span>
                <span
                  className={`mt-0.5 block font-mono text-[11px] font-bold ${selected ? "text-canvas" : "text-ink"}`}
                >
                  {t.detail}
                </span>
                <span className={`block text-[11px] leading-snug ${selected ? "text-canvas/70" : "text-muted"}`}>
                  {t.focus} {selected ? "· ✓ Selected" : "· Use →"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Master-detail grid: 45% config / 55% sticky telemetry on desktop, stacked on mobile */}
      <form onSubmit={submit} noValidate className="mt-3 grid items-start gap-3 lg:grid-cols-[45%_55%] lg:gap-4">
        {/* LEFT — configuration column */}
        <div className="min-w-0 space-y-3">
          {/* Candidate model input + 1-click popular models + hardware detector */}
          <div className="panel space-y-3 rounded-lg p-4">
            <div>
              <label htmlFor="cur" className={label}>
                Current Production Deployment
              </label>
              <span id="cur-help" className={helper}>
                The baseline model or endpoint currently handling production traffic.
              </span>
              <input
                id="cur"
                value={form.current_model}
                onChange={(e) => set("current_model", e.target.value)}
                aria-invalid={!!errors.current_model}
                aria-describedby="cur-err cur-help"
                className={field}
                placeholder="e.g. Qwen3-8B on H100 or meta-llama/Meta-Llama-3.1-8B-Instruct"
              />
              {errors.current_model && (
                <p id="cur-err" role="alert" className="mt-1 text-[11px] text-block">
                  {errors.current_model}
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="cand" className={label}>
                  Candidate Model to Certify
                </label>
                <span className="text-[11px] text-muted">Accepts ANY Hugging Face slug or URL</span>
              </div>
              <span id="cand-help" className={helper}>
                Paste any Hugging Face URL (e.g. <code>https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct</code>) or repo ID.
              </span>
              <input
                id="cand"
                value={form.candidate_model}
                onChange={(e) => handleCandidateChange(e.target.value)}
                aria-invalid={!!errors.candidate_model}
                aria-describedby="cand-err cand-help"
                className={field}
                placeholder="e.g. https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct or deepseek-ai/DeepSeek-R1-Distill-Qwen-32B"
              />

              {extractedSlug && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded border border-ink/30 bg-ink/5 p-2 text-xs">
                  <span className="min-w-0 truncate text-ink">
                    🔗 Hugging Face link detected: <strong>{extractedSlug}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={applyExtractedSlug}
                    className="shrink-0 rounded bg-ink px-2 py-0.5 text-[11px] font-bold text-canvas hover:bg-black"
                  >
                    Use Clean Slug
                  </button>
                </div>
              )}

              <div className="mt-2.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Production &amp; Lab Standards (1-click fill):
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {POPULAR_PROD_MODELS.map((m) => {
                    const active = form.candidate_model === m.slug;
                    return (
                      <button
                        key={m.slug}
                        type="button"
                        onClick={() => set("candidate_model", m.slug)}
                        className={`inline-flex items-center gap-1.5 cursor-pointer rounded border px-2 py-1 text-[11px] font-mono transition-all ${
                          active
                            ? "border-ink bg-ink font-bold text-canvas shadow-[2px_2px_0_rgba(31,31,31,0.2)]"
                            : "border-ink/30 bg-canvas/70 text-ink/80 hover:border-ink hover:bg-canvas"
                        }`}
                      >
                        <span>{m.label}</span>
                        <span
                          className={`rounded px-1 py-0.2 text-[9px] uppercase font-bold tracking-tight ${
                            active ? "bg-canvas/20 text-canvas" : "bg-ink/10 text-muted"
                          }`}
                        >
                          {m.tag}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {modelFit && (
                <div className="mt-3 rounded-md border border-ink/20 bg-canvas/60 p-3 text-xs leading-relaxed">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/15 pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-ink">{modelFit.display_name}</span>
                      <span className="rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-mono font-bold">
                        {modelFit.params_b}B params
                      </span>
                      {modelFit.license && (
                        <span className="rounded border border-emerald-700/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-emerald-800">
                          {modelFit.license}
                        </span>
                      )}
                      {inspecting && <span className="text-[10px] text-muted">inspecting…</span>}
                    </div>
                    <span className="font-mono text-[11px] text-muted">
                      {modelFit.layers}L · {modelFit.hidden}H
                    </span>
                  </div>

                  {modelFit.note && (
                    <p className="mt-1.5 text-[11px] text-muted leading-tight border-b border-ink/10 pb-1.5">
                      {modelFit.note}
                    </p>
                  )}

                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded border border-ink/10 bg-white/40 p-2">
                      <span className="block font-bold text-ink">💻 Local Open-Source Setup:</span>
                      <span className="mt-0.5 block text-[11px] text-ink/80">{modelFit.local_verdict}</span>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono text-muted">
                        <span>4-bit: ~{modelFit.weights_int4_gb}GB</span>
                        <span>·</span>
                        <span>FP8: ~{modelFit.weights_fp8_gb}GB</span>
                      </div>
                      <span className="mt-1 block text-[10px] text-muted">
                        Local toolchain: <code>ollama pull</code> / <code>MLX</code>
                      </span>
                    </div>

                    <div className="rounded border border-ink/10 bg-white/40 p-2">
                      <span className="block font-bold text-ink">☁️ Production Nebius Cloud:</span>
                      <span className="mt-0.5 block text-[11px] text-ink/80">
                        Recommended: <strong>{modelFit.recommended_cloud_label}</strong> (${modelFit.recommended_cloud_price.toFixed(2)}/hr)
                      </span>
                      <span className="mt-1 block text-[10px] text-muted">
                        Serving engine: <strong>vLLM / SGLang</strong> with strict &lt;2,000ms p95 SLA gates.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {errors.candidate_model && (
                <p id="cand-err" role="alert" className="mt-1 text-[11px] text-block">
                  {errors.candidate_model}
                </p>
              )}
            </div>

            {/* Local hardware auto-detector (16/24/32/64GB RAM chips inside) */}
            <div aria-label="Local hardware auto-detection">
              <HardwareProfiler modelFit={modelFit} inspecting={inspecting} />
            </div>
          </div>

          {/* Breakscale workload stress calibration */}
          <fieldset className="rounded-lg border border-ink bg-canvas/50 p-4">
            <legend className="px-1 text-[11px] font-bold uppercase tracking-widest text-muted">
              Workload stress calibration — Breakscale
            </legend>
            <p className="text-[11px] leading-relaxed text-muted">
              Load the system until it breaks, and watch why. Concurrency × context drives KV-cache growth — the
              telemetry panel projects CUDA OOM <em>before</em> you spend budget.
            </p>

            <div className="mt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <label htmlFor="concurrency" className={label}>
                  Concurrency stress — parallel streams
                </label>
                <output
                  htmlFor="concurrency"
                  aria-live="polite"
                  className="rounded border border-ink bg-ink px-2 py-0.5 font-mono text-[12px] font-bold text-canvas"
                >
                  {form.concurrency} streams
                </output>
              </div>
              <span id="concurrency-help" className={helper}>
                Simultaneous inference streams. KV-cache scales linearly with this number — it is what OOMs, not
                weights.
              </span>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => stepConcurrency(-1)}
                  disabled={form.concurrency <= CONCURRENCY_STEPS[0]}
                  aria-label="Decrease concurrency to previous step"
                  className="min-h-[44px] min-w-[44px] cursor-pointer rounded border border-ink bg-transparent px-3 font-mono text-base font-bold transition-all hover:bg-ink hover:text-canvas disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink"
                >
                  −
                </button>
                <input
                  id="concurrency"
                  type="range"
                  min={0}
                  max={CONCURRENCY_STEPS.length - 1}
                  step={1}
                  value={Math.max(0, CONCURRENCY_STEPS.indexOf(form.concurrency))}
                  onChange={(e) => {
                    const next = CONCURRENCY_STEPS[Number(e.target.value)] ?? form.concurrency;
                    set("concurrency", next);
                  }}
                  aria-label="Concurrency stress in parallel streams"
                  aria-valuemin={CONCURRENCY_STEPS[0]}
                  aria-valuemax={CONCURRENCY_STEPS[CONCURRENCY_STEPS.length - 1]}
                  aria-valuenow={form.concurrency}
                  aria-valuetext={`${form.concurrency} parallel streams`}
                  aria-describedby="concurrency-help concurrency-ticks"
                  className="w-full accent-[#1F1F1F]"
                />
                <button
                  type="button"
                  onClick={() => stepConcurrency(1)}
                  disabled={form.concurrency >= CONCURRENCY_STEPS[CONCURRENCY_STEPS.length - 1]}
                  aria-label="Increase concurrency to next step"
                  className="min-h-[44px] min-w-[44px] cursor-pointer rounded border border-ink bg-transparent px-3 font-mono text-base font-bold transition-all hover:bg-ink hover:text-canvas disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink"
                >
                  +
                </button>
              </div>
              <div
                id="concurrency-ticks"
                role="group"
                aria-label="Concurrency steps"
                className="mt-1.5 grid"
                style={{ gridTemplateColumns: `repeat(${CONCURRENCY_STEPS.length}, 1fr)` }}
              >
                {CONCURRENCY_STEPS.map((s) => {
                  const active = form.concurrency === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => set("concurrency", s)}
                      aria-pressed={active}
                      aria-label={`Set concurrency to ${s} streams`}
                      className={`cursor-pointer border-t-2 px-1 pb-1 pt-1.5 font-mono text-[11px] font-bold transition-colors ${
                        active ? "border-ink text-ink" : "border-ink/25 text-muted hover:border-ink/60 hover:text-ink"
                      }`}
                    >
                      <span aria-hidden="true" className="block text-center leading-none">
                        {active ? "●" : "│"}
                      </span>
                      <span className={`mt-0.5 block text-center ${active ? "bg-ink text-canvas" : ""}`}>{s}</span>
                    </button>
                  );
                })}
              </div>
              {errors.concurrency && (
                <p role="alert" className="mt-1 text-[11px] text-block">
                  {errors.concurrency}
                </p>
              )}
            </div>

            <div className="mt-4 border-t border-ink/15 pt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <label htmlFor="context" className={label}>
                  Context window stress — tokens per request
                </label>
                <output
                  htmlFor="context"
                  aria-live="polite"
                  className="rounded border border-ink bg-ink px-2 py-0.5 font-mono text-[12px] font-bold text-canvas"
                >
                  {form.context_len.toLocaleString("en-US")} tokens
                </output>
              </div>
              <span id="context-help" className={helper}>
                Tokens held in KV-cache per stream. Doubling context doubles cache — long-context soak tests break
                48GB cards first.
              </span>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => stepContext(-1)}
                  disabled={form.context_len <= CONTEXT_STEPS[0]}
                  aria-label="Decrease context window to previous step"
                  className="min-h-[44px] min-w-[44px] cursor-pointer rounded border border-ink bg-transparent px-3 font-mono text-base font-bold transition-all hover:bg-ink hover:text-canvas disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink"
                >
                  −
                </button>
                <input
                  id="context"
                  type="range"
                  min={0}
                  max={CONTEXT_STEPS.length - 1}
                  step={1}
                  value={Math.max(0, CONTEXT_STEPS.indexOf(form.context_len))}
                  onChange={(e) => {
                    const next = CONTEXT_STEPS[Number(e.target.value)] ?? form.context_len;
                    set("context_len", next);
                  }}
                  aria-label="Context window stress in tokens"
                  aria-valuemin={CONTEXT_STEPS[0]}
                  aria-valuemax={CONTEXT_STEPS[CONTEXT_STEPS.length - 1]}
                  aria-valuenow={form.context_len}
                  aria-valuetext={formatTokens(form.context_len)}
                  aria-describedby="context-help context-ticks"
                  className="w-full accent-[#1F1F1F]"
                />
                <button
                  type="button"
                  onClick={() => stepContext(1)}
                  disabled={form.context_len >= CONTEXT_STEPS[CONTEXT_STEPS.length - 1]}
                  aria-label="Increase context window to next step"
                  className="min-h-[44px] min-w-[44px] cursor-pointer rounded border border-ink bg-transparent px-3 font-mono text-base font-bold transition-all hover:bg-ink hover:text-canvas disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink"
                >
                  +
                </button>
              </div>
              <div
                id="context-ticks"
                role="group"
                aria-label="Context window steps"
                className="mt-1.5 grid"
                style={{ gridTemplateColumns: `repeat(${CONTEXT_STEPS.length}, 1fr)` }}
              >
                {CONTEXT_STEPS.map((s) => {
                  const active = form.context_len === s;
                  const k = s >= 1024 ? `${Math.round(s / 1024)}K` : `${s}`;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => set("context_len", s)}
                      aria-pressed={active}
                      aria-label={`Set context window to ${s.toLocaleString()} tokens`}
                      className={`cursor-pointer border-t-2 px-1 pb-1 pt-1.5 font-mono text-[11px] font-bold transition-colors ${
                        active ? "border-ink text-ink" : "border-ink/25 text-muted hover:border-ink/60 hover:text-ink"
                      }`}
                    >
                      <span aria-hidden="true" className="block text-center leading-none">
                        {active ? "●" : "│"}
                      </span>
                      <span className={`mt-0.5 block text-center ${active ? "bg-ink text-canvas" : ""}`}>{k}</span>
                    </button>
                  );
                })}
              </div>
              {errors.context_len && (
                <p role="alert" className="mt-1 text-[11px] text-block">
                  {errors.context_len}
                </p>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 border-t border-ink/15 pt-3 sm:grid-cols-2">
              <div>
                <span id="target-label" className={label}>
                  Target GPU
                </span>
                <div role="radiogroup" aria-labelledby="target-label" className="mt-2 grid grid-cols-2 gap-1.5">
                  {STRESS_TARGET_GPUS.map((g) => {
                    const active = form.target_gpu === g.key;
                    return (
                      <button
                        key={g.key}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={`${g.label}, ${g.vram_gb} gigabytes VRAM`}
                        onClick={() => set("target_gpu", g.key)}
                        className={`min-h-[44px] cursor-pointer rounded border px-2 py-1.5 font-mono text-[11px] font-bold transition-all ${
                          active
                            ? "border-ink bg-ink text-canvas shadow-[2px_2px_0_rgba(31,31,31,0.25)]"
                            : "border-ink/30 bg-transparent text-ink hover:border-ink"
                        }`}
                      >
                        {g.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <span id="precision-label" className={label}>
                  Precision
                </span>
                <div role="radiogroup" aria-labelledby="precision-label" className="mt-2 grid grid-cols-3 gap-1.5">
                  {PRECISION_OPTIONS.map((p) => {
                    const active = form.precision === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={`Precision ${p}, ${BYTES_PER_PRECISION[p]} bytes per parameter`}
                        onClick={() => set("precision", p)}
                        className={`min-h-[44px] cursor-pointer rounded border px-2 py-1.5 font-mono text-[11px] font-bold transition-all ${
                          active
                            ? "border-ink bg-ink text-canvas shadow-[2px_2px_0_rgba(31,31,31,0.25)]"
                            : "border-ink/30 bg-transparent text-ink hover:border-ink"
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
                <span className={helper}>Bytes/param: BF16 2 · FP8 1 · INT4 0.5. Drives both weights and KV math.</span>
              </div>
            </div>
          </fieldset>

          {/* Replay volume + budget cap (preset-driven) */}
          <div className="panel grid grid-cols-1 gap-3 rounded-lg p-4 sm:grid-cols-2">
            <div>
              <label htmlFor="req" className={label}>
                Replay volume (requests)
              </label>
              <span id="req-help" className={helper}>
                Deterministic production queries to replay. Set by the preset above; tune freely (20–1000).
              </span>
              <input
                id="req"
                type="number"
                min={20}
                max={1000}
                value={form.requests}
                onChange={(e) => set("requests", +e.target.value)}
                aria-describedby="req-help"
                className={field}
              />
              {errors.requests && (
                <p role="alert" className="mt-1 text-[11px] text-block">
                  {errors.requests}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="bud" className={label}>
                Budget cap ($)
              </label>
              <span id="bud-help" className={helper}>
                Strict spending limit — Smoke ~$0.50 · SLA Gate ~$2.50 · Soak ~$8.00 (max $10.00).
              </span>
              <input
                id="bud"
                type="number"
                step="0.01"
                min={0.05}
                max={10}
                value={form.budget_usd}
                onChange={(e) => set("budget_usd", +e.target.value)}
                aria-describedby="bud-help"
                className={field}
              />
              {errors.budget_usd && (
                <p role="alert" className="mt-1 text-[11px] text-block">
                  {errors.budget_usd}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — sticky live telemetry preview (55%) */}
        <aside
          aria-label="Live telemetry preview"
          className="min-w-0 rounded-lg border border-ink bg-ink p-4 text-canvas lg:sticky lg:top-20 lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-canvas/60">
              <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              Live Telemetry Preview
            </p>
            <span className="font-mono text-[10px] text-canvas/50">
              {stressArch.archKnown
                ? `${modelFit?.display_name} · ${stressArch.layers}L · ${stressArch.hidden}H · ${form.precision}`
                : "Generic 30B arch estimate"}
            </span>
          </div>

          {/* Real-time VRAM allocation gauge: Weights + KV-Cache + System Overhead */}
          <div className="mt-3 rounded-md border border-canvas/20 bg-canvas/5 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-canvas/70">
                VRAM allocation — {form.target_gpu} ({stressTargetVram}GB)
              </p>
              <p className="font-mono text-[11px] font-bold text-canvas" aria-live="polite">
                ~{stress.totalGb}GB / {stressTargetVram}GB · {stress.targetPct}%
              </p>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.round(stress.targetPct))}
              aria-label={`VRAM allocation ${stress.targetPct} percent on ${form.target_gpu}${stress.oom ? ", out of memory" : ""}`}
              className="mt-2 flex h-3 w-full overflow-hidden rounded border border-canvas/30 bg-canvas/10"
            >
              {gaugeSegs.map((s) => (
                <div
                  key={s.key}
                  title={`${s.label}: ~${s.gb}GB`}
                  style={{
                    width: `${Math.max(0, Math.min(100, (s.gb / gaugeCap) * 100))}%`,
                    backgroundColor: s.color,
                    borderRight: "1px solid rgba(239,235,228,0.4)",
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-canvas/70">
              {gaugeSegs.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ backgroundColor: s.color === "#A8A29E" ? "#A8A29E" : s.color }}
                  />
                  {s.label} ~{s.gb}GB
                </span>
              ))}
              <span className="text-canvas/50">
                KV = 2×{stressArch.layers}L×{stressArch.hidden}H×{form.context_len.toLocaleString("en-US")}×{form.concurrency}×{stress.bytes}B
              </span>
            </div>
          </div>

          {/* Projected breaking point / SLA gate margin */}
          <div
            aria-live="polite"
            className={`mt-2.5 rounded-md border p-3 ${
              stress.oom
                ? "border-red-400/60 bg-red-500/10"
                : stress.tight
                  ? "border-amber-400/60 bg-amber-500/10"
                  : "border-emerald-400/50 bg-emerald-500/10"
            }`}
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-canvas/70">
              Breaking point · SLA gate margin
            </p>
            {stress.oom ? (
              <p className="mt-1 text-[12px] font-bold text-red-300" role="alert">
                ⚠️ CUDA OOM on {form.target_gpu}: ~{stress.totalGb}GB needed vs ~{stressTargetSat.usableGb}GB usable
                ({stress.targetPct}%).
              </p>
            ) : (
              <p className="mt-1 text-[12px] font-bold text-emerald-300">
                {stress.tight ? "▶ TIGHT" : "✓ FITS"} on {form.target_gpu}: {stress.targetHeadroom}GB headroom
                ({stress.targetPct}% of {stressTargetVram}GB).
              </p>
            )}
            <p className="mt-1 text-[11px] leading-relaxed text-canvas/80">
              {maxSafeStreams <= 0 ? (
                <>Weights + runtime already exceed {form.target_gpu} — breaks at <strong>1 stream</strong>. Drop precision to FP8/INT4 or escalate tiers.</>
              ) : nextBreakStep ? (
                <>Breaks at <strong className="font-mono">≥{nextBreakStep} streams</strong> @ {form.context_len.toLocaleString("en-US")} ctx ({form.precision}). Safe ceiling: <strong className="font-mono">{maxSafeStreams} streams</strong>.</>
              ) : (
                <>Holds all {CONCURRENCY_STEPS[CONCURRENCY_STEPS.length - 1]} streams @ {form.context_len.toLocaleString("en-US")} ctx — headroom {stress.targetHeadroom}GB before the 95% SLA gate.</>
              )}
            </p>
          </div>

          {/* Target GPU comparison table */}
          <div className="mt-2.5 overflow-hidden rounded-md border border-canvas/20">
            <table className="w-full text-left font-mono text-[11px]">
              <caption className="bg-canvas/5 px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-canvas/60">
                Target GPU comparison
              </caption>
              <thead>
                <tr className="border-b border-canvas/15 text-[10px] uppercase tracking-wider text-canvas/50">
                  <th scope="col" className="px-3 py-1.5 font-bold">GPU</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-bold">Load</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-bold">Sat</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-bold">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {TELEMETRY_COMPARE_GPUS.map((g) => {
                  const sat = g.key === "LOCAL" ? stressLocal : g.key === "L40S" ? stressL40s : stressH100;
                  const isTarget = form.target_gpu === g.key || (g.key === "LOCAL" && false);
                  const verdict = sat.oom ? "OOM" : sat.tight ? "TIGHT" : "FITS";
                  return (
                    <tr key={g.key} className={`border-b border-canvas/10 last:border-0 ${isTarget ? "bg-canvas/10" : ""}`}>
                      <td className="px-3 py-1.5">
                        <span className="block font-bold text-canvas">{g.label}</span>
                        <span className="block text-[10px] text-canvas/50">{g.note}</span>
                        <span
                          className="mt-1 block h-1 overflow-hidden rounded bg-canvas/15"
                          aria-hidden="true"
                        >
                          <span
                            className="block h-full"
                            style={{
                              width: `${Math.min(100, sat.pct)}%`,
                              backgroundColor: sat.oom ? "#F87171" : sat.tight ? "#FBBF24" : "#34D399",
                            }}
                          />
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right text-canvas/80">
                        {stress.totalGb}/{g.vram_gb}GB
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right text-canvas/80">{sat.pct}%</td>
                      <td className="px-3 py-1.5 text-right">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            sat.oom
                              ? "bg-red-500/25 text-red-200"
                              : sat.tight
                                ? "bg-amber-500/25 text-amber-200"
                                : "bg-emerald-500/25 text-emerald-200"
                          }`}
                        >
                          {verdict}
                        </span>
                        <span className="block text-[10px] text-canvas/50">
                          {sat.oom ? "over" : `+${sat.headroomGb}GB`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Execution mode toggle */}
          <div className="mt-2.5" aria-label="Execution mode toggle">
            <p className="text-[10px] font-bold uppercase tracking-widest text-canvas/60">
              Execution mode (saved to this browser)
            </p>
            <div className="mt-1.5 [&>div]:border-canvas/30 [&>div]:bg-transparent">
              <ExecutionModeToggle />
            </div>
            <p className="mt-1 text-[10px] leading-snug text-canvas/60">
              {byokConnected
                ? "Live GPU runs will bill your Nebius key (host cap bypassed)."
                : "No key? Runs use Demo Mode (Simulated / Host Pool). ⚡ Live · 🧪 Simulator is free, never certifies."}
            </p>
          </div>

          {/* High-visibility run button */}
          <button
            type="submit"
            className="mt-3 min-h-[52px] w-full cursor-pointer rounded-lg bg-canvas px-4 py-3 text-base font-extrabold tracking-tight text-ink shadow-[4px_4px_0_rgba(239,235,228,0.25)] transition-all hover:bg-white hover:-translate-y-px active:translate-y-0"
          >
            🚀 Run Hardware Benchmark on Cloud GPU →
          </button>
          <p className="mt-1 text-center text-[10px] text-canvas/60">
            Replays {form.requests} real queries to measure VRAM, latency &amp; errors before you deploy.
          </p>
          <p aria-live="polite" className="mt-1 min-h-[16px] font-mono text-[11px] text-canvas/70">
            {msg || `${form.requests} req · max $${Number(form.budget_usd || 0).toFixed(2)} · ${form.concurrency} streams · ${form.context_len.toLocaleString("en-US")} ctx`}
          </p>

          {/* Audit preview + safety guarantee (condensed) */}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-canvas/20 pt-2.5 text-[11px] leading-relaxed">
            <div>
              <dt className="font-bold text-canvas/60">Testing</dt>
              <dd className="break-all font-mono text-[10px] text-canvas/85">
                {form.current_model || "—"} → {form.candidate_model || "—"}
              </dd>
            </div>
            <div>
              <dt className="font-bold text-canvas/60">Stress point</dt>
              <dd className="font-mono text-[10px] text-canvas/85">
                {form.concurrency} streams · {form.context_len.toLocaleString("en-US")} ctx · {form.precision} · {form.target_gpu}
              </dd>
            </div>
          </dl>
          <ul className="mt-2.5 space-y-1.5 border-t border-canvas/20 pt-2.5 text-[11px] leading-relaxed text-canvas/80">
            <li>
              <span aria-hidden="true">🛡️</span> <strong>Policy:</strong> Max 1 GPU · 15 min · $2.00/experiment.
            </li>
            <li>
              <span aria-hidden="true">⏱️</span> <strong>Duration:</strong> 2–3 min.{" "}
              <span aria-hidden="true">🛑</span> <strong>Failsafe:</strong> auto-aborts at budget cap.
            </li>
          </ul>
        </aside>
      </form>
    </div>
  );
}
