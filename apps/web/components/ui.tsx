"use client";
import Link from "next/link";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

export function TopNav() {
  return (<nav className="sticky top-0 z-50 flex items-center justify-between gap-4 border-b border-ink bg-canvas px-4 py-3 sm:px-6 sm:py-4" aria-label="Main">
    <div className="flex min-w-0 items-center gap-3">
      <Link href="/" className="shrink-0 cursor-pointer text-sm font-bold tracking-tight">◉ GPUProof</Link>
      <span className="chip hidden truncate px-3 py-1 text-[11px] lg:inline-block">🏆 Nebius x NVIDIA AI Hackathon · Best Apps &amp; Agents Track</span>
      <span className="chip inline-block truncate px-3 py-1 text-[11px] lg:hidden">🏆 Nebius x NVIDIA Hackathon</span>
    </div>
    <div className="hidden items-center gap-6 text-xs md:flex">
      <Link className="cursor-pointer uppercase tracking-widest text-muted transition-colors hover:text-ink" href="/#how-it-works">How It Works</Link>
      <Link className="cursor-pointer uppercase tracking-widest text-muted transition-colors hover:text-ink" href="/#dilemma">Failure Modes</Link>
      <Link className="cursor-pointer uppercase tracking-widest text-muted transition-colors hover:text-ink" href="/#faq">FAQ</Link>
      <Link className="cursor-pointer uppercase tracking-widest text-muted transition-colors hover:text-ink" href="/docs">Docs</Link>
      <Link className="cursor-pointer uppercase tracking-widest text-muted transition-colors hover:text-ink" href="/dashboard">Audit Portfolio</Link>
    </div>
    <div className="flex shrink-0 items-center gap-4 text-xs">
      <Link href="/new" className="btn-dark cursor-pointer rounded px-3 py-2 font-bold transition-all hover:-translate-y-px hover:shadow-[4px_4px_0_rgba(31,31,31,0.25)]">New Hardware Audit →</Link>
    </div>
  </nav>);
}

export function SiteFooter() {
  return (<footer className="border-t border-ink bg-canvas" aria-label="Footer">
    <div className="mx-auto grid max-w-5xl gap-8 px-6 py-12 text-left md:grid-cols-3">
      <div>
        <p className="text-sm font-bold tracking-tight">◉ GPUProof</p>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">Autonomous GPU inference certification. Built for the Nebius x NVIDIA Global AI Hackathon — Best Apps &amp; Agents Track.</p>
        <p className="mt-3 inline-block border border-ink px-2 py-1 text-[11px] uppercase tracking-widest">Deterministic · Audit-grade</p>
      </div>
      <nav aria-label="Architecture">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted">Architecture &amp; Links</p>
        <ul className="mt-3 space-y-2 text-[12px]">
          <li><Link className="cursor-pointer underline-offset-4 hover:underline" href="/#how-it-works">How It Works</Link></li>
          <li><Link className="cursor-pointer underline-offset-4 hover:underline" href="/docs">Architecture Docs</Link></li>
          <li><Link className="cursor-pointer underline-offset-4 hover:underline" href="/dashboard">Audit Portfolio</Link></li>
          <li><Link className="cursor-pointer underline-offset-4 hover:underline" href="/new">New Certification</Link></li>
          <li><Link className="cursor-pointer underline-offset-4 hover:underline" href="/#dilemma">Failure Modes</Link></li>
          <li><Link className="cursor-pointer underline-offset-4 hover:underline" href="/#faq">FAQ</Link></li>
        </ul>
      </nav>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted">Stack</p>
        <ul className="mt-3 space-y-2 font-mono text-[12px] text-ink/80">
          <li>Nebius Serverless Jobs</li>
          <li>Nebius Token Factory</li>
          <li>vLLM</li>
          <li>Nemotron Ultra 550B</li>
          <li>Nemotron Nano 30B</li>
          <li>FastAPI + Next.js</li>
        </ul>
      </div>
    </div>
    <div className="border-t border-ink px-6 py-4">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 text-[11px] leading-relaxed text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>SLA policy: SHIP requires P95 &lt; 2000ms · accuracy ≥ 85% · error rate ≤ 5%. © 2026 GPUProof.</p>
        <a href="https://github.com" target="_blank" rel="noreferrer" className="cursor-pointer underline underline-offset-4 hover:text-ink">GitHub →</a>
      </div>
    </div>
  </footer>);
}

export function StatusPill({ status, simulated }: { status: string; simulated?: boolean | null }) {
  if (simulated) return (<span aria-label="simulated run" className="chip bg-ink px-2 py-1 text-[11px] text-canvas">SIMULATED</span>);
  const cls = status === "SHIP" ? "bg-ship text-white px-2 py-1 rounded text-[11px]"
    : status === "BLOCK" ? "bg-block text-white px-2 py-1 rounded text-[11px]"
    : "chip px-2 py-1 text-[11px]";
  return <span className={cls}>{status}</span>;
}

export function BudgetMeter({ spend, cap }: { spend: number; cap: number }) {
  const pct = Math.min(100, (spend / cap) * 100);
  return (<div aria-label={`budget ${spend} of ${cap} dollars`} className="mt-1">
    <div className="h-1.5 w-full border border-ink" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
    </div>
    <p className="mt-1 text-[11px] text-muted">${spend.toFixed(2)} / ${cap.toFixed(2)}</p>
  </div>);
}

export function LiveRegion({ message }: { message: string }) {
  return <p aria-live="polite" className="sr-only">{message}</p>;
}

export function useApi() { return API; }
export function useLocalCerts() {
  const [items, setItems] = useState<any[]>(() => {
    try { return typeof window !== "undefined" ? JSON.parse(localStorage.getItem("gpuproof-certs") || "[]") : []; }
    catch { return []; }
  });
  function push(entry: any) {
    setItems((prev) => {
      const next = [entry, ...prev.filter((x) => x.id !== entry.id)].slice(0, 20);
      try { localStorage.setItem("gpuproof-certs", JSON.stringify(next)); } catch {}
      return next;
    });
  }
  return { items, push };
}
