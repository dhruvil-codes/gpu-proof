"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HARDWARE_TARGETS,
  applyRamSelection,
  detectHardware,
  evaluateFit,
  fetchNativeHardwareProfile,
  getTargetKey,
  importCliProfile,
  loadDetected,
  setTargetKey,
  targetLabel,
  type DetectedHardware,
  type ModelFitLike,
} from "@/lib/hardwareDetector";

type Props = {
  /** Live model sizing from /api/models/inspect — drives the fit card. */
  modelFit?: ModelFitLike | null;
  inspecting?: boolean;
  /** Compact badge-only mode for the homepage picker. */
  compact?: boolean;
  /** Fires when the effective target changes (AUTO or catalog key). */
  onTargetChange?: (targetKey: string, detected: DetectedHardware | null) => void;
};

export function useHardwareProfiler() {
  const [detected, setDetected] = useState<DetectedHardware | null>(null);
  const [targetKey, setTarget] = useState<string>("AUTO");
  const [detectMs, setDetectMs] = useState<number | null>(null);

  useEffect(() => {
    try {
      const cached = loadDetected();
      if (cached) setDetected(cached);
    } catch {
      /* ignore */
    }
    try {
      setTarget(getTargetKey());
    } catch {
      /* ignore */
    }
    // Non-intrusive auto-detection on mount — synchronous, <50ms, no prompts.
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    try {
      const d = detectHardware();
      setDetected(d);
      setDetectMs(d.durationMs ?? (typeof performance !== "undefined" ? performance.now() - t0 : 0));
    } catch {
      /* detection must never break the page */
    }

    // Follow up immediately with background probe to local FastAPI /api/system/hardware
    // which reports exact native physical RAM (e.g. 24GB on this machine) without
    // browser quantization caps.
    fetchNativeHardwareProfile()
      .then((native) => {
        if (native) {
          setDetected(native);
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  const changeTarget = useCallback((key: string) => {
    setTarget(key);
    try {
      setTargetKey(key);
    } catch {
      /* ignore */
    }
  }, []);

  const selectRam = useCallback((gb: number) => {
    setDetected((curr) => applyRamSelection(gb, curr));
  }, []);

  return { detected, setDetected, targetKey, changeTarget, detectMs, selectRam };
}

export default function HardwareProfiler({ modelFit, inspecting, compact, onTargetChange }: Props) {
  const { detected, setDetected, targetKey, changeTarget, detectMs, selectRam } = useHardwareProfiler();
  const [detecting, setDetecting] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [cliOpen, setCliOpen] = useState(false);
  const [cliText, setCliText] = useState("");
  const [cliError, setCliError] = useState("");
  const dropRef = useRef<HTMLDivElement>(null);
  const notifiedRef = useRef<string>("");

  useEffect(() => {
    const sig = `${targetKey}|${detected?.profileKey ?? ""}`;
    if (notifiedRef.current !== sig) {
      notifiedRef.current = sig;
      onTargetChange?.(targetKey, detected);
    }
  }, [targetKey, detected, onTargetChange]);

  useEffect(() => {
    if (!dropdownOpen) return;
    function onDocClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDropdownOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [dropdownOpen]);

  async function redetect() {
    setDetecting(true);
    try {
      const native = await fetchNativeHardwareProfile();
      if (native) {
        setDetected(native);
        setDetecting(false);
        return;
      }
    } catch {
      /* ignore */
    }
    try {
      const d = detectHardware();
      setDetected(d);
    } catch {
      /* never break the page */
    } finally {
      setDetecting(false);
    }
  }

  function applyCli() {
    setCliError("");
    try {
      const d = importCliProfile(cliText.trim());
      setDetected(d);
      setCliText("");
      setCliOpen(false);
    } catch (err) {
      setCliError(err instanceof Error ? err.message : String(err));
    }
  }

  const fit = useMemo(() => evaluateFit(modelFit, targetKey, detected), [modelFit, targetKey, detected]);
  const isAuto = targetKey === "AUTO";

  if (compact) {
    return (
      <div className="mx-auto mt-4 flex max-w-2xl flex-wrap items-center justify-center gap-2" aria-label="Local hardware auto-detection">
        {detected ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-canvas/30 bg-ink/60 px-3 py-1.5 font-mono text-[11px] text-canvas">
              <span aria-hidden="true">💻</span>
              <span>
                Current Machine: <strong>{detected.label}</strong>
              </span>
            </span>
            <div className="inline-flex items-center gap-1" role="group" aria-label="Quick RAM toggle">
              {[16, 24, 32, 64].map((gb) => {
                const active = detected.usableGB === gb;
                return (
                  <button
                    key={gb}
                    type="button"
                    onClick={() => selectRam(gb)}
                    aria-pressed={active}
                    className={`gp-chip cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] font-bold transition-[transform,border-color,background-color,color] duration-200 active:scale-[0.97] ${
                      active
                        ? "border border-canvas bg-canvas text-ink"
                        : "border border-canvas/30 text-canvas/80 hover:border-canvas hover:text-canvas"
                    }`}
                    title={`Lock RAM to ${gb}GB`}
                  >
                    {gb}G{active ? "✓" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={redetect}
            className="cursor-pointer rounded-full border border-canvas/30 px-4 py-1.5 text-[11px] font-bold text-canvas transition-all hover:border-canvas"
          >
            🔍 Auto-Detect My Machine
          </button>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Local hardware auto-detection" className="rounded-lg border border-ink bg-[#F5F1E9] p-4">
      {/* Pill row */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={redetect}
          disabled={detecting}
          aria-live="polite"
          className="gp-chip inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-full border border-ink bg-ink px-4 py-2 text-xs font-bold text-canvas transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[3px_3px_0_rgba(31,31,31,0.3)] active:scale-[0.97] disabled:opacity-60"
        >
          <span aria-hidden="true">{detecting ? "⏳" : "🔍"}</span>
          {detecting ? "Detecting…" : detected ? "Re-detect My Machine" : "Auto-Detect My Machine"}
        </button>
        {detected && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-900">
            <span aria-hidden="true">💻</span>
            <span>
              Current Machine: {detected.label}
            </span>
          </span>
        )}
        {detectMs !== null && detected && (
          <span className="font-mono text-[10px] text-muted" title={`Fingerprint took ${detectMs}ms`}>
            {detectMs}ms · {detected.method}
            {typeof detected.deviceMemoryGB === "number" ? ` · ${detected.cpuThreads ?? "?"} threads` : ""}
          </span>
        )}
      </div>

      {/* RAM selector chips */}
      {detected && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2" role="group" aria-label="System RAM selector">
          <span className="font-mono text-[11px] font-bold text-muted">System RAM:</span>
          {[16, 24, 32, 64].map((gb) => {
            const active = detected.usableGB === gb;
            return (
              <button
                key={gb}
                type="button"
                onClick={() => selectRam(gb)}
                aria-pressed={active}
                className={`gp-chip cursor-pointer rounded px-2.5 py-1 font-mono text-[11px] font-bold transition-[transform,border-color,background-color,color,box-shadow] duration-200 active:scale-[0.97] ${
                  active
                    ? "border border-ink bg-ink text-canvas shadow-[2px_2px_0_rgba(31,31,31,0.25)]"
                    : "border border-ink/25 bg-canvas/70 text-ink hover:border-ink hover:bg-canvas"
                }`}
                title={`Lock system RAM to ${gb}GB for local model fit calculations`}
              >
                {gb} GB {active ? "✓" : ""}
              </button>
            );
          })}
          <span className="font-mono text-[10px] text-muted">
            ({detected.usableGB}GB active for local fit)
          </span>
        </div>
      )}

      {/* Toggle row */}
      {detected && (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Hardware target toggle">
          <button
            type="button"
            onClick={() => {
              changeTarget("AUTO");
              setDropdownOpen(false);
            }}
            aria-pressed={isAuto}
            className={`gp-chip inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-bold transition-[transform,border-color,background-color,color,box-shadow] duration-200 active:scale-[0.97] ${
              isAuto
                ? "border-ink bg-ink text-canvas shadow-[2px_2px_0_rgba(31,31,31,0.25)]"
                : "border-ink/30 bg-transparent text-ink hover:border-ink"
            }`}
          >
            {isAuto ? "✓ Use this machine for local fit" : "Use this machine for local fit"}
          </button>
          <div className="relative" ref={dropRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              aria-expanded={dropdownOpen}
              aria-haspopup="listbox"
              className={`gp-chip inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-bold transition-[transform,border-color,background-color,color,box-shadow] duration-200 active:scale-[0.97] ${
                !isAuto
                  ? "border-ink bg-ink text-canvas shadow-[2px_2px_0_rgba(31,31,31,0.25)]"
                  : "border-ink/30 bg-transparent text-ink hover:border-ink"
              }`}
            >
              <span>{isAuto ? "Evaluate a different machine / server" : `Target: ${targetLabel(targetKey, detected)}`}</span>
              <span className="gp-chevron" data-open={dropdownOpen} aria-hidden="true">
                <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>
              </span>
            </button>
            <div
              className={`absolute left-0 z-30 mt-1 w-72 transition-opacity duration-200 ${
                dropdownOpen ? "visible opacity-100" : "invisible opacity-0"
              }`}
            >
              <div className="gp-accordion" data-open={dropdownOpen}>
                <div className="gp-accordion-inner">
              <div
                role="listbox"
                aria-label="Target hardware"
                aria-hidden={!dropdownOpen}
                className="max-h-72 overflow-y-auto rounded-lg border border-ink bg-canvas p-1 shadow-[4px_4px_0_#1F1F1F]"
              >
                {HARDWARE_TARGETS.map((t) => {
                  const active = targetKey === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        changeTarget(t.key);
                        setDropdownOpen(false);
                      }}
                      className={`flex w-full cursor-pointer items-start justify-between gap-2 rounded px-2.5 py-2 text-left transition-colors ${
                        active ? "bg-ink text-canvas" : "hover:bg-ink/5"
                      }`}
                    >
                      <span>
                        <span className="block text-xs font-bold">
                          {active ? "✓ " : ""}
                          {t.key === "AUTO" && detected ? `Current Machine (${detected.badge})` : t.label}
                        </span>
                        <span className={`block text-[10px] ${active ? "text-canvas/70" : "text-muted"}`}>{t.sub}</span>
                      </span>
                      {t.kind !== "auto" && (
                        <span className={`shrink-0 font-mono text-[10px] ${active ? "text-canvas/80" : "text-muted"}`}>
                          {t.usableGB}GB
                        </span>
                      )}
                    </button>
                  );
                })}
                <div className="border-t border-ink/15 p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setDropdownOpen(false);
                      setCliOpen((v) => !v);
                    }}
                    className="w-full cursor-pointer rounded px-2.5 py-1.5 text-left font-mono text-[11px] text-muted transition-colors duration-200 hover:bg-ink/5 hover:text-ink"
                  >
                    ⌨ Paste `gpuproof detect` output for exact specs →
                  </button>
                </div>
              </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CLI bridge collapsible — grid-rows accordion, no layout jumps */}
      <div className="gp-accordion" data-open={cliOpen}>
        <div className="gp-accordion-inner">
        <div className="mt-3 rounded border border-dashed border-ink/40 bg-canvas/60 p-3">
          <p className="text-[11px] font-bold">Exact specs via terminal probe</p>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted">
            Run <code className="rounded bg-ink/10 px-1">python -m services.detector</code> on the machine you want to
            profile, then paste the JSON below. It overrides browser heuristics with exact chip + VRAM.
          </p>
          <label htmlFor="cli-profile" className="sr-only">
            Paste gpuproof detect JSON output
          </label>
          <textarea
            id="cli-profile"
            value={cliText}
            onChange={(e) => setCliText(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder='{"profileKey": "RTX4090", "label": "NVIDIA GeForce RTX 4090 (24GB GDDR6X)", "usableGB": 24, …}'
            className="mt-2 min-h-[64px] w-full rounded border border-ink/30 bg-transparent p-2 font-mono text-[11px] outline-none transition-[border-color] duration-200 focus:border-ink"
          />
          {cliError && (
            <p role="alert" className="mt-1 text-[11px] font-bold text-block">
              {cliError}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={applyCli}
              disabled={!cliText.trim()}
              className="gp-chip cursor-pointer rounded bg-ink px-3 py-1.5 text-[11px] font-bold text-canvas transition-[transform,opacity] duration-200 active:scale-[0.97] disabled:opacity-50"
            >
              Apply exact profile
            </button>
            <button
              type="button"
              onClick={() => {
                setCliOpen(false);
                setCliError("");
              }}
              className="gp-chip cursor-pointer rounded border border-ink/30 px-3 py-1.5 text-[11px] font-bold transition-[transform,border-color] duration-200 hover:border-ink active:scale-[0.97]"
            >
              Cancel
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Dynamic "Will It Run on MY Current Device?" card */}
      {modelFit && fit && (
        <div
          aria-live="polite"
          className={`mt-3 rounded-md border p-3 text-xs leading-relaxed transition-[border-color,background-color] duration-200 ${
            fit.fits ? "border-emerald-700/40 bg-emerald-500/10" : "border-red-700/40 bg-red-500/10"
          }`}
        >
          <p className={`text-[11px] font-bold uppercase tracking-wider ${fit.fits ? "text-emerald-900" : "text-red-900"}`}>
            Will it run on {isAuto ? "my current device" : targetLabel(targetKey, detected)}?
            {inspecting ? <span className="ml-2 font-mono normal-case text-muted">sizing…</span> : null}
          </p>
          <p className="mt-1 font-bold">{fit.headline}</p>
          <p className="mt-0.5 text-[12px]">{fit.detail}</p>
          <p className="mt-1 font-mono text-[10px] text-muted">
            {fit.stackHint}
            {modelFit.local_verdict ? ` · Server note: ${modelFit.local_verdict}` : ""}
          </p>
        </div>
      )}
    </section>
  );
}
