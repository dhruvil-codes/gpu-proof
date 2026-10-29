import { redirect } from "next/navigation";

/* ==========================================================================
   /sandbox redirect — the live 1-hour chat console entry point was replaced
   by the unified Crash-Test Lab on /. Deep links keep working: `model`,
   `gpu`, and `precision` parameters are forwarded as lab prefill parameters.
   ========================================================================== */

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}

/** Sandbox GPU keys ("L40S", "H100", "H100X8", …) map to lab tier ids. */
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

export default function SandboxRedirect({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = new URLSearchParams();
  const model = first(searchParams?.model) ?? first(searchParams?.candidate_model);
  if (model) params.set("candidate_model", model);
  const gpu = normalizeGpu(first(searchParams?.gpu) ?? first(searchParams?.target_gpu));
  if (gpu) params.set("target_gpu", gpu);
  const precision = first(searchParams?.precision);
  if (precision) params.set("precision", precision);
  const workload = normalizeWorkload(first(searchParams?.workload));
  if (workload) params.set("workload", workload);
  const qs = params.toString();
  redirect(qs ? `/?${qs}` : "/");
}
