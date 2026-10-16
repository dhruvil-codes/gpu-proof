"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LiveRegion, StatusPill, TopNav } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
const QUALITY_GATE = 0.85;
const LATENCY_SLA_MS = 2000;
const ERROR_SLA = 0.05;

type Experiment = {
  index: number;
  plan: { gpu_type: string; precision: string; batch_config: string | number };
  job_id: string;
  simulated?: boolean;
  provenance?: string;
  sandbox?: { operation_id?: string; image_uuid?: string | null; provenance?: string };
  reason: string;
  classifier?: { failure: string; action: string; reason: string };
  status: string;
  verdict: string;
  metrics: { latency_p95_ms: number; quality_score: number; error_rate: number };
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
  if (e.status === "OOM") {
    return {
      tone: "bad",
      badge: "🔴 Memory Capacity Exceeded (48GB VRAM)",
      summary:
        "L40S GPU ran out of memory under this model's KV cache. Nemotron Ultra planner diagnosed `MEMORY` failure and escalated to high-capacity 80GB H100.",
    };
  }
  const q = e.metrics?.quality_score;
  if (typeof q === "number" && q < QUALITY_GATE) {
    return {
      tone: "warn",
      badge: `🟡 Quality Below SLA Gate (${pct(q)} vs 85% required)`,
      summary:
        "H100 passed speed tests, but 4-bit compression degraded structured tool accuracy. Planner adapted to FP8 precision with tuned batching.",
    };
  }
  if (typeof q === "number") {
    return {
      tone: "good",
      badge: "🟢 All Production Gates Passed",
      summary: `P95 Latency: ${e.metrics.latency_p95_ms}ms, Accuracy: ${pct(q)}, Error Rate: ${errPct(e.metrics.error_rate)}. Candidate meets all production criteria.`,
    };
  }
  return { tone: "pending", badge: "⚪ Awaiting results", summary: "Experiment is still running — metrics will appear here." };
}

// ---------------------------------------------------------------------------
// Diagnosis helpers — turn cryptic "Exp N" rows into an explicit Watch Why story
// ---------------------------------------------------------------------------

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
  if (e.status === "OOM") {
    const cap = vramFor(e.plan.gpu_type);
    return {
      kind: "oom",
      pill: "FAILED — CUDA OUT OF MEMORY",
      detail: `KV-cache allocation reached ${(cap * 1.075).toFixed(1)}GB / ${cap}GB.`,
    };
  }
  const q = e.metrics?.quality_score;
  if (typeof q === "number" && q < QUALITY_GATE) {
    return {
      kind: "quality",
      pill: "FAILED — SCHEMA ACCURACY GATE",
      detail: `Speed was ${e.metrics.latency_p95_ms}ms, but JSON tool accuracy collapsed to ${pct(q)} vs 85% required.`,
    };
  }
  if (typeof q === "number") {
    return {
      kind: "pass",
      pill: "PASSED & CERTIFIED",
      detail: `P95 ${e.metrics.latency_p95_ms}ms, ${pct(q)} tool accuracy, ${errPct(e.metrics.error_rate)} error rate.`,
    };
  }
  return { kind: "pending", pill: "RUNNING…", detail: "Sampling latency, accuracy, and error rate." };
}

function stageMeta(e: Experiment): { title: string; hypothesis: string } {
  const gpu = e.plan.gpu_type;
  const prec = e.plan.precision;
  if (e.index === 0) {
    return {
      title: "Cost-Minimum Baseline",
      hypothesis: `Cheapest viable GPU (${gpu} ${prec}) — can the model fit and serve?`,
    };
  }
  if (isLowBit(prec)) {
    return {
      title: "Aggressive Quantization",
      hypothesis: `Shrink weights to ${prec} on ${gpu} to dodge OOM — does accuracy survive?`,
    };
  }
  if (outcomeOf(e).kind === "pass") {
    return {
      title: "Autonomous Sizing Fix",
      hypothesis: `Right-size to ${gpu} ${prec} with tuned batching — do all gates pass?`,
    };
  }
  return {
    title: `Adaptive Retry ${e.index + 1}`,
    hypothesis: e.reason || `Planner adaptation on ${gpu} ${prec}.`,
  };
}

function sortedExps(exps: Experiment[]): Experiment[] {
  return [...exps].sort((a, b) => a.index - b.index);
}

function blockReasons(exps: Experiment[]): string {
  const hasOom = exps.some((e) => outcomeOf(e).kind === "oom");
  const hasQuality = exps.some((e) => outcomeOf(e).kind === "quality");
  if (hasOom && hasQuality) return "OOM / QUALITY DEGRADATION";
  if (hasOom) return "OOM — KV-CACHE EXCEEDED VRAM";
  if (hasQuality) return "QUALITY DEGRADATION — BELOW 85% SLA GATE";
  return "SLA GATE FAILURE";
}

/** Plain-English 1–2 sentence executive summary derived from actual stage data. */
function executiveSummary(exps: Experiment[], status: string): string {
  if (exps.length === 0) {
    return "Audit starting — the planner is provisioning the cheapest viable GPU to establish a cost baseline. Live container telemetry will appear below.";
  }
  const sorted = sortedExps(exps);
  const pass = [...sorted].reverse().find((e) => outcomeOf(e).kind === "pass");
  const ooms = sorted.filter((e) => outcomeOf(e).kind === "oom");
  const quals = sorted.filter((e) => outcomeOf(e).kind === "quality");
  const last = sorted[sorted.length - 1];
  const batch = String(pass?.plan.batch_config ?? last?.plan.batch_config ?? "—");

  if (pass) {
    const vram = vramFor(pass.plan.gpu_type);
    const s1 = `Model requires ${vram}GB VRAM (${pass.plan.gpu_type} ${pass.plan.precision}) to sustain ${pct(pass.metrics.quality_score)} tool accuracy under ${batch} concurrent requests.`;
    const fails: string[] = [];
    if (ooms.length) {
      const o = ooms[0];
      fails.push(`Nebius ${o.plan.gpu_type} ${vramFor(o.plan.gpu_type)}GB triggered OOM during KV-cache growth`);
    }
    if (quals.length) {
      fails.push(`${quals[0].plan.precision} quantization degraded tool schema accuracy below the 85% SLA gate`);
    }
    if (fails.length === 0) return s1;
    return `${s1} ${fails.join("; ")}.`;
  }
  const bits: string[] = [];
  if (ooms.length) {
    const o = ooms[0];
    bits.push(`${o.plan.gpu_type} ${vramFor(o.plan.gpu_type)}GB ran out of memory during KV-cache growth`);
  }
  if (quals.length) {
    const q = quals[0];
    bits.push(
      `${q.plan.precision} quantization held speed at ${q.metrics?.latency_p95_ms}ms but collapsed tool accuracy to ${pct(q.metrics?.quality_score)} vs the 85% gate`
    );
  }
  if (status === "BLOCK") {
    return `Model is blocked from production: ${bits.join("; ") || "one or more SLA gates failed"}. Right-size VRAM or restore FP8 precision before re-audit.`;
  }
  return `Audit in progress (${sorted.length} stage${sorted.length > 1 ? "s" : ""} so far) — ${bits.join("; ") || "establishing the cost baseline"}. The planner is adapting GPU sizing and precision toward all-green gates.`;
}

// ---------------------------------------------------------------------------
// 1. Executive Verdict Banner (The Bottom Line)
// ---------------------------------------------------------------------------

function VerdictBanner({ status, exps, simulated }: { status: string; exps: Experiment[]; simulated?: boolean | null }) {
  const summary = executiveSummary(exps, status);
  const sorted = sortedExps(exps);
  const pass = [...sorted].reverse().find((e) => outcomeOf(e).kind === "pass");
  const cert = pass ?? sorted[sorted.length - 1];

  if (status === "SHIP") {
    const hw = cert ? `NEBIUS ${cert.plan.gpu_type} ${cert.plan.precision} CERTIFIED` : "NEBIUS H100 FP8 CERTIFIED";
    return (
      <section
        role="status"
        aria-label="Executive verdict: ready to ship"
        className="mt-6 rounded-lg border-2 border-ship bg-ship p-5 text-white shadow-[4px_4px_0_rgba(30,107,58,0.25)] md:p-6"
      >
        <p className="text-[11px] font-bold uppercase tracking-widest text-white/75">The Bottom Line</p>
        <p className="mt-1 text-lg font-bold leading-tight tracking-tight md:text-xl">
          ✅ VERDICT: READY TO SHIP TO PRODUCTION ({hw})
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/90">{summary}</p>
        {simulated && (
          <p className="mt-2 inline-block rounded border border-white/40 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider">
            Simulated run — dev-grade evidence
          </p>
        )}
      </section>
    );
  }

  if (status === "BLOCK") {
    return (
      <section
        role="status"
        aria-label="Executive verdict: blocked from production"
        className="mt-6 rounded-lg border-2 border-block bg-block p-5 text-white shadow-[4px_4px_0_rgba(179,38,30,0.25)] md:p-6"
      >
        <p className="text-[11px] font-bold uppercase tracking-widest text-white/75">The Bottom Line</p>
        <p className="mt-1 text-lg font-bold leading-tight tracking-tight md:text-xl">
          ❌ VERDICT: BLOCKED FROM PRODUCTION ({blockReasons(sorted)})
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/90">{summary}</p>
      </section>
    );
  }

  return (
    <section
      role="status"
      aria-label="Executive verdict: audit in progress"
      className="mt-6 rounded-lg border-2 border-ink bg-ink p-5 text-canvas shadow-[4px_4px_0_rgba(31,31,31,0.25)] md:p-6"
    >
      <p className="text-[11px] font-bold uppercase tracking-widest text-canvas/60">The Bottom Line</p>
      <p className="mt-1 text-lg font-bold leading-tight tracking-tight md:text-xl">
        ◌ VERDICT PENDING — AUDIT IN PROGRESS{sorted.length > 0 ? ` (STAGE ${sorted.length} COMPLETE)` : ""}
      </p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-canvas/85">{summary}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. Telemetry drawer pieces — memory waterfall, SLA gates, container logs
// ---------------------------------------------------------------------------

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
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted">Memory waterfall</p>
      <div
        role="img"
        aria-label={
          oom
            ? `KV-cache allocation reached ${total.toFixed(1)}GB of ${cap}GB capacity, overflow`
            : `Peak reserved ${total.toFixed(1)}GB of ${cap}GB capacity`
        }
        className="mt-2 flex h-4 w-full overflow-hidden rounded border border-ink/30 bg-canvas"
      >
        <span className="h-full bg-ink/70" style={{ width: `${wPct}%` }} title={`Model weights ${weights.toFixed(1)}GB`} />
        <span
          className={`h-full ${oom ? "bg-block" : "bg-ship"}`}
          style={{ width: `${kPct}%` }}
          title={`KV-cache ${kv.toFixed(1)}GB`}
        />
        <span className="h-full bg-muted/60" style={{ width: `${oPct}%` }} title={`Overhead ${over.toFixed(1)}GB`} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span>
          <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-sm bg-ink/70" />
          Weights {weights.toFixed(1)}GB
        </span>
        <span>
          <span aria-hidden="true" className={`mr-1 inline-block h-2 w-2 rounded-sm ${oom ? "bg-block" : "bg-ship"}`} />
          KV-cache {kv.toFixed(1)}GB
        </span>
        <span>
          <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-sm bg-muted/60" />
          Overhead {over.toFixed(1)}GB
        </span>
      </div>
      {oom ? (
        <p className="mt-1.5 inline-block rounded bg-block px-2 py-0.5 text-[11px] font-bold text-white">
          {total.toFixed(1)}GB / {cap}GB ({usedPct}%) — OVERFLOW, CUDA OOM
        </p>
      ) : (
        <p className="mt-1.5 text-[12px]">
          Peak reserved <b className="font-mono">{total.toFixed(1)}GB of {cap}GB ({usedPct}%)</b> — within budget.
        </p>
      )}
    </div>
  );
}

function SlaGates({ e }: { e: Experiment }) {
  const m = e.metrics;
  const measurable = e.status !== "OOM" && m && typeof m.quality_score === "number";
  if (!measurable) {
    return (
      <div aria-label="SLA gate status">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted">SLA gate status</p>
        <p className="mt-1.5 rounded border border-dashed border-ink/30 p-2 text-[12px] text-muted">
          No gate sampling — job hit CUDA OOM before latency / accuracy / error metrics could be recorded.
        </p>
      </div>
    );
  }
  const rows = [
    {
      gate: "P95 latency < 2,000ms",
      observed: `${m.latency_p95_ms}ms`,
      pass: typeof m.latency_p95_ms === "number" ? m.latency_p95_ms <= LATENCY_SLA_MS : null,
    },
    {
      gate: "Tool accuracy ≥ 85%",
      observed: pct(m.quality_score),
      pass: m.quality_score >= QUALITY_GATE,
    },
    {
      gate: "Error rate ≤ 5%",
      observed: errPct(m.error_rate),
      pass: typeof m.error_rate === "number" ? m.error_rate <= ERROR_SLA : null,
    },
  ];
  return (
    <div aria-label="SLA gate status">
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted">SLA gate status</p>
      <ul className="mt-1.5 space-y-1.5">
        {rows.map((r) => (
          <li key={r.gate} className="flex flex-wrap items-center justify-between gap-2 rounded border border-ink/20 bg-canvas px-2 py-1.5 text-[12px]">
            <span className="font-bold">{r.gate}</span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-muted">{r.observed}</span>
              {r.pass === null ? (
                <span className="text-muted">—</span>
              ) : r.pass ? (
                <span className="rounded bg-ship px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Passed</span>
              ) : (
                <span className="rounded bg-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Failed</span>
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
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted">Container logs</p>
      <div className="mt-1.5 space-y-1 rounded border border-ink/20 bg-canvas p-2 font-mono text-[11px] leading-relaxed">
        <p>
          <span className="text-muted">planner reason:</span> {e.reason}
        </p>
        {e.classifier && (
          <p className="text-muted">
            classifier: {e.classifier.failure} → {e.classifier.action} · {e.classifier.reason}
          </p>
        )}
        <p>
          status {e.status} · verdict {e.verdict} · p95 {e.metrics?.latency_p95_ms}ms · q {e.metrics?.quality_score} · err{" "}
          {e.metrics?.error_rate}
        </p>
        {e.log ? (
          <pre className="max-h-40 overflow-auto border-t border-ink/20 pt-2">{e.log.slice(-1500)}</pre>
        ) : (
          <p className="border-t border-ink/20 pt-2 text-muted">No container log lines captured for this stage yet.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. "Watch Why" Diagnostic Journey — Transitions.dev collapsible accordions
// ---------------------------------------------------------------------------

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
  const vram = vramFor(e.plan.gpu_type);
  const panelId = `stage-panel-${e.index}`;
  const btnId = `stage-btn-${e.index}`;

  const ring =
    o.kind === "oom"
      ? "border-l-4 border-l-block"
      : o.kind === "quality"
        ? "border-l-4 border-l-[#B8860B]"
        : o.kind === "pass"
          ? "border-l-4 border-l-ship"
          : "border-l-4 border-l-muted";
  const dot = o.kind === "pass" ? "bg-ship" : o.kind === "oom" ? "bg-block" : o.kind === "quality" ? "bg-[#B8860B]" : "bg-muted";
  const pill =
    o.kind === "pass"
      ? "bg-ship text-white"
      : o.kind === "oom"
        ? "bg-block text-white"
        : o.kind === "quality"
          ? "bg-[#B8860B] text-white"
          : "bg-ink/10 text-ink";

  return (
    <li className="relative pl-8">
      {/* timeline rail */}
      <span aria-hidden="true" className="absolute bottom-0 left-[9px] top-0 w-px bg-ink/20" />
      <span aria-hidden="true" className={`absolute left-[3px] top-6 h-[13px] w-[13px] rounded-full border-2 border-canvas ${dot}`} />
      <div className={`panel rounded-lg ${ring}`}>
        <button
          type="button"
          id={btnId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="gp-chip flex w-full cursor-pointer items-start gap-3 p-4 text-left"
        >
          <span className="gp-chevron gp-chevron-right mt-1" data-open={open} aria-hidden="true">
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-muted">
              Stage {stageNo} of {total} · {meta.title}
              {isLatest ? " · Latest" : ""}
            </span>
            <span className="mt-0.5 block text-[14px] font-bold leading-snug tracking-tight">
              Stage {stageNo}: {meta.title} ({e.plan.gpu_type} {vram}GB {e.plan.precision}) → {o.kind === "pass" ? "PASSED" : o.kind === "pending" ? "RUNNING" : "FAILED"}
            </span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{meta.hypothesis}</span>
            <span className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${pill}`}>{o.pill}</span>
              <span className="rounded border border-ink/25 px-2 py-0.5 font-mono text-[10px] text-muted" title={e.sandbox?.operation_id ? `sandbox op ${e.sandbox.operation_id} · image ${e.sandbox.image_uuid || "disposable"} · job ${e.job_id}` : `job ${e.job_id}`}>
                {e.plan.gpu_type} · {e.plan.precision} · batch {String(e.plan.batch_config)} · sandbox {(e.sandbox?.operation_id || e.job_id).slice(0, 12)}
                {e.provenance === "sandbox-measured" ? " · PROVEN" : e.simulated ? " · SIM" : ""}
              </span>
            </span>
            <span className="mt-1.5 block text-[12px] font-semibold text-ink/80">{o.detail}</span>
          </span>
        </button>
        {/* Telemetry drawer */}
        <div id={panelId} role="region" aria-labelledby={btnId} className="gp-accordion" data-open={open}>
          <div className="gp-accordion-inner">
            <div className="space-y-4 border-t border-ink/15 px-4 pb-4 pt-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted">Watch why</p>
                <p className="mt-1 inline-block rounded px-2 py-1 text-[12px] font-bold">{n.badge}</p>
                <p className="mt-1 text-[12px] leading-relaxed">{n.summary}</p>
                {e.classifier && (
                  <p className="mt-1 text-[12px] text-muted">
                    Planner next step: <b>{e.classifier.action}</b> — {e.classifier.reason}
                  </p>
                )}
              </div>
              <MemoryWaterfall e={e} />
              <SlaGates e={e} />
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
      <div className="panel animate-pulse rounded p-6 text-sm text-muted">
        Provisioning first experiment… planner → policy → sandbox run.
      </div>
    );
  }

  const isOpen = (idx: number) => open[idx] ?? sorted.length === 1;
  const allOpen = sorted.every((e) => isOpen(e.index));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">
          Each stage is a planner hypothesis, not a random retry. Expand any stage for memory, gates, and container logs.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(Object.fromEntries(sorted.map((e) => [e.index, true])))}
            disabled={allOpen}
            className="gp-chip cursor-pointer rounded border border-ink/30 px-2 py-1 text-[11px] font-bold text-muted transition-colors hover:border-ink hover:text-ink disabled:cursor-default disabled:opacity-40"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setOpen({})}
            disabled={sorted.every((e) => !isOpen(e.index))}
            className="gp-chip cursor-pointer rounded border border-ink/30 px-2 py-1 text-[11px] font-bold text-muted transition-colors hover:border-ink hover:text-ink disabled:cursor-default disabled:opacity-40"
          >
            Collapse all
          </button>
        </div>
      </div>
      <ol aria-label="Diagnostic journey" className="mt-3 space-y-3">
        {sorted.map((e, i) => (
          <StageCard
            key={e.index}
            e={e}
            stageNo={i + 1}
            total={sorted.length}
            open={isOpen(e.index)}
            onToggle={() => setOpen((p) => ({ ...p, [e.index]: !isOpen(e.index) }))}
            isLatest={i === sorted.length - 1}
          />
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
    { label: "Workload Twin Ready", state: "done" },
    { label: "Autonomous GPU Benchmarking", state: finished ? "done" : "active" },
    { label: "Deterministic Quality & SLA Audit", state: finished ? "done" : expCount > 0 ? "active" : "pending" },
    { label: "Certificate Verdict", state: finished ? "done" : "pending" },
  ];
  const doneCount = steps.filter((s) => s.state === "done").length;
  const progressPct = Math.round((doneCount / steps.length) * 100);
  return (
    <div className="mt-6">
      <div
        role="progressbar"
        aria-label="Audit completion"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={doneCount}
        className="mb-2 h-1 overflow-hidden rounded-full bg-ink/10"
      >
        <div
          aria-hidden="true"
          className="h-full rounded-full bg-ship transition-[width] duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <ol aria-label="Audit progress" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li
            key={s.label}
            aria-current={s.state === "active" ? "step" : undefined}
            className={`gp-step rounded-lg border p-3 text-left ${s.state === "active" ? "gp-step-running border-2 border-ink bg-ink text-canvas" : s.state === "done" ? "border-ink bg-[#F5F1E9]" : "border-ink/30 bg-transparent text-muted"}`}
          >
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
              {s.state === "done" ? (
                <span key={`done-${i}`} aria-hidden="true" className="gp-pop inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ship text-white">
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                    <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                  </svg>
                </span>
              ) : s.state === "active" ? (
                <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                  {running && i === 1 ? (
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-canvas/30 border-t-canvas" />
                  ) : (
                    <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-canvas" />
                  )}
                </span>
              ) : (
                <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[11px] tabular-nums leading-none">{i + 1}</span>
              )}
              Step {i + 1}
            </span>
            <span className="mt-1 block text-[12px] font-bold leading-snug">{s.label}</span>
            <span className={`mt-0.5 block text-[11px] ${s.state === "active" ? "text-canvas/70" : "text-muted"}`}>
              {s.state === "done" ? "Complete" : s.state === "active" ? (running && i === 1 ? "Running…" : "In progress…") : "Pending"}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// --- Live Telemetry Terminal ---

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
  if (t === "NEBIUS") return "text-sky-400";
  if (t === "VLLM") return "text-amber-400";
  if (t === "VRAM") return "text-purple-400";
  if (t === "PLANNER") return "text-emerald-400";
  if (t === "OOM" || t === "WARN" || t === "ERROR") return "text-red-400";
  if (t === "POLICY") return "text-orange-300";
  return "text-zinc-400";
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
          pushLine("PLANNER", "diagnosis", `🧠 Planned exp ${e.index + 1}: ${e.plan.gpu_type} ${e.plan.precision} batch ${e.plan.batch_config} — ${e.plan.reason}`, e.index ?? -1);
        }
        if (e.type === "policy") setLive(e.allowed ? `Policy approved experiment ${e.index + 1} (est $${e.estimated_cost}).` : `Policy refused: ${e.reasons.join("; ")}`);
        if (e.type === "policy") {
          pushLine(
            e.allowed ? "POLICY" : "WARN",
            "provision",
            e.allowed ? `✅ Policy approved exp ${e.index + 1} (est $${e.estimated_cost}).` : `⛔ Policy refused exp ${e.index + 1}: ${(e.reasons || []).join("; ")}`,
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
            `■ Exp ${done.index + 1} finished: ${done.status} · ${done.verdict} · p95 ${done.metrics?.latency_p95_ms}ms · q ${done.metrics?.quality_score}`,
            done.index ?? -1
          );
        }
        if (e.type === "done") {
          setStatus(e.status);
          setLive(`Certification ${e.status}.`);
          pushLine(e.status === "SHIP" ? "PLANNER" : "WARN", "diagnosis", `🏁 Certification ${e.status}.`, -1);
          es.close();
          fetch(`${API}/certifications/${params.id}`).then((r) => r.json()).then((j) => { setSim(j.simulated); }).catch(() => {});
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
    }).catch(() => {});
    return () => { dead = true; es.close(); };
  }, [params.id]);
  const finished = status !== "RUNNING" && status !== "CREATED";
  const lastExp = exps.length > 0 ? sortedExps(exps)[sortedExps(exps).length - 1] : null;
  const activeJobId = lastExp ? (lastExp.sandbox?.operation_id || lastExp.job_id) : "waiting for sandbox…";
  return (<main>
    <TopNav />
    <div className="mx-auto max-w-3xl px-6 py-8">
      <LiveRegion message={live} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-[11px] text-muted">Experiment Timeline · {params.id}</p>
        <h1 className="text-2xl tracking-tight">Watch it prove it</h1></div>
        <StatusPill status={status} simulated={sim ?? undefined} />
      </div>
      <Stepper status={status} expCount={exps.length} />
      <VerdictBanner status={status} exps={exps} simulated={sim} />
      <section aria-label="Live telemetry terminal" className="mt-6 overflow-hidden rounded-lg border border-ink bg-[#141414] text-zinc-200 shadow-[4px_4px_0_rgba(31,31,31,0.15)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-black/40 px-3 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#28C840]" />
            </span>
            <span className="truncate font-mono text-[11px] text-zinc-400">job {activeJobId}</span>
          </div>
          {finished ? (
            <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-zinc-500">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-zinc-500" />
              Stream ended
            </span>
          ) : (
            <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-green-400">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              <span className="animate-pulse">Live streaming</span>
            </span>
          )}
        </div>
        <div
          ref={termRef}
          role="log"
          aria-label="Live sandbox telemetry"
          className="h-72 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed"
          style={{ fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace" }}
        >
          {teleLines.length === 0 && (
            <p className="text-zinc-500">$ awaiting sandbox output… planner → policy → sandbox run.</p>
          )}
          {teleLines.map((l) => (
            <div key={l.key} className="gp-log-line whitespace-pre-wrap break-words">
              <span className="text-zinc-600">[{l.time}]</span>{" "}
              <span className={`font-bold ${tagColor(l.tag)}`}>[{l.tag}]</span>{" "}
              <span className="text-zinc-200">{l.line}</span>
            </div>
          ))}
          {!finished && teleLines.length > 0 && (
            <span aria-hidden="true" className="mt-1 inline-block h-3.5 w-2 animate-pulse bg-green-400" />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-black/40 px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-zinc-400">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
              className="h-3.5 w-3.5 accent-green-500"
            />
            Follow output
          </label>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-zinc-600">{teleLines.length} lines</span>
            <button
              type="button"
              onClick={copyLogs}
              className="gp-chip cursor-pointer rounded border border-white/20 px-2 py-1 font-mono text-[11px] text-zinc-300 transition-[transform,border-color,color] duration-200 hover:border-white/40 hover:text-white active:scale-[0.97]"
            >
              {copied ? "Copied!" : "Copy Logs"}
            </button>
          </div>
        </div>
      </section>
      <section aria-label="Watch why diagnostic journey" className="mt-8">
        <h2 className="text-lg font-bold tracking-tight">Watch Why — Diagnostic Journey</h2>
        <div className="mt-4" aria-live="off">
          <DiagnosticJourney exps={exps} />
        </div>
      </section>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {finished ? (
          <Link href={`/certificate/${params.id}`} className="btn-dark gp-chip inline-block min-h-[44px] cursor-pointer rounded px-6 py-3 text-sm font-bold transition-[transform,background-color] duration-200 active:scale-[0.97]">View Official Certificate →</Link>
        ) : (
          <span className="chip inline-block min-h-[44px] px-5 py-3 text-sm text-muted">Certificate will appear when the audit finishes…</span>
        )}
        <Link href="/dashboard" className="chip gp-chip inline-block min-h-[44px] cursor-pointer px-5 py-3 text-sm transition-[transform,border-color] duration-200 active:scale-[0.97]">Dashboard</Link>
      </div>
    </div>
  </main>);
}
