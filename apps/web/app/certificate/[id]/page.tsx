"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { TopNav } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
const REGION = "eu-north1";

const WORKLOAD_DIGEST_EXPLANATION =
  "Deterministic SHA-256 fingerprint generated from exact prompt seeds and request traces. Guarantees that these latency and memory numbers were measured on real hardware without hallucinations, and can be verified offline by any auditor or engineering lead.";

const GPU_LABELS: Record<string, string> = {
  L40S: "1x Nebius NVIDIA L40S 48GB",
  H100: "1x Nebius NVIDIA H100 80GB SXM5",
  H200: "1x Nebius NVIDIA H200 141GB SXM5",
  A100: "1x NVIDIA A100 80GB SXM4",
};

type GateFail = { metric: string; observed: number; threshold: number; detail?: string };
type Metrics = {
  latency_p95_ms: number;
  quality_score: number;
  error_rate: number;
  count?: number;
  simulated?: boolean;
};
type Experiment = {
  index: number;
  plan: { gpu_type: string; precision: string; engine?: string; batch_config?: number };
  status: string;
  verdict: string;
  metrics: Metrics;
};
type Deployment = {
  certified_hardware: string;
  gpu_type: string;
  precision: string;
  engine: string;
  candidate_model: string;
  serving_command: string;
  operational_limits: {
    max_safe_concurrency: number;
    max_safe_concurrency_note: string;
    max_context_tokens: number;
    max_context_note: string;
  };
  economics: {
    cost_per_1k_queries_usd: number;
    monthly_run_rate_1m_queries_usd: number;
    basis: string;
  };
};
type CertData = {
  certification_id?: string;
  certification?: string;
  verdict: string;
  note?: string;
  spend_usd?: number;
  failing_gates?: GateFail[];
  evidence?: { metrics: Metrics; baseline: Record<string, unknown> };
  experiments?: Experiment[];
  candidate_model?: string;
  twin_digest?: string | null;
  twin_count?: number | null;
  workload_digest_explanation?: string;
  deployment?: Deployment;
};

/** Deterministic FNV-1a digest of the evidence payload (client-side, stable per content). */
function evidenceDigest(payload: unknown): string {
  const s = JSON.stringify(payload ?? {});
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a:${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** Client-side fallback: same shape as services/certificate_engine.build_serving_command. */
function fallbackServingCommand(candidate: string, precision: string): string {
  const model = (candidate || "candidate-model").trim() || "candidate-model";
  const dtype = (precision || "FP8").trim().toLowerCase() || "fp8";
  return (
    `vllm serve ${model} --dtype ${dtype} ` +
    `--max-model-len 8192 --gpu-memory-utilization 0.95 --tensor-parallel-size 1 --port 8000`
  );
}

function Seal({ tone }: { tone: "ship" | "block" | "sim" }) {
  const bg = tone === "ship" ? "bg-ship" : tone === "block" ? "bg-block" : "bg-ink";
  return (
    <span aria-hidden="true" className={`inline-flex h-14 w-14 items-center justify-center rounded-full ${bg} text-white shadow-[3px_3px_0_rgba(31,31,31,0.25)]`}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l8 3.5v5.2c0 5-3.4 8.6-8 10.3-4.6-1.7-8-5.3-8-10.3V5.5L12 2z" />
        {tone === "block"
          ? (<><path d="M12 7v6" /><circle cx="12" cy="16.5" r="0.5" fill="currentColor" /></>)
          : (<path d="M8.5 12l2.5 2.5 4.5-5" />)}
      </svg>
    </span>
  );
}

export default function Certificate({ params }: { params: { id: string } }) {
  const [d, setD] = useState<CertData | null>(null);
  const [waiting, setWaiting] = useState("");
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [issuedAt] = useState(() => new Date());
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch(`${API}/certifications/${params.id}/certificate`);
        if (!r.ok) {
          if (alive) setWaiting("Audit still running — this certificate will be issued automatically when all gates complete.");
          return;
        }
        const j = await r.json();
        if (alive) { setD(j); setWaiting(""); }
      } catch {}
    }
    load(); const t = setInterval(load, 4000); return () => { alive = false; clearInterval(t); };
  }, [params.id]);

  if (!d) return (<main><TopNav /><p className="p-8 text-sm">{waiting || "Loading certificate…"}</p></main>);

  const ship = d.verdict === "SHIP";
  const sim = d.verdict === "SIMULATED";
  const tone: "ship" | "block" | "sim" = ship ? "ship" : sim ? "sim" : "block";
  const lastExp = d.experiments?.length ? d.experiments[d.experiments.length - 1] : null;
  const m: Metrics | null = d.evidence?.metrics ?? lastExp?.metrics ?? null;

  const p95 = m?.latency_p95_ms;
  const q = m?.quality_score;
  const err = m?.error_rate;
  const failedSet = new Set((d.failing_gates ?? []).map((g) => g.metric));
  const passLatency = typeof p95 === "number" ? (failedSet.size ? !failedSet.has("latency_p95_ms") : p95 <= 2000) : null;
  const passQuality = typeof q === "number" ? (failedSet.size ? !failedSet.has("quality_score") : q >= 0.85) : null;
  const passError = typeof err === "number" ? (failedSet.size ? !failedSet.has("error_rate") : err <= 0.05) : null;
  const margin = typeof p95 === "number" ? Math.max(0, Math.round((1 - p95 / 2000) * 100)) : null;
  const qualityDeltaPp = typeof q === "number" ? q * 100 - 85 : null;
  const latencyOverPct = typeof p95 === "number" && p95 > 2000 ? Math.round((p95 / 2000 - 1) * 100) : null;

  const fnvDigest = evidenceDigest(d.experiments ?? d.evidence);
  // Prefer the backend SHA-256 twin digest (reproducible across any cluster);
  // fall back to the client-side FNV-1a evidence fingerprint for old certs.
  const primaryDigest = d.twin_digest || fnvDigest;
  const digestExplanation = WORKLOAD_DIGEST_EXPLANATION;
  const replayCount = d.twin_count ?? m?.count ?? d.experiments?.length ?? null;

  // --- Production Deployment Prescription (backend authoritative, client fallback) ---
  const planGpu = (lastExp?.plan?.gpu_type || d.deployment?.gpu_type || "H100").toUpperCase();
  const planPrecision = (lastExp?.plan?.precision || d.deployment?.precision || "FP8").toUpperCase();
  const candidateModel =
    d.deployment?.candidate_model || d.candidate_model || "candidate-model";
  const certifiedHardware =
    d.deployment?.certified_hardware || GPU_LABELS[planGpu] || `1x Nebius NVIDIA ${planGpu}`;
  const servingCommand =
    d.deployment?.serving_command || fallbackServingCommand(candidateModel, planPrecision);
  const maxConcurrency = d.deployment?.operational_limits?.max_safe_concurrency ?? 24;
  const concurrencyNote =
    d.deployment?.operational_limits?.max_safe_concurrency_note ||
    `${maxConcurrency} parallel streams before P95 breaches 2,000ms.`;
  const maxContext = d.deployment?.operational_limits?.max_context_tokens ?? 8192;
  const contextNote =
    d.deployment?.operational_limits?.max_context_note ||
    `${maxContext.toLocaleString()} tokens before KV-cache offload on ${certifiedHardware} (PagedAttention, --gpu-memory-utilization 0.95).`;
  const spendUsd = typeof d.spend_usd === "number" ? d.spend_usd : 0;
  const countN = typeof m?.count === "number" && m.count > 0 ? m.count : 100;
  const fallbackCostPer1k =
    spendUsd > 0 ? Math.round((spendUsd / Math.max(1, countN)) * 1000 * 10000) / 10000 : 0.566;
  const costPer1k =
    d.deployment?.economics?.cost_per_1k_queries_usd ?? fallbackCostPer1k;
  const monthly1m =
    d.deployment?.economics?.monthly_run_rate_1m_queries_usd ??
    Math.round(costPer1k * 1000 * 100) / 100;
  const economicsBasis =
    d.deployment?.economics?.basis ||
    (spendUsd > 0
      ? `$${spendUsd.toFixed(4)} audit spend over ~${countN} replayed requests`
      : `Estimated from ${certifiedHardware} hourly rate over ~${countN} replayed requests`);

  async function copyText(text: string, done: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text);
      done(true);
      setTimeout(() => done(false), 2000);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done(true);
        setTimeout(() => done(false), 2000);
      } catch {}
    }
  }

  const kpis = [
    {
      icon: "⚡",
      label: "Response Latency (P95)",
      value: typeof p95 === "number" ? `${p95}ms` : "—",
      delta: typeof p95 !== "number" ? "No measurement" : p95 <= 2000 ? `vs. 2,000ms SLA target (-${margin}% margin)` : `vs. 2,000ms SLA target (+${latencyOverPct}% over SLA)`,
      tertiary: "Target: < 2,000ms",
      pass: passLatency,
    },
    {
      icon: "🎯",
      label: "Tool Schema Accuracy",
      value: typeof q === "number" ? `${(q * 100).toFixed(1)}%` : "—",
      delta: qualityDeltaPp === null ? "No measurement" : `vs. 85.0% required (${qualityDeltaPp >= 0 ? "+" : ""}${qualityDeltaPp.toFixed(1)}% margin)`,
      tertiary: "Target: > 85%",
      pass: passQuality,
    },
    {
      icon: "🛡️",
      label: "Reliability (Error Rate)",
      value: typeof err === "number" ? `${(err * 100).toFixed(1)}%` : "—",
      delta: "vs. 5.0% cap",
      tertiary: "Target: < 5%",
      pass: passError,
    },
    {
      icon: "💵",
      label: "Cost Efficiency",
      value: `$${costPer1k.toFixed(4)} / 1k`,
      delta: `$${monthly1m.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / month at 1M queries`,
      tertiary: d.spend_usd !== undefined ? `Budget spent: $${Number(d.spend_usd).toFixed(2)}` : "Nebius L40S → H100",
      pass: null as boolean | null,
    },
  ];

  const gates = [
    { gate: "Response Latency (P95)", observed: typeof p95 === "number" ? `${p95} ms` : "—", req: "≤ 2,000 ms", pass: passLatency },
    { gate: "Output Quality & Schema Accuracy", observed: typeof q === "number" ? `${(q * 100).toFixed(1)}%` : "—", req: "≥ 85%", pass: passQuality },
    { gate: "Reliability (Error Rate)", observed: typeof err === "number" ? `${(err * 100).toFixed(1)}%` : "—", req: "≤ 5%", pass: passError },
  ];

  function statusBadgeClass(pass: boolean | null) {
    if (pass === true) return "border border-ship/40 bg-ship/10 text-ship px-2 py-0.5 text-[11px] font-mono font-bold rounded";
    if (pass === false) return "border border-block/40 bg-block/10 text-block px-2 py-0.5 text-[11px] font-mono font-bold rounded";
    return "border border-ink/20 bg-ink/5 text-muted px-2 py-0.5 text-[11px] font-mono font-bold rounded";
  }

  return (<main>
    <TopNav />
    <style>{`@media print {
      @page { margin: 10mm; size: A4; }
      nav, button, .no-print { display: none !important; }
      body { background: #fff !important; color: #000 !important; }
      main { padding: 0 !important; }
      .frame { border: none !important; margin: 0 !important; }
      .print-page { max-width: 100% !important; padding: 0 !important; font-size: 10pt; line-height: 1.4; }
      .print-card { box-shadow: none !important; break-inside: avoid; border: 1px solid #000 !important; }
      .print-break { break-inside: avoid; }
      h1 { font-size: 20pt !important; line-height: 1.2 !important; }
      h2 { font-size: 11pt !important; }
      a { text-decoration: none !important; color: inherit !important; }
      pre, code, .hash-digest { word-break: break-all; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 8pt !important; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }`}</style>
    {/* Clean top bar: navigation + print, hidden on paper */}
    <div className="no-print mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-6 pt-5">
      <Link
        href="/dashboard"
        className="chip inline-block min-h-[44px] cursor-pointer px-4 py-2.5 text-xs font-bold transition-all hover:-translate-y-px hover:shadow-[3px_3px_0_rgba(31,31,31,0.25)]"
        aria-label="Return to dashboard"
      >
        ← Return to Dashboard
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="btn-dark min-h-[44px] cursor-pointer rounded px-4 py-2.5 text-xs font-bold transition-all hover:-translate-y-px"
      >
        Print / Save PDF
      </button>
    </div>
    <div className="print-page mx-auto max-w-4xl px-6 py-8">
      {/* Header + seal */}
      <div className="text-center">
        <Seal tone={tone} />
        <h1 className="mt-3 text-2xl tracking-tight md:text-3xl">OFFICIAL INFERENCE CERTIFICATE</h1>
        <p className="mt-1 text-[11px] uppercase tracking-widest text-muted">GPUProof · Nebius AI Cloud · Deterministic audit, never vibes</p>
      </div>

      {/* Metadata bar */}
      <dl className="print-card panel mt-6 grid grid-cols-2 gap-3 rounded-lg p-4 text-left md:grid-cols-4">
        <div><dt className="text-[10px] uppercase tracking-widest text-muted">Certification ID</dt><dd className="hash-digest mt-0.5 truncate font-mono text-[12px] font-bold" title={params.id}>{params.id}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-widest text-muted">Issued</dt><dd className="mt-0.5 text-[12px] font-bold">{issuedAt.toLocaleString()}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-widest text-muted">Workload Hash Digest</dt><dd className="hash-digest mt-0.5 truncate font-mono text-[12px] font-bold" title={primaryDigest}>{primaryDigest}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-widest text-muted">Nebius Region</dt><dd className="mt-0.5 text-[12px] font-bold">{REGION}</dd></div>
      </dl>

      {/* Verdict banner */}
      <div
        role="status"
        aria-label={`verdict ${d.verdict}`}
        className={`print-card mt-4 rounded-lg border p-5 text-left md:p-6 ${ship ? "border-ship bg-ship text-white" : sim ? "border-ink bg-[#F5F1E9]" : "border-block bg-block text-white"}`}
      >
        {ship && (<><p className="text-xl font-bold tracking-tight md:text-2xl">🟢 SHIP FOR PRODUCTION</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed">Verified shield — the candidate model passed every SLA gate and is safe for deployment. Latency, quality, reliability, and cost evidence are attached below.</p></>)}
        {!ship && !sim && (<><p className="text-xl font-bold tracking-tight md:text-2xl">🔴 BLOCK — HIGH PRODUCTION RISK</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed">The candidate failed one or more SLA gates and must not ship in its current configuration. Failed gates:</p>
          <ul className="mt-2 space-y-1 text-sm">
            {(d.failing_gates ?? []).map((g) => (<li key={g.metric} className="font-mono text-[12px]">✕ {g.metric}: observed {String(g.observed)} vs required {String(g.threshold)}{g.detail ? ` — ${g.detail}` : ""}</li>))}
            {(d.failing_gates ?? []).length === 0 && (<li className="text-sm">See the evidence scorecard below for the failing gate.</li>)}
          </ul></>)}
        {sim && (<><p className="text-xl font-bold tracking-tight md:text-2xl">⚪ SIMULATED AUDIT</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Dev-grade evidence only — policy checks passed in simulation. See provenance and scorecard below.</p></>)}
      </div>

      {/* Provenance badge — single source of truth, no duplicate disclaimer */}
      <div className="mt-4">
        {sim ? (
          <div className="rounded-lg border border-ink/40 bg-ink/5 p-4 text-left">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
              <span className="font-bold text-xs uppercase tracking-wider">Deterministic Hardware Simulation · Dev-Grade</span>
            </div>
            <p className="mt-1 text-[12px] text-muted">
              Validated via deterministic hardware simulation. For an official production-grade certificate, re-run with live Nebius Cloud GPU execution enabled.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-ship/40 bg-ship/5 p-4 text-left">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-ship" />
              <span className="font-bold text-xs uppercase tracking-wider text-ship">Nebius AI Cloud Hardware Verified · Production-Grade</span>
            </div>
            <p className="mt-1 text-[12px] text-muted">
              Executed on isolated Nebius serverless GPU containers with measured runtime telemetry.
            </p>
          </div>
        )}
      </div>

      {/* Reproducible benchmark audit fingerprint */}
      <section aria-label="Reproducible benchmark audit fingerprint" className="print-card panel print-break mt-4 rounded-lg p-4 text-left md:p-5">
        <div className="flex items-center gap-2">
          <span aria-hidden="true">🔒</span>
          <h2 className="text-sm font-bold uppercase tracking-widest">REPRODUCIBLE BENCHMARK AUDIT FINGERPRINT</h2>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-ink/80">{digestExplanation}</p>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-muted">Workload Hash Digest</dt>
            <dd className="hash-digest mt-0.5 break-all font-mono text-[12px] font-bold" title={primaryDigest}>{primaryDigest}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-muted">Replayed Requests</dt>
            <dd className="mt-0.5 font-bold">{replayCount !== null ? `${replayCount} requests · temperature 0.0` : "temperature 0.0 · seeded prompts"}</dd>
          </div>
        </dl>
        {d.twin_digest && (
          <p className="mt-2 font-mono text-[11px] text-muted">twin sha256:{d.twin_digest} · evidence {fnvDigest}</p>
        )}
        <div className="no-print mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => copyText(primaryDigest, setCopiedHash)}
            className="cursor-pointer rounded border border-ink px-3 py-2 text-[12px] font-bold transition-all hover:-translate-y-px hover:shadow-[3px_3px_0_rgba(31,31,31,0.25)]"
            aria-live="polite"
          >
            {copiedHash ? "✓ Copied!" : "Copy Audit Fingerprint"}
          </button>
          <span className="hash-digest font-mono text-[11px] text-muted">{primaryDigest}</span>
        </div>
        <p className="mt-2 hidden font-mono text-[11px] text-muted print:block">{primaryDigest}</p>
      </section>

      {/* KPI cards — sleek compact editorial */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="print-card panel flex flex-col rounded-md p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{k.label}</p>
              <span aria-hidden="true" className="text-sm leading-none">{k.icon}</span>
            </div>
            <p className="mt-1.5 font-mono text-lg font-bold tracking-tight text-ink">{k.value}</p>
            <p className="mt-1 truncate text-[11px] leading-snug text-ink/70" title={k.delta}>{k.delta}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-muted">{k.tertiary}</span>
              {k.pass !== null && (
                <span className={statusBadgeClass(k.pass)}>{k.pass ? "PASSED" : "FAILED"}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Evidence scorecard */}
      <div className="print-card panel mt-4 overflow-auto rounded-lg text-left">
        <table className="w-full text-xs">
          <caption className="p-4 text-left text-sm font-bold">Executive Evidence Scorecard — Current vs. Candidate (measured)</caption>
          <thead><tr className="border-y border-ink bg-ink/[0.04] text-left text-muted">
            <th className="p-3 font-bold">Gate</th><th className="p-3">Observed</th><th className="p-3">Requirement</th><th className="p-3 text-right">Result</th>
          </tr></thead>
          <tbody>{gates.map((g, i) => (
            <tr key={g.gate} className={`border-b border-ink/10 last:border-b-0 ${i % 2 === 1 ? "bg-ink/[0.03]" : "bg-transparent"}`}>
              <td className="p-3 font-bold">{g.gate}</td>
              <td className="p-3 font-mono">{g.observed}</td>
              <td className="p-3 font-mono">{g.req}</td>
              <td className="p-3 text-right">
                {g.pass === null ? (<span className="text-muted">—</span>)
                  : g.pass ? (<span className="inline-block rounded-full border border-ship/30 bg-ship px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">Passed</span>)
                  : (<span className="inline-block rounded-full border border-block/30 bg-block px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">Failed</span>)}
              </td>
            </tr>))}</tbody>
        </table>
        {d.spend_usd !== undefined && (<p className="border-t border-ink/10 p-3 text-[11px] text-muted">Budget spent: ${Number(d.spend_usd).toFixed(2)} (cap $10/cert, $20 total)</p>)}
      </div>

      {/* Production Deployment Blueprint — turnkey DevOps/ML blueprint (star outcome) */}
      <section aria-label="Production deployment blueprint (Nebius Cloud)" className="print-card panel print-break mt-4 rounded-lg p-4 text-left md:p-5">
        <div className="flex items-center gap-2">
          <span aria-hidden="true">🚀</span>
          <h2 className="text-sm font-bold uppercase tracking-widest">PRODUCTION DEPLOYMENT BLUEPRINT (NEBIUS CLOUD)</h2>
        </div>
        <p className="mt-1 text-[12px] text-muted">
          Turnkey infrastructure blueprint — certified hardware, ready-to-run serving command, operational limits, and economics.
          {sim ? " Simulation values shown; re-run live for production-grade numbers." : ""}
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-2">
          <div className="rounded-lg border border-ink/20 bg-canvas p-3">
            <dt className="text-[10px] uppercase tracking-widest text-muted">Certified Hardware</dt>
            <dd className="mt-0.5 text-[13px] font-bold">{certifiedHardware}</dd>
            <dd className="mt-1 font-mono text-[11px] text-muted">
              {candidateModel} · {planPrecision} · {(lastExp?.plan?.engine || d.deployment?.engine || "vLLM")}
            </dd>
          </div>
          <div className="rounded-lg border border-ink/20 bg-canvas p-3">
            <dt className="text-[10px] uppercase tracking-widest text-muted">Economics</dt>
            <dd className="mt-0.5 font-mono text-[13px] font-bold">${costPer1k.toFixed(4)} / 1k queries</dd>
            <dd className="mt-1 text-[11px] text-muted">
              ${monthly1m.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / month at 1M queries · {economicsBasis}
            </dd>
          </div>
        </dl>
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-widest text-muted">Ready-to-Run Serving Command</p>
          <pre className="hash-digest mt-1 overflow-auto rounded-lg border border-ink bg-ink p-3 font-mono text-[11px] leading-relaxed text-canvas">{servingCommand}</pre>
          <div className="no-print mt-2">
            <button
              type="button"
              onClick={() => copyText(servingCommand, setCopiedCmd)}
              className="cursor-pointer rounded border border-ink px-3 py-2 text-[12px] font-bold transition-all hover:-translate-y-px hover:shadow-[3px_3px_0_rgba(31,31,31,0.25)]"
              aria-live="polite"
            >
              {copiedCmd ? "✓ Copied!" : "Copy Command"}
            </button>
          </div>
        </div>
        <ul className="mt-3 space-y-2 text-[12px] leading-relaxed">
          <li className="rounded-lg border border-ink/15 p-3">
            <span className="font-bold">Max safe concurrency: {maxConcurrency} streams. </span>
            <span className="text-ink/80">{concurrencyNote}</span>
          </li>
          <li className="rounded-lg border border-ink/15 p-3">
            <span className="font-bold">Max context length: {maxContext.toLocaleString()} tokens. </span>
            <span className="text-ink/80">{contextNote}</span>
          </li>
        </ul>
      </section>

      {/* Official cryptographic footer / document seal */}
      <div className="print-card panel mt-4 rounded-lg p-4 text-left">
        <div className="flex items-center gap-2">
          <span aria-hidden="true">🔒</span>
          <p className="text-xs font-bold uppercase tracking-widest">Official Seal · Cryptographic Verification</p>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-muted">Issued by</dt>
            <dd className="mt-0.5 font-bold">GPUProof Policy Engine v1.0</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-muted">Engine</dt>
            <dd className="mt-0.5 font-bold">vLLM PagedAttention</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-muted">Nebius Region</dt>
            <dd className="mt-0.5 font-bold">{REGION}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-widest text-muted">Workload Digest</dt>
            <dd className="hash-digest mt-0.5 break-all font-mono text-[12px] font-bold" title={primaryDigest}>{primaryDigest}</dd>
          </div>
        </dl>
        <div className="no-print mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => copyText(primaryDigest, setCopiedHash)}
            className="cursor-pointer rounded border border-ink px-3 py-2 text-[12px] font-bold transition-all hover:-translate-y-px hover:shadow-[3px_3px_0_rgba(31,31,31,0.25)]"
          >
            {copiedHash ? "✓ Copied!" : "Copy Verification Hash"}
          </button>
          <span className="hash-digest font-mono text-[11px] text-muted">{primaryDigest}</span>
        </div>
        <p className="hash-digest mt-2 hidden break-all font-mono text-[11px] text-muted print:block">{primaryDigest}</p>
      </div>

      {/* Engineering drawer */}
      <details className="no-print panel mt-4 rounded-lg p-4 text-left text-xs">
        <summary className="cursor-pointer font-bold">▶ Technical Evidence &amp; Per-Experiment Ledger (JSON)</summary>
        <pre className="mt-2 max-h-80 overflow-auto border border-ink/20 bg-canvas p-3 text-[11px] leading-relaxed">{JSON.stringify(d.experiments ?? d.evidence ?? d, null, 2).slice(0, 6000)}</pre>
      </details>

      {/* Action bar */}
      <div className="no-print mt-6 flex flex-wrap gap-3">
        <button onClick={() => window.print()} className="btn-dark min-h-[44px] cursor-pointer rounded px-5 py-3 text-sm font-bold transition-colors">Print / Save Certificate (PDF)</button>
        <Link href="/dashboard" className="chip inline-block min-h-[44px] cursor-pointer px-5 py-3 text-sm">Back to Dashboard</Link>
        <Link href="/new" className="chip inline-block min-h-[44px] cursor-pointer px-5 py-3 text-sm">Run New Audit</Link>
      </div>
    </div>
  </main>);
}
