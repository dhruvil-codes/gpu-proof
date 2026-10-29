"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell, StatusPill } from "@/components/ui";

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
    <AppShell>
      <div className="app-pad mx-auto max-w-shell">
        <div className="max-w-2xl">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Matrix</h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink2">
            What survives quantization, measured. Every run's Nemotron scores accumulate here by model and precision.
            Syntax can be constrained — semantics must be measured. This table only grows.
          </p>
        </div>

        <section aria-label="Precision quality matrix" className="mt-10">
          <h2 className="text-[17px] font-semibold">Precision × quality</h2>
          {!loaded ? (
            <p className="mt-3 text-[14px] text-ink2">Loading the matrix…</p>
          ) : groups.length === 0 ? (
            <div className="mt-4 rounded-card border border-line bg-surface p-6">
              <p className="text-[15px] font-medium">No scored runs yet</p>
              <p className="mt-1 text-[14px] text-ink2">Mint one from the crash-test lab and its Nemotron scores land here automatically.</p>
              <Link href="/#launch" className="btn btn-primary btn-round mt-4 h-10 px-4 text-sm">Open the crash-test lab</Link>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-card border border-line bg-surface">
              <table className="ttable min-w-[680px]">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">Precision</th>
                    <th scope="col" className="!text-right">Runs</th>
                    <th scope="col">Average quality</th>
                    <th scope="col">Last verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={`${g.model}::${g.precision}`}>
                      <td className="max-w-[280px] truncate font-medium" title={g.model}>{g.model}</td>
                      <td className="text-ink2">{g.precision}</td>
                      <td className="tnum">{g.n}</td>
                      <td>
                        <span className="flex items-center gap-2.5">
                          <span className={`meter w-28 ${g.avg_quality >= 0.85 ? "meter-ship" : "meter-block"}`} role="img" aria-label={`${Math.round(g.avg_quality * 100)} percent`}>
                            <span style={{ width: `${Math.round(g.avg_quality * 100)}%` }} />
                          </span>
                          <span className="mono text-[13px] tabular-nums">{(g.avg_quality * 100).toFixed(1)}%</span>
                        </span>
                      </td>
                      <td>
                        {g.last_verdict ? <StatusPill status={g.cert_id && g.last_verdict === "SHIP" ? "SHIP" : g.last_verdict} simulated={g.simulated} /> : <span className="text-faint">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 rounded-card bg-shipWash px-4 py-3.5 text-[13.5px] leading-relaxed text-ink">
            <strong className="font-semibold">Finding:</strong> INT4-class quants routinely pass JSON-syntax checks while failing tool semantics — the gap this matrix exists to record. Structured decoding guarantees syntax; only measurement catches meaning.
          </div>
        </section>

        <section aria-label="Release radar" className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[17px] font-semibold">Release radar</h2>
            <p className="text-[13px] text-ink2">
              {radarSource === "tavily-live" ? "Live via Tavily" : radarSource === "cache" ? "Cached" : "Checking…"}
            </p>
          </div>
          {!loaded ? (
            <p className="mt-3 text-[14px] text-ink2">Scanning releases…</p>
          ) : radar.length === 0 ? (
            <p className="mt-4 rounded-card border border-line bg-surface p-5 text-[14px] text-ink2">The radar is quiet right now.</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {radar.slice(0, 10).map((r, i) => (
                <li key={`${r.url}-${i}`} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium">{r.model}</span>
                    <a href={r.url} target="_blank" rel="noreferrer" className="block truncate text-[12.5px] text-ink2 underline decoration-line underline-offset-4 hover:text-ink">
                      {r.url}
                    </a>
                  </span>
                  <Link
                    href={`/?candidate_model=${encodeURIComponent(r.model)}`}
                    className="btn btn-ghost btn-round h-9 shrink-0 px-3.5 text-[13px]"
                  >
                    Re-audit →
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[13px] text-ink2">Certificates carry their checkpoint — when the radar spots a successor, one click re-opens sizing for it.</p>
        </section>

        <section aria-label="Embeddable badges" className="mt-12">
          <h2 className="text-[17px] font-semibold">SHIP badges for model READMEs</h2>
          {groups.filter((g) => g.cert_id).length === 0 ? (
            <p className="mt-4 rounded-card border border-line bg-surface p-5 text-[14px] text-ink2">Badges appear alongside certified runs.</p>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {groups
                .filter((g) => g.cert_id)
                .slice(0, 6)
                .map((g) => (
                  <li key={`${g.model}::${g.precision}`} className="rounded-card border border-line bg-surface p-4">
                    <img src={`/api/badge/${g.cert_id}`} alt={`SandboxProof badge for ${g.model}`} loading="lazy" className="h-auto w-full max-w-[340px] rounded-control" />
                    <button
                      type="button"
                      onClick={() => g.cert_id && copySnippet(g.cert_id)}
                      className="btn btn-ghost btn-round mt-3 h-9 px-3.5 text-[13px]"
                    >
                      {g.cert_id && copied === g.cert_id ? "Copied" : "Copy embed snippet"}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
