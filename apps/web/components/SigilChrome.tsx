"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ByokModal from "@/components/ByokModal";
import { BYOK_EVENT, isByokConnected } from "@/components/byok";

const links = [
  { label: "Audit Lab", href: "/new" },
  { label: "Live Sandboxes", href: "/sandbox" },
  { label: "Certificates", href: "/dashboard" },
  { label: "Docs", href: "/docs" },
];

export function SigilTopNav() {
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
    let active = true;
    fetch("/api/health", { cache: "no-store" })
      .then((response) => { if (active) setHealth(response.ok ? "online" : "offline"); })
      .catch(() => { if (active) setHealth("offline"); });
    return () => { active = false; };
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-20 max-w-[1440px] items-center justify-between gap-5 px-5 md:px-8 xl:px-12">
        <div className="flex min-w-0 items-center gap-5">
          <Link href="/" className="shrink-0 font-sans text-[17px] font-semibold tracking-[-0.045em] text-ink" aria-label="SandboxProof home">
            <span className="mr-2 inline-block size-3 border-[3px] border-orange align-[-1px]" aria-hidden="true" />SANDBOXPROOF
          </Link>
          <span className="hidden items-center gap-2 border-l border-rule pl-5 font-mono text-[10px] tracking-[0.07em] text-muted xl:flex">
            <span className={`size-1.5 rounded-full ${health === "online" ? "bg-ship" : health === "offline" ? "bg-block" : "bg-warning"}`} aria-hidden="true" />
            {health === "online" ? "ALL SYSTEMS OPERATIONAL" : health === "offline" ? "BACKEND OFFLINE" : "CHECKING SYSTEMS"}
          </span>
        </div>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
          {links.map((link) => <Link key={link.href} href={link.href} className="px-3 py-3 text-[13px] font-medium text-muted transition-colors hover:text-ink focus-visible:text-ink">{link.label}</Link>)}
        </nav>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setKeyOpen(true)} className="sigil-technical-button hidden items-center border border-ink bg-ink px-4 font-mono text-[11px] font-medium tracking-[0.04em] text-white hover:bg-inkSoft sm:inline-flex">
            {connected ? "NEBIUS KEY CONNECTED" : "CONNECT NEBIUS API KEY"}<span className="ml-4 text-orange" aria-hidden="true">→</span>
          </button>
          <button type="button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-controls="mobile-navigation" aria-label={menuOpen ? "Close menu" : "Open menu"} className="sigil-technical-button flex size-12 items-center justify-center border border-rule font-mono text-lg lg:hidden">{menuOpen ? "×" : "≡"}</button>
        </div>
      </div>
      {menuOpen && <nav id="mobile-navigation" className="border-t border-rule bg-paper px-5 pb-5 lg:hidden" aria-label="Mobile navigation">
        {links.map((link) => <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="block border-b border-rule py-4 text-sm font-medium">{link.label}</Link>)}
        <button type="button" onClick={() => { setMenuOpen(false); setKeyOpen(true); }} className="sigil-technical-button mt-5 w-full bg-ink px-4 font-mono text-[11px] text-white sm:hidden">CONNECT NEBIUS API KEY →</button>
      </nav>}
      <ByokModal open={keyOpen} onClose={() => setKeyOpen(false)} />
    </header>
  );
}

export function SigilFooter() {
  return <footer className="border-t border-darkRule bg-ink text-white">
    <div className="mx-auto grid max-w-[1440px] gap-12 px-6 py-16 md:grid-cols-[1.4fr_1fr] md:px-12 lg:px-[176px]">
      <div>
        <p className="sigil-label text-orange">15 / END OF TRANSMISSION</p>
        <Link href="/new" className="mt-7 inline-flex items-end gap-8 text-[clamp(2.25rem,5vw,4rem)] leading-none tracking-[-0.055em] hover:text-orange">Run an audit <span aria-hidden="true">→</span></Link>
        <p className="mt-6 max-w-sm text-sm leading-6 text-inverseMuted">Crash-test open-weight models in isolated sandboxes. Ship only what the evidence supports.</p>
      </div>
      <nav aria-label="Footer navigation" className="grid grid-cols-2 gap-x-8 gap-y-2 self-start text-sm">
        {links.map((link, index) => <Link key={link.href} href={link.href} className="flex min-h-12 items-center justify-between border-b border-darkRule hover:text-orange"><span className="mr-2 font-mono text-[10px] text-inverseMuted">0{index + 1}</span>{link.label}<span aria-hidden="true">→</span></Link>)}
      </nav>
    </div>
    <div className="mx-auto flex max-w-[1440px] flex-col gap-2 border-t border-darkRule px-6 py-5 font-mono text-[10px] tracking-[0.05em] text-inverseMuted md:flex-row md:justify-between md:px-12 lg:px-[176px]"><span>© 2026 SANDBOXPROOF · NEBIUS × NVIDIA</span><span>AI PROPOSES. POLICY APPROVES. METRICS DECIDE.</span></div>
  </footer>;
}
