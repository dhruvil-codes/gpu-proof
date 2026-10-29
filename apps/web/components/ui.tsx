"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import ByokModal from "@/components/ByokModal";
import { BYOK_EVENT, isByokConnected } from "@/components/byok";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

/* ——— Shared hooks ——— */

export function useApi() {
  return API;
}

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

/* ——— Shared atoms ——— */

export function StatusPill({ status, simulated }: { status: string; simulated?: boolean | null }) {
  if (simulated) return <span className="pill pill-warn">Simulated</span>;
  const s = status.toUpperCase();
  if (s === "SHIP") return <span className="pill pill-ship">SHIP</span>;
  if (s === "BLOCK") return <span className="pill pill-block">BLOCK</span>;
  if (s === "RUNNING") return <span className="pill pill-running">Running</span>;
  if (s === "FAILED" || s === "ERROR") return <span className="pill pill-block">Failed</span>;
  return <span className="pill pill-neutral">{s === "CREATED" ? "Queued" : status}</span>;
}

export function ByokBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="pill pill-ship" title="Runs bill your own Nebius key">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#247B50]" aria-hidden="true" />
      Your Nebius key
    </span>
  ) : (
    <span className="pill pill-neutral" title="Simulated runs on the shared host pool — connect a key for live sandboxes">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#A3A29B]" aria-hidden="true" />
      Demo mode
    </span>
  );
}

export function BudgetMeter({ spend, cap, tone }: { spend: number; cap: number; tone?: "ink" | "warn" | "block" }) {
  const pct = cap > 0 ? Math.min(100, (spend / cap) * 100) : 0;
  const cls = tone === "block" ? "meter meter-block" : tone === "warn" ? "meter meter-accent" : "meter";
  return (
    <div aria-label={`Budget: ${spend.toFixed(2)} of ${cap.toFixed(2)} dollars spent`}>
      <div className={cls} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-[13px] text-ink2 tabular-nums">
        ${spend.toFixed(2)} <span aria-hidden="true">/</span> ${cap.toFixed(2)}
      </p>
    </div>
  );
}

export function LiveRegion({ message }: { message: string }) {
  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}

/* ——— Chrome ——— */

const links = [
  { label: "Crash lab", href: "/" },
  { label: "Runs", href: "/dashboard" },
  { label: "Matrix", href: "/matrix" },
  { label: "Docs", href: "/docs" },
  { label: "Console", href: "/sandbox-console" },
];

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="SandboxProof home">
      <span className="inline-block h-3 w-3 bg-accent" aria-hidden="true" />
      <span className="font-display text-[20px] leading-none tracking-[-0.01em]">SandboxProof</span>
    </Link>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    const refresh = () => setConnected(isByokConnected());
    refresh();
    window.addEventListener(BYOK_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(BYOK_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      if (active) setHealth((h) => (h === "checking" ? "offline" : h));
    }, 3500);
    fetch("/api/health", { cache: "no-store" })
      .then((response) => {
        if (active) setHealth(response.ok ? "online" : "offline");
      })
      .catch(() => {
        if (active) setHealth("offline");
      })
      .finally(() => clearTimeout(t));
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-bg">
      <div className="mx-auto flex h-14 max-w-shell items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6 lg:gap-8">
          <Wordmark />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {links.map((link) => {
              const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-control px-3 py-2 text-sm transition-colors ${
                    active ? "font-medium text-ink" : "text-ink2 hover:text-ink"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="hidden items-center gap-2 text-[13px] text-ink2 lg:inline-flex"
            title={`Nebius Token Factory status: ${health}`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                health === "online" ? "bg-ship" : health === "offline" ? "bg-block" : "bg-faint"
              }`}
              aria-hidden="true"
            />
            Token Factory {health === "online" ? "online" : health === "offline" ? "offline" : "…"}
          </span>
          <button type="button" onClick={() => setKeyOpen(true)} className="btn btn-ghost btn-round hidden px-3.5 py-2 text-sm sm:inline-flex">
            {connected ? "Key connected" : "Connect key"}
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="btn btn-ghost btn-round inline-flex h-10 w-10 items-center justify-center md:hidden"
          >
            <span aria-hidden="true" className="text-lg leading-none">{menuOpen ? "×" : "≡"}</span>
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav id="mobile-nav" className="bg-bg px-4 pb-5 pt-2 md:hidden" aria-label="Mobile">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block rounded-control px-2 py-3.5 text-[15px] hover:bg-raised"
            >
              {link.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setKeyOpen(true);
            }}
            className="btn btn-primary btn-round mt-4 w-full px-4 py-2.5 text-sm"
          >
            {connected ? "Key connected" : "Connect key"}
          </button>
        </nav>
      )}
      <ByokModal open={keyOpen} onClose={() => setKeyOpen(false)} />
    </header>
  );
}

/* App pages: frame + bar + white sheet */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-frame">
      <TopNav />
      <main className="app-sheet">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-shell px-4 pb-8 pt-6 sm:px-6">
      <div className="flex flex-col gap-3 text-[14px] text-ink2 sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 bg-accent" aria-hidden="true" />
          <span className="font-medium text-ink">SandboxProof</span>
          <span aria-hidden="true">·</span>
          <span>AI proposes. Policy approves. Metrics decide.</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/docs" className="hover:text-ink">Docs</Link>
          <Link href="/usage" className="hover:text-ink">Spend</Link>
          <a href="https://github.com/dhruvil-codes/gpu-proof" target="_blank" rel="noreferrer" className="hover:text-ink">GitHub</a>
          <span>Nebius × NVIDIA hackathon, Oct 2026</span>
        </span>
      </div>
    </footer>
  );
}
