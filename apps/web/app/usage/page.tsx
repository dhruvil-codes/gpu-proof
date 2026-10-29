"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell, StatusPill, useApi } from "@/components/ui";

/* ==========================================================================
   Usage & spend — every run accounted for.
   Audit spend: backend ledger (source of truth, $10/cert + $20 total caps).
   Sandbox cost: session duration × Oct 2026 GPU rate (estimate, $0 in Demo).
   Simulator runs always cost $0.00 — shown, never hidden.
   ========================================================================== */

const RATES: Record<string, { label: string; price: number }> = {
  L40S: { label: "L40S · 48GB", price: 1.35 },
  R6000: { label: "RTX PRO 6000 · 96GB", price: 1.8 },
  H100: { label: "H100 · 80GB", price: 4.5 },
  H200: { label: "H200 · 141GB", price: 5.4 },
  B200: { label: "B200 · 180GB", price: 8.5 },
  H100X8: { label: "8× H100 · 640GB", price: 36.0 },
};

type Cert = { id: string; status: string; spend: number; simulated?: boolean | null };
type SandboxRec = {
  id: string;
  cert?: string;
  model?: string;
  gpu?: string;
  prompts?: number;
  tokens?: number;
  meanTtftMs?: number;
  meanItlMs?: number;
  elapsedSec?: number;
  exported_at?: string;
};

function fmtClock(s?: number) {
  if (typeof s !== "number" || !Number.isFinite(s)) return "—";
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

export default function Usage() {
  const API = useApi();
  const [certs, setCerts] = useState<Cert[]>([]);
  const [cap, setCap] = useState(20);
  const [sessions, setSessions] = useState<SandboxRec[]>([]);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API}/certifications`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return;
        setBackendUp(true);
        setCerts(Array.isArray(j.memory) ? j.memory : []);
        if (typeof j.cap === "number") setCap(j.cap);
      })
      .catch(() => {
        if (alive) setBackendUp(false);
      });
    try {
      const out: SandboxRec[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("sandboxproof-sandbox-")) {
          try {
            out.push(JSON.parse(localStorage.getItem(k) || "{}"));
          } catch {
            /* skip corrupt entries */
          }
        }
      }
      setSessions(out.filter((s) => s && s.id));
    } catch {
      /* private mode */
    }
    return () => {
      alive = false;
    };
  }, [API]);

  const auditSpend = Math.round(certs.reduce((s, c) => s + (c.spend || 0), 0) * 100) / 100;
  const simCount = certs.filter((c) => c.simulated).length;
  const sandboxCost = Math.round(
    sessions.reduce((s, x) => {
      const rate = RATES[x.gpu || ""]?.price ?? 0;
      return typeof x.elapsedSec === "number" ? s + (x.elapsedSec / 3600) * rate : s;
    }, 0) * 100
  ) / 100;
  const pricedCount = sessions.filter((x) => typeof x.elapsedSec === "number").length;
  const totPrompts = sessions.reduce((s, x) => s + (x.prompts || 0), 0);
  const totTokens = sessions.reduce((s, x) => s + (x.tokens || 0), 0);
  const pctUsed = Math.min(100, (auditSpend / Math.max(1, cap)) * 100);

  return (
    <AppShell>
      <div className="app-pad mx-auto max-w-shell">
        <div className="max-w-2xl">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Spend</h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink2">
            Every run accounted for. The audit ledger comes from the backend (source of truth); sandbox sessions are
            estimated from duration × October 2026 rates. Simulator runs are $0.00 — shown, never hidden.
            {backendUp === false && " Backend unreachable — showing local sessions only."}
          </p>
        </div>

        <section aria-label="Spend totals" className="kpi-strip mt-8 rounded-card border border-line bg-surface max-sm:grid-cols-2" style={{ ["--kpi-n" as string]: 4 }}>
          <div className="kpi-cell">
            <p className="kpi-label">Audit spend</p>
            <p className="kpi-value mt-1.5 tabular-nums">
              ${auditSpend.toFixed(2)}
              <span className="text-[15px] font-normal text-ink2"> / ${cap.toFixed(2)}</span>
            </p>
            <p className="mt-1 text-[12.5px] text-ink2">{certs.length} audits · {simCount} simulated</p>
          </div>
          <div className="kpi-cell">
            <p className="kpi-label">Sandbox estimate</p>
            <p className="kpi-value mt-1.5 tabular-nums">${sandboxCost.toFixed(2)}</p>
            <p className="mt-1 text-[12.5px] text-ink2">{sessions.length} sessions{pricedCount < sessions.length ? ` · ${sessions.length - pricedCount} pre-timing` : ""}</p>
          </div>
          <div className="kpi-cell">
            <p className="kpi-label">Console prompts</p>
            <p className="kpi-value mt-1.5 tabular-nums">{totPrompts}</p>
            <p className="mt-1 text-[12.5px] text-ink2">{totTokens.toLocaleString("en-US")} session tokens</p>
          </div>
          <div className="kpi-cell">
            <p className="kpi-label">Enforced caps</p>
            <p className="kpi-value mt-1.5 tabular-nums">$10 <span className="text-[15px] font-normal text-ink2">/</span> $20</p>
            <p className="mt-1 text-[12.5px] text-ink2">per certification · project total</p>
          </div>
        </section>

        <div className={`meter mt-4 ${pctUsed >= 90 ? "meter-block" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pctUsed)} aria-label="Budget used">
          <span style={{ width: `${pctUsed}%` }} />
        </div>

        <section aria-label="Audit ledger" className="mt-12">
          <h2 className="text-[17px] font-semibold">Audit ledger <span className="text-[13.5px] font-normal text-ink2">— backend, real spend</span></h2>
          {certs.length === 0 ? (
            <p className="mt-4 rounded-card border border-line bg-surface p-5 text-[14px] text-ink2">
              {backendUp === false ? "Backend unreachable — start it to see the ledger." : "No audits yet — mint one from the crash-test lab or a sandbox export."}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-card border border-line bg-surface">
              <table className="ttable min-w-[560px]">
                <thead>
                  <tr>
                    <th scope="col">Certification</th>
                    <th scope="col">Status</th>
                    <th scope="col">Mode</th>
                    <th scope="col" className="!text-right">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {certs.slice(0, 30).map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/certificate/${c.id}`} className="mono font-medium hover:text-accentInk">{c.id}</Link>
                      </td>
                      <td><StatusPill status={c.status} simulated={c.simulated} /></td>
                      <td className="text-ink2">{c.simulated ? "simulator ($0)" : "measured"}</td>
                      <td className="tnum">${(c.spend || 0).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-label="Sandbox sessions" className="mt-12">
          <h2 className="text-[17px] font-semibold">Sandbox sessions <span className="text-[13.5px] font-normal text-ink2">— this browser, harness-simulated console</span></h2>
          {sessions.length === 0 ? (
            <p className="mt-4 rounded-card border border-line bg-surface p-5 text-[14px] text-ink2">
              No exported sessions yet — export from any sandbox console session to record it here.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-card border border-line bg-surface">
              <table className="ttable min-w-[720px]">
                <thead>
                  <tr>
                    <th scope="col">Session</th>
                    <th scope="col">Model → GPU</th>
                    <th scope="col" className="!text-right">Prompts / tokens</th>
                    <th scope="col" className="!text-right">TTFT / ITL</th>
                    <th scope="col" className="!text-right">Time · estimate</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const rate = RATES[s.gpu || ""]?.price ?? 0;
                    const cost = typeof s.elapsedSec === "number" ? (s.elapsedSec / 3600) * rate : null;
                    return (
                      <tr key={s.id}>
                        <td>
                          {s.cert ? <Link href={`/certificate/${s.cert}`} className="mono font-medium hover:text-accentInk">{s.id}</Link> : <span className="mono font-medium">{s.id}</span>}
                        </td>
                        <td className="max-w-[260px] truncate text-ink2" title={`${s.model} → ${s.gpu}`}>{(s.model || "—").split("/").pop()} → {RATES[s.gpu || ""]?.label ?? s.gpu ?? "—"}</td>
                        <td className="tnum">{s.prompts ?? 0} / {(s.tokens ?? 0).toLocaleString("en-US")}</td>
                        <td className="tnum">{s.meanTtftMs ?? "—"} / {s.meanItlMs ?? "—"} ms</td>
                        <td className="tnum">{fmtClock(s.elapsedSec)} · {cost === null ? "—" : `$${cost.toFixed(2)}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
