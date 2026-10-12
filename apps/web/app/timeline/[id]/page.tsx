"use client";
import { useEffect, useRef, useState } from "react";
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
          setLive(`Experiment ${e.index + 1} starting: planner → policy → Nebius job.`);
          pushLine("NEBIUS", "provision", `—— Experiment ${e.index + 1} starting: planner → policy → Nebius job.`, e.index ?? -1);
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
  const activeJobId = exps.length > 0 ? exps[exps.length - 1].job_id : "waiting for job…";
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
          aria-label="Live GPU engine telemetry"
          className="h-72 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed"
          style={{ fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace" }}
        >
          {teleLines.length === 0 && (
            <p className="text-zinc-500">$ awaiting GPU engine output… planner → policy → Nebius job.</p>
          )}
          {teleLines.map((l) => (
            <div key={l.key} className="whitespace-pre-wrap break-words">
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
              className="cursor-pointer rounded border border-white/20 px-2 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-white/40 hover:text-white"
            >
              {copied ? "Copied!" : "Copy Logs"}
            </button>
          </div>
        </div>
      </section>
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
