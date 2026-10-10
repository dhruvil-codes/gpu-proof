"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { TopNav } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

export default function Certificate({ params }: { params: { id: string } }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch(`${API}/certifications/${params.id}/certificate`);
        const j = await r.json();
        if (alive) setD(j);
      } catch {}
    }
    load(); const t = setInterval(load, 4000); return () => { alive = false; clearInterval(t); };
  }, [params.id]);
  if (!d) return (<main><TopNav /><p className="p-8 text-sm">Loading certificate…</p></main>);
  const ship = d.verdict === "SHIP";
  const sim = d.verdict === "SIMULATED";
  const rows = (d.experiments ?? []).map((e: any) => ({
    exp: `Exp ${e.index + 1} ${e.plan.gpu_type}/${e.plan.precision}`,
    p95: e.metrics.latency_p95_ms, q: e.metrics.quality_score,
    err: e.metrics.error_rate, status: e.status,
  }));
  return (<main>
    <TopNav />
    <div className="mx-auto max-w-3xl px-6 py-8 text-center">
      <p className="text-[11px] text-muted">Certificate · {params.id}</p>
      <div role="status" aria-label={`verdict ${d.verdict}`} className={`mx-auto mt-4 inline-block rounded px-10 py-6 text-4xl font-bold ${ship ? "bg-ship text-white" : sim ? "border-2 border-ink" : "bg-block text-white"}`}>{d.verdict}</div>
      {d.note && (<p className="mx-auto mt-3 max-w-md text-xs text-muted">{d.note}</p>)}
      {d.failing_gates?.length > 0 && (<div className="panel mx-auto mt-4 max-w-md rounded border-block p-3 text-left text-xs"><p className="font-bold text-block">Failing gates (BLOCK)</p>{d.failing_gates.map((g: any) => (<p key={g.metric}>{g.metric}: observed {g.observed} vs {g.threshold}</p>))}</div>)}
      {rows.length > 0 && (<div className="panel mt-6 overflow-auto rounded p-0 text-left text-xs">
        <table className="w-full">
          <caption className="p-3 text-left font-bold">Current vs Candidate evidence (measured)</caption>
          <thead><tr className="border-y border-ink text-muted"><th className="p-2 text-left">Experiment</th><th className="p-2">P95 ms</th><th className="p-2">Quality</th><th className="p-2">Error</th><th className="p-2">Status</th></tr></thead>
          <tbody>{rows.map((r: any) => (<tr key={r.exp} className="border-b border-ink/10"><td className="p-2">{r.exp}</td><td className="p-2 text-center">{r.p95}</td><td className="p-2 text-center">{r.q}</td><td className="p-2 text-center">{r.err}</td><td className="p-2 text-center">{r.status}</td></tr>))}</tbody>
        </table>
      </div>)}
      <div className="panel mt-6 rounded p-4 text-left text-xs">
        <p className="font-bold">Raw evidence</p>
        <pre className="mt-2 max-h-80 overflow-auto">{JSON.stringify(d.experiments ?? d.evidence ?? d, null, 2).slice(0, 6000)}</pre>
      </div>
      <Link href="/dashboard" className="btn-dark mt-6 inline-block min-h-[44px] cursor-pointer rounded px-5 py-3 text-sm transition-colors">Back to Dashboard</Link>
    </div>
  </main>);
}
