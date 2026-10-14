"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusPill, TopNav, useApi } from "@/components/ui";

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
        if (k && k.startsWith("gpuproof-sandbox-")) {
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

  return (
    <main>
      <TopNav />
      <div className="mx-auto w-full max-w-[1080px] px-4 py-6 lg:px-8">
        <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">Usage &amp; spend · every run accounted for</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">What everything cost</h1>
        <p className="mt-1 font-mono text-sm text-muted">
          Audit ledger: backend (source of truth) · Sandbox: duration × Oct 2026 rates · Simulator runs are $0.00, always.
          {backendUp === false && " Backend unreachable — showing local sessions only."}
        </p>

        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { k: "Audit spend", v: `$${auditSpend.toFixed(2)} / $${cap.toFixed(2)}`, s: `${certs.length} audits · ${simCount} simulated` },
            { k: "Sandbox est.", v: `$${sandboxCost.toFixed(2)}`, s: `${sessions.length} sessions${pricedCount < sessions.length ? ` · ${sessions.length - pricedCount} pre-timing` : ""}` },
            { k: "Console prompts", v: String(totPrompts), s: `${totTokens.toLocaleString("en-US")} session tokens` },
            { k: "Caps", v: "$10 / $20", s: "per-cert · project total (backend enforced)" },
          ].map((c) => (
            <div key={c.k} className="rounded-2xl border border-ink/15 bg-[#F5F1E9] p-4">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted">{c.k}</p>
              <p className="mt-1 font-mono text-xl font-bold tracking-tight">{c.v}</p>
              <p className="mt-0.5 font-mono text-[11px] text-muted">{c.s}</p>
            </div>
          ))}
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full border border-ink/20" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((auditSpend / Math.max(1, cap)) * 100))} aria-label="Budget used">
          <div className="h-full bg-ink transition-all" style={{ width: `${Math.min(100, (auditSpend / Math.max(1, cap)) * 100)}%` }} />
        </div>

        <section aria-label="Audit ledger" className="mt-6">
          <h2 className="font-mono text-sm font-bold">Audit ledger <span className="font-normal text-muted">(backend · real spend)</span></h2>
          {certs.length === 0 ? (
            <p className="mt-2 rounded-xl border border-ink/15 bg-[#F5F1E9] p-4 font-mono text-xs text-muted">
              {backendUp === false ? "Backend unreachable — start it to see the ledger." : "No audits yet — mint one from /new or a sandbox export."}
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-xl border border-ink/15">
              <table className="w-full min-w-[560px] bg-[#F5F1E9] font-mono text-[11px]">
                <thead>
                  <tr className="border-b border-ink/15 text-left text-muted">
                    <th className="px-3 py-2">Certification</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2 text-right">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {certs.slice(0, 30).map((c) => (
                    <tr key={c.id} className="border-b border-ink/10 last:border-b-0">
                      <td className="px-3 py-2">
                        <Link href={`/certificate/${c.id}`} className="font-bold underline-offset-4 hover:underline">{c.id}</Link>
                      </td>
                      <td className="px-3 py-2"><StatusPill status={c.status} simulated={c.simulated} /></td>
                      <td className="px-3 py-2 text-muted">{c.simulated ? "simulator ($0)" : "measured"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">${(c.spend || 0).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-label="Sandbox sessions" className="mt-6">
          <h2 className="font-mono text-sm font-bold">Sandbox sessions <span className="font-normal text-muted">(this browser · console is harness-simulated)</span></h2>
          {sessions.length === 0 ? (
            <p className="mt-2 rounded-xl border border-ink/15 bg-[#F5F1E9] p-4 font-mono text-xs text-muted">
              No exported sessions yet — export from any sandbox to record it here.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-xl border border-ink/15">
              <table className="w-full min-w-[720px] bg-[#F5F1E9] font-mono text-[11px]">
                <thead>
                  <tr className="border-b border-ink/15 text-left text-muted">
                    <th className="px-3 py-2">Session</th>
                    <th className="px-3 py-2">Model → GPU</th>
                    <th className="px-3 py-2 text-right">Prompts/tok</th>
                    <th className="px-3 py-2 text-right">TTFT/ITL</th>
                    <th className="px-3 py-2 text-right">Time · est.</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const rate = RATES[s.gpu || ""]?.price ?? 0;
                    const cost = typeof s.elapsedSec === "number" ? (s.elapsedSec / 3600) * rate : null;
                    return (
                      <tr key={s.id} className="border-b border-ink/10 last:border-b-0">
                        <td className="px-3 py-2">
                          {s.cert ? <Link href={`/certificate/${s.cert}`} className="font-bold underline-offset-4 hover:underline">{s.id}</Link> : <span className="font-bold">{s.id}</span>}
                        </td>
                        <td className="max-w-[260px] truncate px-3 py-2" title={`${s.model} → ${s.gpu}`}>{(s.model || "—").split("/").pop()} → {RATES[s.gpu || ""]?.label ?? s.gpu ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.prompts ?? 0}/{(s.tokens ?? 0).toLocaleString("en-US")}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.meanTtftMs ?? "—"}ms/{s.meanItlMs ?? "—"}ms</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtClock(s.elapsedSec)} · {cost === null ? "—" : `$${cost.toFixed(2)}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
