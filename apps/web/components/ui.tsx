"use client";
import Link from "next/link";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

export function TopNav() {
  return (<nav className="flex items-center justify-between border-b border-ink px-6 py-4" aria-label="Main">
    <Link href="/" className="cursor-pointer text-sm font-bold">◉ GPUProof</Link>
    <div className="hidden gap-6 text-xs text-muted md:flex">
      <Link className="cursor-pointer hover:text-ink" href="/dashboard">Product</Link>
      <Link className="cursor-pointer hover:text-ink" href="/new">How it works</Link>
      <Link className="cursor-pointer hover:text-ink" href="/dashboard">Docs</Link>
      <Link className="cursor-pointer hover:text-ink" href="/dashboard">Pricing</Link>
    </div>
    <div className="flex items-center gap-4 text-xs">
      <Link href="/dashboard" className="cursor-pointer">Login</Link>
      <Link href="/new" className="btn-dark cursor-pointer rounded px-3 py-2 transition-colors">Get Started</Link>
    </div>
  </nav>);
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
