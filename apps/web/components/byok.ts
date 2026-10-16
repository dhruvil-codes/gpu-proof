"use client";

export const BYOK_KEY = "sandboxproof_nebius_key";
export const BYOK_PROJECT = "sandboxproof_nebius_project";
export const BYOK_SUBNET = "sandboxproof_nebius_subnet";
export const BYOK_EVENT = "sandboxproof:byok-changed";

export type ByokCredentials = {
  apiKey: string;
  projectId: string;
  subnetId: string;
};

export function getByokCredentials(): ByokCredentials {
  if (typeof window === "undefined") return { apiKey: "", projectId: "", subnetId: "" };
  try {
    return {
      apiKey: (localStorage.getItem(BYOK_KEY) || "").trim(),
      projectId: (localStorage.getItem(BYOK_PROJECT) || "").trim(),
      subnetId: (localStorage.getItem(BYOK_SUBNET) || "").trim(),
    };
  } catch {
    return { apiKey: "", projectId: "", subnetId: "" };
  }
}

export function isByokConnected(): boolean {
  return getByokCredentials().apiKey.length > 0;
}

export function setByokCredentials(creds: ByokCredentials): void {
  if (typeof window === "undefined") return;
  try {
    const key = (creds.apiKey || "").trim();
    const proj = (creds.projectId || "").trim();
    const sub = (creds.subnetId || "").trim();
    if (key) localStorage.setItem(BYOK_KEY, key);
    else localStorage.removeItem(BYOK_KEY);
    if (proj) localStorage.setItem(BYOK_PROJECT, proj);
    else localStorage.removeItem(BYOK_PROJECT);
    if (sub) localStorage.setItem(BYOK_SUBNET, sub);
    else localStorage.removeItem(BYOK_SUBNET);
  } catch {
    /* storage full / private mode — stay in Demo Mode */
  }
  notifyByokChanged();
}

export function clearByokCredentials(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(BYOK_KEY);
    localStorage.removeItem(BYOK_PROJECT);
    localStorage.removeItem(BYOK_SUBNET);
  } catch {
    /* ignore */
  }
  notifyByokChanged();
}

export function notifyByokChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(BYOK_EVENT));
  } catch {
    /* ignore */
  }
}

/** Headers attached per-request; secrets never leave the browser except here. */
export function buildByokHeaders(): Record<string, string> {
  const { apiKey, projectId, subnetId } = getByokCredentials();
  const h: Record<string, string> = {};
  if (apiKey) h["X-Nebius-Api-Key"] = apiKey;
  if (projectId) h["X-Nebius-Project-Id"] = projectId;
  if (subnetId) h["X-Nebius-Subnet-Id"] = subnetId;
  return h;
}
