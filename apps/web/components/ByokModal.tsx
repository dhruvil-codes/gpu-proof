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
        className="w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-[0_16px_48px_rgba(0,0,0,0.18)]"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="byok-title" className="text-[17px] font-semibold">
            Connect your Nebius key
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="btn btn-ghost btn-round h-8 w-8 items-center justify-center !px-0 text-[15px]"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <p id="byok-policy" className="mt-2 rounded-control bg-raised p-3 text-[13px] leading-relaxed text-ink2">
          Keys are stored only in this browser&apos;s localStorage and passed per request as headers. They never touch the server database.
        </p>

        <form onSubmit={save} className="mt-5 space-y-4">
          <div>
            <label htmlFor="byok-key" className="block text-[14px] font-medium">
              Nebius API key <span className="text-blockDeep">*</span>
            </label>
            <span id="byok-key-help" className="mt-0.5 block text-[12.5px] text-ink2">
              Required for cloud execution. Starts with <code className="mono">nb-…</code>
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
              className="field mono mt-2"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="byok-project" className="block text-[14px] font-medium">
                Nebius project ID
              </label>
              <span className="mt-0.5 block text-[12.5px] text-ink2">Optional · cloud GPU jobs</span>
              <input
                id="byok-project"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="project-..."
                className="field mono mt-2"
              />
            </div>
            <div>
              <label htmlFor="byok-subnet" className="block text-[14px] font-medium">
                Nebius subnet ID
              </label>
              <span className="mt-0.5 block text-[12.5px] text-ink2">Optional · cloud GPU jobs</span>
              <input
                id="byok-subnet"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={subnetId}
                onChange={(e) => setSubnetId(e.target.value)}
                placeholder="subnet-..."
                className="field mono mt-2"
              />
            </div>
          </div>

          {err && (
            <p id="byok-err" role="alert" className="text-[13px] font-medium text-blockDeep">
              {err}
            </p>
          )}
          {msg && (
            <p aria-live="polite" className="text-[13px] text-ink2">
              {msg}
            </p>
          )}

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <button type="submit" className="btn btn-primary btn-round h-11 flex-1 px-4 text-sm">
              Save and connect
            </button>
            <button type="button" onClick={disconnect} className="btn btn-ghost btn-round h-11 flex-1 px-4 text-sm">
              Disconnect
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
