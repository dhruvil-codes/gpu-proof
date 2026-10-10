"use client";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

export default function Certificate({ params }: { params: { id: string } }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { fetch(`${API}/certifications/${params.id}/certificate`).then((r) => r.json()).then(setD).catch(() => {}); }, [params.id]);
  if (!d) return <main className="p-8 text-sm">Loading certificate…</main>;
  const ship = d.verdict === "SHIP";
  return (<main className="mx-auto max-w-3xl px-6 py-8 text-center">
    <p className="text-[11px] text-muted">Certificate · {params.id}</p>
    <div className={`mx-auto mt-4 inline-block rounded px-10 py-6 text-4xl font-bold ${ship ? "bg-ship text-white" : d.verdict === "SIMULATED" ? "border border-ink" : "bg-block text-white"}`}>{d.verdict}</div>
    {d.note && (<p className="mx-auto mt-3 max-w-md text-xs text-muted">{d.note}</p>)}
    <div className="panel mt-6 rounded p-4 text-left text-xs">
      <p className="font-bold">Evidence (measured)</p>
      <pre className="mt-2 overflow-auto">{JSON.stringify(d.experiments ?? d.evidence ?? d, null, 2).slice(0, 4000)}</pre>
    </div>
  </main>);
}
