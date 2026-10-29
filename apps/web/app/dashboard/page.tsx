"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell, StatusPill } from "@/components/ui";

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

export default function Dashboard() {
  const [items, setItems] = useState<CertItem[]>([]);
  const [metrics, setMetrics] = useState<Record<string, Metrics>>({});
  const [budget, setBudget] = useState({ spend: 0, cap: 20 });
  const [filter, setFilter] = useState<Filter>("ALL");
  const filters: Filter[] = ["ALL", "SHIP", "BLOCK", "SIMULATED"];

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

  return (
    <AppShell>
      <div className="app-pad mx-auto max-w-shell">
        {/* Title row */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Runs</h1>
            <p className="mt-1 text-[14px] text-ink2">
              {items.length} crash tests so far — ${budget.spend.toFixed(2)} of the ${budget.cap.toFixed(2)} ledger spent.
            </p>
          </div>
          <Link href="/#launch" className="btn btn-primary btn-round h-10 shrink-0 px-4 text-sm">New crash test</Link>
        </div>

        {/* KPI strip: one container split by hairlines */}
        <section aria-label="Totals" className="kpi-strip mt-8 rounded-card border border-line bg-surface" style={{ ["--kpi-n" as string]: 4 }}>
          <div className="kpi-cell">
            <p className="kpi-label">Total runs</p>
            <p className="kpi-value mt-1.5 tabular-nums">{counts.ALL}</p>
          </div>
          <div className="kpi-cell">
            <p className="kpi-label">Shipped</p>
            <p className="kpi-value mt-1.5 tabular-nums text-ship">{counts.SHIP}</p>
          </div>
          <div className="kpi-cell">
            <p className="kpi-label">Blocked</p>
            <p className="kpi-value mt-1.5 tabular-nums text-block">{counts.BLOCK}</p>
          </div>
          <div className="kpi-cell">
            <p className="kpi-label">Ledger spent</p>
            <p className="kpi-value mt-1.5 tabular-nums">
              ${budget.spend.toFixed(2)}
              <span className="text-[15px] font-normal text-ink2"> / ${budget.cap.toFixed(2)}</span>
            </p>
            <div className={`meter mt-2.5 ${percent >= 90 ? "meter-block" : ""}`} role="progressbar" aria-label="Nebius spend against total budget cap" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${percent}%` }} />
            </div>
          </div>
        </section>

        {/* Registry */}
        <section aria-labelledby="registry-heading" className="mt-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="registry-heading" className="text-[17px] font-semibold">Registry</h2>
            <p className="max-w-sm text-[13px] leading-snug text-ink2">
              Simulated runs are labelled for development and cannot mint production certificates.
            </p>
          </div>

          {/* Underline tabs */}
          <div className="mt-5 border-b border-line" role="group" aria-label="Filter runs by verdict">
            <div className="flex gap-1 overflow-x-auto">
              {filters.map((id) => {
                const active = filter === id;
                const label = id === "ALL" ? "All" : id === "SIMULATED" ? "Simulated" : id;
                return (
                  <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={active}
                    className={`relative shrink-0 px-3 pb-2.5 pt-1.5 text-[14px] transition-colors ${active ? "font-medium text-ink" : "text-ink2 hover:text-ink"}`}>
                    {label} <span className="text-[12.5px] text-ink2 tabular-nums">{counts[id]}</span>
                    {active && <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-0.5 bg-ink" />}
                  </button>
                );
              })}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="mt-6 rounded-card border border-line bg-surface px-6 py-14 text-center">
              <p className="text-[16px] font-medium">{items.length === 0 ? "No runs yet" : `No ${filter === "ALL" ? "" : filter.toLowerCase() + " "}runs here yet`}</p>
              <p className="mx-auto mt-2 max-w-sm text-[14px] text-ink2">
                {items.length === 0
                  ? "Pick a model in the crash-test lab and launch the first certification."
                  : "Try another verdict tab to see the rest of the registry."}
              </p>
              {items.length === 0 && <Link href="/#launch" className="btn btn-primary btn-round mt-6 h-10 px-4 text-sm">Open the crash-test lab</Link>}
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="mt-4 hidden overflow-x-auto md:block">
                <table className="ttable min-w-[840px]">
                  <caption className="sr-only">Certification records</caption>
                  <colgroup><col className="w-[30%]" /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[10%]" /><col className="w-[11%]" /><col className="w-[13%]" /><col className="w-[12%]" /></colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Model / record</th>
                      <th scope="col">Verdict</th>
                      <th scope="col">Date</th>
                      <th scope="col" className="!text-right">Exps</th>
                      <th scope="col" className="!text-right">Spend</th>
                      <th scope="col" className="!text-right">P95</th>
                      <th scope="col" className="!text-right">Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => {
                      const metric = metrics[item.id] ?? {};
                      return (
                        <tr key={item.id}>
                          <td>
                            <Link href={isFinished(item) ? `/certificate/${encodeURIComponent(item.id)}` : `/timeline/${encodeURIComponent(item.id)}`} className="group block max-w-[280px]">
                              <span className="block truncate text-[14px] font-medium text-ink group-hover:text-accentInk">{item.candidate || "Unspecified model"}</span>
                              <span className="mono block truncate text-[11.5px] text-ink2">{item.id}</span>
                            </Link>
                          </td>
                          <td><StatusPill status={item.status} simulated={item.simulated} /></td>
                          <td className="text-ink2">{dateOf(item.created_at)}</td>
                          <td className="tnum">{metric.count ?? item.experiments ?? "—"}</td>
                          <td className="tnum">{typeof item.spend === "number" ? `$${item.spend.toFixed(2)}` : "—"}</td>
                          <td className="tnum">{typeof metric.latency === "number" ? `${Math.round(metric.latency).toLocaleString()} ms` : "—"}</td>
                          <td className="tnum">{typeof metric.quality === "number" ? `${Math.round(metric.quality * 100)}%` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile rows */}
              <div className="mt-2 md:hidden">
                {visible.map((item) => {
                  const metric = metrics[item.id] ?? {};
                  return (
                    <Link key={item.id} href={isFinished(item) ? `/certificate/${encodeURIComponent(item.id)}` : `/timeline/${encodeURIComponent(item.id)}`}
                      className="block border-b border-rule py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-medium">{item.candidate || "Unspecified model"}</p>
                          <p className="mono mt-0.5 truncate text-[11.5px] text-ink2">{item.id}</p>
                        </div>
                        <StatusPill status={item.status} simulated={item.simulated} />
                      </div>
                      <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px]">
                        <div><dt className="text-[12px] text-ink2">Date</dt><dd className="mt-0.5">{dateOf(item.created_at)}</dd></div>
                        <div><dt className="text-[12px] text-ink2">Experiments</dt><dd className="mt-0.5 tabular-nums">{metric.count ?? item.experiments ?? "—"}</dd></div>
                        <div><dt className="text-[12px] text-ink2">Spend</dt><dd className="mt-0.5 tabular-nums">{typeof item.spend === "number" ? `$${item.spend.toFixed(2)}` : "—"}</dd></div>
                      </dl>
                      <p className="mt-3 text-[13px] font-medium text-accentInk">{isFinished(item) ? "View certificate" : "Watch live"} →</p>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}
