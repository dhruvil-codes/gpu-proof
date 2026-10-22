import type { PassportData } from "@/lib/passport";

export function ModelPassport({ data }: { data: PassportData }) {
  const statusClass = data.status === "SHIP" ? "bg-ship" : data.status === "BLOCK" ? "bg-block" : "bg-warning";
  return <div className="relative aspect-[1200/630] w-full overflow-hidden border border-darkRule bg-ink text-white" role="img" aria-label={`${data.status} model passport for ${data.model}`}>
    <div className="absolute inset-x-[7%] top-[14%] border-t border-darkRule" />
    <div className="absolute inset-x-[7%] bottom-[16%] border-t border-darkRule" />
    <div className="absolute inset-y-0 left-[7%] border-l border-darkRule" />
    <div className="absolute inset-y-0 right-[7%] border-l border-darkRule" />
    <div className="relative flex h-full flex-col px-[9%] pb-[7%] pt-[5%]">
      <div className="flex items-center justify-between gap-4"><span className="text-[clamp(11px,2vw,18px)] font-semibold tracking-[-0.04em]"><span className="mr-2 inline-block size-2 bg-orange" />SANDBOXPROOF</span><span className="hidden font-mono text-[clamp(6px,1vw,11px)] tracking-[0.05em] text-inverseMuted sm:block">MODEL PASSPORT / VERIFIABLE RECEIPT</span></div>
      <div className="mt-auto"><p className="font-mono text-[clamp(7px,1.05vw,11px)] tracking-[0.1em] text-orange">{data.label || "SANDBOX-MEASURED"}</p><h3 className="mt-2 max-w-full truncate text-[clamp(18px,4.5vw,48px)] font-semibold tracking-[-0.055em]">{data.model}</h3></div>
      <div className="mt-4 flex items-end gap-[5%]"><div className={`${statusClass} px-[3%] py-[1%] text-[clamp(20px,5.6vw,64px)] font-semibold leading-none tracking-[-0.06em]`}>{data.status}</div><div className="grid gap-1 pb-1 font-mono text-[clamp(6px,1.05vw,11px)] text-inverseMuted"><span>HARDWARE {data.hardware}</span><span>P95 {data.p95Ms == null ? "—" : `${Math.round(data.p95Ms)}MS`} · TOOL {data.toolAccuracy == null ? "—" : `${Math.round(data.toolAccuracy * 100)}%`}</span><span>SAFE STREAMS {data.concurrency ?? "—"}</span></div></div>
      <p className="mt-auto truncate border-t border-darkRule pt-3 font-mono text-[clamp(6px,1vw,10px)] text-inverseMuted">SHA-256 &nbsp; {data.fingerprint}</p>
    </div>
  </div>;
}
