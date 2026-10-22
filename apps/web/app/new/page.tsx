"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ByokModal from "@/components/ByokModal";
import { TopNav, useByokStatus } from "@/components/ui";
import { buildByokHeaders } from "@/components/byok";
import { buildExecutionHeaders, enableDevSimFromQuery, getExecutionMode, isDevSim, useExecutionMode } from "@/components/executionMode";

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
const ALLOW_SIM = process.env.NEXT_PUBLIC_ALLOW_SIM === "1";

type BackendState = "checking" | "live" | "sim" | "down";
type Precision = "FP8" | "BF16" | "INT4";
type Hardware = { id: string; name: string; memory: number; hourly: number; bandwidth: string };
type Workload = { id: string; label: string; detail: string; concurrency: number; context: number; tasks: string[] };

const HARDWARE: Hardware[] = [
  { id: "L40S", name: "L40S", memory: 48, hourly: 1.35, bandwidth: "864 GB/s" },
  { id: "H100", name: "H100 SXM5", memory: 80, hourly: 4.5, bandwidth: "3.35 TB/s" },
  { id: "H200", name: "H200", memory: 141, hourly: 5.4, bandwidth: "4.8 TB/s" },
];
const WORKLOADS: Workload[] = [
  { id: "agent", label: "Agent tool-calling", detail: "Function selection, argument fidelity, chained operations.", concurrency: 8, context: 8192, tasks: ["tool_calling", "structured_output"] },
  { id: "json", label: "Structured JSON", detail: "Schema adherence under continuous inference.", concurrency: 4, context: 8192, tasks: ["structured_output"] },
  { id: "burst", label: "Burst concurrency", detail: "Tail latency and memory at sustained parallel load.", concurrency: 18, context: 8192, tasks: ["tool_calling", "structured_output"] },
];

function extractRepo(input: string) {
  const clean = input.trim().replace(/^(?:https?:\/\/)?(?:www\.)?huggingface\.co\//i, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);
  return parts[0] === "models" ? parts.slice(1, 3).join("/") : parts.slice(0, 2).join("/");
}

async function checkBackend(): Promise<BackendState> {
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

function Label({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{children}</span>;
}

function StepHeading({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="grid gap-3 border-b border-rule pb-6 sm:grid-cols-[56px_1fr]">
      <span className="font-mono text-[13px] text-orange">{number}</span>
      <div>
        <h2 className="text-[26px] font-medium tracking-[-0.045em] text-ink sm:text-[32px]">{title}</h2>
        <p className="mt-2 max-w-xl text-[13px] leading-[18px] text-muted">{description}</p>
      </div>
    </div>
  );
}

function NumberField({ id, label, value, min, max, step = 1, unit, onChange }: {
  id: string; label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (value: number) => void;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-2 block"><Label>{label}</Label></span>
      <span className="flex h-12 items-center border border-rule bg-white focus-within:border-ink">
        <input id={id} type="number" min={min} max={max} step={step} value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-full w-full min-w-0 bg-transparent px-3 font-mono text-[14px] text-ink outline-none" />
        <span className="shrink-0 border-l border-rule px-3 font-mono text-[11px] text-muted">{unit}</span>
      </span>
    </label>
  );
}

export default function New() {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <TopNav />
      <Suspense fallback={<div className="mx-auto max-w-[1120px] px-6 py-24 font-mono text-[13px]">LOADING AUDIT LAB…</div>}>
        <AuditLab />
      </Suspense>
    </main>
  );
}

function AuditLab() {
  const router = useRouter();
  const query = useSearchParams();
  const [executionMode] = useExecutionMode();
  const byokConnected = useByokStatus();
  const [byokOpen, setByokOpen] = useState(false);
  const [backend, setBackend] = useState<BackendState>("checking");
  const [model, setModel] = useState(query.get("candidate_model") || "nvidia/Nemotron-3-Nano-30B");
  const [baseline, setBaseline] = useState(query.get("current_model") || "Qwen/Qwen3-8B");
  const [gpu, setGpu] = useState(() => {
    const raw = (query.get("target_gpu") || query.get("gpu") || "H100").toUpperCase();
    return HARDWARE.some((item) => item.id === raw) ? raw : "H100";
  });
  const [precision, setPrecision] = useState<Precision>(() => {
    const raw = (query.get("precision") || "FP8").toUpperCase();
    return raw === "BF16" || raw === "INT4" ? raw : "FP8";
  });
  const [workloadId, setWorkloadId] = useState("agent");
  const [concurrency, setConcurrency] = useState(Number(query.get("concurrency")) || 8);
  const [contextLen, setContextLen] = useState(Number(query.get("context_len")) || 8192);
  const [p95, setP95] = useState(2000);
  const [accuracy, setAccuracy] = useState(85);
  const [errorRate, setErrorRate] = useState(5);
  const [runCap, setRunCap] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    enableDevSimFromQuery();
    let mounted = true;
    checkBackend().then((state) => { if (mounted) setBackend(state); });
    return () => { mounted = false; };
  }, []);

  const hardware = HARDWARE.find((item) => item.id === gpu)!;
  const workload = WORKLOADS.find((item) => item.id === workloadId)!;
  const repo = useMemo(() => extractRepo(model), [model]);
  const validRepo = /^[^\s/]+\/[^\s/]+$/.test(repo);
  // This is a planning estimate. The live audit supplies the authoritative memory result.
  const estimatedParams = /30B/i.test(model) ? 30 : /8B/i.test(model) ? 8 : null;
  const weightEstimate = estimatedParams === null ? null : estimatedParams * (precision === "BF16" ? 2 : precision === "INT4" ? 0.5 : 1);
  const kvEstimate = estimatedParams === null ? null : Math.round((2 * 64 * 8 * 128 * contextLen * concurrency * (precision === "BF16" ? 2 : 1)) / 1e9 * 10) / 10;
  const totalEstimate = weightEstimate === null || kvEstimate === null ? null : weightEstimate + kvEstimate + 1.8;
  const memoryPct = totalEstimate === null ? 0 : Math.min(100, totalEstimate / hardware.memory * 100);
  const estimatedOom = totalEstimate !== null && totalEstimate > hardware.memory * 0.95;
  const simRequested = ALLOW_SIM && executionMode === "sim";
  const canLaunch = validRepo && gpu !== "H200" && !submitting && runCap > 0 && runCap <= 10;

  function chooseWorkload(id: string) {
    const next = WORKLOADS.find((item) => item.id === id);
    if (!next) return;
    setWorkloadId(id);
    setConcurrency(next.concurrency);
    setContextLen(next.context);
  }

  async function launch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!validRepo) { setError("Enter a Hugging Face model slug in org/model format."); return; }
    if (gpu === "H200") { setError("H200 is available for preflight sizing. Live certification currently supports L40S and H100 proposals."); return; }
    if (![concurrency, contextLen, p95, accuracy, errorRate, runCap].every(Number.isFinite)) {
      setError("Enter valid numeric values for every workload, SLA, and budget field."); return;
    }
    if (concurrency < 1 || concurrency > 64 || contextLen < 512 || contextLen > 131072) {
      setError("Concurrency must be 1–64 and context must be 512–131072 tokens."); return;
    }
    if (p95 < 1 || p95 > 60000 || accuracy < 0 || accuracy > 100 || errorRate < 0 || errorRate > 100) {
      setError("SLA gates are outside their allowed range."); return;
    }
    if (runCap <= 0 || runCap > 10) {
      setError("Budget limits cannot exceed $2 per experiment, $10 per run, or $20 total."); return;
    }
    setStatus("Verifying execution backend…");
    const truth = await checkBackend();
    setBackend(truth);
    if (truth === "down") { setStatus(""); setError("Backend unreachable. A live backend is required to launch."); return; }
    if (truth === "sim" && !isDevSim()) { setStatus(""); setError("Backend is simulator enforced. Live certification is unavailable."); return; }
    const mode = ALLOW_SIM ? getExecutionMode() : truth === "sim" ? "sim" : "real";
    setSubmitting(true);
    setStatus("Creating audit and starting isolated sandbox…");
    try {
      const headers = { "Content-Type": "application/json", ...buildByokHeaders(), ...buildExecutionHeaders(mode) };
      const payload = {
        candidate_model: repo,
        current_model: extractRepo(baseline) || baseline,
        gpu_type: gpu,
        precision,
        workload_tasks: workload.tasks,
        gates: [
          { metric: "latency_p95_ms", op: "<=", threshold: p95 },
          { metric: "quality_score", op: ">=", threshold: accuracy / 100 },
          { metric: "error_rate", op: "<=", threshold: errorRate / 100 },
        ],
        concurrency, context_len: contextLen, requests: 200,
        budget_usd: runCap, mode,
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
        throw new Error(`Could not create audit: ${detail}`);
      }
      const result = await created.json();
      if (!result?.id) throw new Error("Audit created without an experiment ID.");
      const startController = new AbortController();
      const startTimeout = setTimeout(() => startController.abort(), 20000);
      let started: Response;
      try {
        started = await fetch(`/api/certifications/${encodeURIComponent(result.id)}/start`, {
          method: "POST", headers: { ...buildByokHeaders(), ...buildExecutionHeaders(mode) }, signal: startController.signal,
        });
      } finally { clearTimeout(startTimeout); }
      if (!started.ok) throw new Error(`Audit created but sandbox launch failed (HTTP ${started.status}). Open the timeline to retry.`);
      try {
        const history = JSON.parse(localStorage.getItem("sandboxproof-certs") || "[]");
        history.unshift({ id: result.id, candidate: repo, status: "RUNNING", spend: 0, experiments: 0, simulated: mode !== "real", created_at: new Date().toISOString() });
        localStorage.setItem("sandboxproof-certs", JSON.stringify(history.slice(0, 20)));
      } catch { /* Local history is optional. */ }
      router.push(`/timeline/${encodeURIComponent(result.id)}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(/fetch|network|abort/i.test(message) ? "The audit API did not respond. Check the backend and try again." : message);
      setStatus("");
      setSubmitting(false);
    }
  }

  return (
    <>
      <ByokModal open={byokOpen} onClose={() => setByokOpen(false)} />
      <div className="mx-auto max-w-[1280px] border-x border-rule">
        <div className="border-b border-rule px-6 py-3 sm:px-10">
          <Label>01 / Audit Lab / New certification</Label>
        </div>
        <header className="grid gap-8 border-b border-rule px-6 py-12 sm:px-10 lg:grid-cols-[1fr_300px] lg:py-16">
          <div>
            <span className="inline-flex items-center gap-2 border border-rule bg-white px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em]"><span className="h-2 w-2 bg-orange" /> CI/CD FOR INFERENCE</span>
            <h1 className="mt-6 max-w-[680px] text-[48px] font-medium leading-[1.04] tracking-[-0.055em] sm:text-[64px]">Build the test.<br /><span className="text-orange">Prove the model.</span></h1>
            <p className="mt-6 max-w-[610px] text-[18px] leading-[27px] tracking-[-0.015em] text-muted">Replay your agent workload in an isolated Nebius Sandbox. Set strict gates, cap spend, and get a verifiable SHIP or BLOCK decision.</p>
          </div>
          <div className="self-end border border-rule bg-white p-5">
            <Label>Execution readiness</Label>
            <p aria-live="polite" className="mt-4 flex items-center gap-2 font-mono text-[12px]">
              <span className={`h-2 w-2 ${backend === "live" ? "bg-ship" : backend === "checking" ? "bg-orange" : "bg-block"}`} />
              {backend === "live" ? "LIVE BACKEND" : backend === "sim" ? "SIMULATOR BACKEND" : backend === "down" ? "BACKEND OFFLINE" : "CHECKING BACKEND"}
            </p>
            <div className="mt-4 border-t border-rule pt-4">
              <p className="font-mono text-[12px] text-ink">{byokConnected ? "NEBIUS KEY CONNECTED" : "NEBIUS KEY NOT CONNECTED"}</p>
              <button type="button" onClick={() => setByokOpen(true)} className="mt-3 min-h-10 border border-ink bg-ink px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-white hover:bg-orange hover:border-orange">Connect Nebius API key →</button>
            </div>
          </div>
        </header>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
          <form id="audit-form" onSubmit={launch} noValidate className="min-w-0">
            <section id="target" className="border-b border-rule px-6 py-10 sm:px-10">
              <StepHeading number="01" title="Target model & hardware" description="Choose the open-weight candidate and a hardware target for preflight sizing. Live policy supports L40S and H100 proposals." />
              <div className="mt-8 grid gap-5 sm:grid-cols-2">
                <label className="block sm:col-span-2"><Label>Hugging Face model slug</Label>
                  <input value={model} onChange={(event) => setModel(event.target.value)} spellCheck={false} placeholder="org/model-name"
                    className="mt-2 h-12 w-full border border-rule bg-white px-3 font-mono text-[14px] outline-none focus:border-ink" />
                  <span className="mt-2 block font-mono text-[11px] text-muted">Paste a model slug or huggingface.co URL. Estimates use known model sizes; the audit measures actual behavior.</span>
                </label>
                <label className="block"><Label>Baseline model</Label>
                  <input value={baseline} onChange={(event) => setBaseline(event.target.value)} spellCheck={false}
                    className="mt-2 h-12 w-full border border-rule bg-white px-3 font-mono text-[13px] outline-none focus:border-ink" />
                </label>
                <label className="block"><Label>Serving precision</Label>
                  <select value={precision} onChange={(event) => setPrecision(event.target.value as Precision)}
                    className="mt-2 h-12 w-full border border-rule bg-white px-3 font-mono text-[13px] outline-none focus:border-ink">
                    <option value="FP8">FP8 · production default</option><option value="BF16">BF16 · full fidelity</option><option value="INT4">INT4 · compressed</option>
                  </select>
                </label>
              </div>
              <fieldset className="mt-8"><legend><Label>Hardware target</Label></legend>
                <div className="mt-3 grid gap-px border border-rule bg-rule sm:grid-cols-3">
                  {HARDWARE.map((item) => <label key={item.id} className={`relative cursor-pointer bg-white p-4 transition-colors hover:bg-orangeWash ${gpu === item.id ? "shadow-[inset_0_3px_0_#FF4D0A]" : ""}`}>
                    <input type="radio" name="hardware" value={item.id} checked={gpu === item.id} onChange={() => setGpu(item.id)} className="sr-only" />
                    <span className="flex items-start justify-between gap-2"><span className="font-mono text-[14px] font-medium">{item.name}</span><span aria-hidden="true" className={`h-3 w-3 border ${gpu === item.id ? "border-orange bg-orange" : "border-muted"}`} /></span>
                    <span className="mt-2 block font-mono text-[11px] text-muted">{item.memory}GB VRAM / {item.bandwidth}{item.id === "H200" ? " / PREFLIGHT ONLY" : ""}</span>
                  </label>)}
                </div>
              </fieldset>
              {gpu === "H200" && <p className="mt-3 border-l-2 border-warning bg-white px-4 py-3 font-mono text-[11px] leading-5 text-muted">H200 sizing is available here. Select L40S or H100 to launch a live certification under the current execution policy.</p>}
            </section>

            <section id="workload" className="border-b border-rule px-6 py-10 sm:px-10">
              <StepHeading number="02" title="Workload twin" description="Send representative requests at the concurrency and context your application will use." />
              <fieldset className="mt-8"><legend className="sr-only">Workload profile</legend>
                <div className="grid gap-px border border-rule bg-rule">
                  {WORKLOADS.map((item) => <label key={item.id} className={`flex cursor-pointer gap-4 bg-white p-4 hover:bg-orangeWash ${workloadId === item.id ? "shadow-[inset_3px_0_0_#FF4D0A]" : ""}`}>
                    <input type="radio" name="workload" value={item.id} checked={workloadId === item.id} onChange={() => chooseWorkload(item.id)} className="mt-1 accent-orange" />
                    <span><span className="block text-[15px] font-medium">{item.label}</span><span className="mt-1 block text-[13px] leading-[18px] text-muted">{item.detail}</span></span>
                    <span className="ml-auto hidden shrink-0 font-mono text-[11px] text-muted sm:block">{item.concurrency} STREAMS</span>
                  </label>)}
                </div>
              </fieldset>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <NumberField id="concurrency" label="Concurrent streams" value={concurrency} min={1} max={64} unit="STREAMS" onChange={setConcurrency} />
                <NumberField id="context" label="Context window" value={contextLen} min={512} max={131072} step={512} unit="TOKENS" onChange={setContextLen} />
              </div>
            </section>

            <section id="gates" className="border-b border-rule px-6 py-10 sm:px-10">
              <StepHeading number="03" title="Strict SLA gates" description="The certificate passes only when measured telemetry clears every selected threshold." />
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <NumberField id="p95" label="P95 latency ≤" value={p95} min={1} max={60000} unit="MS" onChange={setP95} />
                <NumberField id="accuracy" label="Tool accuracy ≥" value={accuracy} min={0} max={100} unit="%" onChange={setAccuracy} />
                <NumberField id="error-rate" label="Error rate ≤" value={errorRate} min={0} max={100} step={0.1} unit="%" onChange={setErrorRate} />
              </div>
              <p className="mt-4 font-mono text-[11px] text-muted">Gates are recorded in the certification and evaluated against the live run.</p>
            </section>

            <section id="budget" className="px-6 py-10 sm:px-10">
              <StepHeading number="04" title="Budget ledger" description="Platform hard caps are enforced before provisioning. You can lower the limit for this run." />
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="border border-rule bg-white p-4"><p className="font-mono text-[11px] text-muted">PER EXPERIMENT / HARD CAP</p><p className="mt-3 font-mono text-2xl">$2.00</p></div>
                <NumberField id="run-cap" label="This run" value={runCap} min={0.01} max={10} step={0.01} unit="USD" onChange={setRunCap} />
                <div className="border border-rule bg-white p-4"><p className="font-mono text-[11px] text-muted">ALL RUNS / HARD CAP</p><p className="mt-3 font-mono text-2xl">$20.00</p></div>
              </div>
              <p className="mt-4 font-mono text-[11px] text-muted">The policy engine rejects proposals above $2 per experiment, $10 per certification, or the $20 total ledger. This run can use a lower cap.</p>
              {ALLOW_SIM && <p className="mt-4 border border-rule bg-white p-3 font-mono text-[11px]">DEV EXECUTION MODE: {simRequested ? "SIMULATED · NO PRODUCTION CERTIFICATE" : "LIVE"}</p>}
              <div className="mt-8 border-t border-rule pt-8">
                {error && <p role="alert" className="mb-4 border-l-2 border-block bg-white p-3 font-mono text-[12px] text-block">{error}</p>}
                {status && <p role="status" className="mb-4 font-mono text-[12px] text-muted">{status}</p>}
                <button type="submit" disabled={!canLaunch}
                  className="flex min-h-14 w-full items-center justify-between gap-4 bg-orange px-5 font-mono text-[13px] font-medium uppercase tracking-[0.04em] text-white transition-colors hover:bg-orangeDeep disabled:cursor-not-allowed disabled:opacity-50">
                  <span>{submitting ? "Launching sandbox…" : "Launch Nebius microVM sandbox"}</span><span aria-hidden="true">↗</span>
                </button>
                <p className="mt-3 font-mono text-[11px] leading-[18px] text-muted">Live runs use Nebius credentials when connected. A simulator backend cannot silently issue a production certificate.</p>
              </div>
            </section>
          </form>

          <aside aria-label="Audit estimate" className="border-t border-rule bg-white lg:border-l lg:border-t-0">
            <div className="lg:sticky lg:top-20">
              <div className="border-b border-rule p-6"><Label>Preflight / 001</Label><h2 className="mt-4 text-[24px] font-medium tracking-[-0.045em]">Memory autopsy</h2><p className="mt-2 text-[13px] leading-[18px] text-muted">Estimate before launch. Actual peak VRAM is measured inside the microVM.</p></div>
              <div className="border-b border-rule p-6">
                <div className="flex justify-between font-mono text-[11px]"><span className="text-muted">TARGET CAPACITY</span><span>{hardware.memory} GB</span></div>
                <div className="relative mt-4 h-5 border border-rule bg-paper">
                  <div className={`h-full transition-[width] duration-300 ${estimatedOom ? "bg-block" : "bg-orange"}`} style={{ width: `${memoryPct}%` }} />
                  <span className="absolute inset-y-[-5px] left-[95%] w-px bg-ink" aria-hidden="true" />
                </div>
                <div className="mt-3 flex justify-between font-mono text-[11px] text-muted"><span>0 GB</span><span>95% USABLE</span><span>{hardware.memory} GB</span></div>
                <dl className="mt-6 space-y-3 font-mono text-[12px]">
                  <div className="flex justify-between border-b border-rule pb-3"><dt>MODEL WEIGHTS</dt><dd>{weightEstimate === null ? "PENDING" : `${weightEstimate.toFixed(1)} GB`}</dd></div>
                  <div className="flex justify-between border-b border-rule pb-3"><dt>KV CACHE</dt><dd>{kvEstimate === null ? "PENDING" : `${kvEstimate.toFixed(1)} GB`}</dd></div>
                  <div className="flex justify-between border-b border-rule pb-3"><dt>RUNTIME RESERVE</dt><dd>1.8 GB</dd></div>
                  <div className="flex justify-between font-medium"><dt>TOTAL ESTIMATE</dt><dd className={estimatedOom ? "text-block" : "text-orange"}>{totalEstimate === null ? "UNKNOWN" : `${totalEstimate.toFixed(1)} GB`}</dd></div>
                </dl>
                <p className={`mt-6 border p-3 font-mono text-[11px] leading-[18px] ${estimatedOom ? "border-block text-block" : "border-rule text-muted"}`}>
                  {estimatedOom ? "PREFLIGHT WARNING: estimated memory exceeds usable VRAM. The audit can still run to produce a measured failure receipt." : totalEstimate === null ? "Unknown architecture. No fabricated fit verdict; the sandbox will measure memory." : "PREFLIGHT FIT: estimate is below the 95% memory boundary. Live measurement determines certification."}
                </p>
              </div>
              <div className="p-6"><Label>Audit manifest</Label><dl className="mt-4 space-y-3 font-mono text-[11px]"><div className="flex justify-between gap-2"><dt className="text-muted">GPU</dt><dd>{hardware.name}</dd></div><div className="flex justify-between gap-2"><dt className="text-muted">PRECISION</dt><dd>{precision}</dd></div><div className="flex justify-between gap-2"><dt className="text-muted">WORKLOAD</dt><dd className="text-right">{workload.label}</dd></div><div className="flex justify-between gap-2"><dt className="text-muted">RUN HARD CAP</dt><dd>${runCap.toFixed(2)}</dd></div></dl></div>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
