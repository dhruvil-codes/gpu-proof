"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function Dashboard() {
  const [items, setItems] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem("gpuproof-certs") || "[]"); } catch { return []; }
  });
  useEffect(() => { localStorage.setItem("gpuproof-certs", JSON.stringify(items)); }, [items]);
  return (<main className="px-6 py-8">
    <div className="flex items-center justify-between"><h1 className="text-2xl">Dashboard</h1>
    <Link href="/new" className="btn-dark rounded px-4 py-2 text-sm">+ New Certification</Link></div>
    <p className="mt-1 text-xs text-muted">Budget: $20.00 hard cap · $10.00 per certification · simulator runs labelled SIMULATED.</p>
    <div className="mt-6 grid gap-3">{items.length === 0 && (<div className="panel rounded p-6 text-sm text-muted">No certifications yet. Start one to see SHIP / BLOCK / RUNNING here.</div>)}
      {items.map((c) => (<Link key={c.id} href={`/timeline/${c.id}`} className="panel flex items-center justify-between rounded p-4">
        <div><p className="text-sm font-bold">{c.id}</p><p className="text-[11px] text-muted">{c.candidate} · {c.experiments} exps · ${c.spend}</p></div>
        <span className={`rounded px-2 py-1 text-[11px] ${c.status === "SHIP" ? "bg-ship text-white" : c.status === "BLOCK" ? "bg-block text-white" : "border border-ink"}`}>{c.simulated ? "SIMULATED" : c.status}</span>
      </Link>))}</div>
  </main>);
}
