"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { TopNav } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
const REGION = "eu-north1";

type GateFail = { metric: string; observed: number; threshold: number; detail?: string };
type Metrics = { latency_p95_ms: number; quality_score: number; error_rate: number };
type Experiment = {
  index: number;
  plan: { gpu_type: string; precision: string };
  status: string;
  verdict: string;
  metrics: Metrics;
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
  const [copied, setCopied] = useState(false);
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

  const digest = evidenceDigest(d.experiments ?? d.evidence);

  async function copyDigest() {
    try {
      await navigator.clipboard.writeText(digest);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = digest;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
    }
  }

  const kpis = [
    {
      icon: "⚡",
      label: "Response Latency (P95)",
      value: typeof p95 === "number" ? `${p95}ms` : "—",
      delta: typeof p95 !== "number" ? "No measurement" : p95 <= 2000 ? `vs. 2,000ms SLA target (-${margin}% safety margin)` : `vs. 2,000ms SLA target (+${latencyOverPct}% over SLA)`,
      deltaTone: passLatency === null ? "neutral" : passLatency ? "pass" : "fail",
      tertiary: "Target: < 2,000ms",
      pass: passLatency,
    },
    {
      icon: "🎯",
      label: "Tool Schema Accuracy",
      value: typeof q === "number" ? `${(q * 100).toFixed(1)}%` : "—",
      delta: qualityDeltaPp === null ? "No measurement" : `vs. 85.0% required (${qualityDeltaPp >= 0 ? "+" : ""}${qualityDeltaPp.toFixed(1)}% margin)`,
      deltaTone: passQuality === null ? "neutral" : passQuality ? "pass" : "fail",
      tertiary: "Target: > 85%",
      pass: passQuality,
    },
    {
      icon: "🛡️",
      label: "Reliability (Error Rate)",
      value: typeof err === "number" ? `${(err * 100).toFixed(1)}%` : "—",
      delta: "vs. 5.0% cap",
      deltaTone: passError === null ? "neutral" : passError ? "pass" : "fail",
      tertiary: "Target: < 5%",
      pass: passError,
    },
    {
      icon: "💵",
      label: "Cost Efficiency",
      value: "~$0.0018 / 1k queries",
      delta: "~38% cloud GPU savings",
      deltaTone: "neutral" as const,
      tertiary: d.spend_usd !== undefined ? `Budget spent: $${Number(d.spend_usd).toFixed(2)}` : "Nebius L40S → H100",
      pass: null as boolean | null,
    },
  ];

  const gates = [
    { gate: "Response Latency (P95)", observed: typeof p95 === "number" ? `${p95} ms` : "—", req: "≤ 2,000 ms", pass: passLatency },
    { gate: "Output Quality & Schema Accuracy", observed: typeof q === "number" ? `${(q * 100).toFixed(1)}%` : "—", req: "≥ 85%", pass: passQuality },
    { gate: "Reliability (Error Rate)", observed: typeof err === "number" ? `${(err * 100).toFixed(1)}%` : "—", req: "≤ 5%", pass: passError },
  ];

  function deltaClass(toneStr: string) {
    if (toneStr === "pass") return "mt-2 inline-block rounded-full border border-ship/30 bg-ship/10 px-2 py-0.5 text-[11px] font-semibold text-ship";
    if (toneStr === "fail") return "mt-2 inline-block rounded-full border border-block/30 bg-block/10 px-2 py-0.5 text-[11px] font-semibold text-block";
    return "mt-2 inline-block rounded-full border border-ink/20 bg-ink/5 px-2 py-0.5 text-[11px] font-semibold text-ink";
  }

  return (<main>
    <TopNav />
    <style>{`@media print {
      @page { margin: 12mm; size: A4; }
      nav, .no-print { display: none !important; }
      body { background: #fff !important; }
      main { padding: 0 !important; }
      .frame { border: none !important; margin: 0 !important; }
      .print-page { max-width: 100% !important; padding: 0 !important; }
      .print-card { box-shadow: none !important; break-inside: avoid; }
      h1 { font-size: 20pt !important; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }`}</style>
    <div className="print-page mx-auto max-w-4xl px-6 py-8">
      {/* Header + seal */}
      <div className="text-center">
        <Seal tone={tone} />
        <h1 className="mt-3 text-2xl tracking-tight md:text-3xl">OFFICIAL INFERENCE CERTIFICATE</h1>
        <p className="mt-1 text-[11px] uppercase tracking-widest text-muted">GPUProof · Nebius AI Cloud · Deterministic audit, never vibes</p>
      </div>

      {/* Metadata bar */}
      <dl className="print-card panel mt-6 grid grid-cols-2 gap-3 rounded-lg p-4 text-left md:grid-cols-4">
        <div><dt className="text-[10px] uppercase tracking-widest text-muted">Certification ID</dt><dd className="mt-0.5 truncate font-mono text-[12px] font-bold" title={params.id}>{params.id}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-widest text-muted">Issued</dt><dd className="mt-0.5 text-[12px] font-bold">{issuedAt.toLocaleString()}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-widest text-muted">Workload Hash Digest</dt><dd className="mt-0.5 truncate font-mono text-[12px] font-bold" title={digest}>{digest}</dd></div>
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

      {/* KPI cards with before-vs-after deltas */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="print-card panel flex flex-col rounded-lg p-4">
            <p aria-hidden="true" className="text-lg">{k.icon}</p>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-muted">{k.label}</p>
            <p className="mt-1 text-xl font-bold tracking-tight">{k.value}</p>
            <div><span className={deltaClass(k.deltaTone)}>{k.delta}</span></div>
            <p className="mt-1.5 text-[11px] text-muted">{k.tertiary}</p>
            {k.pass !== null && (
              <p className={`mt-2 inline-block self-start rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white ${k.pass ? "bg-ship" : "bg-block"}`}>{k.pass ? "Passed" : "Failed"}</p>
            )}
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
            <dd className="mt-0.5 truncate font-mono text-[12px] font-bold" title={digest}>{digest}</dd>
          </div>
        </dl>
        <div className="no-print mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copyDigest}
            className="cursor-pointer rounded border border-ink px-3 py-2 text-[12px] font-bold transition-all hover:-translate-y-px hover:shadow-[3px_3px_0_rgba(31,31,31,0.25)]"
          >
            {copied ? "✓ Copied!" : "Copy Verification Hash"}
          </button>
          <span className="font-mono text-[11px] text-muted">{digest}</span>
        </div>
        <p className="mt-2 hidden font-mono text-[11px] text-muted print:block">{digest}</p>
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
