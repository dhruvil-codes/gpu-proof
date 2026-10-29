import type { PassportData } from "@/lib/passport";

/* The shareable 1200×630 proof card. Sized with container-query units so the
   card's internal type scales with the card, never with the viewport. */
export function ModelPassport({ data }: { data: PassportData }) {
  const statusClass = data.status === "SHIP" ? "bg-ship" : data.status === "BLOCK" ? "bg-block" : "bg-warn";
  return (
    <div
      data-ui
      className="relative aspect-[1200/630] w-full overflow-hidden rounded-card bg-term text-termText"
      role="img"
      aria-label={`${data.status} model passport for ${data.model}`}
      style={{ containerType: "inline-size" }}
    >
      <div className="relative flex h-full flex-col px-[9%] pb-[6%] pt-[5%]">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[clamp(13px,2.1cqw,26px)] font-semibold tracking-[-0.02em]">
            <span className="mr-[0.5em] inline-block h-[0.55em] w-[0.55em] bg-accent" aria-hidden="true" />
            SandboxProof
          </span>
          <span className="text-[clamp(13px,1.5cqw,18px)] text-termMuted">Model passport — verifiable receipt</span>
        </div>
        <div className="mt-auto">
          <p className="text-[clamp(13px,1.55cqw,19px)] font-medium text-accent">{data.label || "SANDBOX-MEASURED"}</p>
          <h3 className="mt-2 max-w-full truncate text-[clamp(17px,4.6cqw,56px)] font-semibold tracking-[-0.02em]">{data.model}</h3>
        </div>
        <div className="mt-4 flex items-end gap-[5%]">
          <div className={`${statusClass} rounded-control px-[3%] py-[1.2%] text-[clamp(19px,5.4cqw,66px)] font-semibold leading-none tracking-[-0.02em]`}>{data.status}</div>
          <div className="grid gap-[0.35em] pb-1 text-[clamp(13px,1.6cqw,20px)] text-termMuted tabular-nums">
            <span>Hardware {data.hardware}</span>
            <span>P95 {data.p95Ms == null ? "—" : `${Math.round(data.p95Ms)} ms`} · Tool {data.toolAccuracy == null ? "—" : `${Math.round(data.toolAccuracy * 100)}%`}</span>
            <span>Safe streams {data.concurrency ?? "—"}</span>
          </div>
        </div>
        <code className="mt-auto block truncate pt-[1.2em] text-[clamp(13px,1.4cqw,17px)] text-termMuted">SHA-256&nbsp;&nbsp;{data.fingerprint}</code>
      </div>
    </div>
  );
}
