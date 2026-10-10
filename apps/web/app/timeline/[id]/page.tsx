"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

export default function Timeline({ params }: { params: { id: string } }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const c = await (await fetch(`${API}/certifications/${params.id}`)).json();
        const cert = await (await fetch(`${API}/certifications/${params.id}/certificate`)).json();
        if (alive) setData({ ...c, detail: cert });
      } catch {}
    }
    poll(); const t = setInterval(poll, 3000); return () => { alive = false; clearInterval(t); };
  }, [params.id]);
  if (!data) return <main className="p-8 text-sm">Loading {params.id}…</main>;
  const exps = data.detail?.experiments || [];
  return (<main className="mx-auto max-w-3xl px-6 py-8">
    <p className="text-[11px] text-muted">Experiment Timeline · {params.id}</p>
    <h1 className="text-2xl">Watch it prove it</h1>
    <div className="mt-6 space-y-3">{exps.map((e: any) => (
      <div key={e.index} className="panel rounded p-4">
        <div className="flex items-center justify-between text-xs">
          <b>Exp {e.index + 1} · {e.plan.gpu_type} {e.plan.precision} · vLLM</b>
          <span className="text-muted">job {e.job_id}{e.simulated ? " · SIMULATED" : ""}</span>
        </div>
        <p className="mt-2 text-[12px]">{e.reason}</p>
        {e.classifier && (<p className="mt-1 text-[11px] text-muted">Classifier: {e.classifier.failure} → {e.classifier.action} · {e.classifier.reason}</p>)}
        <p className="mt-1 text-[11px]">status {e.status} · verdict {e.verdict} · p95 {e.metrics.latency_p95_ms}ms · q {e.metrics.quality_score}</p>
      </div>))}</div>
    <Link href={`/certificate/${params.id}`} className="btn-dark mt-6 inline-block rounded px-5 py-3 text-sm">View Certificate</Link>
  </main>);
}
