"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ModelPassport } from "@/components/ModelPassport";
import { TopNav, useByokStatus } from "@/components/ui";
import { buildByokHeaders } from "@/components/byok";
import { buildExecutionHeaders, enableDevSimFromQuery, getExecutionMode, isDevSim } from "@/components/executionMode";
import { downloadPassportPng, passportShareUrl, type PassportData } from "@/lib/passport";

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
const ALLOW_SIM = process.env.NEXT_PUBLIC_ALLOW_SIM === "1";

/* ==========================================================================
   Landing — "the certificate is the design".
   Hero: the name spans the page like a letterhead; the corners carry the
   copy. Sections are typographic set pieces; the product's own interface
   fragments (marked data-ui) carry the imagery.
   ========================================================================== */

const demoStages = [
  { title: "Proposal accepted", detail: "Candidate endpoint and workload twin are sealed before execution.", status: "READY" },
  { title: "Sandbox microVM starts", detail: "Nebius Contree microVM replays sealed workload twin at target concurrency.", status: "RUNNING" },
  { title: "Quality breach caught", detail: "Lean max_tokens truncates structured JSON tool calls.", status: "BLOCK" },
  { title: "Nemotron diagnoses", detail: "QUALITY: raise output budget and tune safe concurrency; hard gates stay fixed.", status: "ADAPT" },
  { title: "Rerun passes & certified", detail: "Same workload twin, new disposable sandbox, measured receipts.", status: "SHIP" },
];

const matrixRows = [
  ["What it measures", "Human preference votes", "Your agent workload and SLA gates"],
  ["Execution environment", "Single-turn leaderboard", "Fresh isolated microVM per experiment"],
  ["VRAM and concurrency", "No hardware receipt", "GPU memory, OOM boundary, safe streams"],
  ["Tool calling", "Conversation quality signal", "Deterministic tool and JSON validation"],
  ["Output", "Relative rank", "SHIP / BLOCK certificate with evidence"],
];

/* ——— Wordmark: SVG text forced to span margin to margin ——— */

function SpanningName({ tone = "ink" }: { tone?: "ink" | "paper" }) {
  return (
    <svg viewBox="0 0 1000 138" className="block w-full" aria-hidden="true" focusable="false">
      <text
        x="0"
        y="110"
        textLength="1000"
        lengthAdjust="spacingAndGlyphs"
        style={{ fontFamily: "var(--font-display), Georgia, serif", fontSize: 126, letterSpacing: "-0.02em" }}
        className={tone === "ink" ? "fill-ink" : "fill-[#F1F1ED]"}
      >
        SandboxProof
      </text>
    </svg>
  );
}

/* ——— Crash-test lab (the one live thing) ——— */

const CONTEXT_LEN = 8192;
const RUNTIME_GB = 1.8;
const FP8_BYTES = 1;
const INT4_BYTES = 0.5;

type ModelSpec = {
  slug: string;
  name: string;
  tag: string;
  paramsB: number | null;
  layers: number;
  kvHeads: number;
  headDim: number;
  hidden: number;
  moe?: boolean;
};

const MODEL_SPECS: ModelSpec[] = [
  { slug: "nvidia/Nemotron-3-Nano-30B", name: "Nemotron-3-Nano-30B", tag: "NVIDIA", paramsB: 30, layers: 48, kvHeads: 8, headDim: 128, hidden: 5120 },
  { slug: "Qwen/Qwen3.8-27B", name: "Qwen3.8-27B", tag: "TRENDING", paramsB: 27.8, layers: 64, kvHeads: 8, headDim: 128, hidden: 5120 },
  { slug: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama-3.3-70B-Instruct", tag: "70B", paramsB: 70.6, layers: 80, kvHeads: 8, headDim: 128, hidden: 8192 },
  { slug: "mistralai/Codestral-22B-v0.1", name: "Codestral-22B-v0.1", tag: "CODE", paramsB: 22.2, layers: 40, kvHeads: 8, headDim: 128, hidden: 4096 },
  { slug: "deepseek-ai/DeepSeek-V3", name: "DeepSeek-V3", tag: "FRONTIER", paramsB: 671, layers: 61, kvHeads: 1, headDim: 576, hidden: 7168, moe: true },
];

const DEFAULT_SLUG = MODEL_SPECS[0].slug;

const gpuTiers = [
  { id: "L40S", label: "L40S", memory: 48, hourly: "$1.35/hr" },
  { id: "H100", label: "H100", memory: 80, hourly: "$4.50/hr" },
];

const labWorkloads = [
  { id: "agent", label: "Agent tool-calling", desc: "Multi-step function calls, argument schemas, tool execution.", tasks: ["tool_calling", "structured_output"], concurrency: 8 },
  { id: "json", label: "Structured JSON", desc: "Strict JSON schema adherence and key reliability.", tasks: ["structured_output"], concurrency: 4 },
  { id: "burst", label: "Concurrency and speed", desc: "Throughput and tail latency under 18 parallel streams.", tasks: ["tool_calling", "structured_output"], concurrency: 18 },
];

function extractRepo(input: string) {
  const clean = input.trim().replace(/^(?:https?:\/\/)?(?:www\.)?huggingface\.co\//i, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);
  return parts[0] === "models" ? parts.slice(1, 3).join("/") : parts.slice(0, 2).join("/");
}

async function checkBackend(): Promise<"checking" | "live" | "sim" | "down"> {
  for (const url of ["/api/health", `${API_BASE}/health`]) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      const simulator = data?.simulator === true || String(data?.simulator ?? "").toLowerCase() === "true";
      return simulator ? "sim" : "live";
    } catch {
      // Try the direct backend after the local proxy.
    }
  }
  return "down";
}

/** KV-cache estimate: 2 (K+V) × layers × kvHeads × headDim × ctx × streams × bytes / 1e9.
 *  Mirrors services/advisor.py sizing so the plan matches what gets measured. */
function kvCacheGb(spec: ModelSpec, streams: number, bytes: number = FP8_BYTES): number {
  return Math.round(((2 * spec.layers * spec.kvHeads * spec.headDim * CONTEXT_LEN * streams * bytes) / 1e9) * 10) / 10;
}

function weightsGb(spec: ModelSpec, bytes: number = FP8_BYTES): number | null {
  return spec.paramsB === null ? null : Math.round(spec.paramsB * bytes * 10) / 10;
}

function isPresetSlug(slug: string): boolean {
  return MODEL_SPECS.some((s) => s.slug.toLowerCase() === slug.toLowerCase());
}

/** Tier-based architecture estimate for custom slugs (mirrors services/advisor._estimate_arch). */
function specFromName(slug: string): ModelSpec | null {
  const match = /(\d+(?:\.\d+)?)\s*B/i.exec(slug);
  if (!match) return null;
  const paramsB = Number(match[1]);
  return { slug, name: slug.split("/")[1] || slug, tag: "CUSTOM", paramsB, layers: paramsB >= 65 ? 80 : paramsB >= 30 ? 64 : paramsB >= 14 ? 48 : 32, kvHeads: 8, headDim: paramsB >= 65 ? 1024 : paramsB >= 30 ? 640 : paramsB >= 14 ? 640 : 512, hidden: paramsB >= 65 ? 8192 : 5120 };
}

type BackendState = "checking" | "live" | "sim" | "down";

function CrashTestLab() {
  const router = useRouter();
  const query = useSearchParams();
  const byokConnected = useByokStatus();
  const [backend, setBackend] = useState<BackendState>("checking");
  const [candidate, setCandidate] = useState(() => extractRepo(query.get("candidate_model") || query.get("model") || "") || DEFAULT_SLUG);
  const [draft, setDraft] = useState(() => {
    const raw = extractRepo(query.get("candidate_model") || query.get("model") || "");
    return raw && !isPresetSlug(raw) ? raw : "";
  });
  const [workloadId, setWorkloadId] = useState(() => {
    const raw = (query.get("workload") || "").toLowerCase();
    return labWorkloads.some((item) => item.id === raw) ? raw : "agent";
  });
  const [tierOverride, setTierOverride] = useState<"L40S" | "H100" | null>(() => {
    const normalize = (value: string | null) => {
      const upper = (value || "").toUpperCase();
      return upper.startsWith("L40S") ? "L40S" : upper.startsWith("H100") ? "H100" : null;
    };
    return normalize(query.get("target_gpu") || query.get("gpu"));
  });
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [liveSpec, setLiveSpec] = useState<ModelSpec | null>(null);
  const inspectCache = useRef<Map<string, ModelSpec>>(new Map());

  useEffect(() => {
    enableDevSimFromQuery();
    let mounted = true;
    checkBackend().then((state) => { if (mounted) setBackend(state); });
    return () => { mounted = false; };
  }, []);

  // Live Hugging Face architecture enrichment for custom slugs. The offline
  // name-estimate applies immediately; verified metadata replaces it quietly.
  useEffect(() => {
    if (isPresetSlug(candidate) || !/^[^\s/]+\/[^\s/]+$/.test(candidate)) return;
    const cached = inspectCache.current.get(candidate);
    if (cached) { setLiveSpec(cached); return; }
    setLiveSpec(null);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        query: candidate,
        precision: "FP8",
        concurrency: String(workload.concurrency),
        context_len: String(CONTEXT_LEN),
      });
      fetch(`/api/models/inspect?${params.toString()}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data || data.is_live_hf !== true || typeof data.params_b !== "number") return;
          const hidden = typeof data.hidden === "number" ? data.hidden : 5120;
          const spec: ModelSpec = { slug: candidate, name: data.display_name || candidate.split("/")[1] || candidate, tag: "CUSTOM", paramsB: data.params_b, layers: typeof data.layers === "number" ? data.layers : 64, kvHeads: 8, headDim: Math.round(hidden / 8), hidden };
          inspectCache.current.set(candidate, spec);
          setLiveSpec(spec);
        })
        .catch(() => { /* offline — name estimate stands */ });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate, workloadId]);

  const workload = labWorkloads.find((item) => item.id === workloadId)!;
  const preset = MODEL_SPECS.find((item) => item.slug === candidate);
  const validRepo = /^[^\s/]+\/[^\s/]+$/.test(candidate);
  const spec = useMemo<ModelSpec | null>(() => {
    if (preset) return preset;
    if (!validRepo) return null;
    if (/(\d+(?:\.\d+)?)\s*B/i.test(candidate)) { const s = specFromName(candidate); return s; }
    return liveSpec && liveSpec.slug === candidate ? liveSpec : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate, validRepo, liveSpec]);
  const archLabel = isPresetSlug(candidate)
    ? "Known architecture"
    : liveSpec && liveSpec.slug === candidate
      ? "Live Hugging Face metadata"
      : spec
        ? "Estimated from the name"
        : "Unknown — the sandbox measures the truth";
  const weights = spec ? weightsGb(spec) : null;
  const kv = spec ? kvCacheGb(spec, workload.concurrency) : null;
  const total = weights !== null && kv !== null ? Math.round((weights + kv + RUNTIME_GB) * 10) / 10 : null;
  const fits = (memory: number) => total !== null && total <= memory * 0.95;
  const tierFit = gpuTiers.map((tier) => ({ ...tier, oom: !fits(tier.memory) }));
  const launchTier = tierOverride ?? (tierFit.find((t) => !t.oom)?.id ?? "H100");
  const launchTierInfo = gpuTiers.find((tier) => tier.id === launchTier)!;
  const bothOom = tierFit.every((t) => t.oom);
  const scale = Math.max(84, (total ?? 80) * 1.08);
  const pctOf = (gb: number) => `${Math.max(0, Math.min(100, (gb / scale) * 100))}%`;
  const showAxisNumbers = scale <= 160;
  const int4Weights = spec && spec.paramsB !== null ? Math.round(spec.paramsB * INT4_BYTES * 10) / 10 : null;
  const int4Kv = spec ? kvCacheGb(spec, workload.concurrency, INT4_BYTES) : null;
  const int4Total = int4Weights !== null && int4Kv !== null ? Math.round((int4Weights + int4Kv + RUNTIME_GB) * 10) / 10 : null;
  const int4Tier = int4Total !== null ? gpuTiers.find((tier) => int4Total <= tier.memory * 0.95) : undefined;

  function pickPreset(slug: string) {
    setCandidate(slug);
    setDraft("");
    setLiveSpec(null);
    setError("");
  }

  function pickWorkload(id: string) {
    setWorkloadId(id);
    setError("");
  }

  async function launch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!validRepo) { setError("Enter a Hugging Face model slug in organization/repo format."); return; }
    setStatus("Verifying execution backend…");
    const truth = await checkBackend();
    setBackend(truth);
    if (truth === "down") { setStatus(""); setError("Backend unreachable. A live backend is required to launch."); return; }
    if (truth === "sim" && !isDevSim()) { setStatus(""); setError("Backend is simulator enforced. Live certification is unavailable."); return; }
    const mode = ALLOW_SIM ? getExecutionMode() : truth === "sim" ? "sim" : "real";
    setSubmitting(true);
    setStatus("Creating certification…");
    try {
      const headers = { "Content-Type": "application/json", ...buildByokHeaders(), ...buildExecutionHeaders(mode) };
      const payload = {
        candidate_model: candidate,
        current_model: "Qwen/Qwen3-8B",
        gpu_type: launchTier,
        precision: "FP8",
        workload_tasks: workload.tasks,
        gates: [
          { metric: "latency_p95_ms", op: "<=", threshold: 2000 },
          { metric: "quality_score", op: ">=", threshold: 0.85 },
          { metric: "error_rate", op: "<=", threshold: 0.05 },
        ],
        concurrency: workload.concurrency, context_len: CONTEXT_LEN, requests: 200,
        budget_usd: 10, mode,
      };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      let created: Response;
      try {
        created = await fetch("/api/certifications", { method: "POST", headers, body: JSON.stringify(payload), signal: controller.signal });
      } finally { clearTimeout(timeout); }
      if (!created.ok) {
        const body = await created.json().catch(() => null);
        const detail = body?.detail ? (typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)) : `HTTP ${created.status}`;
        throw new Error(`Could not create the certification: ${detail}`);
      }
      const result = await created.json();
      if (!result?.id) throw new Error("Certification created without an experiment ID.");
      setStatus(`Certification ${String(result.id).slice(0, 8)}… created — starting the isolated sandbox…`);
      const startController = new AbortController();
      const startTimeout = setTimeout(() => startController.abort(), 20000);
      let started: Response;
      try {
        started = await fetch(`/api/certifications/${encodeURIComponent(result.id)}/start`, {
          method: "POST", headers: { ...buildByokHeaders(), ...buildExecutionHeaders(mode) }, signal: startController.signal,
        });
      } finally { clearTimeout(startTimeout); }
      if (!started.ok) throw new Error(`Certification created but the sandbox launch failed (HTTP ${started.status}). Open the timeline to retry.`);
      try {
        const history = JSON.parse(localStorage.getItem("sandboxproof-certs") || "[]");
        history.unshift({ id: result.id, candidate: candidate, status: "RUNNING", spend: 0, experiments: 0, simulated: mode !== "real", created_at: new Date().toISOString() });
        localStorage.setItem("sandboxproof-certs", JSON.stringify(history.slice(0, 20)));
      } catch { /* Local history is optional. */ }
      setStatus("Sandbox live — opening the execution timeline…");
      window.setTimeout(() => router.push(`/timeline/${encodeURIComponent(result.id)}`), 420);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(/fetch|network|abort/i.test(message) ? "The audit API did not respond. Check the backend and try again." : message);
      setStatus("");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={launch} noValidate className="overflow-hidden rounded-card bg-surface">
      {/* Panel header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-5 sm:px-7">
        <h3 className="text-[16px] font-semibold">Crash-test lab</h3>
        <p className="flex items-center gap-2 text-[13px] text-ink2">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${backend === "live" ? "bg-ship" : backend === "sim" ? "bg-warn" : backend === "down" ? "bg-block" : "bg-faint"}`}
            aria-hidden="true"
          />
          {backend === "live" ? "Live Nebius backend" : backend === "sim" ? "Simulator backend" : backend === "down" ? "Backend offline" : "Checking backend"}
          <span aria-hidden="true">·</span>
          {byokConnected ? "your Nebius key" : "shared host pool"}
        </p>
      </div>

      {/* Pick a model */}
      <div className="px-5 py-5 sm:px-7">
        <h4 className="text-[15px] font-medium">Pick a model from Hugging Face</h4>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Trending open-weight models">
          {MODEL_SPECS.map((item) => {
            const active = candidate.toLowerCase() === item.slug.toLowerCase();
            const w = item.paramsB === null ? null : Math.round(item.paramsB * FP8_BYTES * 10) / 10;
            return (
              <button key={item.slug} type="button" onClick={() => pickPreset(item.slug)} aria-pressed={active} title={item.slug}
                className={`opt flex-col items-start justify-between gap-1 !p-3 ${active ? "!border-ink" : ""}`}>
                <span className={`w-full truncate text-[13px] font-medium ${active ? "text-accentInk" : "text-ink"}`}>{item.name}</span>
                <span className="w-full truncate text-[13px] text-ink2 tabular-nums">{item.paramsB}B{item.moe ? " MoE" : ""} · FP8 ≈ {w ?? "?"} GB</span>
              </button>
            );
          })}
        </div>
        <label className="mt-4 block">
          <span className="text-[13px] text-ink2">Or paste any Hugging Face slug</span>
          <input value={draft} onChange={(event) => { const value = event.target.value; setDraft(value); const parsed = extractRepo(value); if (/^[^\s/]+\/[^\s/]+$/.test(parsed)) { setCandidate(parsed); setError(""); } else if (!value.trim()) { setCandidate(DEFAULT_SLUG); } }}
            spellCheck={false} placeholder="organization/repo — any open-weight model" aria-label="Custom Hugging Face model slug"
            className="field mt-2 text-[14px]" />
          {draft !== "" && !validRepo && <span role="alert" className="mt-2 block text-[13px] text-blockDeep">Invalid slug — paste organization/repo or a huggingface.co URL.</span>}
        </label>
      </div>

      {/* Choose the workload */}
      <div className="bg-raised px-5 py-6 sm:px-7">
        <h4 className="text-[15px] font-medium">Choose the workload your production runs</h4>
        <div role="radiogroup" aria-label="Agent workload" data-ui className="mt-3 grid gap-2 sm:grid-cols-3">
          {labWorkloads.map((item) => {
            const active = workloadId === item.id;
            return (
              <button key={item.id} type="button" role="radio" aria-checked={active} onClick={() => pickWorkload(item.id)}
                className={`opt flex-col items-start gap-1 ${active ? "!border-ink" : ""}`}>
                <span className={`text-[14px] font-medium ${active ? "text-ink" : ""}`}>{item.label}</span>
                <span className="text-[13px] leading-snug text-ink2">{item.desc}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 max-w-[72ch] text-[14px] leading-relaxed text-ink">
          Production defaults applied — {workload.concurrency} parallel streams, {CONTEXT_LEN.toLocaleString()}-token context,
          200 requests, budget cap $10.00. Nothing to tune; the sandbox is the only authority on measured results.
        </p>
      </div>

      {/* Check the fit, launch */}
      <div className="px-5 py-6 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[15px] font-medium">Check the fit, then launch</h4>
          <p className="text-[13px] text-ink2">{archLabel}</p>
        </div>

        <div data-ui className="mt-3 rounded-control border border-line bg-raised p-3.5 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            {tierFit.map((tier) => {
              const active = launchTier === tier.id;
              return (
                <button key={tier.id} type="button" onClick={() => setTierOverride(tier.id as "L40S" | "H100")} aria-pressed={active}
                  title={`Launch this certification on ${tier.label} ${tier.memory}GB at ${tier.hourly}`}
                  className={`pill cursor-pointer ${active ? "!bg-ink !text-[#F1F1ED]" : "pill-neutral"}`}>
                  <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${active ? "bg-accent" : tier.oom ? "bg-block" : "bg-ship"}`} />
                  {tier.label} {tier.memory}GB
                  <span className={active ? "opacity-70" : tier.oom ? "text-blockDeep" : "text-[#247B50]"}>{total === null ? "?" : tier.oom ? "OOM" : "Fits"}</span>
                </button>
              );
            })}
            {tierOverride && (
              <button type="button" onClick={() => setTierOverride(null)} className="pill pill-neutral cursor-pointer">Auto-tier on</button>
            )}
            <span className="ml-auto text-[13px] text-ink2 tabular-nums">Plan (FP8) ≈ <span className="font-medium text-ink">{total === null ? "?" : `${total.toFixed(1)} GB`}</span></span>
          </div>

          {/* The VRAM bar: weights + KV cache + runtime vs GPU tier caps */}
          <div className="relative mt-4 h-11 overflow-visible rounded-control border border-line bg-surface" role="img"
            aria-label={total === null
              ? "Memory footprint unknown against L40S 48GB and H100 80GB tiers; measured inside the sandbox"
              : `${total.toFixed(1)} gigabytes of model weights, KV cache and runtime versus L40S 48 and H100 80 gigabyte tiers`}>
            {total !== null && (
              <div className="flex h-full overflow-hidden rounded-l-control" style={{ width: pctOf(total) }}>
                <span className="h-full bg-ink" style={{ width: `${(weights ?? 0) === 0 ? 0 : ((weights ?? 0) / (total ?? 1)) * 100}%` }} />
                <span className={`h-full ${bothOom ? "bg-block" : "bg-accent"}`} style={{ width: `${(kv ?? 0) === 0 ? 0 : ((kv ?? 0) / (total ?? 1)) * 100}%` }} />
                <span className="h-full bg-[#C9C8C1]" style={{ width: `${(RUNTIME_GB / (total ?? 1)) * 100}%` }} />
              </div>
            )}
            <span className="absolute inset-y-0 left-[95%] w-px bg-ink/50" aria-hidden="true" />
            {gpuTiers.map((tier) => (
              <span key={tier.id} className="pointer-events-none absolute inset-y-[-6px]" style={{ left: pctOf(tier.memory) }} aria-hidden="true">
                <span className="absolute inset-y-0 left-0 w-0.5 bg-ink" style={{ opacity: total !== null && total > tier.memory ? 0.35 : 1 }} />
                {showAxisNumbers && <span className="absolute -translate-x-1/2 whitespace-nowrap text-[13px] text-ink2 tabular-nums" style={{ top: "calc(100% + 6px)" }}>{tier.memory}GB</span>}
              </span>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-[13px] text-ink2">
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 bg-ink" aria-hidden="true" />Weights {weights === null ? "?" : `${weights.toFixed(1)} GB`}</span>
              <span className="flex items-center gap-1.5"><span className={`inline-block h-2 w-2 ${bothOom ? "bg-block" : "bg-accent"}`} aria-hidden="true" />KV cache at {workload.concurrency} streams {kv === null ? "?" : `${kv.toFixed(1)} GB`}</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 bg-[#C9C8C1]" aria-hidden="true" />Runtime {RUNTIME_GB} GB</span>
            </span>
            <span>Launch tier <span className="font-medium text-ink">{launchTier} · {launchTierInfo.hourly}</span>{tierOverride ? " — pinned" : bothOom ? " — target for the measured crash" : " — smallest tier the estimate fits"}</span>
          </div>
        </div>

        {(bothOom && int4Tier) && (
          <p className="mt-3 max-w-[72ch] rounded-control bg-warnWash px-3.5 py-2.5 text-[14px] leading-relaxed text-warn">
            Auto-fix available: INT4 (≈ {int4Total?.toFixed(1)} GB total) fits the {int4Tier.label} {int4Tier.memory}GB. The planner can propose it after the first measured run; hard gates never change.
          </p>
        )}
        {bothOom && !int4Tier && spec?.moe && (
          <p className="mt-3 max-w-[72ch] rounded-control bg-warnWash px-3.5 py-2.5 text-[14px] leading-relaxed text-warn">
            Frontier scale: {spec.paramsB}B weights exceed every single-GPU tier. The audit measures the breach; the planner shortlists a serving topology (multi-GPU / sparse MoE routing).
          </p>
        )}

        {error && <p role="alert" className="mt-3 max-w-[72ch] rounded-control bg-blockWash px-3.5 py-2.5 text-[14px] text-blockDeep">{error}</p>}
        {status && <p role="status" aria-live="polite" className="mt-3 text-[14px] text-ink2">{status}</p>}

        <button type="submit" disabled={submitting || !validRepo}
          className="btn btn-accent btn-square mt-4 h-14 w-full px-6 text-[15px]">
          {submitting ? "Launching the Nebius sandbox…" : "Crash-test it in a Nebius sandbox"}
          <span aria-hidden="true">→</span>
        </button>
        <div className="mt-3 max-w-[72ch] space-y-1 text-[14px] leading-relaxed text-ink2">
          <p>Hard gates and budget policy live in <Link href="/docs" className="underline decoration-line underline-offset-4 hover:text-ink">the docs</Link>.</p>
          <p>Free in simulator mode · live runs bill your key</p>
        </div>
      </div>
    </form>
  );
}

/* ——— The walkthrough: watch a crash happen (the moving picture) ——— */

function OomAutopsy({ memory, used, animated = false }: { memory: number; used: number; animated?: boolean }) {
  const pct = Math.min(100, Math.round((used / memory) * 100));
  const breachTokens = Math.floor((memory - 30 - 2) / (18 / 8192));
  return (
    <div data-ui className="term term-sans p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[14px] font-medium text-termText">OOM autopsy — KV cache</p>
          <p className="mt-1 text-[13px] text-termMuted">30 GB weights + 18 GB KV + 2 GB runtime</p>
        </div>
        <span className="text-[13px] font-medium text-accent tabular-nums">{used} / {memory} GB</span>
      </div>
      <div className="relative h-9 overflow-hidden rounded-control border border-termRule bg-[#1E1E1C]" role="img" aria-label={`${used} gigabytes estimated use against ${memory} gigabytes available`}>
        <div className="h-full bg-accent" style={animated ? { animation: "oom-fill 2.8s var(--ease) infinite alternate", transformOrigin: "left" } : { width: `${pct}%` }} />
      </div>
      <div className="mt-2.5 flex flex-wrap justify-between gap-2 text-[13px] text-termMuted tabular-nums">
        <span>0 tokens</span>
        <span>breach ≈ {breachTokens.toLocaleString()} tokens</span>
        <span>{memory} GB limit</span>
      </div>
    </div>
  );
}

function CrashDemo() {
  const [stage, setStage] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    if (stage >= demoStages.length - 1) { setRunning(false); return; }
    const timer = window.setTimeout(() => setStage((value) => value + 1), 1050);
    return () => window.clearTimeout(timer);
  }, [running, stage]);
  const run = () => { setStage(0); setRunning(true); };
  return (
    <section id="demo" className="mx-auto max-w-shell px-5 py-24 sm:px-5 lg:py-32">
      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div className="max-w-2xl rise">
          <h2 className="d-lg">The leaderboard says yes.<br />The sandbox asks why.</h2>
          <p className="lead mt-5 max-w-xl text-ink">
            Watch the same candidate meet a real agent workload — the failure and the adaptation. Launch an audit above for your own measured result.
          </p>
        </div>
        <button type="button" onClick={run} disabled={running} className="btn btn-ghost btn-square rise h-11 shrink-0 px-5 text-sm">
          {running ? "Replaying…" : stage === 0 ? "Run the scenario" : "Replay the scenario"}
        </button>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <div className="rise rounded-card bg-surface p-6 sm:p-7">
          <h3 className="d-md">Good vibes.<br />No hardware proof.</h3>
          <p className="mt-4 text-[16px] leading-relaxed text-ink">
            A standard deployment has no isolated run. The model wins preference votes at batch size 1; production concurrency expands the KV cache, and there is no operation ID or memory receipt.
          </p>
          <pre className="term mt-6 overflow-x-auto p-4 text-[13px] leading-6"><code><span className="text-termMuted">$ vllm serve candidate --gpu L40S</span>{"\n"}<span className="text-[#FF8A6B]">CUDA out of memory</span>{"\n"}<span className="text-termMuted">KV allocation failed · no recovery plan</span></code></pre>
          <p className="mt-4 text-[14px] font-medium text-blockDeep">Unexpected production failure</p>
        </div>

        <div className="rise rounded-card bg-surface p-6 sm:p-7">
          <h3 className="d-md">Crash early.<br />Ship with receipts.</h3>
          <p className="mt-4 text-[16px] leading-relaxed text-ink">
            Inside SandboxProof, fresh Nebius microVMs replay one sealed workload twin. Nemotron diagnoses the quality failure and adapts max_tokens and safe concurrency; deterministic policy keeps every gate unchanged.
          </p>
          <ol className="mt-6 space-y-1" aria-label="Crash test stages">
            {demoStages.map((item, index) => (
              <li key={item.title} className={`grid grid-cols-[1fr_auto] items-start gap-3 rounded-control px-3 py-3 text-[15px] ${index === stage ? "bg-raised" : ""} ${index <= stage ? "text-ink" : "text-ink2"}`}>
                <span>
                  <strong className="block font-medium">{item.title}</strong>
                  {index === stage && <span className="mt-1 block text-[14px] leading-snug text-ink2">{item.detail}</span>}
                </span>
                <span className={`min-w-[52px] text-right text-[13px] font-medium tabular-nums ${item.status === "SHIP" ? "text-ship" : item.status === "BLOCK" ? "text-block" : "text-ink2"}`}>{item.status}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="rise mt-6"><OomAutopsy memory={48} used={50} animated={stage >= 1 && stage <= 3} /></div>

      <div className="rise mt-8 flex flex-wrap items-center justify-between gap-4">
        <p className="text-[15px] text-ink2">
          Final certificate — {stage === 4 ? <span className="font-medium text-ship">SHIP on H100 FP8</span> : "awaiting the rerun"}
        </p>
        <Link href="#launch" className="text-[15px] font-medium underline decoration-accent underline-offset-4 hover:text-accentInk">Crash-test your model</Link>
      </div>
    </section>
  );
}

/* ——— Honest comparison ——— */

function Matrix() {
  return (
    <section id="comparison" className="mx-auto max-w-shell px-5 py-24 lg:py-32">
      <div className="max-w-2xl rise">
        <h2 className="d-lg">Preference is a signal.<br />Execution is a test.</h2>
        <p className="lead mt-5 text-ink">
          Arena rankings help compare conversational quality. They cannot certify that a candidate meets your hardware and workload limits.
        </p>
      </div>
      <div className="rise mt-12 hidden overflow-x-auto md:block" data-ui>
        <table className="ttable min-w-[680px]">
          <thead>
            <tr>
              <th scope="col" className="w-[26%]">Test dimension</th>
              <th scope="col" className="w-[34%]">Public arena</th>
              <th scope="col" className="w-[40%] text-accentInk">SandboxProof</th>
            </tr>
          </thead>
          <tbody>
            {matrixRows.map(([label, arena, proof]) => (
              <tr key={label}>
                <th scope="row" className="font-medium text-ink">{label}</th>
                <td className="text-ink2">{arena}</td>
                <td className="font-medium">{proof}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 md:hidden">
        {matrixRows.map(([label, arena, proof]) => (
          <div key={label} className="py-5">
            <p className="text-[16px] font-medium">{label}</p>
            <dl className="mt-2.5 grid gap-2 text-[15px] leading-relaxed">
              <div className="grid grid-cols-[68px_1fr] gap-3">
                <dt className="text-ink2">Arena</dt>
                <dd className="text-ink2">{arena}</dd>
              </div>
              <div className="grid grid-cols-[68px_1fr] gap-3">
                <dt className="text-ink2">Proof</dt>
                <dd className="font-medium text-ink">{proof}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

const demoPassport: PassportData = { model: "nvidia/Nemotron-3-Nano-30B", status: "SHIP", hardware: "H100 80GB FP8", p95Ms: 1642, toolAccuracy: 0.93, concurrency: 18, fingerprint: "a7f4d0c2e18b96a53f1d7e490bf3e241e18b9f7d2c04a6b8e93f115d7c240abc", label: "Illustrative preview — not certified" };

function PassportSection() {
  const [exportError, setExportError] = useState("");
  async function download() { try { setExportError(""); await downloadPassportPng(demoPassport); } catch { setExportError("PNG export is unavailable in this browser."); } }
  function share() { window.open(passportShareUrl(demoPassport), "_blank", "noopener,noreferrer"); void download(); }
  return (
    <section id="passport" className="mx-auto max-w-shell px-5 py-24 lg:py-32">
      <div className="grid items-center gap-10 lg:grid-cols-[.8fr_1.2fr]">
        <div className="rise">
          <h2 className="d-lg">A passport<br />with receipts.</h2>
          <p className="lead mt-5 max-w-md text-ink">
            Every completed audit becomes a shareable proof card, a production serving command, and a deterministic certificate. Simulated results stay visibly simulated.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={share} className="btn btn-primary btn-square h-11 px-5 text-sm">Share to X or Twitter</button>
            <button type="button" onClick={() => void download()} className="btn btn-ghost btn-square h-11 px-5 text-sm">Download 1200 × 630 PNG</button>
          </div>
          {exportError && <p role="alert" className="mt-3 text-[14px] text-blockDeep">{exportError}</p>}
          <p className="mt-4 max-w-md text-[14px] leading-relaxed text-ink2">
            Preview data is illustrative. An actual certificate links to its measured experiment and digest.
          </p>
        </div>
        <div className="rise min-w-0"><ModelPassport data={demoPassport} /></div>
      </div>
    </section>
  );
}

/* ——— Gates sentence with cycling lit words ——— */

const gateWords = ["p95 latency", "tool-call quality", "error rate", "tail throughput"];

function GatesStatement() {
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setLit((value) => (value + 1) % gateWords.length), 2200);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <section className="bg-surface">
      <div className="mx-auto max-w-shell px-5 py-24 lg:py-32">
        <p className="statement max-w-4xl">
          Ship means <span className={lit === 0 ? "gate-lit" : "gate-dim"}>p95 latency under two seconds</span>,
          {" "}<span className={lit === 1 ? "gate-lit" : "gate-dim"}>tool quality at 0.85</span>, and an{" "}
          <span className={lit === 2 ? "gate-lit" : "gate-dim"}>error rate under five percent</span> — measured
          in a fresh microVM, or the verdict is <strong className="font-semibold">BLOCK</strong>.
        </p>
        <p className="mt-6 text-[15px] text-ink2">Hard gates are policy, not prompts — the planner cannot renegotiate them. <Link href="/docs" className="underline decoration-line underline-offset-4 hover:text-ink">How the gates work</Link></p>
      </div>
    </section>
  );
}

/* ——— Pipeline as one proportional bar ——— */

const stages = [
  { label: "Your workload is sealed", time: "Seconds", grow: 1.1, note: "The twin is hashed — same inputs, same test, every time." },
  { label: "Nemotron plans the harness", time: "About a minute", grow: 1.6, note: "The planner proposes; deterministic policy validates it." },
  { label: "A fresh microVM replays it", time: "Up to 15 minutes", grow: 6, note: "Isolated Nebius sandbox, teardown always, operation ID on every receipt." },
  { label: "Metrics decide", time: "Instant", grow: 1.3, note: "Gates evaluate measured numbers and mint SHIP or BLOCK." },
];

function StageBar() {
  return (
    <section className="mx-auto max-w-shell px-5 py-24 lg:py-32">
      <h2 className="d-lg rise max-w-xl">Five minutes of setup.<br />One bar of honest work.</h2>
      <div data-ui className="stagebar mt-12 h-[300px] max-md:h-auto" role="img" aria-label="Pipeline: sealing the workload takes seconds, planning about a minute, the sandbox replay up to 15 minutes, the verdict instant.">
        {stages.map((stage) => (
          <div key={stage.label} className="flex min-w-0 flex-col" style={{ flexGrow: stage.grow, flexBasis: 0 }}>
            <div className={`rise relative flex-1 rounded-control p-5 ${stage.grow > 5 ? "bg-accentInk text-white" : "bg-[#E7E6E0] text-ink"}`}>
              <p className={`text-[clamp(17px,1.6vw,22px)] font-medium leading-snug ${stage.grow > 5 ? "text-white" : "text-ink"}`}>{stage.time}</p>
            </div>
            <div className="mt-4 max-w-[24ch]">
              <p className="text-[15px] font-medium leading-snug">{stage.label}</p>
              <p className="mt-1 text-[14px] leading-snug text-ink2">{stage.note}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ——— The ledger: hard caps, decimal-aligned ——— */

const ledger = [
  { whole: "$2", decimals: "00", caption: "Maximum spend per experiment" },
  { whole: "$10", decimals: "00", caption: "Maximum spend per certification" },
  { whole: "$20", decimals: "00", caption: "Hard cap across the ledger — the API refuses launches past it" },
  { whole: "5", decimals: "", caption: "Experiments per certification, then the loop stops" },
  { whole: "15", decimals: "", caption: "Minutes per sandbox operation, then teardown" },
  { whole: "0", decimals: "", caption: "Vibes in the verdict — every figure is measured" },
];

function Ledger() {
  return (
    <section className="bg-surface">
      <div className="mx-auto grid max-w-shell gap-10 px-5 py-24 lg:grid-cols-[1fr_1.2fr] lg:gap-16 lg:py-32">
        <h2 className="d-lg rise self-center lg:sticky lg:top-28 lg:self-start">The ledger<br />is the point.</h2>
        <div className="flex flex-col gap-8">
          {ledger.map((row) => (
            <div key={row.caption} className="ledger-row rise">
              <span className="ledger-figure text-right">{row.whole}</span>
              <span className="ledger-figure" aria-hidden={row.decimals ? undefined : true}>{row.decimals ? `.${row.decimals}` : ""}</span>
              <span className="ledger-caption text-ink">{row.caption}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


/* ------- Hero scene: the crash-test pipeline as an isometric diagram ------- */

const ISO = 0.8660254;

function isoFaces(cx: number, cy: number, w: number, d: number, h: number) {
  const hw = w * ISO, hd = d * 0.5;
  return {
    top: `${cx},${cy - hd} ${cx + hw},${cy} ${cx},${cy + hd} ${cx - hw},${cy}`,
    left: `${cx - hw},${cy} ${cx},${cy + hd} ${cx},${cy + hd + h} ${cx - hw},${cy + h}`,
    right: `${cx + hw},${cy} ${cx},${cy + hd} ${cx},${cy + hd + h} ${cx + hw},${cy + h}`,
  };
}

const FACE = { top: "#FFFFFF", lit: "#F1F1ED", dark: "#E3E2DC", ink: "#131313" };

function IsoCard({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children: React.ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill="#FFFFFF" stroke="#E3E2DC" />
      {children}
    </g>
  );
}

function HeroScene() {
  const slab = (cy: number) => isoFaces(340, cy, 132, 132, 18);
  const bottom = slab(320), middle = slab(294), top = slab(268);
  const cube = isoFaces(136, 316, 72, 72, 50);
  const sans = { fontFamily: "var(--font-sans), system-ui, sans-serif" };
  return (
    <div data-ui className="relative">
      <div className="hidden md:block">
        <svg viewBox="0 0 560 520" role="img" aria-label="Isometric diagram of a crash test: a candidate model and a sealed workload twin feed an isolated Nebius sandbox stack; measured gates of latency, quality and error rate produce a SHIP certificate." className="w-full">
          <defs>
            <pattern id="hero-dots" width="26" height="26" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.2" fill="#131313" opacity="0.14" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="560" height="520" fill="url(#hero-dots)" opacity="0.5" />

          {/* floor mat */}
          <polygon points="340,252 544,352 340,452 136,352" fill="none" stroke="#131313" strokeWidth="1" strokeDasharray="6 5" opacity="0.28" />

          {/* connectors */}
          <line x1="198" y1="316" x2="224" y2="320" stroke="#131313" strokeWidth="1.4" />
          <line x1="112" y1="116" x2="122" y2="286" stroke="#131313" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.5" />
          <line x1="447" y1="172" x2="448" y2="260" stroke="#131313" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.5" />
          <line x1="302" y1="186" x2="330" y2="200" stroke="#131313" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.5" />
          <path d="M340,404 L340,430" fill="none" stroke="#FF4D0A" strokeWidth="1.6" strokeDasharray="6 6" className="flow-line" />

          {/* sandbox stack */}
          <g stroke={FACE.ink} strokeWidth="1.2">
            <polygon points={bottom.left} fill={FACE.lit} />
            <polygon points={bottom.right} fill={FACE.dark} />
            <polygon points={bottom.top} fill={FACE.top} />
            <polygon points={middle.left} fill={FACE.lit} />
            <polygon points={middle.right} fill={FACE.dark} />
            <polygon points={middle.top} fill={FACE.top} />
            <polygon points={top.left} fill={FACE.lit} />
            <polygon points={top.right} fill={FACE.dark} />
            <polygon points={top.top} fill="#FFE8DD" />
          </g>
          <polygon points="340,260 348,268 340,276 332,268" fill="#FF4D0A" />

          {/* weights cube */}
          <g stroke={FACE.ink} strokeWidth="1.2">
            <polygon points={cube.left} fill={FACE.lit} />
            <polygon points={cube.right} fill={FACE.dark} />
            <polygon points={cube.top} fill={FACE.top} />
          </g>
          <text x="136" y="422" textAnchor="middle" fontSize="13" fill="#6B6B66" style={sans}>candidate · FP8 30 GB</text>

          {/* workload twin card */}
          <IsoCard x={24} y={32} w={196} h={84}>
            <text x="40" y="58" fontSize="14" fontWeight="600" fill="#131313" style={sans}>Workload twin</text>
            <text x="40" y="80" fontSize="13" fill="#6B6B66" style={sans}>200 requests · temp 0.0</text>
            <text x="40" y="100" fontSize="13" fill="#6B6B66" style={sans}>sha256 9ce3a3d7</text>
          </IsoCard>

          {/* sandbox chip */}
          <IsoCard x={218} y={152} w={168} h={34}>
            <circle cx="236" cy="169" r="4" fill="#FF4D0A" />
            <text x="248" y="174" fontSize="13" fill="#131313" style={sans}>Nebius sandbox</text>
          </IsoCard>

          {/* gates card */}
          <IsoCard x={352} y={48} w={190} h={124}>
            <text x="368" y="72" fontSize="14" fontWeight="600" fill="#131313" style={sans}>Hard gates</text>
            {[
              { y: 98, label: "p95 latency", value: "1,642 ms" },
              { y: 120, label: "tool quality", value: "93%" },
              { y: 142, label: "error rate", value: "1.0%" },
            ].map((row) => (
              <g key={row.label}>
                <circle cx="374" cy={row.y - 4} r="3.5" fill="#247B50" />
                <text x="386" y={row.y} fontSize="13" fill="#6B6B66" style={sans}>{row.label}</text>
                <text x="526" y={row.y} textAnchor="end" fontSize="13" fontWeight="500" fill="#131313" style={sans}>{row.value}</text>
              </g>
            ))}
          </IsoCard>

          {/* certificate card */}
          <IsoCard x={300} y={430} w={240} h={72}>
            <rect x="316" y="446" width="62" height="24" rx="12" fill="#DCFAE5" />
            <text x="347" y="462" textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#04250E" style={sans}>SHIP</text>
            <text x="390" y="462" fontSize="13" fontWeight="500" fill="#131313" style={sans}>H100 FP8</text>
            <text x="316" y="486" fontSize="13" fill="#6B6B66" style={sans}>24 safe streams · $0.38/1k</text>
          </IsoCard>
        </svg>
      </div>

      {/* Phone: the same receipt, set as readable text instead of a scaled drawing */}
      <div className="rounded-card bg-surface p-5 sm:p-6 md:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] font-medium">Workload twin · sealed</p>
          <span className="pill pill-ship">SHIP</span>
        </div>
        <p className="mt-1 text-[14px] text-ink2">200 requests · temp 0.0 · sha256 9ce3a3d7</p>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[14px] leading-snug">
          <dt className="text-ink2">Candidate</dt>
          <dd className="font-medium">Nemotron-3-Nano-30B · FP8 30 GB</dd>
          <dt className="text-ink2">Sandbox</dt>
          <dd>Nebius Contree microVM · Token Factory</dd>
          <dt className="text-ink2">Gates</dt>
          <dd>p95 1,642 ms · tool 93% · errors 1.0%</dd>
          <dt className="text-ink2">Result</dt>
          <dd className="font-medium text-ship">SHIP (Certified Capacity Envelope)</dd>
        </dl>
        <p className="mt-5 text-[14px] text-ink2">24 safe streams · $0.38 per 1k queries</p>
      </div>
    </div>
  );
}

/* ——— User Guide / How it Works ——— */

function UserGuide() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const items = [
    {
      q: "What is a Workload Twin?",
      a: "A workload twin is a cryptographic capture of your real production traffic: actual prompt distributions, JSON schemas, tool definitions, and concurrency patterns. Sealed with a SHA-256 fingerprint at temperature 0.0 with deterministic seeds, guaranteeing identical replay across every candidate model.",
    },
    {
      q: "Why do models fail in isolated sandboxes?",
      a: "Reasoning models (like Nemotron-3-Nano) consume output tokens formulating their thought chain before returning JSON; with a lean max_tokens budget, tool calls get truncated mid-flight. High concurrency saturates token throughput and causes P95 tail latency breaches. SandboxProof catches these in disposable microVMs before production users ever see them.",
    },
    {
      q: "How does Nemotron Ultra adapt parameters autonomously?",
      a: "When a replay run breaches an SLA gate, the Nemotron Ultra planner analyzes the failure telemetry. If structured JSON is truncated, it raises max_tokens; if tail latency breaches the SLA, it throttles concurrency. Immutable policy engines verify every plan before launch, and hard quality gates are never relaxed.",
    },
    {
      q: "What does the SHIP certificate guarantee?",
      a: "A cryptographic certificate of measured capacity envelope: verified maximum safe concurrency, maximum context window, minimum token output budget, and cost per 1,000 queries. Backed by real Nebius microVM operation IDs and deterministic hash receipts.",
    },
  ];

  return (
    <section id="guide" className="mx-auto max-w-shell px-5 py-24 lg:py-32">
      <div className="max-w-2xl rise">
        <h2 className="d-lg">How it works.<br />No magic, just arithmetic.</h2>
        <p className="lead mt-4 text-ink">
          Everything you need to understand how SandboxProof crash-tests open-weight models before production rollout.
        </p>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-2">
        {items.map((item, idx) => {
          const isOpen = openIdx === idx;
          return (
            <div key={item.q} className="rounded-card border border-line bg-surface p-6 transition">
              <button
                type="button"
                onClick={() => setOpenIdx(isOpen ? null : idx)}
                className="flex w-full items-start justify-between text-left cursor-pointer"
                aria-expanded={isOpen}
              >
                <h3 className="text-[16px] font-semibold text-ink">{item.q}</h3>
                <span className="mono ml-3 text-[18px] text-ink2">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <p className="mt-3 text-[14px] leading-relaxed text-ink2">
                  {item.a}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ——— Landing (page, not app shell) ——— */

export default function LandingPage() {
  return (
    <div className="bg-bg">
      <TopNav />

      {/* Hackathon Judge Showcase Banner */}
      <aside aria-label="Hackathon Judge Showcase" className="border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-shell flex-wrap items-center justify-between gap-3 text-[13px]">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
            <strong className="font-semibold text-ink">Judge Showcase:</strong>
            <span className="text-ink2">
              Verified live audit <code className="mono font-semibold text-ink">cert-a1a3fa0d</code> replayed in disposable Nebius microVMs ($0.0069 spend).
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/certificate/cert-a1a3fa0d" className="font-medium text-accent hover:underline">
              View Certificate →
            </Link>
            <span className="text-line">·</span>
            <Link href="/timeline/cert-a1a3fa0d" className="font-medium text-ink hover:underline">
              Diagnostic Timeline →
            </Link>
          </div>
        </div>
      </aside>

      <main>
        {/* Hero — headline and actions left, the pipeline diagram right */}
        <section className="flex min-h-[88svh] items-center px-5 pb-8 pt-4 sm:px-6" aria-label="SandboxProof">
          <div className="mx-auto grid w-full max-w-shell items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-4">
            <div className="rise max-w-[620px]">
              <h1 className="d-xl max-w-[14ch] text-balance">Crash early.<br />Ship with receipts.</h1>
              <p className="lead mt-5 max-w-[46ch] text-balance text-ink">
                SandboxProof replays your production traffic through disposable Nebius microVMs to certify open-weight models before you deploy.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href="#launch" className="btn btn-accent btn-square h-12 px-6 text-[15px]">Start crash test</a>
                <Link href="/certificate/cert-a1a3fa0d" className="btn btn-ghost btn-square h-12 px-6 text-[15px]">
                  Inspect verified run (cert-a1a3fa0d)
                </Link>
              </div>
              <p className="mt-6 max-w-[44ch] text-[14px] leading-relaxed text-ink2">Free in simulator mode · live runs bill your own Nebius key.</p>
            </div>
            <div className="rise min-w-0">
              <HeroScene />
            </div>
          </div>
        </section>

        {/* The launcher */}
        <section id="launch" className="mx-auto max-w-shell scroll-mt-20 px-5 pb-24 lg:pb-32">
          <div className="max-w-2xl">
            <h2 className="d-lg">The crash-test lab</h2>
            <p className="lead mt-4 text-ink">
              Pick a model, choose a workload, launch. The plan updates as you pick; the sandbox measures the truth.
            </p>
          </div>
          <div className="mt-10">
            <Suspense fallback={<div className="rounded-card bg-surface p-8 text-[14px] text-ink2">Loading the crash-test lab…</div>}>
              <CrashTestLab />
            </Suspense>
          </div>
        </section>

        <StageBar />
        <GatesStatement />
        <UserGuide />
        <CrashDemo />
        <Matrix />
        <Ledger />
        <PassportSection />

        {/* Close: question at both edges, name returns like a bracket */}
        <section className="mt-8 bg-ink text-[#F1F1ED]">
          <div className="flex min-h-[92svh] flex-col px-5 py-10 sm:px-6">
            <p className="verdict mx-auto w-full max-w-[13ch] text-center text-[clamp(3.4rem,11vw,10rem)] leading-[0.98]">
              Ship it<br />or block it?
            </p>
            <div className="my-auto flex flex-col items-center justify-center gap-4 py-14 sm:flex-row">
              <a href="#launch" className="btn btn-onDark btn-square h-14 w-full max-w-[280px] px-8 text-[15px]">Run your first crash test</a>
              <span aria-hidden="true" className="text-[15px] text-[#A6A69E] max-sm:hidden">or</span>
              <Link href="/docs" className="btn btn-onDarkGhost btn-square h-14 w-full max-w-[280px] px-8 text-[15px]">Read the docs</Link>
            </div>
            <p className="mx-auto text-center text-[15px] text-[#A6A69E]">The first certification is free in simulator mode — connect a Nebius key for live sandboxes.</p>

            <div className="mt-14">
              <p className="mb-6 max-w-[30ch] text-[17px] leading-snug text-[#F1F1ED]">
                Run it tonight. Attach the certificate tomorrow.
              </p>
              <div aria-hidden="true"><SpanningName tone="paper" /></div>
            </div>
          </div>
          <div className="flex flex-col gap-3 px-5 py-6 text-[15px] text-[#A6A69E] sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span>SandboxProof · Nebius × NVIDIA hackathon, October 2026</span>
            <span className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <Link href="/dashboard" className="hover:text-white">Runs</Link>
              <Link href="/matrix" className="hover:text-white">Matrix</Link>
              <Link href="/usage" className="hover:text-white">Spend</Link>
              <Link href="/docs" className="hover:text-white">Docs</Link>
              <a href="https://github.com/dhruvil-codes/gpu-proof" target="_blank" rel="noreferrer" className="hover:text-white">GitHub</a>
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}
