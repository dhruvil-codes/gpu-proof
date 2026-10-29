import { redirect } from "next/navigation";

/* ==========================================================================
   /new redirect — the dedicated audit form was replaced by the unified
   Crash-Test Lab on /. Inbound deep links keep working: every known query
   parameter is forwarded so the lab prefills the same state.
   ========================================================================== */

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}

/** Normalize hardware echo tokens ("L40S_48GB", "H100_80GB") to tier ids. */
function normalizeGpu(value: string | null): string | null {
  const upper = (value || "").toUpperCase();
  if (upper.startsWith("L40S")) return "L40S";
  if (upper.startsWith("H100")) return "H100";
  return upper || null;
}

function normalizeWorkload(value: string | null): string | null {
  const lower = (value || "").toLowerCase();
  return ["agent", "json", "burst"].includes(lower) ? lower : null;
}

export default function NewRedirect({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = new URLSearchParams();
  const candidate = first(searchParams?.candidate_model) ?? first(searchParams?.model);
  if (candidate) params.set("candidate_model", candidate);
  const current = first(searchParams?.current_model);
  if (current) params.set("current_model", current);
  const gpu = normalizeGpu(first(searchParams?.target_gpu) ?? first(searchParams?.gpu));
  if (gpu) params.set("target_gpu", gpu);
  const precision = first(searchParams?.precision);
  if (precision) params.set("precision", precision);
  const workload = normalizeWorkload(first(searchParams?.workload));
  if (workload) params.set("workload", workload);
  const qs = params.toString();
  redirect(qs ? `/?${qs}` : "/");
}
