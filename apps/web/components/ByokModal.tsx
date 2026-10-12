"use client";
import { useEffect, useRef, useState } from "react";
import {
  BYOK_EVENT,
  clearByokCredentials,
  getByokCredentials,
  setByokCredentials,
} from "@/components/byok";

export default function ByokModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [projectId, setProjectId] = useState("");
  const [subnetId, setSubnetId] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const keyRef = useRef<HTMLInputElement>(null);

  // Load current values whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    const cur = getByokCredentials();
    setApiKey(cur.apiKey);
    setProjectId(cur.projectId);
    setSubnetId(cur.subnetId);
    setMsg("");
    setErr("");
    // Focus the key field for keyboard users.
    const t = setTimeout(() => keyRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open ]);

  // Escape closes; overlay click closes (handled on the overlay element).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function save(e?: React.FormEvent) {
    e?.preventDefault();
    const key = apiKey.trim();
    if (!key) {
      setErr("Nebius API Key is required for cloud execution.");
      return;
    }
    setByokCredentials({ apiKey: key, projectId: projectId.trim(), subnetId: subnetId.trim() });
    setMsg("Connected — audits will now bill your Nebius key.");
    setErr("");
    try {
      window.dispatchEvent(new CustomEvent(BYOK_EVENT));
    } catch {}
    onClose();
  }

  function disconnect() {
    clearByokCredentials();
    setApiKey("");
    setProjectId("");
    setSubnetId("");
    setMsg("Disconnected — back to Demo Mode (Simulated / Host Pool).");
    setErr("");
    try {
      window.dispatchEvent(new CustomEvent(BYOK_EVENT));
    } catch {}
  }

  const field =
    "mt-1 min-h-[44px] w-full rounded border border-ink bg-transparent p-2 font-mono text-sm outline-none focus:border-black";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="byok-title"
        aria-describedby="byok-policy"
        className="panel w-full max-w-md rounded-lg p-5 shadow-[6px_6px_0_rgba(31,31,31,0.35)]"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="byok-title" className="text-base font-bold tracking-tight">
            🔑 BYOK / API Key
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close BYOK dialog"
            className="cursor-pointer rounded border border-ink px-2 py-1 text-xs font-bold hover:bg-ink hover:text-canvas"
          >
            ✕
          </button>
        </div>

        <p id="byok-policy" className="mt-2 rounded border border-ink/30 bg-canvas p-2 text-[11px] leading-relaxed text-muted">
          Your keys are stored exclusively in your browser&apos;s localStorage and passed via
          encrypted headers per request. Never stored on our server database.
        </p>

        <form onSubmit={save} className="mt-4 space-y-4">
          <div>
            <label htmlFor="byok-key" className="block text-sm font-bold">
              Nebius API Key <span className="text-block">*</span>
            </label>
            <span id="byok-key-help" className="mt-1 block text-[11px] text-muted">
              Required for cloud execution. Starts with <code>nb-...</code>
            </span>
            <input
              ref={keyRef}
              id="byok-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="nb-..."
              required
              aria-required="true"
              aria-describedby="byok-key-help byok-err"
              className={field}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="byok-project" className="block text-sm font-bold">
                Nebius Project ID
              </label>
              <span className="mt-1 block text-[11px] text-muted">
                Optional · Serverless GPU jobs
              </span>
              <input
                id="byok-project"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="project-..."
                className={field}
              />
            </div>
            <div>
              <label htmlFor="byok-subnet" className="block text-sm font-bold">
                Nebius Subnet ID
              </label>
              <span className="mt-1 block text-[11px] text-muted">
                Optional · Serverless GPU jobs
              </span>
              <input
                id="byok-subnet"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={subnetId}
                onChange={(e) => setSubnetId(e.target.value)}
                placeholder="subnet-..."
                className={field}
              />
            </div>
          </div>

          {err && (
            <p id="byok-err" role="alert" className="text-[11px] font-bold text-block">
              {err}
            </p>
          )}
          {msg && (
            <p aria-live="polite" className="text-[11px] text-muted">
              {msg}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="submit"
              className="btn-dark min-h-[44px] flex-1 cursor-pointer rounded px-4 py-2 text-sm font-bold"
            >
              Save &amp; Connect
            </button>
            <button
              type="button"
              onClick={disconnect}
              className="min-h-[44px] flex-1 cursor-pointer rounded border border-ink px-4 py-2 text-sm font-bold hover:bg-ink hover:text-canvas"
            >
              Clear / Disconnect
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
