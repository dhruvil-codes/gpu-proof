"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BudgetMeter, StatusPill, TopNav } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

export default function Dashboard() {
  const [items, setItems] = useState<any[]>([]);
  const [cap, setCap] = useState({ spend: 0, cap: 20 });
  useEffect(() => {
    try { setItems(JSON.parse(localStorage.getItem("gpuproof-certs") || "[]")); } catch {}
    fetch(`${API}/certifications`).then((r) => r.json()).then((j) => {
      if (j?.stored?.length) setItems((prev) => {
        const ids = new Set(prev.map((x: any) => x.id));
        return [...prev, ...j.stored.filter((x: any) => !ids.has(x.id))];
      });
      setCap({ spend: j.total_spend ?? 0, cap: j.cap ?? 20 });
    }).catch(() => {});
  }, []);
  return (<main>
    <TopNav />
    <div className="px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Dashboard</h1>
        <Link href="/new" className="btn-dark min-h-[44px] cursor-pointer rounded px-4 py-2 text-sm transition-colors">+ New Certification</Link>
      </div>
      <div className="panel mt-4 max-w-xs rounded p-3">
        <p className="text-[11px] font-bold">Spend guardrail</p>
        <BudgetMeter spend={cap.spend} cap={cap.cap} />
      </div>
      <p className="mt-2 text-xs text-muted">Simulator runs are labelled SIMULATED and can never mint certificates.</p>
      <div className="mt-6 grid gap-3">{items.length === 0 && (<div className="panel rounded p-6 text-sm text-muted">No certifications yet. Start one to see SHIP / BLOCK / RUNNING here.</div>)}
        {items.map((c) => (<Link key={c.id} href={`/timeline/${c.id}`} className="panel flex cursor-pointer items-center justify-between gap-3 rounded p-4 transition-shadow hover:shadow-[3px_3px_0_#1F1F1F]">
          <div><p className="text-sm font-bold">{c.id}</p><p className="text-[11px] text-muted">{c.candidate ?? ""} · {c.experiments ?? ""} exps · ${c.spend ?? 0}</p></div>
          <StatusPill status={c.status} simulated={c.simulated} />
        </Link>))}</div>
    </div>
  </main>);
}
