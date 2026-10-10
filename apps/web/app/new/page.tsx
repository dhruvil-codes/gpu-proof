"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopNav } from "@/components/ui";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

export default function New() {
  const r = useRouter();
  const q = useSearchParams();
  const [form, setForm] = useState({ candidate_model: q.get("candidate_model") || "Nemotron-3-Nano-30B", current_model: "Qwen3-8B", requests: 200, budget_usd: 10 });
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.candidate_model.trim()) errs.candidate_model = "Candidate model is required.";
    if (!form.current_model.trim()) errs.current_model = "Current deployment is required.";
    if (!(form.requests >= 20 && form.requests <= 1000)) errs.requests = "Requests must be 20–1000.";
    if (!(form.budget_usd >= 0.05 && form.budget_usd <= 10)) errs.budget_usd = "Budget must be $0.05–$10.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setMsg("Creating twin...");
    try {
      const res = await fetch(`${API}/certifications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      const j = await res.json(); setMsg(`twin ${j.twin_digest} · launching...`);
      const s = await fetch(`${API}/certifications/${j.id}/start`, { method: "POST" });
      if (!s.ok) throw new Error(`start failed: ${s.status}`);
      try {
        const items = JSON.parse(localStorage.getItem("gpuproof-certs") || "[]");
        items.unshift({ id: j.id, candidate: form.candidate_model, status: "RUNNING", spend: 0, experiments: 0, simulated: true });
        localStorage.setItem("gpuproof-certs", JSON.stringify(items.slice(0, 20)));
      } catch {}
      r.push(`/timeline/${j.id}`);
    } catch (err: any) { setMsg(`Error: ${err.message} — is the API running on ${API}?`); }
  }
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const field = "mt-1 min-h-[44px] w-full border border-ink bg-transparent p-2 text-sm";
  return (<main>
    <TopNav />
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl">New Certification</h1>
      <p className="text-xs text-muted">Current + Candidate + Workload + Requirements + Budget. Policy validates every experiment (1 GPU, 15 min, $2/exp, L40S/H100, vLLM).</p>
      <form onSubmit={submit} noValidate className="panel mt-6 space-y-4 rounded p-5">
        <div><label htmlFor="cur" className="block text-xs">Current deployment</label>
          <input id="cur" value={form.current_model} onChange={(e) => set("current_model", e.target.value)} aria-invalid={!!errors.current_model} aria-describedby="cur-err" className={field} />
          {errors.current_model && <p id="cur-err" role="alert" className="mt-1 text-[11px] text-block">{errors.current_model}</p>}</div>
        <div><label htmlFor="cand" className="block text-xs">Candidate model ID</label>
          <input id="cand" value={form.candidate_model} onChange={(e) => set("candidate_model", e.target.value)} aria-invalid={!!errors.candidate_model} aria-describedby="cand-err" className={field} />
          {errors.candidate_model && <p id="cand-err" role="alert" className="mt-1 text-[11px] text-block">{errors.candidate_model}</p>}</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label htmlFor="req" className="block text-xs">Requests</label>
            <input id="req" type="number" value={form.requests} onChange={(e) => set("requests", +e.target.value)} className={field} />
            {errors.requests && <p role="alert" className="mt-1 text-[11px] text-block">{errors.requests}</p>}</div>
          <div><label htmlFor="bud" className="block text-xs">Budget (≤ $10)</label>
            <input id="bud" type="number" step="0.01" value={form.budget_usd} onChange={(e) => set("budget_usd", +e.target.value)} className={field} />
            {errors.budget_usd && <p role="alert" className="mt-1 text-[11px] text-block">{errors.budget_usd}</p>}</div>
        </div>
        <button className="btn-dark min-h-[44px] w-full cursor-pointer rounded px-4 py-3 text-sm transition-colors">Run Certification</button>
        <p aria-live="polite" className="text-[11px] text-muted">{msg}</p>
      </form>
    </div>
  </main>);
}
