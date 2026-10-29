"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell, LiveRegion, StatusPill } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
const QUALITY_GATE = 0.85;
const LATENCY_SLA_MS = 2000;
const ERROR_SLA = 0.05;

type Experiment = {
  index: number;
  plan: {
    model?: string;
    concurrency?: number;
    context_len?: number;
    max_tokens?: number;
    reason?: string;
    gpu_type?: string;
    precision?: string;
    batch_config?: string | number;
  };
  job_id: string;
  simulated?: boolean;
  provenance?: string;
  sandbox?: { operation_id?: string; image_uuid?: string | null; provenance?: string };
  reason: string;
  classifier?: { failure: string; action: string; reason: string };
  status: string;
  verdict: string;
  metrics: { latency_p95_ms: number; quality_score: number; error_rate: number; ttft_ms?: number; tokens_per_second?: number; memory_utilization?: number };
  log?: string;
};

type Narrative = { tone: "bad" | "warn" | "good" | "pending"; badge: string; summary: string };

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function errPct(x: number): string {
  if (typeof x !== "number") return "—";
  return x < 1 ? `${Math.round(x * 100)}%` : `${x}`;
}

function narrative(e: Experiment): Narrative {
  const q = e.metrics?.quality_score;
  const p95 = e.metrics?.latency_p95_ms;
  const maxTokens = e.plan?.max_tokens ?? 64;
  const conc = e.plan?.concurrency ?? 16;
  if (e.status === "QUALITY" || (typeof q === "number" && q < QUALITY_GATE)) {
    return {
      tone: "warn",
      badge: `Output truncated (${pct(q ?? 0)} quality vs 85% required)`,
      summary:
        `Lean output budget (max_tokens=${maxTokens}) truncated structured JSON tool calls. The Nemotron planner diagnosed a QUALITY failure and adapted max_tokens.`,
    };
  }
  if (e.status === "LATENCY" || (typeof p95 === "number" && p95 > LATENCY_SLA_MS)) {
    return {
      tone: "bad",
      badge: `Latency gate breached (P95 ${p95}ms > 2000ms)`,
      summary:
        `Concurrency (${conc} parallel streams) saturated endpoint capacity. The Nemotron planner diagnosed a LATENCY breach and throttled concurrency.`,
    };
  }
  if (e.status === "OOM" || e.status === "INFRASTRUCTURE") {
    return {
      tone: "bad",
      badge: "Sandbox execution failure",
      summary:
        "The sandbox replay encountered an unexpected failure. The Nemotron classifier diagnosed the issue for recovery.",
    };
  }
  if (typeof q === "number") {
    return {
      tone: "good",
      badge: "All production gates passed",
      summary: `P95 latency ${e.metrics.latency_p95_ms} ms, accuracy ${pct(q)}, error rate ${errPct(e.metrics.error_rate)}. The candidate meets every production criterion.`,
    };
  }
  return { tone: "pending", badge: "Awaiting results", summary: "The experiment is replaying in the sandbox microVM — metrics will appear here." };
}

function vramFor(gpuType: string): number {
  const g = (gpuType || "").toUpperCase();
  if (g.includes("H200")) return 141;
  if (g.includes("B200")) return 192;
  if (g.includes("H100")) return 80;
  if (g.includes("A100")) return g.includes("80") ? 80 : 40;
  if (g.includes("L40S")) return 48;
  if (g.includes("A6000") || g.includes("L40")) return 48;
  if (g.includes("A10")) return 24;
  if (g.includes("T4")) return 16;
  const m = g.match(/(\d+)\s*GB/);
  if (m) return parseInt(m[1], 10);
  return 48;
}

function isLowBit(precision: string): boolean {
  return /INT4|FP4|AWQ|GPTQ|4-?BIT/i.test(precision || "");
}

type OutcomeKind = "oom" | "quality" | "pass" | "pending";

function outcomeOf(e: Experiment): { kind: OutcomeKind; pill: string; detail: string } {
  const q = e.metrics?.quality_score;
  const p95 = e.metrics?.latency_p95_ms;
  const maxTokens = e.plan?.max_tokens ?? 64;
  const conc = e.plan?.concurrency ?? 16;
  if (e.status === "QUALITY" || (typeof q === "number" && q < QUALITY_GATE)) {
    return {
      kind: "quality",
      pill: "Failed — schema accuracy gate",
      detail: `Output truncated due to lean max_tokens (${maxTokens}); JSON tool accuracy fell to ${pct(q ?? 0)} against the 85% gate.`,
    };
  }
  if (e.status === "LATENCY" || (typeof p95 === "number" && p95 > LATENCY_SLA_MS)) {
    return {
      kind: "oom",
      pill: "Failed — latency SLA gate",
      detail: `P95 reached ${p95}ms under ${conc} concurrent streams (threshold 2,000ms).`,
    };
  }
  if (e.status === "OOM") {
    const cap = vramFor(e.plan.gpu_type || "");
    return {
      kind: "oom",
      pill: "Failed — capacity exceeded",
      detail: `Resource allocation reached capacity on ${e.plan.gpu_type || "target tier"}.`,
    };
  }
  if (typeof q === "number") {
    return {
      kind: "pass",
      pill: "Passed and certified",
      detail: `P95 ${e.metrics.latency_p95_ms} ms, ${pct(q)} tool accuracy, ${errPct(e.metrics.error_rate)} error rate.`,
    };
  }
  return { kind: "pending", pill: "Running…", detail: "Sampling latency, accuracy, and error rate in microVM." };
}

function stageMeta(e: Experiment): { title: string; hypothesis: string } {
  const conc = e.plan?.concurrency ?? 16;
  const maxTokens = e.plan?.max_tokens ?? 64;
  const ctx = e.plan?.context_len ?? 4096;
  const gpu = e.plan?.gpu_type || "TokenFactory";
  const prec = e.plan?.precision || "FP8";
  if (e.index === 0) {
    return {
      title: "Cost-minimum envelope",
      hypothesis: `Cheapest profile (concurrency=${conc}, max_tokens=${maxTokens}) — does structured output complete accurately?`,
    };
  }
  if (outcomeOf(e).kind === "quality" || (e.plan?.max_tokens && e.plan.max_tokens > 64)) {
    return {
      title: "Output budget expansion",
      hypothesis: `Raise max_tokens to ${maxTokens} to prevent truncation — does structured tool calling recover?`,
    };
  }
  if (outcomeOf(e).kind === "pass") {
    return {
      title: "Capacity envelope certified",
      hypothesis: `Serving profile (concurrency=${conc}, context=${ctx}, max_tokens=${maxTokens}) passes all SLA gates.`,
    };
  }
  return {
    title: `Adaptive retry ${e.index + 1}`,
    hypothesis: e.reason || `Planner adaptation on ${gpu} ${prec}.`,
  };
}

function sortedExps(exps: Experiment[]): Experiment[] {
  return [...exps].sort((a, b) => a.index - b.index);
}

function blockReasons(exps: Experiment[]): string {
  const hasOom = exps.some((e) => outcomeOf(e).kind === "oom");
  const hasQuality = exps.some((e) => outcomeOf(e).kind === "quality");
  if (hasOom && hasQuality) return "out of memory and quality degradation";
  if (hasOom) return "the KV cache exceeded VRAM";
  if (hasQuality) return "quality fell below the 85% gate";
  return "an SLA gate failed";
}

function executiveSummary(exps: Experiment[], status: string): string {
  if (exps.length === 0) {
    return "The run is starting — the planner is provisioning the cheapest viable GPU to establish a cost baseline. Live container telemetry will appear below.";
  }
  const sorted = sortedExps(exps);
  const pass = [...sorted].reverse().find((e) => outcomeOf(e).kind === "pass");
  const ooms = sorted.filter((e) => outcomeOf(e).kind === "oom");
  const quals = sorted.filter((e) => outcomeOf(e).kind === "quality");
  const last = sorted[sorted.length - 1];
  const batch = String(pass?.plan.batch_config ?? last?.plan.batch_config ?? "—");

  if (pass) {
    const vram = vramFor(pass.plan.gpu_type);
    const s1 = `The model needs ${vram} GB of VRAM (${pass.plan.gpu_type} ${pass.plan.precision}) to hold ${pct(pass.metrics.quality_score)} tool accuracy under ${batch} concurrent requests.`;
    const fails: string[] = [];
    if (ooms.length) {
      const o = ooms[0];
      fails.push(`the ${o.plan.gpu_type} (${vramFor(o.plan.gpu_type)} GB) ran out of memory as the KV cache grew`);
    }
    if (quals.length) {
      fails.push(`${quals[0].plan.precision} quantization degraded tool schema accuracy below the 85% gate`);
    }
    if (fails.length === 0) return s1;
    return `${s1} ${fails.join("; ")}.`;
  }
  const bits: string[] = [];
  if (ooms.length) {
    const o = ooms[0];
    bits.push(`${o.plan.gpu_type} (${vramFor(o.plan.gpu_type)} GB) ran out of memory during KV-cache growth`);
  }
  if (quals.length) {
    const q = quals[0];
    bits.push(
      `${q.plan.precision} quantization held speed at ${q.metrics?.latency_p95_ms} ms but collapsed tool accuracy to ${pct(q.metrics?.quality_score)} against the 85% gate`
    );
  }
  if (status === "BLOCK") {
    return `Blocked from production: ${bits.join("; ") || "one or more SLA gates failed"}. Right-size VRAM or restore FP8 precision before re-running.`;
  }
  return `In progress (${sorted.length} stage${sorted.length > 1 ? "s" : ""} so far) — ${bits.join("; ") || "establishing the cost baseline"}. The planner is adapting GPU sizing and precision toward all-green gates.`;
}

function VerdictBanner({ status, exps, simulated }: { status: string; exps: Experiment[]; simulated?: boolean | null }) {
  const summary = executiveSummary(exps, status);
  const sorted = sortedExps(exps);
  const pass = [...sorted].reverse().find((e) => outcomeOf(e).kind === "pass");
  const cert = pass ?? sorted[sorted.length - 1];

  if (status === "SHIP") {
    const hw = cert ? `certified on Nebius ${cert.plan.gpu_type} ${cert.plan.precision}` : "";
    return (
      <section role="status" aria-label="Verdict: ready to ship" className="mt-8 rounded-card bg-ship p-5 text-white md:p-6">
        <p className="verdict text-[clamp(1.6rem,2.6vw,2.2rem)] leading-none">SHIP</p>
        <p className="mt-2 text-[14px] font-medium">{hw ? `Ready for production — ${hw}.` : "Ready for production."}</p>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-white/85">{summary}</p>
        {simulated && <p className="mt-3 inline-block rounded-full bg-white/15 px-3 py-1 text-[12px] font-medium">Simulated run — dev-grade evidence</p>}
      </section>
    );
  }

  if (status === "BLOCK") {
    return (
      <section role="status" aria-label="Verdict: blocked from production" className="mt-8 rounded-card bg-block p-5 text-white md:p-6">
        <p className="verdict text-[clamp(1.6rem,2.6vw,2.2rem)] leading-none">BLOCK</p>
        <p className="mt-2 text-[14px] font-medium">Blocked from production — {blockReasons(sorted)}.</p>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-white/85">{summary}</p>
      </section>
    );
  }

  return (
    <section role="status" aria-label="Verdict pending" className="mt-8 rounded-card bg-ink p-5 text-[#F1F1ED] md:p-6">
      <p className="flex items-center gap-3 text-[14px] font-medium">
        <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
        Verdict pending{sorted.length > 0 ? ` — ${sorted.length} stage${sorted.length > 1 ? "s" : ""} complete` : ""}
      </p>
      <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-[#F1F1ED]/80">{summary}</p>
    </section>
  );
}

/* ——— Telemetry drawer pieces ——— */

function MemoryWaterfall({ e }: { e: Experiment }) {
  const cap = vramFor(e.plan.gpu_type);
  const oom = outcomeOf(e).kind === "oom";
  const low = isLowBit(e.plan.precision);
  let weights: number, kv: number, over: number;
  if (oom) {
    weights = cap * 0.62;
    kv = cap * 0.4;
    over = cap * 0.055;
  } else if (low) {
    weights = cap * 0.28;
    kv = cap * 0.3;
    over = cap * 0.06;
  } else {
    weights = cap * 0.45;
    kv = cap * 0.22;
    over = cap * 0.05;
  }
  const total = weights + kv + over;
  const scale = Math.max(total, cap);
  const wPct = Math.max(2, (weights / scale) * 100);
  const kPct = Math.max(2, (kv / scale) * 100);
  const oPct = Math.max(1.5, (over / scale) * 100);
  const usedPct = Math.round((total / cap) * 100);

  return (
    <div aria-label="Memory waterfall">
      <p className="text-[13px] font-medium">Memory pressure (schematic)</p>
      <div
        role="img"
        aria-label={oom ? `Illustrative allocation beyond ${cap}GB capacity after KV-cache growth` : `Illustrative allocation within ${cap}GB capacity`}
        className="mt-2 flex h-4 w-full overflow-hidden rounded-full border border-line bg-raised"
      >
        <span className="h-full bg-ink/70" style={{ width: `${wPct}%` }} title={`Model weights ${weights.toFixed(1)}GB`} />
        <span className={`h-full ${oom ? "bg-block" : "bg-ship"}`} style={{ width: `${kPct}%` }} title={`KV-cache ${kv.toFixed(1)}GB`} />
        <span className="h-full bg-[#C9C8C1]" style={{ width: `${oPct}%` }} title={`Overhead ${over.toFixed(1)}GB`} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink2 tabular-nums">
        <span><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full bg-ink/70" />Weights {weights.toFixed(1)} GB</span>
        <span><span aria-hidden="true" className={`mr-1 inline-block h-2 w-2 rounded-full ${oom ? "bg-block" : "bg-ship"}`} />KV cache {kv.toFixed(1)} GB</span>
        <span><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full bg-[#C9C8C1]" />Overhead {over.toFixed(1)} GB</span>
      </div>
      {oom ? (
        <p className="mt-2 inline-block rounded-full bg-blockWash px-2.5 py-1 text-[12px] font-medium text-blockDeep">
          Estimated pressure at the {cap} GB limit — CUDA OOM
        </p>
      ) : (
        <p className="mt-2 text-[12.5px] text-ink2">Illustrative allocation, {usedPct}% of {cap} GB. Runtime logs hold the measured values.</p>
      )}
      <p className="mt-1.5 text-[11.5px] text-faint">Segment sizes are schematic; the API does not report per-component VRAM or the exact breach token.</p>
    </div>
  );
}

function SlaGates({ e }: { e: Experiment }) {
  const m = e.metrics;
  const measurable = e.status !== "OOM" && m && typeof m.quality_score === "number";
  if (!measurable) {
    return (
      <div aria-label="SLA gate status">
        <p className="text-[13px] font-medium">SLA gates</p>
        <p className="mt-2 rounded-control bg-raised px-3 py-2 text-[13px] text-ink2">
          No gate sampling — the job hit CUDA OOM before latency, accuracy, and error metrics could be recorded.
        </p>
      </div>
    );
  }
  const rows = [
    {
      gate: "P95 latency ≤ 2,000 ms",
      observed: `${m.latency_p95_ms} ms`,
      pass: typeof m.latency_p95_ms === "number" ? m.latency_p95_ms <= LATENCY_SLA_MS : null,
    },
    { gate: "Tool accuracy ≥ 85%", observed: pct(m.quality_score), pass: m.quality_score >= QUALITY_GATE },
    { gate: "Error rate ≤ 5%", observed: errPct(m.error_rate), pass: typeof m.error_rate === "number" ? m.error_rate <= ERROR_SLA : null },
  ];
  return (
    <div aria-label="SLA gate status">
      <p className="text-[13px] font-medium">SLA gates</p>
      <ul className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <li key={r.gate} className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-raised px-3 py-2 text-[13px]">
            <span className="font-medium">{r.gate}</span>
            <span className="flex items-center gap-2.5">
              <span className="mono text-ink2 tabular-nums">{r.observed}</span>
              {r.pass === null ? (
                <span className="text-faint">—</span>
              ) : r.pass ? (
                <span className="pill pill-ship">Passed</span>
              ) : (
                <span className="pill pill-block">Failed</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StageTelemetry({ e }: { e: Experiment }) {
  return (
    <div aria-label="Container logs">
      <p className="text-[13px] font-medium">Container logs</p>
      <div className="term mt-2 space-y-1 p-3">
        <p><span className="text-termMuted">planner reason:</span> {e.reason}</p>
        {e.classifier && (
          <p className="text-termMuted">classifier: {e.classifier.failure} → {e.classifier.action} · {e.classifier.reason}</p>
        )}
        <p>
          status {e.status} · verdict {e.verdict} · p95 {e.metrics?.latency_p95_ms} ms · q {e.metrics?.quality_score} · err {e.metrics?.error_rate}
        </p>
        {e.log ? (
          <pre className="max-h-44 overflow-auto border-t border-termRule pt-2 whitespace-pre-wrap break-words">{e.log.slice(-1500)}</pre>
        ) : (
          <p className="border-t border-termRule pt-2 text-termMuted">No container log lines captured for this stage yet.</p>
        )}
      </div>
    </div>
  );
}

function CopyId({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); }
    }} className="btn btn-ghost btn-round h-8 shrink-0 px-2.5 text-[12px]">{copied ? "Copied" : `Copy ${label}`}</button>
  );
}

/* ——— Stage cards ——— */

function StageCard({
  e,
  stageNo,
  total,
  open,
  onToggle,
  isLatest,
}: {
  e: Experiment;
  stageNo: number;
  total: number;
  open: boolean;
  onToggle: () => void;
  isLatest: boolean;
}) {
  const meta = stageMeta(e);
  const o = outcomeOf(e);
  const n = narrative(e);
  const vram = vramFor(e.plan.gpu_type || "");
  const panelId = `stage-panel-${e.index}`;
  const btnId = `stage-btn-${e.index}`;

  const edge = o.kind === "oom" ? "border-l-block" : o.kind === "quality" ? "border-l-warn" : o.kind === "pass" ? "border-l-ship" : "border-l-[#C9C8C1]";
  const dot = o.kind === "pass" ? "bg-ship" : o.kind === "oom" ? "bg-block" : o.kind === "quality" ? "bg-warn" : "bg-[#C9C8C1]";
  const toneOf = (t: Narrative["tone"]) => (t === "bad" ? "text-blockDeep" : t === "warn" ? "text-warn" : t === "good" ? "text-ship" : "text-ink2");

  const planDesc = e.plan.concurrency
    ? `concurrency=${e.plan.concurrency} · max_tokens=${e.plan.max_tokens} · context=${e.plan.context_len || 4096}`
    : `${e.plan.gpu_type} ${vram} GB ${e.plan.precision}`;

  return (
    <li className="relative pl-7">
      <span aria-hidden="true" className={`absolute bottom-0 left-[5px] top-0 w-px bg-line ${isLatest ? "" : ""}`} />
      <span aria-hidden="true" className={`absolute left-0 top-6 h-[11px] w-[11px] rounded-full border-2 border-surface ${dot}`} />
      <div className={`rounded-card border border-line border-l-[3px] bg-surface ${edge}`}>
        <button
          type="button"
          id={btnId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full cursor-pointer items-start gap-3 p-4 text-left sm:p-5"
        >
          <svg className={`mt-0.5 h-4 w-4 shrink-0 text-ink2 transition-transform duration-200 ${open ? "rotate-90" : ""}`} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          </svg>
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] text-ink2">
              Stage {stageNo} of {total} · {meta.title}{isLatest ? " · latest" : ""}
            </span>
            <span className="mt-0.5 block text-[15px] font-semibold leading-snug">
              {planDesc} → {o.kind === "pass" ? "passed" : o.kind === "pending" ? "running" : "failed"}
            </span>
            <span className="mt-0.5 block text-[13px] leading-relaxed text-ink2">{meta.hypothesis}</span>
            <span className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={`pill ${o.kind === "pass" ? "pill-ship" : o.kind === "oom" ? "pill-block" : o.kind === "quality" ? "pill-warn" : "pill-neutral"}`}>{o.pill}</span>
              <span className="mono rounded-full bg-raised px-2.5 py-1 text-[11px] text-ink2" title={e.sandbox?.operation_id ? `sandbox op ${e.sandbox.operation_id} · image ${e.sandbox.image_uuid || "disposable"} · job ${e.job_id}` : `job ${e.job_id}`}>
                {e.plan.concurrency ? `concurrency ${e.plan.concurrency} · max_tokens ${e.plan.max_tokens}` : `${e.plan.gpu_type} · ${e.plan.precision}`} · op {(e.sandbox?.operation_id || e.job_id).slice(0, 12)}
                {e.provenance === "sandbox-measured" ? " · sandbox-measured" : e.simulated ? " · sim" : ""}
              </span>
            </span>
            <span className="mt-1.5 block text-[13px] font-medium">{o.detail}</span>
          </span>
        </button>
        <div id={panelId} role="region" aria-labelledby={btnId} className="acc" data-open={open}>
          <div className="acc-inner">
            <div className="space-y-4 border-t border-rule px-4 pb-5 pt-4 sm:px-5">
              <div>
                <p className="text-[13px] font-medium">Watch why</p>
                <p className={`mt-1 text-[13px] font-semibold ${toneOf(n.tone)}`}>{n.badge}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink2">{n.summary}</p>
                {e.classifier && (
                  <p className="mt-1 text-[13px] text-ink2">
                    Planner next step: <strong className="font-medium text-ink">{e.classifier.action}</strong> — {e.classifier.reason}
                  </p>
                )}
              </div>
              <MemoryWaterfall e={e} />
              <SlaGates e={e} />
              <div>
                <p className="text-[13px] font-medium">MicroVM operation receipt</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-control bg-raised px-3 py-2">
                  <span className="mono break-all text-[12px]">{e.sandbox?.operation_id || e.job_id}</span>
                  <CopyId label="op ID" value={e.sandbox?.operation_id || e.job_id} />
                </div>
                {e.sandbox?.image_uuid && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-control bg-raised px-3 py-2">
                    <span className="mono break-all text-[12px]">{e.sandbox.image_uuid}</span>
                    <CopyId label="image ID" value={e.sandbox.image_uuid} />
                  </div>
                )}
                <p className="mt-2 text-[12.5px] text-ink2">
                  {e.provenance === "sandbox-measured" ? "Nebius sandbox — measured" : e.simulated ? "Simulated — dev grade" : "Provenance not reported"}
                </p>
              </div>
              <StageTelemetry e={e} />
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function DiagnosticJourney({ exps }: { exps: Experiment[] }) {
  const sorted = sortedExps(exps);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  if (sorted.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 text-[14px] text-ink2">
        Provisioning the first experiment… planner → policy → sandbox run.
      </div>
    );
  }

  const isOpen = (idx: number) => open[idx] ?? sorted.length === 1;
  const allOpen = sorted.every((e) => isOpen(e.index));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-[13.5px] text-ink2">
          Each stage is a planner hypothesis, not a random retry. Expand any stage for memory, gates, and container logs.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpen(Object.fromEntries(sorted.map((e) => [e.index, true])))} disabled={allOpen}
            className="btn btn-ghost btn-round h-8 px-3 text-[12.5px] disabled:opacity-40">Expand all</button>
          <button type="button" onClick={() => setOpen({})} disabled={sorted.every((e) => !isOpen(e.index))}
            className="btn btn-ghost btn-round h-8 px-3 text-[12.5px] disabled:opacity-40">Collapse all</button>
        </div>
      </div>
      <ol aria-label="Diagnostic journey" className="mt-5 space-y-3">
        {sorted.map((e, i) => (
          <StageCard key={e.index} e={e} stageNo={i + 1} total={sorted.length} open={isOpen(e.index)}
            onToggle={() => setOpen((p) => ({ ...p, [e.index]: !isOpen(e.index) }))} isLatest={i === sorted.length - 1} />
        ))}
      </ol>
    </div>
  );
}

type StepState = "done" | "active" | "pending";

function Stepper({ status, expCount }: { status: string; expCount: number }) {
  const finished = status !== "RUNNING" && status !== "CREATED";
  const running = !finished;
  const steps: { label: string; state: StepState }[] = [
    { label: "Workload twin ready", state: "done" },
    { label: "Sandbox benchmarking", state: finished ? "done" : "active" },
    { label: "Quality and SLA audit", state: finished ? "done" : expCount > 0 ? "active" : "pending" },
    { label: "Certificate verdict", state: finished ? "done" : "pending" },
  ];
  const doneCount = steps.filter((s) => s.state === "done").length;
  const progressPct = Math.round((doneCount / steps.length) * 100);
  return (
    <div className="mt-8">
      <div role="progressbar" aria-label="Run completion" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} className="meter meter-ship">
        <span style={{ width: `${progressPct}%`, transition: "width 500ms var(--ease)" }} />
      </div>
      <ol aria-label="Run progress" className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.label} aria-current={s.state === "active" ? "step" : undefined}>
            <p className={`flex items-center gap-2 text-[13px] font-medium ${s.state === "pending" ? "text-faint" : "text-ink"}`}>
              {s.state === "done" ? (
                <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ship text-white">
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" /></svg>
                </span>
              ) : s.state === "active" ? (
                <span aria-hidden="true" className={`pulse-dot inline-block h-2.5 w-2.5 shrink-0 rounded-full ${running && i === 1 ? "bg-accent text-accent" : "bg-ink"}`} />
              ) : (
                <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] tabular-nums text-faint">{i + 1}</span>
              )}
              {s.label}
            </p>
            <p className={`mt-0.5 pl-7 text-[12px] ${s.state === "pending" ? "text-faint" : "text-ink2"}`}>
              {s.state === "done" ? "Complete" : s.state === "active" ? (running && i === 1 ? "Running…" : "In progress…") : "Pending"}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ——— Live telemetry terminal ——— */

type TeleLine = { key: number; time: string; tag: string; step: string; line: string; index: number };

function stepToTag(step: string): string {
  const s = (step || "").toLowerCase();
  if (s === "provision") return "NEBIUS";
  if (s === "vllm_load" || s === "concurrency") return "vLLM";
  if (s === "memory") return "VRAM";
  if (s === "diagnosis") return "PLANNER";
  if (s === "oom" || s === "warn" || s === "error") return "OOM";
  return "LOG";
}

function normalizeTag(tag: unknown, step: string): string {
  if (typeof tag === "string" && tag.trim()) return tag.trim().toUpperCase() === "VLLM" ? "vLLM" : tag.trim().toUpperCase();
  return stepToTag(step);
}

function tagColor(tag: string): string {
  const t = tag.toUpperCase();
  if (t === "NEBIUS") return "text-[#A6A69E]";
  if (t === "VLLM" || t === "VRAM" || t === "POLICY") return "text-[#FF9B70]";
  if (t === "PLANNER") return "text-[#7FD7A8]";
  if (t === "OOM" || t === "WARN" || t === "ERROR") return "text-[#FF8A7A]";
  return "text-[#A6A69E]";
}

function nowTime(): string {
  try {
    return new Date().toLocaleTimeString("en-GB", { hour12: false });
  } catch {
    return "";
  }
}

export default function Timeline({ params }: { params: { id: string } }) {
  const [exps, setExps] = useState<Experiment[]>([]);
  const [status, setStatus] = useState("RUNNING");
  const [sim, setSim] = useState<boolean | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [live, setLive] = useState("Connecting to live run events.");
  const [teleLines, setTeleLines] = useState<TeleLine[]>([]);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const termRef = useRef<HTMLDivElement | null>(null);
  const keyRef = useRef(0);

  function pushLine(tag: string, step: string, line: string, index: number) {
    keyRef.current += 1;
    const entry: TeleLine = { key: keyRef.current, time: nowTime(), tag, step, line, index };
    setTeleLines((prev) => [...prev.slice(-400), entry]);
  }

  function pushTelemetryEvent(e: any) {
    const tag = normalizeTag(e.tag, e.step || "");
    pushLine(tag, String(e.step || "log"), String(e.line || ""), typeof e.index === "number" ? e.index : -1);
  }

  useEffect(() => {
    if (follow && termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [teleLines, follow]);

  async function copyLogs() {
    try {
      await navigator.clipboard.writeText(teleLines.map((l) => `[${l.time}] [${l.tag}] ${l.line}`).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  useEffect(() => {
    let dead = false;
    const es = new EventSource(`${API}/certifications/${params.id}/events`);
    es.onmessage = (m) => {
      if (dead || !m.data || m.data.startsWith(":")) return;
      try {
        const e = JSON.parse(m.data);
        if (e.type === "telemetry") {
          pushTelemetryEvent(e);
          return;
        }
        if (e.type === "experiment_start") {
          setLive(`Experiment ${e.index + 1} starting: planner → policy → sandbox run.`);
          pushLine("NEBIUS", "provision", `—— Experiment ${e.index + 1} starting: planner → policy → sandbox run.`, e.index ?? -1);
        }
        if (e.type === "plan") {
          setLive(`Experiment ${e.index + 1} planned: ${e.plan.gpu_type} ${e.plan.precision}. ${e.plan.reason}`);
          pushLine("PLANNER", "diagnosis", `Planned exp ${e.index + 1}: ${e.plan.gpu_type} ${e.plan.precision} batch ${e.plan.batch_config} — ${e.plan.reason}`, e.index ?? -1);
        }
        if (e.type === "policy") setLive(e.allowed ? `Policy approved experiment ${e.index + 1} (est $${e.estimated_cost}).` : `Policy refused: ${e.reasons.join("; ")}`);
        if (e.type === "policy") {
          pushLine(
            e.allowed ? "POLICY" : "WARN",
            "provision",
            e.allowed ? `Policy approved exp ${e.index + 1} (est $${e.estimated_cost}).` : `Policy refused exp ${e.index + 1}: ${(e.reasons || []).join("; ")}`,
            e.index ?? -1
          );
        }
        if (e.type === "experiment_done") {
          setExps((prev) => [...prev.filter((x) => x.index !== e.experiment.index), e.experiment]);
          setLive(`Experiment ${e.experiment.index + 1} finished: ${e.experiment.status}.`);
          const done = e.experiment;
          pushLine(
            done.status === "OOM" ? "OOM" : "PLANNER",
            "diagnosis",
            `Exp ${done.index + 1} finished: ${done.status} · ${done.verdict} · p95 ${done.metrics?.latency_p95_ms}ms · q ${done.metrics?.quality_score}`,
            done.index ?? -1
          );
        }
        if (e.type === "done") {
          setStatus(e.status);
          setLive(`Certification ${e.status}.`);
          pushLine(e.status === "SHIP" ? "PLANNER" : "WARN", "diagnosis", `Certification ${e.status}.`, -1);
          es.close();
          fetch(`${API}/certifications/${params.id}`).then((r) => r.json()).then((j) => { setSim(j.simulated); setCandidate(j.candidate_model ?? j.candidate ?? null); }).catch(() => {});
        }
      } catch {}
    };
    es.onerror = () => {
      // SSE fallback: poll the experiments endpoint (works in sim + real mode,
      // before and after completion — unlike /certificate which 409s when empty)
      fetch(`${API}/certifications/${params.id}/experiments`).then((r) => r.json()).then((j) => {
        if (j.experiments) setExps(j.experiments);
        if (j.simulated !== undefined) setSim(j.simulated);
        if (Array.isArray(j.telemetry) && j.telemetry.length > 0 && !dead) {
          setTeleLines((prev) => {
            if (prev.length >= j.telemetry.length) return prev;
            return j.telemetry.map((t: any, i: number) => ({
              key: i + 1,
              time: nowTime(),
              tag: normalizeTag(t.tag, t.step || ""),
              step: String(t.step || "log"),
              line: String(t.line || ""),
              index: typeof t.index === "number" ? t.index : -1,
            }));
          });
          keyRef.current = Math.max(keyRef.current, j.telemetry.length);
        }
      }).catch(() => {});
    };
    // initial paint (covers late joiners after the SSE "done" was consumed)
    fetch(`${API}/certifications/${params.id}/experiments`).then((r) => r.json()).then((j) => {
      if (!dead && j.experiments) { setExps(j.experiments); if (j.simulated !== undefined) setSim(j.simulated); }
      if (!dead && Array.isArray(j.telemetry) && j.telemetry.length > 0) {
        setTeleLines(j.telemetry.map((t: any, i: number) => ({
          key: i + 1,
          time: nowTime(),
          tag: normalizeTag(t.tag, t.step || ""),
          step: String(t.step || "log"),
          line: String(t.line || ""),
          index: typeof t.index === "number" ? t.index : -1,
        })));
        keyRef.current = j.telemetry.length;
      }
    }).catch(() => {});
    fetch(`${API}/certifications/${params.id}`).then((r) => r.json()).then((j) => {
      if (!dead && j.status && j.status !== "RUNNING" && j.status !== "CREATED") {
        setStatus(j.status);
        setLive(`Certification ${j.status}.`);
      }
      if (!dead && j.simulated !== undefined) setSim(j.simulated);
      if (!dead) setCandidate(j.candidate_model ?? j.candidate ?? null);
    }).catch(() => {});
    return () => { dead = true; es.close(); };
  }, [params.id]);

  const finished = status !== "RUNNING" && status !== "CREATED";
  const lastExp = exps.length > 0 ? sortedExps(exps)[sortedExps(exps).length - 1] : null;
  const activeJobId = lastExp ? (lastExp.sandbox?.operation_id || lastExp.job_id) : "waiting for sandbox…";

  return (
    <AppShell>
      <div className="app-pad mx-auto max-w-shell">
        <LiveRegion message={live} />

        {/* Title row */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-[26px] font-semibold tracking-[-0.02em]">{candidate || "Live run"}</h1>
            <p className="mono mt-1 truncate text-[12.5px] text-ink2">{params.id}</p>
            <p className="mt-2 max-w-xl text-[14px] text-ink2">
              Every attempt carries a hardware receipt and a measurable outcome. Follow the microVM run as it happens.
            </p>
          </div>
          <StatusPill status={status} simulated={sim ?? undefined} />
        </div>

        <Stepper status={status} expCount={exps.length} />
        <VerdictBanner status={status} exps={exps} simulated={sim} />

        {/* Latest measured metrics */}
        <section aria-label="Latest measured metrics" className="kpi-strip mt-8 rounded-card border border-line bg-surface max-sm:grid-cols-2" style={{ ["--kpi-n" as string]: 4 }}>
          {([
            ["TTFT", lastExp?.metrics?.ttft_ms, "ms", 0],
            ["Tokens / second", lastExp?.metrics?.tokens_per_second, "", 1],
            ["P95 latency", lastExp?.metrics?.latency_p95_ms, "ms", 0],
            ["Memory utilization", lastExp?.metrics?.memory_utilization === undefined ? undefined : lastExp.metrics.memory_utilization * 100, "%", 1],
          ] as const).map(([label, value, unit, decimals]) => (
            <div key={label} className="kpi-cell">
              <p className="kpi-label">{label}</p>
              <p className="kpi-value mt-1.5 tabular-nums">{typeof value === "number" ? `${value.toFixed(decimals)}${unit === "ms" ? " ms" : unit}` : "—"}</p>
            </div>
          ))}
        </section>
        <p className="mt-2 text-[12.5px] text-ink2">
          A dash means the runtime did not report that metric. {sim ? "Simulated run — dev-grade evidence." : "Measured values come from recorded sandbox telemetry."}
        </p>

        {/* Live telemetry terminal */}
        <section aria-label="Live telemetry terminal" className="term mt-6 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-termRule px-4 py-2.5">
            <span className="mono flex min-w-0 items-center gap-2.5 truncate text-[12px] text-termMuted">
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 bg-accent" />
              microVM / operation {activeJobId}
            </span>
            {finished ? (
              <span className="flex items-center gap-2 text-[12px] text-[#8A8A84]">
                <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[#8A8A84]" />
                Stream ended
              </span>
            ) : (
              <span className="flex items-center gap-2 text-[12px] text-[#7FD7A8]">
                <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-[#7FD7A8] text-[#7FD7A8]" aria-hidden="true" />
                Live streaming
              </span>
            )}
          </div>
          <div ref={termRef} role="log" aria-label="Live sandbox telemetry" className="h-80 overflow-y-auto p-4">
            {teleLines.length === 0 && <p className="text-[#8A8A84]">$ awaiting sandbox output… planner → policy → sandbox run.</p>}
            {teleLines.map((l) => (
              <div key={l.key} className="log-line whitespace-pre-wrap break-words">
                <span className="text-[#6E6E68]">[{l.time}]</span> <span className={`font-medium ${tagColor(l.tag)}`}>[{l.tag}]</span> <span>{l.line}</span>
              </div>
            ))}
            {!finished && teleLines.length > 0 && <span aria-hidden="true" className="mt-1 inline-block h-3.5 w-2 animate-pulse bg-[#7FD7A8]" />}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-termRule px-4 py-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-termMuted">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="h-3.5 w-3.5 accent-[#FF4D0A]" />
              Follow output
            </label>
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-[#6E6E68] tabular-nums">{teleLines.length} lines</span>
              <button type="button" onClick={copyLogs}
                className="btn btn-onDarkGhost btn-round h-8 px-3 text-[12px]">{copied ? "Copied" : "Copy logs"}</button>
            </div>
          </div>
        </section>

        {/* Diagnostic journey */}
        <section aria-label="Diagnostic journey" className="mt-12">
          <h2 className="d-md">Failure is a data point.</h2>
          <div className="mt-5" aria-live="off">
            <DiagnosticJourney exps={exps} />
          </div>
        </section>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          {finished ? (
            <Link href={`/certificate/${params.id}`} className="btn btn-primary btn-round h-11 px-5 text-sm">View the certificate</Link>
          ) : (
            <span className="rounded-full bg-raised px-4 py-2.5 text-[13.5px] text-ink2">The certificate appears when the run finishes…</span>
          )}
          <Link href="/dashboard" className="btn btn-ghost btn-round h-11 px-5 text-sm">All runs</Link>
        </div>
      </div>
    </AppShell>
  );
}
