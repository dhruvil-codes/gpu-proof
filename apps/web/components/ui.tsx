"use client";
import { useEffect, useState } from "react";
import { BYOK_EVENT, isByokConnected } from "@/components/byok";
import { useExecutionMode, type ExecutionMode } from "@/components/executionMode";
import { SigilFooter, SigilTopNav } from "@/components/SigilChrome";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

export function useByokStatus() {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const refresh = () => {
      try {
        setConnected(isByokConnected());
      } catch {
        setConnected(false);
      }
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(BYOK_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(BYOK_EVENT, refresh);
    };
  }, []);
  return connected;
}

export function ByokBadge({ connected }: { connected: boolean }) {
  if (connected) {
    return (
      <span
        aria-label="BYOK connected — audits bill your Nebius key"
        title="BYOK connected — audits bill your Nebius key"
        className="chip inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold"
      >
        <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-green-600" />
        🔑 BYOK: Connected (Nebius)
      </span>
    );
  }
  return (
    <span
      aria-label="Demo mode — simulated runs on the host pool"
      title="Demo mode — simulated runs on the host pool"
      className="chip inline-flex items-center gap-1.5 px-3 py-1 text-[11px]"
    >
      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-neutral-400" />
      ⚡ Demo Mode (Simulated / Host Pool)
    </span>
  );
}

export function ExecutionModeToggle({ compact = false }: { compact?: boolean }) {
  // Shipped UI is real-only: the simulator switch renders only in dev
  // when NEXT_PUBLIC_ALLOW_SIM=1. Any existing usages render nothing.
  if (process.env.NEXT_PUBLIC_ALLOW_SIM !== "1") return null;
  const [mode, setMode] = useExecutionMode();
  const opt = (id: ExecutionMode, glyph: string, label: string, hint: string) => {
    const active = mode === id;
    return (
      <button
        key={id}
        type="button"
        role="radio"
        aria-checked={active}
        title={hint}
        onClick={() => setMode(id)}
        className={`min-h-[44px] flex-1 cursor-pointer rounded px-3 py-2 text-xs font-bold transition-all ${
          active
            ? "bg-ink text-canvas shadow-[2px_2px_0_rgba(31,31,31,0.35)]"
            : "text-muted hover:text-ink"
        }`}
      >
        {glyph} {compact ? "" : label}
        <span className="sr-only">{label}</span>
      </button>
    );
  };
  return (
    <div
      role="radiogroup"
      aria-label="Execution mode: live sandbox or deterministic simulator"
      title="Choose live sandbox runs or instant simulation"
      className="flex items-center gap-1 rounded-lg border border-ink bg-[#F5F1E9] p-1"
    >
      {opt("real", "⚡", "Live sandbox", "Run audits in isolated Nebius Sandboxes (free in beta; inference bills BYOK key or host pool)")}
      {opt("sim", "🧪", "Deterministic Simulator", "Instant $0 simulation — no spend, dev-only, never certifies")}
    </div>
  );
}
export const TopNav = SigilTopNav;
export const SiteFooter = SigilFooter;

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
    try { return typeof window !== "undefined" ? JSON.parse(localStorage.getItem("sandboxproof-certs") || "[]") : []; }
    catch { return []; }
  });
  function push(entry: any) {
    setItems((prev) => {
      const next = [entry, ...prev.filter((x) => x.id !== entry.id)].slice(0, 20);
      try { localStorage.setItem("sandboxproof-certs", JSON.stringify(next)); } catch {}
      return next;
    });
  }
  return { items, push };
}
