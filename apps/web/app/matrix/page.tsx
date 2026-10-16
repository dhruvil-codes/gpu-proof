"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusPill, TopNav } from "@/components/ui";

/* ==========================================================================
   Matrix — the compounding dataset. Empirical (model, precision) quality
   from every audit + release radar with one-click re-audits + embeddable
   SHIP badges. This page is the MOAT: it only grows.
   ========================================================================== */

type Group = {
  model: string;
  precision: string;
  n: number;
  avg_quality: number;
  last_verdict: string | null;
  simulated: boolean | null;
  cert_id: string | null;
};

type RadarItem = { model: string; note: string; url: string; days_ago_hint?: unknown };

export default function Matrix() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [radar, setRadar] = useState<RadarItem[]>([]);
  const [radarSource, setRadarSource] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    let alive = true;
    Promise.allSettled([fetch("/api/matrix").then((r) => (r.ok ? r.json() : null)), fetch("/api/radar").then((r) => (r.ok ? r.json() : null))]).then(
      ([m, r]) => {
        if (!alive) return;
        if (m.status === "fulfilled" && m.value?.groups) setGroups(m.value.groups);
        if (r.status === "fulfilled" && Array.isArray(r.value?.items)) {
          setRadar(r.value.items);
          setRadarSource(r.value.source || "");
        }
        setLoaded(true);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  async function copySnippet(id: string) {
    const snippet = `<a href="${origin}/certificate/${id}"><img src="${origin}/api/badge/${id}" alt="SandboxProof certified" /></a>`;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(id);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <main>
      <TopNav />
      <div className="mx-auto w-full max-w-[1080px] px-4 py-6 lg:px-8">
        <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">Matrix · the compounding dataset</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">What survives quantization, measured</h1>
        <p className="mt-1 max-w-2xl font-mono text-sm leading-relaxed text-muted">
          Every audit's Nemotron scores accumulate here by model and precision. Syntax can be constrained — semantics must be measured. This table only grows.
        </p>

        <section aria-label="Precision quality matrix" className="mt-5">
          <h2 className="font-mono text-sm font-bold">Precision × quality <span className="font-normal text-muted">(empirical, all audits)</span></h2>
          {!loaded ? (
            <p className="mt-2 font-mono text-xs text-muted">Loading matrix…</p>
          ) : groups.length === 0 ? (
            <p className="mt-2 rounded-xl border border-ink/15 bg-[#F5F1E9] p-4 font-mono text-xs text-muted">
              No scored audits yet — mint one from /new and its Nemotron scores land here automatically.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-xl border border-ink/15">
              <table className="w-full min-w-[640px] bg-[#F5F1E9] font-mono text-[12px]">
                <thead>
                  <tr className="border-b border-ink/15 text-left text-muted">
                    <th className="px-3 py-2">Model</th>
                    <th className="px-3 py-2">Precision</th>
                    <th className="px-3 py-2 text-right">Runs</th>
                    <th className="px-3 py-2">Avg quality</th>
                    <th className="px-3 py-2">Last verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={`${g.model}::${g.precision}`} className="border-b border-ink/10 last:border-b-0">
                      <td className="max-w-[280px] truncate px-3 py-2 font-bold" title={g.model}>{g.model}</td>
                      <td className="px-3 py-2">{g.precision}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{g.n}</td>
                      <td className="px-3 py-2">
                        <span className="mr-2 inline-block h-2 w-24 overflow-hidden rounded bg-ink/10 align-middle" role="img" aria-label={`${Math.round(g.avg_quality * 100)} percent`}>
                          <span className={`block h-full ${g.avg_quality >= 0.85 ? "bg-ship" : "bg-block"}`} style={{ width: `${Math.round(g.avg_quality * 100)}%` }} />
                        </span>
                        <span className="tabular-nums">{(g.avg_quality * 100).toFixed(1)}%</span>
                      </td>
                      <td className="px-3 py-2">
                        {g.last_verdict ? <StatusPill status={g.cert_id && g.last_verdict === "SHIP" ? "SHIP" : g.last_verdict} simulated={g.simulated} /> : <span className="text-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 rounded-xl border border-ship/30 bg-ship/5 p-3 font-mono text-[12px] leading-relaxed">
            <strong>Finding #1:</strong> INT4-class quants routinely pass JSON-syntax checks while failing tool <em>semantics</em> — the gap this matrix exists to record. Structured decoding guarantees syntax; only measurement catches meaning.
          </div>
        </section>

        <section aria-label="Release radar" className="mt-6">
          <h2 className="font-mono text-sm font-bold">
            Release radar{" "}
            <span className="font-normal text-muted">
              ({radarSource === "tavily-live" ? "live via Tavily" : radarSource === "cache" ? "cached" : "checking…"})
            </span>
          </h2>
          {!loaded ? (
            <p className="mt-2 font-mono text-xs text-muted">Scanning releases…</p>
          ) : radar.length === 0 ? (
            <p className="mt-2 rounded-xl border border-ink/15 bg-[#F5F1E9] p-4 font-mono text-xs text-muted">Radar quiet right now.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {radar.slice(0, 10).map((r, i) => (
                <li key={`${r.url}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/15 bg-[#F5F1E9] px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs font-bold">{r.model}</span>
                    <a href={r.url} target="_blank" rel="noreferrer" className="block truncate font-mono text-[11px] text-muted underline-offset-4 hover:underline">
                      {r.url}
                    </a>
                  </span>
                  <Link
                    href={`/new?candidate_model=${encodeURIComponent(r.model)}`}
                    className="shrink-0 cursor-pointer rounded-full border border-ink/25 px-3 py-1.5 font-mono text-[11px] font-bold transition-colors hover:border-ink"
                  >
                    Re-audit →
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 font-mono text-[11px] text-muted">Certificates carry their checkpoint — when the radar spots a successor, one click re-opens sizing for it.</p>
        </section>

        <section aria-label="Embeddable badges" className="mt-6">
          <h2 className="font-mono text-sm font-bold">SHIP badges <span className="font-normal text-muted">(for model READMEs)</span></h2>
          {groups.filter((g) => g.cert_id).length === 0 ? (
            <p className="mt-2 rounded-xl border border-ink/15 bg-[#F5F1E9] p-4 font-mono text-xs text-muted">Badges appear alongside certified audits.</p>
          ) : (
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {groups
                .filter((g) => g.cert_id)
                .slice(0, 6)
                .map((g) => (
                  <li key={`${g.model}::${g.precision}`} className="rounded-xl border border-ink/15 bg-[#F5F1E9] p-3">
                    <img src={`/api/badge/${g.cert_id}`} alt={`SandboxProof badge for ${g.model}`} loading="lazy" className="h-auto w-full max-w-[340px]" />
                    <button
                      type="button"
                      onClick={() => g.cert_id && copySnippet(g.cert_id)}
                      className="mt-2 min-h-[36px] cursor-pointer rounded-full border border-ink/25 px-3 py-1 font-mono text-[11px] font-bold transition-colors hover:border-ink"
                    >
                      {g.cert_id && copied === g.cert_id ? "✓ Copied!" : "Copy embed snippet"}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
