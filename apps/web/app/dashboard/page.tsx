"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BudgetMeter, StatusPill, TopNav } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

type CertItem = {
  id: string;
  candidate?: string;
  status: string;
  spend?: number;
  experiments?: number;
  simulated?: boolean | null;
  created_at?: string | number;
};

type CertDetails = { count?: number; latency?: number; quality?: number };

type Filter = "ALL" | "SHIP" | "BLOCK" | "SIM";

function displayStatus(c: CertItem): string {
  if (c.simulated) return "SIMULATED";
  return c.status;
}

function isFinished(c: CertItem): boolean {
  return c.status !== "RUNNING" && c.status !== "CREATED";
}

function formatDate(ts?: string | number): string | null {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString();
  } catch {
    return null;
  }
}

export default function Dashboard() {
  const [items, setItems] = useState<CertItem[]>([]);
  const [details, setDetails] = useState<Record<string, CertDetails>>({});
  const [cap, setCap] = useState({ spend: 0, cap: 20 });
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => {
    let alive = true;
    let base: CertItem[] = [];
    try { base = JSON.parse(localStorage.getItem("gpuproof-certs") || "[]"); } catch {}
    if (alive) setItems(base);
    fetch(`${API}/certifications`).then((r) => r.json()).then((j) => {
      if (!alive) return;
      if (j?.stored?.length) setItems((prev) => {
        const byId = new Map(prev.map((x: CertItem) => [x.id, x]));
        for (const s of j.stored) {
          const cur = byId.get(s.id) ?? { id: s.id, candidate: "", experiments: 0, status: "RUNNING", simulated: null };
          byId.set(s.id, {
            ...cur, status: s.status, spend: s.spend,
            simulated: s.simulated ?? cur.simulated ?? null,
          });
        }
        return [...byId.values()];
      });
      else setItems(base);
      setCap({ spend: j.total_spend ?? 0, cap: j.cap ?? 20 });
      // Progressive enhancement: per-cert metrics for the snippet (never blocks the list).
      const ids: string[] = (j?.stored ?? base).map((s: { id: string }) => s.id);
      for (const id of ids) {
        fetch(`${API}/certifications/${id}/experiments`).then((r) => r.json()).then((e) => {
          if (!alive || !e?.experiments) return;
          const arr = e.experiments as { metrics?: { latency_p95_ms: number; quality_score: number } }[];
          const last = arr[arr.length - 1];
          setDetails((prev) => ({
            ...prev,
            [id]: {
              count: arr.length,
              latency: last?.metrics?.latency_p95_ms,
              quality: last?.metrics?.quality_score,
            },
          }));
        }).catch(() => {});
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const total = items.length;
  const ship = items.filter((c) => displayStatus(c) === "SHIP").length;
  const blocked = items.filter((c) => displayStatus(c).startsWith("BLOCK")).length;
  const simCount = items.filter((c) => displayStatus(c) === "SIMULATED").length;

  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: "ALL", label: "All", count: total },
    { id: "SHIP", label: "SHIP", count: ship },
    { id: "BLOCK", label: "BLOCK", count: blocked },
    { id: "SIM", label: "Simulated / Dev", count: simCount },
  ];

  const visible = items.filter((c) => {
    const s = displayStatus(c);
    if (filter === "SHIP") return s === "SHIP";
    if (filter === "BLOCK") return s.startsWith("BLOCK");
    if (filter === "SIM") return s === "SIMULATED";
    return true;
  });

  return (<main>
    <TopNav />
    <div className="mx-auto w-full max-w-[1280px] px-4 py-5 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl tracking-tight">Certification Portfolio</h1>
          <p className="mt-1 text-xs text-muted">Every audit, every verdict, every dollar — one executive overview.</p>
        </div>
        <Link href="/new" className="btn-dark min-h-[44px] cursor-pointer rounded px-4 py-2 text-sm font-bold transition-colors">+ New Certification</Link>
      </div>

      {/* Executive stats bar */}
      <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <div className="panel rounded-lg p-3.5">
          <p className="text-[10px] uppercase tracking-widest text-muted">Total Certifications Run</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">{total}</p>
        </div>
        <div className="panel rounded-lg border-l-4 border-l-ship p-3.5">
          <p className="text-[10px] uppercase tracking-widest text-muted">Production Approved (SHIP)</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ship">{ship}</p>
        </div>
        <div className="panel rounded-lg border-l-4 border-l-block p-3.5">
          <p className="text-[10px] uppercase tracking-widest text-muted">Production Blocked (BLOCK)</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-block">{blocked}</p>
        </div>
        <div className="panel rounded-lg p-3.5">
          <p className="text-[10px] uppercase tracking-widest text-muted">Total Spend Guardrail</p>
          <div className="mt-1"><BudgetMeter spend={cap.spend} cap={cap.cap} /></div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter certifications by status">
        {tabs.map((t) => {
          const active = filter === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              aria-pressed={active}
              className={`min-h-[44px] cursor-pointer rounded-full border px-4 py-2 text-xs font-bold transition-colors ${active ? "border-ink bg-ink text-canvas" : "border-ink bg-transparent hover:bg-ink/5"}`}
            >
              {t.label} · {t.count}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-muted">Simulator runs are labelled SIMULATED and can never mint certificates.</p>

      {/* Cards — dense 2-column grid on desktop, stacked on mobile */}
      <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
        {items.length === 0 && (
          <div className="panel rounded-lg p-6 text-center lg:col-span-2">
            <p className="text-lg font-bold tracking-tight">No certifications yet — run your first audit in one click.</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted">Pick a scenario template (cost, latency, or accuracy), and GPUProof will stress-test the candidate model on Nebius GPUs and issue a SHIP / BLOCK certificate.</p>
            <Link href="/new" className="btn-dark mt-4 inline-block min-h-[44px] cursor-pointer rounded px-6 py-3 text-sm font-bold transition-colors">Run Your First Certification →</Link>
          </div>
        )}
        {items.length > 0 && visible.length === 0 && (
          <div className="panel rounded-lg p-6 text-center text-sm text-muted lg:col-span-2">No certifications match this filter yet.</div>
        )}
        {visible.map((c) => {
          const det = details[c.id] ?? {};
          const expCount = det.count ?? c.experiments ?? 0;
          const spend = typeof c.spend === "number" ? `$${c.spend.toFixed(2)}` : "$—";
          const lat = typeof det.latency === "number" ? `${det.latency}ms` : "—";
          const qual = typeof det.quality === "number" ? `${Math.round(det.quality * 100)}%` : "—";
          const date = formatDate(c.created_at);
          const title = c.candidate || c.id;
          return (
            <Link
              key={c.id}
              href={isFinished(c) ? `/certificate/${c.id}` : `/timeline/${c.id}`}
              className="panel flex cursor-pointer items-center justify-between gap-3 rounded-lg p-4 transition-shadow hover:shadow-[3px_3px_0_#1F1F1F]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{title}</p>
                <p className="mt-0.5 text-[11px] text-muted">{date ?? c.id}{title !== c.id && date ? ` · ${c.id}` : ""}</p>
                <p className="mt-1 font-mono text-[11px]">Experiments: {expCount} · Spend: {spend} · Latency: {lat} · Quality: {qual}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <StatusPill status={c.status} simulated={c.simulated} />
                <span className="text-xs font-bold">{isFinished(c) ? "View Certificate →" : "Watch Live →"}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  </main>);
}
