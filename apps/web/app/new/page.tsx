"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

export default function New() {
  const r = useRouter();
  const [form, setForm] = useState({ candidate_model: "Nemotron-3-Nano-30B", current_model: "Qwen3-8B", requests: 200, budget_usd: 10 });
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg("Creating...");
    const res = await fetch(`${API}/certifications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await res.json(); setMsg(`twin ${j.twin_digest} · starting...`);
    const s = await fetch(`${API}/certifications/${j.id}/start`, { method: "POST" });
    const out = await s.json();
    const items = JSON.parse(localStorage.getItem("gpuproof-certs") || "[]");
    items.unshift({ id: j.id, candidate: form.candidate_model, status: out.status, spend: out.spend ?? 0, experiments: (out.experiments || []).length, simulated: out.simulated });
    localStorage.setItem("gpuproof-certs", JSON.stringify(items));
    r.push(`/timeline/${j.id}`);
  }
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  return (<main className="mx-auto max-w-2xl px-6 py-8">
    <h1 className="text-2xl">New Certification</h1>
    <p className="text-xs text-muted">Current + Candidate + Workload + Requirements + Budget. Policy validates every experiment (1 GPU, 15 min, $2/exp, L40S/H100, vLLM).</p>
    <form onSubmit={submit} className="panel mt-6 space-y-4 rounded p-5">
      <label className="block text-xs">Current deployment<input value={form.current_model} onChange={(e) => set("current_model", e.target.value)} className="mt-1 w-full border border-ink bg-transparent p-2 text-sm" /></label>
      <label className="block text-xs">Candidate model ID<input value={form.candidate_model} onChange={(e) => set("candidate_model", e.target.value)} className="mt-1 w-full border border-ink bg-transparent p-2 text-sm" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs">Requests<input type="number" value={form.requests} onChange={(e) => set("requests", +e.target.value)} className="mt-1 w-full border border-ink bg-transparent p-2 text-sm" /></label>
        <label className="block text-xs">Budget (≤ $10)<input type="number" value={form.budget_usd} onChange={(e) => set("budget_usd", +e.target.value)} className="mt-1 w-full border border-ink bg-transparent p-2 text-sm" /></label>
      </div>
      <button className="btn-dark w-full rounded px-4 py-3 text-sm">Run Certification</button>
      <p className="text-[11px] text-muted">{msg}</p>
    </form>
  </main>);
}
