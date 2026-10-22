"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopNav } from "@/components/ui";

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
type Metrics = { count?: number; latency?: number; quality?: number };
type Filter = "ALL" | "SHIP" | "BLOCK" | "SIMULATED";
const filters: Filter[] = ["ALL", "SHIP", "BLOCK", "SIMULATED"];

function statusOf(item: CertItem) {
  return item.simulated ? "SIMULATED" : item.status.toUpperCase();
}

function isFinished(item: CertItem) {
  return item.status !== "RUNNING" && item.status !== "CREATED";
}

function dateOf(value?: string | number) {
  if (value == null || value === "") return "—";
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric) ? numeric < 1e11 ? numeric * 1000 : numeric : value;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric" }).format(date);
}

function Stamp({ item }: { item: CertItem }) {
  const status = statusOf(item);
  const tone = status === "SHIP" ? "border-ship/30 bg-ship/10 text-ship"
    : status.startsWith("BLOCK") ? "border-block/30 bg-block/10 text-block"
    : status === "SIMULATED" ? "border-rule bg-paper text-muted"
    : "border-orange/30 bg-orangeWash text-orangeDeep";
  return <span className={`inline-flex shrink-0 justify-center border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}>{status}</span>;
}

export default function Dashboard() {
  const [items, setItems] = useState<CertItem[]>([]);
  const [metrics, setMetrics] = useState<Record<string, Metrics>>({});
  const [budget, setBudget] = useState({ spend: 0, cap: 20 });
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => {
    let alive = true;
    let local: CertItem[] = [];
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem("sandboxproof-certs") || "[]");
      if (Array.isArray(parsed)) local = parsed.filter((entry): entry is CertItem => !!entry && typeof entry.id === "string" && typeof entry.status === "string");
    } catch { /* The server list can still load. */ }
    setItems(local);

    fetch(`${API}/certifications`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load certifications")))
      .then((data) => {
        if (!alive) return;
        const stored: CertItem[] = Array.isArray(data?.stored) ? data.stored : [];
        const memory: CertItem[] = Array.isArray(data?.memory) ? data.memory : [];
        const byId = new Map(local.map((item) => [item.id, item]));
        for (const serverItem of [...stored, ...memory]) {
          if (!serverItem || typeof serverItem.id !== "string") continue;
          const previous = byId.get(serverItem.id);
          byId.set(serverItem.id, { ...previous, ...serverItem, simulated: serverItem.simulated ?? previous?.simulated ?? null });
        }
        setItems([...byId.values()]);
        setBudget({ spend: Number(data.total_spend) || 0, cap: Number(data.cap) || 20 });
        for (const id of byId.keys()) {
          fetch(`${API}/certifications/${encodeURIComponent(id)}/experiments`)
            .then((response) => response.ok ? response.json() : null)
            .then((result) => {
              if (!alive || !Array.isArray(result?.experiments)) return;
              const experiments = result.experiments as { metrics?: { latency_p95_ms?: number; quality_score?: number } }[];
              const latest = experiments[experiments.length - 1];
              setMetrics((current) => ({ ...current, [id]: {
                count: experiments.length,
                latency: latest?.metrics?.latency_p95_ms,
                quality: latest?.metrics?.quality_score,
              } }));
            }).catch(() => {});
        }
      }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const counts: Record<Filter, number> = {
    ALL: items.length,
    SHIP: items.filter((item) => statusOf(item) === "SHIP").length,
    BLOCK: items.filter((item) => statusOf(item).startsWith("BLOCK")).length,
    SIMULATED: items.filter((item) => statusOf(item) === "SIMULATED").length,
  };
  const visible = items.filter((item) => filter === "ALL" || (filter === "BLOCK" ? statusOf(item).startsWith("BLOCK") : statusOf(item) === filter));
  const percent = budget.cap > 0 ? Math.min(100, Math.max(0, budget.spend / budget.cap * 100)) : 0;

  return <main className="min-h-screen bg-paper text-ink">
    <TopNav />
    <div className="mx-auto max-w-wide border-x border-rule">
      <header className="grid border-b border-rule lg:grid-cols-[192px_1fr]">
        <div className="border-b border-rule px-6 py-5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted lg:border-b-0 lg:border-r">05 / Registry</div>
        <div className="px-6 py-10 sm:px-10 sm:py-14">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-orangeDeep"><span className="h-1.5 w-1.5 bg-orange" /> Audit archive</p>
          <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div><h1 className="text-[40px] font-medium leading-[1.05] tracking-[-0.055em] sm:text-[48px]">Certifications.</h1><p className="mt-4 max-w-xl text-[15px] leading-6 text-muted">A traceable record of model verdicts, experiments, and Nebius spend.</p></div>
            <Link href="/new" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-5 rounded-sm bg-ink px-5 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-white transition-colors hover:bg-orange">New audit <span aria-hidden="true">↗</span></Link>
          </div>
        </div>
      </header>

      <section aria-label="Certification totals" className="grid grid-cols-2 border-b border-rule lg:grid-cols-4">
        {([
          ["TOTAL RUNS", counts.ALL, "text-ink"],
          ["SHIP / APPROVED", counts.SHIP, "text-ship"],
          ["BLOCK / REJECTED", counts.BLOCK, "text-block"],
          ["SIMULATED / DEV", counts.SIMULATED, "text-muted"],
        ] as const).map(([label, value, tone], index) => <div key={label} className={`min-h-32 border-rule px-6 py-6 sm:px-8 ${index % 2 === 0 ? "border-r" : ""} ${index < 2 ? "border-b lg:border-b-0" : ""} ${index > 0 && index < 3 ? "lg:border-r" : ""}`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{label}</p>
          <p className={`mt-4 font-mono text-[38px] leading-none tracking-[-0.06em] ${tone}`}>{String(value).padStart(2, "0")}</p>
        </div>)}
      </section>

      <section aria-label="Nebius spend" className="grid border-b border-rule bg-white lg:grid-cols-[192px_1fr]">
        <div className="border-b border-rule px-6 py-6 font-mono text-[11px] uppercase tracking-[0.08em] text-muted lg:border-b-0 lg:border-r">Budget ledger</div>
        <div className="px-6 py-6 sm:px-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">Nebius spend / total cap</p><p className="mt-2 font-mono text-[24px] leading-none tracking-[-0.04em]">${budget.spend.toFixed(2)} <span className="text-[15px] text-muted">/ ${budget.cap.toFixed(2)}</span></p></div>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{percent.toFixed(0)}% utilized</p>
          </div>
          <div role="progressbar" aria-label="Nebius spend against total budget cap" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} className="mt-5 h-2 w-full bg-rule"><div className={`h-full transition-[width] ${percent >= 90 ? "bg-block" : "bg-orange"}`} style={{ width: `${percent}%` }} /></div>
        </div>
      </section>

      <section aria-labelledby="registry-heading" className="px-6 py-10 sm:px-10 sm:py-12">
        <div className="flex flex-col gap-6 border-b border-rule pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="font-mono text-[10px] uppercase tracking-[0.08em] text-orangeDeep">01 / Audit ledger</p><h2 id="registry-heading" className="mt-3 text-[32px] font-medium leading-9 tracking-[-0.055em]">All records</h2></div>
          <p className="max-w-xs text-[13px] leading-[18px] text-muted">Simulated runs are labeled for development and cannot mint production certificates.</p>
        </div>

        <div className="mt-6 flex flex-wrap gap-px border border-rule bg-rule" role="group" aria-label="Filter certifications by status">
          {filters.map((id) => <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id} className={`min-h-11 flex-1 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors sm:flex-none sm:min-w-32 ${filter === id ? "bg-ink text-white" : "bg-white text-muted hover:text-ink"}`}>{id} <span className="ml-1 opacity-70">{counts[id]}</span></button>)}
        </div>

        {visible.length === 0 ? <div className="mt-6 border border-rule bg-white px-6 py-12 text-center">
          <p className="text-lg font-medium tracking-tight">{items.length === 0 ? "No audit records yet." : `No ${filter.toLowerCase()} records yet.`}</p>
          <p className="mt-2 text-[13px] leading-5 text-muted">{items.length === 0 ? "Run a sandbox audit to create the first record." : "Try another status filter to see more records."}</p>
          {items.length === 0 && <Link href="/new" className="mt-6 inline-flex min-h-11 items-center border border-ink px-5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] hover:bg-ink hover:text-white">Start an audit ↗</Link>}
        </div> : <>
          <div className="mt-6 hidden overflow-x-auto border border-rule bg-white md:block">
            <table className="w-full min-w-[800px] table-fixed border-collapse text-left">
              <caption className="sr-only">Historical certification records</caption>
              <colgroup><col className="w-[31%]" /><col className="w-[16%]" /><col className="w-[14%]" /><col className="w-[11%]" /><col className="w-[12%]" /><col className="w-[16%]" /></colgroup>
              <thead className="border-b border-rule bg-paper font-mono text-[10px] uppercase tracking-[0.08em] text-muted"><tr><th scope="col" className="px-4 py-4 font-medium">Model / record ID</th><th scope="col" className="px-4 py-4 font-medium">Verdict</th><th scope="col" className="px-4 py-4 font-medium">Date</th><th scope="col" className="px-4 py-4 font-medium">Runs</th><th scope="col" className="px-4 py-4 font-medium">Spend</th><th scope="col" className="px-4 py-4 font-medium">P95 / Quality</th></tr></thead>
              <tbody>{visible.map((item) => {
                const metric = metrics[item.id] ?? {};
                return <tr key={item.id} className="group border-b border-rule last:border-b-0 hover:bg-orangeWash/30">
                  <td className="px-4 py-5"><Link href={isFinished(item) ? `/certificate/${encodeURIComponent(item.id)}` : `/timeline/${encodeURIComponent(item.id)}`} className="block font-medium text-ink hover:text-orangeDeep"><span className="block truncate text-[14px]">{item.candidate || "Unspecified model"}</span><span className="mt-1 block truncate font-mono text-[10px] text-muted">{item.id} <span aria-hidden="true" className="text-orange opacity-0 group-hover:opacity-100">↗</span></span></Link></td>
                  <td className="px-4 py-5"><Stamp item={item} /></td>
                  <td className="px-4 py-5 font-mono text-[11px] text-inkSoft">{dateOf(item.created_at)}</td>
                  <td className="px-4 py-5 font-mono text-[12px]">{metric.count ?? item.experiments ?? "—"}</td>
                  <td className="px-4 py-5 font-mono text-[12px]">{typeof item.spend === "number" ? `$${item.spend.toFixed(2)}` : "—"}</td>
                  <td className="px-4 py-5 font-mono text-[11px]">{typeof metric.latency === "number" ? `${Math.round(metric.latency)}ms` : "—"}<span className="mx-1 text-rule">/</span>{typeof metric.quality === "number" ? `${Math.round(metric.quality * 100)}%` : "—"}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div className="mt-6 border-t border-rule md:hidden">{visible.map((item) => {
            const metric = metrics[item.id] ?? {};
            return <Link key={item.id} href={isFinished(item) ? `/certificate/${encodeURIComponent(item.id)}` : `/timeline/${encodeURIComponent(item.id)}`} className="block border-b border-rule bg-white px-4 py-5 transition-colors hover:bg-orangeWash/30">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-[15px] font-medium leading-5">{item.candidate || "Unspecified model"}</p><p className="mt-1 truncate font-mono text-[10px] text-muted">{item.id}</p></div><Stamp item={item} /></div>
              <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-rule pt-4 font-mono text-[11px]"><div><dt className="mb-1 text-[9px] uppercase tracking-[0.08em] text-muted">Date</dt><dd>{dateOf(item.created_at)}</dd></div><div><dt className="mb-1 text-[9px] uppercase tracking-[0.08em] text-muted">Experiments</dt><dd>{metric.count ?? item.experiments ?? "—"}</dd></div><div><dt className="mb-1 text-[9px] uppercase tracking-[0.08em] text-muted">Spend</dt><dd>{typeof item.spend === "number" ? `$${item.spend.toFixed(2)}` : "—"}</dd></div></dl>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.08em] text-orangeDeep">{isFinished(item) ? "View record" : "Watch live"} ↗</p>
            </Link>;
          })}</div>
        </>}
      </section>
    </div>
  </main>;
}
