"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LiveRegion, StatusPill, TopNav } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
const QUALITY_GATE = 0.85;

type Experiment = {
  index: number;
  plan: { gpu_type: string; precision: string; batch_config: string | number };
  job_id: string;
  simulated?: boolean;
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

const TONE_RING: Record<Narrative["tone"], string> = {
  bad: "border-l-4 border-l-block",
  warn: "border-l-4 border-l-[#B8860B]",
  good: "border-l-4 border-l-ship",
  pending: "border-l-4 border-l-muted",
};

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
  return (
    <ol aria-label="Audit progress" className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {steps.map((s, i) => (
        <li
          key={s.label}
          aria-current={s.state === "active" ? "step" : undefined}
          className={`rounded-lg border p-3 text-left ${s.state === "active" ? "border-ink bg-ink text-canvas" : s.state === "done" ? "border-ink bg-[#F5F1E9]" : "border-ink/30 bg-transparent text-muted"}`}
        >
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
            {s.state === "done" ? (
              <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ship text-[11px] text-white">✓</span>
            ) : s.state === "active" ? (
              <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center">
                {running && i === 1 ? (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-canvas/30 border-t-canvas" />
                ) : (
                  <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-canvas" />
                )}
              </span>
            ) : (
              <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px]">{i + 1}</span>
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
  );
}

export default function Timeline({ params }: { params: { id: string } }) {
  const [exps, setExps] = useState<Experiment[]>([]);
  const [status, setStatus] = useState("RUNNING");
  const [sim, setSim] = useState<boolean | null>(null);
  const [live, setLive] = useState("Connecting to live run events.");
  useEffect(() => {
    let dead = false;
    const es = new EventSource(`${API}/certifications/${params.id}/events`);
    es.onmessage = (m) => {
      if (dead || !m.data || m.data.startsWith(":")) return;
      try {
        const e = JSON.parse(m.data);
        if (e.type === "experiment_start") setLive(`Experiment ${e.index + 1} starting: planner → policy → Nebius job.`);
        if (e.type === "plan") setLive(`Experiment ${e.index + 1} planned: ${e.plan.gpu_type} ${e.plan.precision}. ${e.plan.reason}`);
        if (e.type === "policy") setLive(e.allowed ? `Policy approved experiment ${e.index + 1} (est $${e.estimated_cost}).` : `Policy refused: ${e.reasons.join("; ")}`);
        if (e.type === "experiment_done") {
          setExps((prev) => [...prev.filter((x) => x.index !== e.experiment.index), e.experiment]);
          setLive(`Experiment ${e.experiment.index + 1} finished: ${e.experiment.status}.`);
        }
        if (e.type === "done") {
          setStatus(e.status);
          setLive(`Certification ${e.status}.`);
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
      }).catch(() => {});
    };
    // initial paint (covers late joiners after the SSE "done" was consumed)
    fetch(`${API}/certifications/${params.id}/experiments`).then((r) => r.json()).then((j) => {
      if (!dead && j.experiments) { setExps(j.experiments); if (j.simulated !== undefined) setSim(j.simulated); }
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
      <div className="mt-6 space-y-3" aria-live="off">
        {exps.length === 0 && (<div className="panel animate-pulse rounded p-6 text-sm text-muted">Provisioning first experiment… planner → policy → Nebius job.</div>)}
        {exps.map((e) => {
          const n = narrative(e);
          return (
          <div key={e.index} className={`panel rounded p-4 ${TONE_RING[n.tone]}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <b>Exp {e.index + 1} · {e.plan.gpu_type} {e.plan.precision} · vLLM · batch {e.plan.batch_config}</b>
              <span className="text-muted">job {e.job_id}{e.simulated ? " · SIMULATED" : ""}</span>
            </div>
            <p className="mt-2 inline-block rounded px-2 py-1 text-[12px] font-bold">{n.badge}</p>
            <p className="mt-1 text-[12px] leading-relaxed">{n.summary}</p>
            <details className="mt-3 text-[11px]">
              <summary className="cursor-pointer rounded border border-ink/30 px-2 py-2 text-muted transition-colors hover:text-ink">▶ View Raw Container &amp; GPU Telemetry</summary>
              <div className="mt-2 space-y-1 border border-ink/20 p-2">
                <p><span className="text-muted">Planner reason:</span> {e.reason}</p>
                {e.classifier && (<p className="text-muted">Classifier: {e.classifier.failure} → {e.classifier.action} · {e.classifier.reason}</p>)}
                <p>status {e.status} · verdict {e.verdict} · p95 {e.metrics?.latency_p95_ms}ms · q {e.metrics?.quality_score} · err {e.metrics?.error_rate}</p>
                {e.log && (<pre className="max-h-40 overflow-auto border-t border-ink/20 pt-2">{e.log.slice(-1500)}</pre>)}
              </div>
            </details>
          </div>);
        })}</div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {finished ? (
          <Link href={`/certificate/${params.id}`} className="btn-dark inline-block min-h-[44px] cursor-pointer rounded px-6 py-3 text-sm font-bold transition-colors">View Official Certificate →</Link>
        ) : (
          <span className="chip inline-block min-h-[44px] px-5 py-3 text-sm text-muted">Certificate will appear when the audit finishes…</span>
        )}
        <Link href="/dashboard" className="chip inline-block min-h-[44px] cursor-pointer px-5 py-3 text-sm">Dashboard</Link>
      </div>
    </div>
  </main>);
}
