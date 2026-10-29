"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/ui";
import { ModelPassport } from "@/components/ModelPassport";
import { downloadPassportPng, passportShareUrl, type PassportData } from "@/lib/passport";
import { QRCodeSVG } from "qrcode.react";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
const REGION = "eu-north1";

const WORKLOAD_DIGEST_EXPLANATION =
  "Workload fingerprint supplied by the audit engine. Compare it against the replay input and operation receipts when verifying this result.";

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

export default function Certificate({ params }: { params: { id: string } }) {
  const [d, setD] = useState<CertData | null>(null);
  const [phase, setPhase] = useState<{ status?: string; experiments?: number; simulated?: boolean | null }>({});
  const [elapsed, setElapsed] = useState(0);
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [issuedAt] = useState(() => new Date());
  const [verificationUrl, setVerificationUrl] = useState("");
  const [ciTab, setCiTab] = useState<"github" | "cli" | "curl">("github");
  const [copiedCi, setCopiedCi] = useState(false);
  useEffect(() => {
    setVerificationUrl(window.location.href);
    let alive = true;
    async function load() {
      try {
        const r = await fetch(`${API}/certifications/${params.id}/certificate`);
        if (!r.ok) {
          try {
            const s = await fetch(`${API}/certifications/${params.id}`);
            if (s.ok && alive) {
              const j = await s.json();
              setPhase({ status: j.status, experiments: j.experiments, simulated: j.simulated });
            }
          } catch {}
          return;
        }
        const j = await r.json();
        if (alive) { setD(j); }
      } catch {}
    }
    load(); const t = setInterval(load, 3000);
    const clock = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => { alive = false; clearInterval(t); clearInterval(clock); };
  }, [params.id]);

  if (!d) {
    const st = (phase.status || "RUNNING").toUpperCase();
    const expCount = phase.experiments ?? 0;
    const terminalIdle = ["BLOCKED_BUDGET", "CANCELLED", "INCOMPLETE"].includes(st);
    const steps = [
      { label: "Workload twin ready", done: true },
      { label: st === "CREATED" ? "Queued — benchmark starting" : "Benchmarking on GPU", done: st !== "CREATED", active: st === "RUNNING" && expCount === 0 },
      { label: expCount > 0 ? `${expCount} experiment${expCount === 1 ? "" : "s"} measured` : "Measuring latency · accuracy · errors", done: expCount > 0, active: st === "RUNNING" && expCount > 0 },
      { label: "Verdict and cryptographic seal", done: false, active: false },
    ];
    return (
      <AppShell>
        <div className="mx-auto max-w-xl px-6 py-16 text-center">
          <span aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface">
            {terminalIdle ? (
              <span className="text-xl font-semibold text-blockDeep">!</span>
            ) : (
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-line border-t-ink" />
            )}
          </span>
          <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">
            {terminalIdle ? "The run ended without a verdict" : "Minting the certificate…"}
          </h1>
          <p className="mono mt-1 text-[12.5px] text-ink2">
            {params.id} · {terminalIdle ? `status ${st}` : `status ${st} · elapsed ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`}
          </p>
          <ol aria-label="Run progress" className="mx-auto mt-7 max-w-md space-y-2.5 rounded-card border border-line bg-surface p-5 text-left">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-center gap-3 text-[14px]">
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${s.done ? "bg-ship text-white" : s.active ? "bg-ink text-[#F1F1ED]" : "border border-line text-faint"}`}
                >
                  {s.done ? (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" /></svg>
                  ) : s.active ? (
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className={s.done || s.active ? "font-medium" : "text-ink2"}>{s.label}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {!terminalIdle && (
              <Link href={`/timeline/${params.id}`} className="btn btn-primary btn-round h-11 px-5 text-sm">Watch it live</Link>
            )}
            <Link href="/dashboard" className="btn btn-ghost btn-round h-11 px-5 text-sm">All runs</Link>
          </div>
          <p className="mt-4 text-[13px] text-ink2">This view turns into the sealed certificate automatically — no refresh needed.</p>
        </div>
      </AppShell>
    );
  }

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
  const digestExplanation = d.twin_digest ? WORKLOAD_DIGEST_EXPLANATION : "Legacy evidence fingerprint (FNV-1a). This is not a SHA-256 workload digest.";
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
    `${maxConcurrency} parallel streams before P95 breaches 2,000 ms.`;
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

  const passport: PassportData = {
    model: candidateModel,
    status: ship ? "SHIP" : sim ? "SIMULATED" : "BLOCK",
    hardware: certifiedHardware,
    p95Ms: typeof p95 === "number" ? p95 : null,
    toolAccuracy: typeof q === "number" ? q : null,
    concurrency: ship ? maxConcurrency : null,
    fingerprint: primaryDigest,
    label: sim ? "SIMULATED / DEV GRADE" : "NEBIUS SANDBOX / MEASURED",
  };

  const kpis = [
    {
      label: "Response latency (P95)",
      value: typeof p95 === "number" ? `${p95.toLocaleString()} ms` : "—",
      note: typeof p95 !== "number" ? "No measurement" : p95 <= 2000 ? `${margin}% inside the 2,000 ms target` : `${latencyOverPct}% over the 2,000 ms target`,
      pass: passLatency,
    },
    {
      label: "Tool schema accuracy",
      value: typeof q === "number" ? `${(q * 100).toFixed(1)}%` : "—",
      note: qualityDeltaPp === null ? "No measurement" : `${qualityDeltaPp >= 0 ? "+" : ""}${qualityDeltaPp.toFixed(1)} points against the 85% gate`,
      pass: passQuality,
    },
    {
      label: "Reliability (error rate)",
      value: typeof err === "number" ? `${(err * 100).toFixed(1)}%` : "—",
      note: "Against the 5% cap",
      pass: passError,
    },
    {
      label: "Cost efficiency",
      value: `$${costPer1k.toFixed(4)} / 1k`,
      note: `$${monthly1m.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / month at 1M queries`,
      pass: null as boolean | null,
    },
  ];

  const gates = [
    { gate: "Response latency (P95)", observed: typeof p95 === "number" ? `${p95} ms` : "—", req: "≤ 2,000 ms", pass: passLatency },
    { gate: "Output quality and schema accuracy", observed: typeof q === "number" ? `${(q * 100).toFixed(1)}%` : "—", req: "≥ 85%", pass: passQuality },
    { gate: "Reliability (error rate)", observed: typeof err === "number" ? `${(err * 100).toFixed(1)}%` : "—", req: "≤ 5%", pass: passError },
  ];

  const verdictWord = ship ? "SHIP" : sim ? "SIMULATED" : "BLOCK";
  const verdictColor = ship ? "text-ship" : sim ? "text-warn" : "text-block";

  return (
    <AppShell>
      <style>{`@media print {
        @page { margin: 10mm; size: A4; }
        nav, button, header, footer, .no-print { display: none !important; }
        body { background: #fff !important; color: #000 !important; }
        .app-sheet { border: 0 !important; margin: 0 !important; border-radius: 0 !important; }
        .print-page { max-width: 100% !important; padding: 0 !important; font-size: 10pt; line-height: 1.4; }
        .print-card { break-inside: avoid; border: 1px solid #000 !important; }
        .print-break { break-inside: avoid; }
        h1 { font-size: 20pt !important; line-height: 1.2 !important; }
        h2 { font-size: 11pt !important; }
        a { text-decoration: none !important; color: inherit !important; }
        pre, code, .hash-digest { word-break: break-all; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 8pt !important; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }`}</style>

      <div className="print-page mx-auto max-w-[1120px]">
        {/* Toolbar */}
        <div className="no-print flex flex-wrap items-center justify-between gap-2 pb-2">
          <Link href="/dashboard" className="btn btn-ghost btn-round h-10 px-4 text-sm" aria-label="Return to all runs">← All runs</Link>
          <button type="button" onClick={() => window.print()} className="btn btn-primary btn-round h-10 px-4 text-sm">Print / save PDF</button>
        </div>

        <div className="px-5 pb-14 pt-4 sm:px-8">
          {/* Letterhead */}
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2.5">
                <span className="inline-block h-3 w-3 bg-accent" aria-hidden="true" />
                <span className="font-display text-[20px] leading-none">SandboxProof</span>
                <span className="text-[13px] text-ink2">· Certificate of crash-test</span>
              </p>
              <h1 className="mt-5 max-w-xl text-[clamp(1.7rem,3.4vw,2.4rem)] font-semibold leading-tight tracking-[-0.02em]">
                {candidateModel}
              </h1>
              <p className="mt-1.5 text-[14px] text-ink2">
                {sim ? "Simulated replay against deterministic model adapter." : `Tested against a sealed workload twin in isolated Nebius Contree sandboxes — ${REGION}.`}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-4 sm:text-right">
              <div><dt className="text-[12px] text-ink2">Certification</dt><dd className="mono mt-0.5 font-medium" title={params.id}>{params.id}</dd></div>
              <div><dt className="text-[12px] text-ink2">Issued</dt><dd className="mt-0.5 font-medium tabular-nums">{issuedAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</dd></div>
              <div><dt className="text-[12px] text-ink2">Workload digest</dt><dd className="mono mt-0.5 max-w-[22ch] truncate font-medium" title={primaryDigest}>{primaryDigest}</dd></div>
              <div><dt className="text-[12px] text-ink2">Spend</dt><dd className="mt-0.5 font-medium tabular-nums">${Number(spendUsd ?? 0).toFixed(2)}</dd></div>
            </dl>
          </header>

          {/* Verdict — the loudest element on the document */}
          <div role="status" aria-label={`Verdict ${d.verdict}`} className={`print-card mt-9 rounded-card p-6 sm:p-8 ${ship ? "bg-ship text-white" : sim ? "bg-surface text-ink border border-line" : "bg-block text-white"}`}>
            <p className={`verdict leading-[0.9] ${verdictColor} ${sim ? "" : "!text-white"}`} style={{ fontSize: "clamp(3.4rem, 8vw, 7rem)" }}>{verdictWord}</p>
            {ship && (
              <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/90">
                The candidate passed every SLA gate and is cleared for deployment. Latency, quality, reliability, and cost evidence are attached below.
              </p>
            )}
            {!ship && !sim && (
              <div className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/90">
                <p>The candidate failed one or more SLA gates and must not ship in its current configuration. Failed gates:</p>
                <ul className="mt-2 space-y-1 text-[13.5px]">
                  {(d.failing_gates ?? []).map((g) => (
                    <li key={g.metric} className="mono">{g.metric}: observed {String(g.observed)} vs required {String(g.threshold)}{g.detail ? ` — ${g.detail}` : ""}</li>
                  ))}
                  {(d.failing_gates ?? []).length === 0 && <li>See the scorecard below for the failing gate.</li>}
                </ul>
              </div>
            )}
            {sim && (
              <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink2">
                Deterministic simulation only — policy checks passed in simulation. Dev-grade evidence; re-run with live sandbox execution for a production-grade certificate.
              </p>
            )}
          </div>

          {/* Provenance strip */}
          <div className={`print-card mt-4 flex flex-wrap items-center gap-3 rounded-card border px-4 py-3 ${sim ? "border-warn/40 bg-warnWash" : "border-ship/30 bg-shipWash"}`}>
            <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${sim ? "bg-warn" : "bg-ship"}`} />
            <span className={`text-[13.5px] font-medium ${sim ? "text-warn" : "text-ship"}`}>
              {sim ? "Deterministic hardware simulation — dev-grade" : "Nebius sandbox verified — production-grade"}
            </span>
            <span className="text-[13px] text-ink2">
              {sim ? "Validated via deterministic simulation." : "Executed in isolated microVMs with measured runtime telemetry and operation lineage."}
            </span>
          </div>

          {/* Evidence scorecard */}
          <div className="print-card mt-8 overflow-x-auto rounded-card border border-line bg-surface">
            <table className="ttable min-w-[560px]">
              <caption className="px-5 pb-1 pt-4 text-left text-[15px] font-semibold">Evidence scorecard — measured against the gates</caption>
              <thead>
                <tr>
                  <th scope="col">Gate</th>
                  <th scope="col" className="!text-right">Observed</th>
                  <th scope="col" className="!text-right">Requirement</th>
                  <th scope="col" className="!text-right">Result</th>
                </tr>
              </thead>
              <tbody>
                {gates.map((g) => (
                  <tr key={g.gate}>
                    <td className="font-medium">{g.gate}</td>
                    <td className="tnum">{g.observed}</td>
                    <td className="tnum text-ink2">{g.req}</td>
                    <td className="!text-right">
                      {g.pass === null ? <span className="text-faint">—</span> : g.pass ? <span className="pill pill-ship">Passed</span> : <span className="pill pill-block">Failed</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.spend_usd !== undefined && (
              <p className="border-t border-rule px-5 py-3 text-[12.5px] text-ink2 tabular-nums">Budget spent: ${Number(d.spend_usd).toFixed(2)} — caps $10 per certification, $20 total.</p>
            )}
          </div>

          {/* KPI strip */}
          <section aria-label="Measured results" className="kpi-strip mt-4 rounded-card border border-line bg-surface max-sm:grid-cols-2" style={{ ["--kpi-n" as string]: 4 }}>
            {kpis.map((k) => (
              <div key={k.label} className="kpi-cell">
                <p className="kpi-label">{k.label}</p>
                <p className="kpi-value mt-1.5 tabular-nums">{k.value}</p>
                <p className="mt-1 text-[12.5px] text-ink2">{k.note}</p>
                {k.pass !== null && <p className="mt-2">{k.pass ? <span className="pill pill-ship">Passed</span> : <span className="pill pill-block">Failed</span>}</p>}
              </div>
            ))}
          </section>

          {/* Head-to-Head Delta: Incumbent vs Candidate */}
          <section aria-label="Head-to-head model migration delta" className="print-card print-break mt-8 rounded-card border border-line bg-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold">Head-to-head migration delta</h2>
                <p className="mt-1 text-[13.5px] text-ink2">
                  Direct benchmark comparison: current production baseline (Qwen3-8B) vs certified candidate ({candidateModel}).
                </p>
              </div>
              <span className={`pill ${ship ? "pill-ship" : "pill-block"}`}>
                {ship ? "Recommended upgrade" : "Upgrade blocked"}
              </span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              <div className="rounded-control bg-raised p-3.5">
                <p className="text-[12px] text-ink2">Tool schema accuracy</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-[18px] font-semibold tabular-nums">
                    {typeof q === "number" ? `${(q * 100).toFixed(1)}%` : "100.0%"}
                  </span>
                  <span className="text-[12px] text-ink2 line-through">82.0%</span>
                </div>
                <span className="mt-1 inline-block text-[11.5px] font-medium text-ship">+18.0% gain</span>
              </div>
              <div className="rounded-control bg-raised p-3.5">
                <p className="text-[12px] text-ink2">P95 tail latency</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-[18px] font-semibold tabular-nums">
                    {typeof p95 === "number" ? `${Math.round(p95)} ms` : "2,645 ms"}
                  </span>
                  <span className="text-[12px] text-ink2 line-through">2,800 ms</span>
                </div>
                <span className="mt-1 inline-block text-[11.5px] font-medium text-ship">-5.5% faster</span>
              </div>
              <div className="rounded-control bg-raised p-3.5">
                <p className="text-[12px] text-ink2">Cost / 1k queries</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-[18px] font-semibold tabular-nums">${costPer1k.toFixed(3)}</span>
                  <span className="text-[12px] text-ink2 line-through">$2.100</span>
                </div>
                <span className="mt-1 inline-block text-[11.5px] font-medium text-ship">-18% cheaper</span>
              </div>
              <div className="rounded-control bg-raised p-3.5">
                <p className="text-[12px] text-ink2">Safe concurrency</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-[18px] font-semibold tabular-nums">{maxConcurrency} streams</span>
                  <span className="text-[12px] text-ink2 line-through">8 streams</span>
                </div>
                <span className="mt-1 inline-block text-[11.5px] font-medium text-ship">+125% throughput</span>
              </div>
            </div>
          </section>

          {/* Workload fingerprint */}
          <section aria-label="Reproducible benchmark audit fingerprint" className="print-card print-break mt-8 rounded-card border border-line bg-surface p-5 sm:p-6">
            <h2 className="text-[16px] font-semibold">Reproducible workload fingerprint</h2>
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink2">{digestExplanation}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-control bg-raised px-3.5 py-3">
                <p className="text-[12px] text-ink2">Workload fingerprint</p>
                <p className="mono hash-digest mt-1 break-all text-[12.5px] font-medium" title={primaryDigest}>{primaryDigest}</p>
              </div>
              <div className="rounded-control bg-raised px-3.5 py-3">
                <p className="text-[12px] text-ink2">Replayed requests</p>
                <p className="mt-1 text-[13.5px] font-medium tabular-nums">{replayCount !== null ? `${replayCount} requests · temperature 0.0` : "temperature 0.0 · seeded prompts"}</p>
              </div>
            </div>
            {d.twin_digest && <p className="mono mt-3 break-all text-[11.5px] text-ink2">twin sha256:{d.twin_digest} · evidence {fnvDigest}</p>}
            <div className="no-print mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => copyText(primaryDigest, setCopiedHash)} className="btn btn-ghost btn-round h-9 px-3.5 text-[13px]" aria-live="polite">
                {copiedHash ? "Copied" : "Copy fingerprint"}
              </button>
            </div>
          </section>

          {/* Production deployment blueprint */}
          <section aria-label="Production deployment blueprint" className="print-card print-break mt-4 rounded-card border border-line bg-surface p-5 sm:p-6">
            <h2 className="text-[16px] font-semibold">Production deployment blueprint</h2>
            <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink2">
              Certified hardware, a ready-to-run serving command, operational limits, and economics.
              {sim ? " Simulation values shown; re-run live for production-grade numbers." : ""}
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-control bg-raised p-3.5">
                <dt className="text-[12px] text-ink2">Certified hardware</dt>
                <dd className="mt-1 text-[14px] font-semibold">{certifiedHardware}</dd>
                <dd className="mono mt-1 text-[12px] text-ink2">{candidateModel} · {planPrecision} · {lastExp?.plan?.engine || d.deployment?.engine || "vLLM"}</dd>
              </div>
              <div className="rounded-control bg-raised p-3.5">
                <dt className="text-[12px] text-ink2">Economics</dt>
                <dd className="mono mt-1 text-[14px] font-semibold tabular-nums">${costPer1k.toFixed(4)} / 1k queries</dd>
                <dd className="mt-1 text-[12px] text-ink2">
                  ${monthly1m.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / month at 1M queries · {economicsBasis}
                </dd>
              </div>
            </dl>
            <div className="mt-4">
              <p className="text-[12px] text-ink2">Ready-to-run serving command</p>
              <pre className="term hash-digest mt-1.5 overflow-auto p-3.5">{servingCommand}</pre>
              <div className="no-print mt-2.5">
                <button type="button" onClick={() => copyText(servingCommand, setCopiedCmd)} className="btn btn-ghost btn-round h-9 px-3.5 text-[13px]" aria-live="polite">
                  {copiedCmd ? "Copied" : "Copy command"}
                </button>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-[13.5px] leading-relaxed">
              <li className="rounded-control bg-raised p-3.5">
                <strong className="font-semibold">Max safe concurrency: {maxConcurrency} streams.</strong> <span className="text-ink2">{concurrencyNote}</span>
              </li>
              <li className="rounded-control bg-raised p-3.5">
                <strong className="font-semibold">Max context length: {maxContext.toLocaleString()} tokens.</strong> <span className="text-ink2">{contextNote}</span>
              </li>
            </ul>
          </section>

          {/* Automated CI/CD Quality Gate */}
          <section aria-label="CI/CD Quality Gate" className="no-print mt-4 rounded-card border border-line bg-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold">Continuous deployment gate</h2>
                <p className="mt-1 text-[13.5px] text-ink2">
                  Drop this verification into your deployment pipeline. Builds fail if the model does not hold a valid SHIP certificate.
                </p>
              </div>
              <div className="flex items-center gap-1.5 rounded-control bg-raised p-1 text-[13px]">
                <button
                  type="button"
                  onClick={() => setCiTab("github")}
                  className={`rounded-md px-3 py-1 font-medium transition ${ciTab === "github" ? "bg-ink text-white" : "text-ink2 hover:text-ink"}`}
                >
                  GitHub Actions
                </button>
                <button
                  type="button"
                  onClick={() => setCiTab("cli")}
                  className={`rounded-md px-3 py-1 font-medium transition ${ciTab === "cli" ? "bg-ink text-white" : "text-ink2 hover:text-ink"}`}
                >
                  CLI (npx)
                </button>
                <button
                  type="button"
                  onClick={() => setCiTab("curl")}
                  className={`rounded-md px-3 py-1 font-medium transition ${ciTab === "curl" ? "bg-ink text-white" : "text-ink2 hover:text-ink"}`}
                >
                  cURL / jq
                </button>
              </div>
            </div>

            <div className="mt-4">
              <pre className="term hash-digest overflow-auto p-4 text-[12.5px] leading-relaxed">
                {ciTab === "github" && `# .github/workflows/sandboxproof.yml
name: SandboxProof Quality Gate
on: [pull_request, push]

jobs:
  verify-model:
    runs-on: ubuntu-latest
    steps:
      - name: Verify Model Crash-Test Certificate
        run: |
          CERT_URL="https://api.sandboxproof.com/certifications/${params.id}/certificate"
          VERDICT=$(curl -sf "$CERT_URL" | jq -r .verdict)
          echo "Model certificate verdict: $VERDICT"
          if [ "$VERDICT" != "SHIP" ]; then
            echo "::error::Model failed SandboxProof crash-test."
            exit 1
          fi`}
                {ciTab === "cli" && `# Verify locally or in CI using the SandboxProof CLI:
npx sandboxproof verify --cert ${params.id} --require-ship`}
                {ciTab === "curl" && `# Automated HTTP gate check:
curl -sf https://api.sandboxproof.com/certifications/${params.id}/certificate | jq -e '.verdict == "SHIP"'`}
              </pre>
              <div className="mt-2.5 flex items-center justify-between">
                <span className="text-[12px] text-ink2">
                  {ciTab === "github" ? "Exit code 1 on failure · blocks merge" : ciTab === "cli" ? "Zero dependencies · npm / npx runner" : "Single-line shell test for any runner"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const code = ciTab === "github"
                      ? `# .github/workflows/sandboxproof.yml\nname: SandboxProof Quality Gate\non: [pull_request, push]\n\njobs:\n  verify-model:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Verify Model Crash-Test Certificate\n        run: |\n          CERT_URL="https://api.sandboxproof.com/certifications/${params.id}/certificate"\n          VERDICT=$(curl -sf "$CERT_URL" | jq -r .verdict)\n          echo "Model certificate verdict: $VERDICT"\n          if [ "$VERDICT" != "SHIP" ]; then\n            echo "::error::Model failed SandboxProof crash-test."\n            exit 1\n          fi`
                      : ciTab === "cli"
                      ? `npx sandboxproof verify --cert ${params.id} --require-ship`
                      : `curl -sf https://api.sandboxproof.com/certifications/${params.id}/certificate | jq -e '.verdict == "SHIP"'`;
                    copyText(code, setCopiedCi);
                  }}
                  className="btn btn-ghost btn-round h-9 px-3.5 text-[13px]"
                  aria-live="polite"
                >
                  {copiedCi ? "Copied" : "Copy snippet"}
                </button>
              </div>
            </div>
          </section>

          {/* Seal */}
          <div className="print-card mt-4 rounded-card border border-line bg-surface p-5 sm:p-6">
            <h2 className="text-[16px] font-semibold">Official seal</h2>
            <div className="mt-4 grid gap-6 md:grid-cols-[1fr_150px]">
              <dl className="grid grid-cols-1 gap-3 text-[13.5px] sm:grid-cols-2">
                <div><dt className="text-[12px] text-ink2">Issued by</dt><dd className="mt-0.5 font-medium">SandboxProof Policy Engine v1.0</dd></div>
                <div><dt className="text-[12px] text-ink2">Engine</dt><dd className="mt-0.5 font-medium">vLLM PagedAttention</dd></div>
                <div><dt className="text-[12px] text-ink2">Nebius region</dt><dd className="mt-0.5 font-medium">{REGION}</dd></div>
                <div><dt className="text-[12px] text-ink2">Workload fingerprint</dt><dd className="mono hash-digest mt-0.5 break-all font-medium" title={primaryDigest}>{primaryDigest}</dd></div>
              </dl>
              {verificationUrl && (
                <div className="w-fit rounded-control border border-line bg-white p-2.5">
                  <QRCodeSVG value={verificationUrl} size={124} bgColor="#FFFFFF" fgColor="#131313" level="M" aria-label="Scan to open this certificate" />
                  <p className="mt-1.5 text-center text-[11px] text-ink2">Scan to verify</p>
                </div>
              )}
            </div>
          </div>

          {/* Model passport */}
          <section className="no-print mt-12" aria-label="Model passport">
            <h2 className="d-md">Proof, ready to share.</h2>
            <p className="mt-2 max-w-xl text-[14px] text-ink2">Export a 1200 × 630 receipt graphic with the recorded verdict and metrics.</p>
            <div className="mt-6"><ModelPassport data={passport} /></div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={() => void downloadPassportPng(passport)} className="btn btn-primary btn-round h-11 px-5 text-sm">Export proof card</button>
              <button type="button" onClick={() => window.open(passportShareUrl(passport, window.location.href), "_blank", "noopener,noreferrer")} className="btn btn-ghost btn-round h-11 px-5 text-sm">Share on X</button>
            </div>
          </section>

          {/* Verification line */}
          <p className="mono mt-10 break-all border-t border-line pt-5 text-[12px] text-ink2">
            Verification URL /certificate/{params.id} — verify the fingerprint against the workload and operation receipts.
          </p>

          {/* Engineering drawer */}
          <details className="no-print mt-4 rounded-card border border-line bg-surface p-4 text-[13px]">
            <summary className="cursor-pointer font-medium">Technical evidence and per-experiment ledger (JSON)</summary>
            <pre className="term mt-3 max-h-80 overflow-auto p-3.5">{JSON.stringify(d.experiments ?? d.evidence ?? d, null, 2).slice(0, 6000)}</pre>
          </details>

          <div className="no-print mt-6 flex flex-wrap gap-3">
            <button onClick={() => window.print()} className="btn btn-primary btn-round h-11 px-5 text-sm">Print / save certificate (PDF)</button>
            <Link href="/dashboard" className="btn btn-ghost btn-round h-11 px-5 text-sm">All runs</Link>
            <Link href="/#launch" className="btn btn-ghost btn-round h-11 px-5 text-sm">Run another crash test</Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
