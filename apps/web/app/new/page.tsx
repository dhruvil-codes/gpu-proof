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
};

const NANO = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";

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

const TEMPLATES: {
  id: string;
  glyph: string;
  title: string;
  focus: string;
  values: Partial<FormState>;
}[] = [
  {
    id: "cost",
    glyph: "💰",
    title: "Cloud Cost Optimization",
    focus: "Focus: Cut GPU bills.",
    values: { current_model: "Qwen3-8B on H100", candidate_model: NANO, requests: 200, budget_usd: 10 },
  },
  {
    id: "latency",
    glyph: "⚡",
    title: "Latency-Critical (Customer Facing)",
    focus: "Focus: Sub-1000ms response time.",
    values: { current_model: "Qwen3-8B", candidate_model: NANO, requests: 300, budget_usd: 10 },
  },
  {
    id: "accuracy",
    glyph: "🎯",
    title: "Strict Tool & Schema Accuracy",
    focus: "Focus: Zero broken JSON or tool calls.",
    values: { requests: 250, budget_usd: 10 },
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
    budget_usd: 10,
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
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setMsg("Creating twin...");
    try {
      const mode = getExecutionMode();
      const byokHeaders = buildByokHeaders();
      const execHeaders = buildExecutionHeaders(mode);
      const payload = {
        ...form,
        candidate_model: cleanCandidate,
        current_model: cleanCurrent,
        mode,
      };
      const res = await fetch(`${API}/certifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...byokHeaders, ...execHeaders },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      const j = await res.json();
      setMsg(
        `twin ${j.twin_digest} · launching...${j.byok_used ? " (BYOK: your Nebius key)" : ""}${
          j.mode ? ` [${j.mode === "real" ? "⚡ Live GPU" : "🧪 Simulator"}]` : ""
        }`
      );
      const s = await fetch(`${API}/certifications/${j.id}/start`, {
        method: "POST",
        headers: { ...byokHeaders, ...execHeaders },
      });
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
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)} — is the API running on ${API}?`);
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
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-baseline justify-between border-b border-ink/20 pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Hardware Audit &amp; Certification</h1>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Bring ANY open-source model (Hugging Face ID or full URL). Compare local open-source setups vs production Nebius cloud GPUs.
          </p>
        </div>
      </div>

      <div className="mt-4" aria-label="Local hardware auto-detection">
        <HardwareProfiler modelFit={modelFit} inspecting={inspecting} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Execution mode">
        <ByokBadge connected={byokConnected} />
        <button
          type="button"
          onClick={() => setByokOpen(true)}
          className="min-h-[44px] cursor-pointer rounded border border-ink px-3 py-2 text-xs font-bold transition-all hover:-translate-y-px hover:shadow-[4px_4px_0_rgba(31,31,31,0.25)]"
        >
          🔑 BYOK / API Key
        </button>
        <span className="text-[11px] text-muted">
          {byokConnected
            ? "Live GPU runs will bill your Nebius key (host cap bypassed)."
            : "No key? Runs use Demo Mode (Simulated / Host Pool)."}
        </span>
      </div>

      <div className="mt-4" aria-label="Execution mode toggle">
        <p className="text-[11px] uppercase tracking-widest text-muted">Execution Mode (saved to this browser)</p>
        <div className="mt-2 max-w-xl">
          <ExecutionModeToggle />
        </div>
        <p className="mt-1 text-[11px] text-muted">
          ⚡ Live runs on Nebius Cloud GPUs · 🧪 Simulator is instant, free, and never certifies.
        </p>
      </div>
      <ByokModal open={byokOpen} onClose={() => setByokOpen(false)} />

      <div className="mt-6" role="group" aria-label="Scenario templates">
        <p className="text-[11px] uppercase tracking-widest text-muted">Start from a 1-click scenario</p>
        <div className="mt-3 grid gap-3 text-left sm:grid-cols-3">
          {TEMPLATES.map((t) => {
            const selected = activeTemplate === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t.id)}
                aria-pressed={selected}
                className={`min-h-[44px] cursor-pointer rounded-lg border p-4 text-left transition-all ${
                  selected
                    ? "border-ink bg-ink text-canvas shadow-[4px_4px_0_rgba(31,31,31,0.25)]"
                    : "border-ink bg-[#F5F1E9] hover:shadow-[4px_4px_0_#1F1F1F]"
                }`}
              >
                <span className="block text-sm font-bold" aria-hidden="true">
                  {t.glyph} {t.title}
                </span>
                <span className={`mt-1 block text-[11px] leading-relaxed ${selected ? "text-canvas/70" : "text-muted"}`}>
                  {t.focus}
                </span>
                <span className={`mt-2 block text-[11px] font-bold ${selected ? "text-canvas" : "text-ink"}`}>
                  {selected ? "✓ Selected" : "Use this scenario →"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <form onSubmit={submit} noValidate className="panel space-y-5 rounded-lg p-5">
          {/* Current Production Deployment */}
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

          {/* Candidate Model to Certify */}
          <div>
            <div className="flex items-center justify-between">
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

            {/* URL Detection & Clean Slug Helper */}
            {extractedSlug && (
              <div className="mt-2 flex items-center justify-between rounded border border-ink/30 bg-ink/5 p-2 text-xs">
                <span className="text-ink">
                  🔗 Hugging Face link detected: <strong>{extractedSlug}</strong>
                </span>
                <button
                  type="button"
                  onClick={applyExtractedSlug}
                  className="rounded bg-ink px-2 py-0.5 text-[11px] font-bold text-canvas hover:bg-black"
                >
                  Use Clean Slug
                </button>
              </div>
            )}

            {/* Popular Production Models (1-Click Chips) */}
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

            {/* Dynamic Hardware Sizing & Feasibility Card */}
            {modelFit && (
              <div className="mt-3 rounded-md border border-ink/20 bg-canvas/60 p-3 text-xs leading-relaxed">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/15 pb-2">
                  <div className="flex items-center gap-2">
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
                  {/* Local Hardware Viability */}
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

                  {/* Production Cloud Recommendation */}
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

          {/* Workload and Budget */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="req" className={label}>
                Workload Sample Size
              </label>
              <span id="req-help" className={helper}>
                Number of deterministic production queries to replay (e.g. 200 requests).
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
                Maximum Test Budget ($)
              </label>
              <span id="bud-help" className={helper}>
                Strict spending limit for this test (capped at $10.00; unused funds stay in your balance).
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

          <button className="btn-dark min-h-[44px] w-full cursor-pointer rounded px-4 py-3 text-sm font-bold transition-colors">
            Run Certification →
          </button>
          <p aria-live="polite" className="text-[11px] text-muted">
            {msg}
          </p>
        </form>

        {/* Side Panel: Safety Guarantee & Local-to-Cloud Feasibility */}
        <aside
          aria-label="Audit preview and safety guarantee"
          className="h-fit rounded-lg border border-ink bg-ink p-5 text-canvas lg:sticky lg:top-6"
        >
          <p className="text-[11px] uppercase tracking-widest text-canvas/60">Audit Preview &amp; Safety Guarantee</p>
          <dl className="mt-3 space-y-2 text-[12px] leading-relaxed">
            <div>
              <dt className="font-bold">Testing</dt>
              <dd className="break-all text-canvas/80 font-mono text-[11px]">
                {form.current_model || "—"} → {form.candidate_model || "—"}
              </dd>
            </div>
            <div>
              <dt className="font-bold">Workload</dt>
              <dd className="text-canvas/80">
                {form.requests} requests · max ${Number(form.budget_usd || 0).toFixed(2)}
              </dd>
            </div>
          </dl>

          <div className="mt-4 border-t border-canvas/20 pt-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-canvas/70">
              GPU-to-GPU Proof Architecture
            </p>
            <p className="mt-1 text-[11px] text-canvas/80 leading-relaxed">
              Open-source models can run locally on consumer GPUs (RTX 4090, 3090, Mac Studio) for individual testing. GPUProof certifies whether they meet enterprise latency, accuracy, and error SLAs before you deploy to Nebius Cloud GPUs.
            </p>
          </div>

          <ul className="mt-4 space-y-3 border-t border-canvas/20 pt-4 text-[12px] leading-relaxed">
            <li>
              <span aria-hidden="true">🛡️</span> <strong>Policy Enforced:</strong>{" "}
              <span className="text-canvas/80">Max 1 GPU, 15 min runtime, $2.00 max per experiment.</span>
            </li>
            <li>
              <span aria-hidden="true">⏱️</span> <strong>Estimated Test Duration:</strong>{" "}
              <span className="text-canvas/80">2 to 3 minutes.</span>
            </li>
            <li>
              <span aria-hidden="true">🛑</span> <strong>Failsafe:</strong>{" "}
              <span className="text-canvas/80">Auto-aborts if cloud budget limit is reached.</span>
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
