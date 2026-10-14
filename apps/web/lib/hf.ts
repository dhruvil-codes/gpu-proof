"use client";

export type HfApiItem = {
  id?: unknown;
  likes?: unknown;
  downloads?: unknown;
  lastModified?: unknown;
  safetensors?: { total?: unknown };
};

/** Live Hugging Face model listing with a backend-proxy fallback.
 *
 * Browsers (adblock, tracking protection, flaky DNS) often fail direct calls
 * to huggingface.co — so try direct first, then fall back to our own
 * /api/models/live proxy which fetches server-side. Throws when both fail.
 */
export async function hfModels(params: Record<string, string>): Promise<HfApiItem[]> {
  const qs = new URLSearchParams(params).toString();
  try {
    const r = await fetch(`https://huggingface.co/api/models?${qs}`);
    if (r.ok) {
      const j = (await r.json()) as unknown;
      if (Array.isArray(j)) return j as HfApiItem[];
    }
  } catch {
    /* fall through to proxy */
  }
  const r2 = await fetch(`/api/models/live?${qs}`);
  if (!r2.ok) throw new Error("Hugging Face unreachable (direct + proxy)");
  const j2 = (await r2.json()) as unknown;
  if (!Array.isArray(j2)) throw new Error("Hugging Face unreachable (bad proxy payload)");
  return j2 as HfApiItem[];
}
