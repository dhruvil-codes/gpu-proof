"use client";
import Link from "next/link";
import { StatusPill, TopNav } from "@/components/ui";

const chips = ["Tool Calling", "Structured Output", "RAG", "Chat", "Coding"];

export default function Home() {
  return (<main>
    <TopNav />
    <section className="grid-cells relative px-6 pb-10 pt-14 text-center">
      <div className="chip inline-flex items-center gap-2 px-3 py-1 text-[11px]">
        <span>Introducing GPUProof</span><Link href="/new" className="btn-dark cursor-pointer rounded px-2 py-0.5 transition-colors">Try now →</Link>
      </div>
      <h1 className="mt-6 text-4xl leading-tight tracking-tight md:text-6xl">Make your model prove it.</h1>
      <p className="mx-auto mt-4 max-w-xl text-sm text-muted">CI/CD for AI inference. Certify a candidate model against your deployment on real Nebius GPUs — measured latency, quality, cost. <StatusPill status="SHIP" /> or <StatusPill status="BLOCK" />.</p>
      <form action="/new" method="get" className="mx-auto mt-8 max-w-2xl rounded-xl bg-ink p-4 text-left text-canvas">
        <label htmlFor="candidate" className="text-[11px] text-canvas/70">Certify</label>
        <div className="flex items-center gap-2">
          <input id="candidate" name="candidate_model" defaultValue="nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" className="min-h-[44px] w-full bg-transparent text-sm outline-none placeholder:text-canvas/40" placeholder="Certify nvidia/... against my current deployment" />
          <Link href="/new" aria-label="Attach workload file" className="cursor-pointer rounded border border-canvas/30 px-2 py-1 transition-colors hover:bg-white/10">＋</Link>
          <button aria-label="Start certification" className="min-h-[44px] cursor-pointer rounded bg-canvas px-3 py-1 text-ink transition-colors hover:bg-white">→</button>
        </div>
      </form>
      <div className="mt-4 flex flex-wrap justify-center gap-2">{chips.map((c) => (<span key={c} className="chip bg-transparent px-3 py-1 text-[11px]">◈ {c}</span>))}</div>
    </section>
    <section className="px-6 py-10 text-center">
      <p className="text-sm font-bold">Built on, not trusted by</p>
      <p className="mt-1 text-[11px] text-muted">No fake customer logos — honest stack only.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-3 text-[11px]">
        {["Nebius AI Cloud", "NVIDIA Nemotron", "vLLM", "Next.js", "FastAPI"].map((b) => (<span key={b} className="chip px-3 py-1">{b}</span>))}
      </div>
      <div className="mx-auto mt-8 grid max-w-3xl gap-3 text-left md:grid-cols-3">
        {[["Configure", "Current + candidate + workload + SLA gates + budget."], ["Certify", "Planner proposes, policy approves, Nebius executes."], ["Decide", "Measured SHIP / BLOCK certificate with evidence."]].map(([t, d]) => (
          <div key={t} className="panel rounded p-4 transition-shadow hover:shadow-[3px_3px_0_#1F1F1F]"><p className="text-xs font-bold">{t}</p><p className="mt-1 text-[11px] text-muted">{d}</p></div>))}
      </div>
      <Link href="/new" className="btn-dark mt-8 inline-block min-h-[44px] cursor-pointer rounded px-5 py-3 text-sm transition-colors">Run Certification</Link>
    </section>
  </main>);
}
