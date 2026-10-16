"use client";

import { useCallback, useEffect, useState } from "react";

export type ExecutionMode = "real" | "sim";

export const EXECUTION_MODE_KEY = "sandboxproof_execution_mode";
export const EXECUTION_MODE_EVENT = "sandboxproof:execution-mode-changed";

export function normalizeExecutionMode(v: unknown): ExecutionMode {
  const s = String(v ?? "").trim().toLowerCase();
  if (["real", "live", "nebius", "cloud"].includes(s)) return "real";
  return "sim";
}

export function getExecutionMode(): ExecutionMode {
  if (typeof window === "undefined") return "sim";
  try {
    return normalizeExecutionMode(localStorage.getItem(EXECUTION_MODE_KEY));
  } catch {
    return "sim";
  }
}

export function setExecutionMode(mode: ExecutionMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(EXECUTION_MODE_KEY, mode);
  } catch {
    /* storage unavailable — keep in-memory default */
  }
  try {
    window.dispatchEvent(new CustomEvent(EXECUTION_MODE_EVENT, { detail: mode }));
  } catch {
    /* ignore */
  }
}

/** Local-only dev bypass for testing mint flows against a simulator backend.
 * Enabled only via ?devsim=1 (sets a localStorage flag). Bypassed runs are
 * always labeled SIMULATED and can never certify production. */
const DEV_SIM_KEY = "sandboxproof-dev-sim";

export function isDevSim(): boolean {
  try {
    return typeof window !== "undefined" && localStorage.getItem(DEV_SIM_KEY) === "1";
  } catch {
    return false;
  }
}

export function enableDevSimFromQuery(): void {
  try {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("devsim") === "1") {
      localStorage.setItem(DEV_SIM_KEY, "1");
    }
  } catch {
    /* ignore */
  }
}
/** Headers attached per-request so the API can log the explicit user choice. */
export function buildExecutionHeaders(mode?: ExecutionMode): Record<string, string> {
  const m = mode ?? getExecutionMode();
  return { "X-SandboxProof-Mode": m, "X-Execution-Mode": m };
}

export function useExecutionMode(): [ExecutionMode, (m: ExecutionMode) => void] {
  const [mode, setMode] = useState<ExecutionMode>("sim");
  useEffect(() => {
    setMode(getExecutionMode());
    const refresh = (e?: Event) => {
      const detail = (e as CustomEvent)?.detail;
      setMode(detail ? normalizeExecutionMode(detail) : getExecutionMode());
    };
    window.addEventListener("storage", refresh);
    window.addEventListener(EXECUTION_MODE_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(EXECUTION_MODE_EVENT, refresh);
    };
  }, []);
  const update = useCallback((m: ExecutionMode) => {
    setMode(m);
    setExecutionMode(m);
  }, []);
  return [mode, update];
}
