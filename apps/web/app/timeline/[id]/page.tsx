"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LiveRegion, StatusPill, TopNav } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

export default function Timeline({ params }: { params: { id: string } }) {
  const [exps, setExps] = useState<any[]>([]);
  const [status, setStatus] = useState("RUNNING");
  const [sim, setSim] = useState<boolean | null>(null);
  const [live, setLive] = useState("Connecting to live run events.");
  const seen = useRef(0);
  useEffect(() => {
    let dead = false;
    const es = new EventSource(`${API}/certifications/${params.id}/events`);
    es.onmessage = (m) => {
      if (dead || !m.data || m.data.startsWith(":") ) return;
      try {
        const e = JSON.parse(m.data);
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
      // SSE fallback: poll the certificate endpoint (general Next.js default; skill stack query had no match)
      fetch(`${API}/certifications/${params.id}/certificate`).then((r) => r.json()).then((j) => {
        if (j.experiments) setExps(j.experiments);
        if (j.verdict && j.verdict !== "SIMULATED") setStatus(j.verdict);
        if (j.simulated !== undefined) setSim(j.simulated);
      }).catch(() => {});
    };
    // initial paint
    fetch(`${API}/certifications/${params.id}/certificate`).then((r) => r.json()).then((j) => {
      if (!dead && j.experiments) setExps(j.experiments);
    }).catch(() => {});
    return () => { dead = true; es.close(); };
  }, [params.id]);
  seen.current = exps.length;
  return (<main>
    <TopNav />
    <div className="mx-auto max-w-3xl px-6 py-8">
      <LiveRegion message={live} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-[11px] text-muted">Experiment Timeline · {params.id}</p>
        <h1 className="text-2xl">Watch it prove it</h1></div>
        <StatusPill status={status} simulated={sim ?? undefined} />
      </div>
      <div className="mt-6 space-y-3" aria-live="off">
        {exps.length === 0 && (<div className="panel animate-pulse rounded p-6 text-sm text-muted">Provisioning first experiment… planner → policy → Nebius job.</div>)}
        {exps.map((e: any) => (
        <div key={e.index} className="panel rounded p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <b>Exp {e.index + 1} · {e.plan.gpu_type} {e.plan.precision} · vLLM · batch {e.plan.batch_config}</b>
            <span className="text-muted">job {e.job_id}{e.simulated ? " · SIMULATED" : ""}</span>
          </div>
          <p className="mt-2 text-[12px]">{e.reason}</p>
          {e.classifier && (<p className="mt-1 text-[11px] text-muted">Classifier: {e.classifier.failure} → {e.classifier.action} · {e.classifier.reason}</p>)}
          <p className="mt-1 text-[11px]">status {e.status} · verdict {e.verdict} · p95 {e.metrics.latency_p95_ms}ms · q {e.metrics.quality_score} · err {e.metrics.error_rate}</p>
          {e.log && (<details className="mt-2 text-[11px]"><summary className="cursor-pointer text-muted">Job log tail</summary><pre className="mt-1 max-h-40 overflow-auto border border-ink/20 p-2">{e.log.slice(-1500)}</pre></details>)}
        </div>))}</div>
      <div className="mt-6 flex gap-3">
        <Link href={`/certificate/${params.id}`} className="btn-dark inline-block min-h-[44px] cursor-pointer rounded px-5 py-3 text-sm transition-colors">View Certificate</Link>
        <Link href="/dashboard" className="chip inline-block min-h-[44px] cursor-pointer px-5 py-3 text-sm">Dashboard</Link>
      </div>
    </div>
  </main>);
}
