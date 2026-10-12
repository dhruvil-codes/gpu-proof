"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ByokBadge, ExecutionModeToggle, TopNav, useByokStatus } from "@/components/ui";
import ByokModal from "@/components/ByokModal";
import { buildByokHeaders } from "@/components/byok";
import { buildExecutionHeaders, getExecutionMode } from "@/components/executionMode";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

type FormState = {
  candidate_model: string;
  current_model: string;
  requests: number;
  budget_usd: number;
};

const NANO = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";

const TEMPLATES: {
  id: string;
  glyph: string;
  title: string;
  focus: string;
  values: Partial<FormState>;
}[] = [
  {
    id: "cost",
    glyph: "💰",
    title: "Cloud Cost Optimization",
    focus: "Focus: Cut GPU bills.",
    values: { current_model: "Qwen3-8B on H100", candidate_model: NANO, requests: 200, budget_usd: 10 },
  },
  {
    id: "latency",
    glyph: "⚡",
    title: "Latency-Critical (Customer Facing)",
    focus: "Focus: Sub-1000ms response time.",
    values: { current_model: "Qwen3-8B", candidate_model: NANO, requests: 300, budget_usd: 10 },
  },
  {
    id: "accuracy",
    glyph: "🎯",
    title: "Strict Tool & Schema Accuracy",
    focus: "Focus: Zero broken JSON or tool calls.",
    values: { requests: 250, budget_usd: 10 },
  },
];

export default function New() {
  return (<main>
    <TopNav />
    <Suspense fallback={<p className="p-8 text-sm">Loading form…</p>}>
      <NewForm />
    </Suspense>
  </main>);
}

function NewForm() {
  const r = useRouter();
  const q = useSearchParams();
  const prefill = q.get("candidate_model") || "Nemotron-3-Nano-30B";
  const [form, setForm] = useState<FormState>({
    candidate_model: prefill,
    current_model: "Qwen3-8B",
    requests: 200,
    budget_usd: 10,
  });
  // Advisor CTA navigates to /new?candidate_model=<slug> — sync it into the form
  // even when the user is already on /new (client-side navigation).
  useEffect(() => {
    const v = q.get("candidate_model");
    if (v && v !== form.candidate_model) {
      setForm((f) => ({ ...f, candidate_model: v }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [byokOpen, setByokOpen] = useState(false);
  const byokConnected = useByokStatus();

  function applyTemplate(id: string) {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setForm((f) => ({ ...f, ...t.values }));
    setActiveTemplate(id);
  }

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
      // Client-side BYOK: keys live in localStorage, sent per-request as headers.
      // Execution mode toggle (localStorage) is sent as both body + headers.
      const mode = getExecutionMode();
      const byokHeaders = buildByokHeaders();
      const execHeaders = buildExecutionHeaders(mode);
      const res = await fetch(`${API}/certifications`, { method: "POST", headers: { "Content-Type": "application/json", ...byokHeaders, ...execHeaders }, body: JSON.stringify({ ...form, mode }) });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      const j = await res.json(); setMsg(`twin ${j.twin_digest} · launching...${j.byok_used ? " (BYOK: your Nebius key)" : ""}${j.mode ? ` [${j.mode === "real" ? "⚡ Live GPU" : "🧪 Simulator"}]` : ""}`);
      const s = await fetch(`${API}/certifications/${j.id}/start`, { method: "POST", headers: { ...byokHeaders, ...execHeaders } });
      if (!s.ok) throw new Error(`start failed: ${s.status}`);
      try {
        const items = JSON.parse(localStorage.getItem("gpuproof-certs") || "[]");
        items.unshift({ id: j.id, candidate: form.candidate_model, status: "RUNNING", spend: 0, experiments: 0, simulated: true, created_at: new Date().toISOString() });
        localStorage.setItem("gpuproof-certs", JSON.stringify(items.slice(0, 20)));
      } catch {}
      r.push(`/timeline/${j.id}`);
    } catch (err: unknown) { setMsg(`Error: ${err instanceof Error ? err.message : String(err)} — is the API running on ${API}?`); }
  }

  const set = (k: keyof FormState, v: string | number) => {
    setForm((f) => ({ ...f, [k]: v }));
    setActiveTemplate(null);
  };
  const field = "mt-1 min-h-[44px] w-full rounded border border-ink bg-transparent p-2 text-sm outline-none focus:border-black";
  const label = "block text-sm font-bold";
  const helper = "mt-1 block text-[11px] leading-relaxed text-muted";

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl tracking-tight">New Certification</h1>
      <p className="mt-1 text-xs leading-relaxed text-muted">Pick a scenario below — or fill in the form manually. No guessing required: every test runs under a strict safety policy.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Execution mode">
        <ByokBadge connected={byokConnected} />
        <button
          type="button"
          onClick={() => setByokOpen(true)}
          className="min-h-[44px] cursor-pointer rounded border border-ink px-3 py-2 text-xs font-bold transition-all hover:-translate-y-px hover:shadow-[4px_4px_0_rgba(31,31,31,0.25)]"
        >
          🔑 BYOK / API Key
        </button>
        <span className="text-[11px] text-muted">
          {byokConnected
            ? "Live GPU runs will bill your Nebius key (host cap bypassed)."
            : "No key? Runs use Demo Mode (Simulated / Host Pool)."}
        </span>
      </div>

      <div className="mt-4" aria-label="Execution mode toggle">
        <p className="text-[11px] uppercase tracking-widest text-muted">Execution Mode (saved to this browser)</p>
        <div className="mt-2 max-w-xl">
          <ExecutionModeToggle />
        </div>
        <p className="mt-1 text-[11px] text-muted">⚡ Live runs on Nebius Cloud GPUs · 🧪 Simulator is instant, free, and never certifies.</p>
      </div>
      <ByokModal open={byokOpen} onClose={() => setByokOpen(false)} />

      <div className="mt-6" role="group" aria-label="Scenario templates">
        <p className="text-[11px] uppercase tracking-widest text-muted">Start from a 1-click scenario</p>
        <div className="mt-3 grid gap-3 text-left sm:grid-cols-3">
          {TEMPLATES.map((t) => {
            const selected = activeTemplate === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t.id)}
                aria-pressed={selected}
                className={`min-h-[44px] cursor-pointer rounded-lg border p-4 text-left transition-all ${selected ? "border-ink bg-ink text-canvas shadow-[4px_4px_0_rgba(31,31,31,0.25)]" : "border-ink bg-[#F5F1E9] hover:shadow-[4px_4px_0_#1F1F1F]"}`}
              >
                <span className="block text-sm font-bold" aria-hidden="true">{t.glyph} {t.title}</span>
                <span className={`mt-1 block text-[11px] leading-relaxed ${selected ? "text-canvas/70" : "text-muted"}`}>{t.focus}</span>
                <span className={`mt-2 block text-[11px] font-bold ${selected ? "text-canvas" : "text-ink"}`}>{selected ? "✓ Selected" : "Use this scenario →"}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_300px]">
        <form onSubmit={submit} noValidate className="panel space-y-5 rounded-lg p-5">
          <div>
            <label htmlFor="cur" className={label}>Current Production Deployment</label>
            <span id="cur-help" className={helper}>The model and hardware currently serving your production traffic.</span>
            <input id="cur" value={form.current_model} onChange={(e) => set("current_model", e.target.value)} aria-invalid={!!errors.current_model} aria-describedby="cur-err cur-help" className={field} placeholder="e.g. Qwen3-8B on H100" />
            {errors.current_model && <p id="cur-err" role="alert" className="mt-1 text-[11px] text-block">{errors.current_model}</p>}
          </div>
          <div>
            <label htmlFor="cand" className={label}>Candidate Model to Certify</label>
            <span id="cand-help" className={helper}>The new model you are evaluating (Hugging Face ID).</span>
            <input id="cand" value={form.candidate_model} onChange={(e) => set("candidate_model", e.target.value)} aria-invalid={!!errors.candidate_model} aria-describedby="cand-err cand-help" className={field} placeholder="e.g. nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" />
            {errors.candidate_model && <p id="cand-err" role="alert" className="mt-1 text-[11px] text-block">{errors.candidate_model}</p>}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="req" className={label}>Workload Sample Size</label>
              <span id="req-help" className={helper}>Number of deterministic production queries to replay (e.g. 200 requests).</span>
              <input id="req" type="number" min={20} max={1000} value={form.requests} onChange={(e) => set("requests", +e.target.value)} aria-describedby="req-help" className={field} />
              {errors.requests && <p role="alert" className="mt-1 text-[11px] text-block">{errors.requests}</p>}
            </div>
            <div>
              <label htmlFor="bud" className={label}>Maximum Test Budget ($)</label>
              <span id="bud-help" className={helper}>Strict spending limit for this test (capped at $10.00; unused funds stay in your balance).</span>
              <input id="bud" type="number" step="0.01" min={0.05} max={10} value={form.budget_usd} onChange={(e) => set("budget_usd", +e.target.value)} aria-describedby="bud-help" className={field} />
              {errors.budget_usd && <p role="alert" className="mt-1 text-[11px] text-block">{errors.budget_usd}</p>}
            </div>
          </div>
          <button className="btn-dark min-h-[44px] w-full cursor-pointer rounded px-4 py-3 text-sm font-bold transition-colors">Run Certification →</button>
          <p aria-live="polite" className="text-[11px] text-muted">{msg}</p>
        </form>

        <aside aria-label="Audit preview and safety guarantee" className="h-fit rounded-lg border border-ink bg-ink p-5 text-canvas lg:sticky lg:top-6">
          <p className="text-[11px] uppercase tracking-widest text-canvas/60">Audit Preview &amp; Safety Guarantee</p>
          <dl className="mt-3 space-y-2 text-[12px] leading-relaxed">
            <div><dt className="font-bold">Testing</dt><dd className="text-canvas/80">{form.current_model || "—"} → {form.candidate_model || "—"}</dd></div>
            <div><dt className="font-bold">Workload</dt><dd className="text-canvas/80">{form.requests} requests · max ${Number(form.budget_usd || 0).toFixed(2)}</dd></div>
          </dl>
          <ul className="mt-4 space-y-3 border-t border-canvas/20 pt-4 text-[12px] leading-relaxed">
            <li><span aria-hidden="true">🛡️</span> <strong>Policy Enforced:</strong> <span className="text-canvas/80">Max 1 GPU, 15 min runtime, $2.00 max per experiment.</span></li>
            <li><span aria-hidden="true">⏱️</span> <strong>Estimated Test Duration:</strong> <span className="text-canvas/80">2 to 3 minutes.</span></li>
            <li><span aria-hidden="true">🛑</span> <strong>Failsafe:</strong> <span className="text-canvas/80">Auto-aborts if cloud budget limit is reached.</span></li>
          </ul>
        </aside>
      </div>
    </div>);
}
