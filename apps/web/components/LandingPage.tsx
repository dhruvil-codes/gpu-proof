"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ModelPassport } from "@/components/ModelPassport";
import { SiteFooter, TopNav } from "@/components/ui";
import { downloadPassportPng, passportShareUrl, type PassportData } from "@/lib/passport";

const candidates = [
  { id: "nvidia/Nemotron-3-Nano-30B", name: "Nemotron-3-Nano-30B", weights: 30, kv: 18 },
  { id: "Qwen/Qwen3-8B", name: "Qwen3-8B", weights: 16, kv: 9 },
  { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama-3.3-70B", weights: 70, kv: 24 },
];
const hardware = [
  { id: "L40S", label: "L40S", memory: 48 },
  { id: "H100", label: "H100", memory: 80 },
  { id: "H200", label: "H200", memory: 141 },
];
const demoStages = [
  { index: "00", title: "Proposal accepted", detail: "Candidate weights and workload twin are sealed before execution.", status: "READY" },
  { index: "01", title: "L40S microVM starts", detail: "18 concurrent agent streams expand the KV cache under load.", status: "RUNNING" },
  { index: "02", title: "Memory breach caught", detail: "CUDA out of memory at the 7,282-token boundary.", status: "BLOCK" },
  { index: "03", title: "Nemotron diagnoses", detail: "MEMORY: change hardware and precision; hard gates stay fixed.", status: "ADAPT" },
  { index: "04", title: "H100 FP8 rerun passes", detail: "Same workload twin, new isolated microVM, measured receipts.", status: "SHIP" },
];
const matrix = [
  ["What it measures", "Human preference votes", "Your agent workload and SLA gates"],
  ["Execution environment", "Single-turn leaderboard", "Fresh isolated microVM per experiment"],
  ["VRAM and concurrency", "No hardware receipt", "GPU memory, OOM boundary, safe streams"],
  ["Tool calling", "Conversation quality signal", "Deterministic tool and JSON validation"],
  ["Output", "Relative rank", "SHIP / BLOCK certificate with evidence"],
];

function Rail({ index, dark = false }: { index: string; dark?: boolean }) {
  return <aside aria-hidden="true" className={`sigil-index-rail hidden px-7 pt-9 font-mono text-[11px] tracking-[0.08em] md:block ${dark ? "border-darkRule text-inverseMuted" : "text-muted"}`}>{index}</aside>;
}

function SectionLabel({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <p className={`sigil-label flex items-center gap-3 ${dark ? "text-orange" : "text-orangeDeep"}`}><span className="size-1.5 bg-orange" aria-hidden="true" />{children}</p>;
}

function OomAutopsy({ memory, used, animated = false }: { memory: number; used: number; animated?: boolean }) {
  const pct = Math.min(100, Math.round((used / memory) * 100));
  const breachTokens = Math.floor((memory - 30 - 2) / (18 / 8192));
  return <div className="border border-darkRule bg-inkSoft p-4 sm:p-6">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-2"><div><p className="sigil-label text-orange">OOM AUTOPSY / KV CACHE</p><p className="mt-2 font-mono text-xs text-inverseMuted">30 GB WEIGHTS + 18 GB KV + 2 GB RUNTIME</p></div><span className="font-mono text-xs text-orange">{used} / {memory} GB</span></div>
    <div className="relative h-10 overflow-visible border border-darkRule bg-[#272725]" role="img" aria-label={`${used} gigabytes estimated use against ${memory} gigabytes available`}>
      <div className={`${animated ? "sigil-oom-fill" : ""} h-full bg-orange`} style={{ width: animated ? undefined : `${pct}%` }} />
      <div className="absolute inset-y-[-6px] right-0 border-r-2 border-white" />
      {used > memory && <div className="absolute right-0 top-0 h-full w-[5%] bg-block/90" />}
    </div>
    <div className="mt-3 flex flex-wrap justify-between gap-2 font-mono text-[10px] tracking-[0.04em] text-inverseMuted"><span>0 TOKENS</span><span>BREACH ≈ {breachTokens.toLocaleString()} TOKENS</span><span>{memory} GB LIMIT</span></div>
  </div>;
}

function QuickTest() {
  const [baseline, setBaseline] = useState("Qwen/Qwen3-8B");
  const [candidateId, setCandidateId] = useState(candidates[0].id);
  const [hardwareId, setHardwareId] = useState("L40S");
  const candidate = candidates.find((item) => item.id === candidateId) || candidates[0];
  const target = hardware.find((item) => item.id === hardwareId) || hardware[0];
  const runtime = 2;
  const estimate = candidate.weights + candidate.kv + runtime;
  const fits = estimate <= target.memory;
  const href = `/new?candidate_model=${encodeURIComponent(candidate.id)}&current_model=${encodeURIComponent(baseline)}&target_gpu=${encodeURIComponent(target.id)}`;
  return <div className="border border-rule bg-white shadow-[8px_8px_0_#DEDFDA]">
    <div className="flex items-center justify-between border-b border-rule px-5 py-4 sm:px-6"><span className="sigil-label text-ink">QUICK TEST / CONFIGURE THE SWAP</span><span className="font-mono text-[10px] text-muted">01—03</span></div>
    <div className="grid gap-0 md:grid-cols-2"><label className="border-b border-rule px-5 py-5 md:border-r sm:px-6"><span className="sigil-label text-muted">01 / BASELINE</span><select value={baseline} onChange={(event) => setBaseline(event.target.value)} className="mt-3 w-full min-h-11 bg-transparent text-base font-medium outline-none" aria-label="Baseline model"><option value="Qwen/Qwen3-8B">Qwen3-8B</option><option value="meta-llama/Llama-3.1-8B-Instruct">Llama-3.1-8B</option></select></label><label className="border-b border-rule px-5 py-5 sm:px-6"><span className="sigil-label text-muted">02 / CANDIDATE</span><select value={candidateId} onChange={(event) => setCandidateId(event.target.value)} className="mt-3 w-full min-h-11 bg-transparent text-base font-medium outline-none" aria-label="Candidate model">{candidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    <div className="border-b border-rule px-5 py-5 sm:px-6"><p className="sigil-label text-muted">03 / TARGET HARDWARE</p><div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="Target hardware">{hardware.map((item) => <button key={item.id} type="button" onClick={() => setHardwareId(item.id)} aria-pressed={hardwareId === item.id} className={`sigil-technical-button border px-2 py-2 text-left font-mono text-xs ${hardwareId === item.id ? "border-ink bg-ink text-white" : "border-rule bg-paper hover:border-ink"}`}><span className="block">{item.label}</span><span className={`mt-1 block text-[10px] ${hardwareId === item.id ? "text-inverseMuted" : "text-muted"}`}>{item.memory} GB</span></button>)}</div></div>
    <div className="px-5 py-5 sm:px-6"><div className="flex items-center justify-between gap-3"><span className="sigil-label text-muted">VRAM ESTIMATE / FP8</span><span className={`font-mono text-[11px] ${fits ? "text-ship" : "text-block"}`}>{fits ? "FITS ON PAPER" : "OOM RISK"}</span></div><p className="mt-3 font-mono text-[clamp(11px,1.25vw,14px)] leading-6 text-ink">{candidate.weights} GB WEIGHTS <span className="text-orange">+</span> {candidate.kv} GB KV <span className="text-orange">+</span> {runtime} GB RUNTIME <span className="text-muted">/</span> {target.memory} GB {target.label}</p><div className="mt-4 h-2 bg-paper"><div className={`h-full ${fits ? "bg-ship" : "bg-orange"}`} style={{ width: `${Math.min(100, estimate / target.memory * 100)}%` }} /></div><p className="mt-3 text-xs leading-5 text-muted">Estimate only. The audit measures your actual workload, concurrency, and tail latency in a sandbox.</p></div>
    <Link href={href} className="sigil-technical-button flex min-h-16 items-center justify-between bg-orange px-5 text-sm font-semibold text-white hover:bg-orangeDeep sm:px-6"><span>Run Sandbox Audit</span><span aria-hidden="true">→</span></Link>
  </div>;
}

function CrashDemo() {
  const [stage, setStage] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    if (stage >= demoStages.length - 1) { setRunning(false); return; }
    const timer = window.setTimeout(() => setStage((value) => value + 1), 1050);
    return () => window.clearTimeout(timer);
  }, [running, stage]);
  const run = () => { setStage(0); setRunning(true); };
  return <section id="demo" className="bg-ink text-white"><div className="sigil-section border-darkRule"><div className="sigil-section-inner"><Rail index="03" dark /><div className="sigil-content px-6 py-16 sm:px-10 lg:px-16 lg:py-24"><SectionLabel dark>LIVE CRASH-TEST / ILLUSTRATIVE WALKTHROUGH</SectionLabel><div className="mt-6 flex flex-col justify-between gap-8 lg:flex-row lg:items-end"><div><h2 className="sigil-h2 max-w-xl">The leaderboard says yes.<br /><span className="text-orange">The sandbox asks why.</span></h2><p className="sigil-body mt-5 max-w-2xl text-inverseMuted">See the same candidate meet a real agent workload. This walkthrough demonstrates the failure and adaptation path; launch an audit for your own measured result.</p></div><button type="button" onClick={run} disabled={running} className="sigil-technical-button shrink-0 border border-white px-6 font-mono text-xs hover:bg-white hover:text-ink">{running ? "REPLAYING…" : stage === 0 ? "RUN THE SCENARIO →" : "REPLAY SCENARIO →"}</button></div>
      <div className="mt-12 grid gap-px border border-darkRule bg-darkRule lg:grid-cols-2"><div className="bg-inkSoft p-6 sm:p-8"><p className="sigil-label text-inverseMuted">COLUMN A / STANDARD ARENA DEPLOYMENT</p><h3 className="sigil-h3 mt-8">Good vibes.<br />No hardware proof.</h3><p className="mt-4 text-sm leading-6 text-inverseMuted">A model wins preference votes at batch size 1. Production concurrency expands KV cache. There is no isolated run, operation ID, or memory receipt.</p><div className="sigil-terminal mt-9 p-4 text-[11px] leading-5"><span className="text-inverseMuted">$ vllm serve candidate --gpu L40S</span><br /><span className="text-block">CUDA out of memory</span><br /><span className="text-inverseMuted">KV allocation failed · no recovery plan</span></div><p className="mt-5 font-mono text-xs text-block">RESULT / UNEXPECTED PRODUCTION FAILURE</p></div><div className="bg-ink p-6 sm:p-8"><p className="sigil-label text-orange">COLUMN B / SANDBOXPROOF GAUNTLET</p><h3 className="sigil-h3 mt-8">Crash early.<br />Ship with receipts.</h3><p className="mt-4 text-sm leading-6 text-inverseMuted">Fresh Nebius microVMs replay one sealed workload twin. Nemotron diagnoses the OOM, proposes H100 FP8, and deterministic policy keeps every gate unchanged.</p><ol className="mt-8 border-t border-darkRule" aria-label="Crash test stages">{demoStages.map((item, index) => <li key={item.index} className={`grid grid-cols-[32px_1fr_auto] items-start gap-3 border-b border-darkRule py-3 text-xs ${index <= stage ? "text-white" : "text-inverseMuted/50"}`}><span className="font-mono text-[10px] text-orange">{item.index}</span><span><strong className="block font-medium">{item.title}</strong>{index === stage && <span className="mt-1 block text-inverseMuted">{item.detail}</span>}</span><span className={`font-mono text-[10px] ${item.status === "SHIP" ? "text-ship" : item.status === "BLOCK" ? "text-block" : "text-inverseMuted"}`}>{item.status}</span></li>)}</ol></div></div>
      <div className="mt-6"><OomAutopsy memory={48} used={50} animated={stage >= 1 && stage <= 3} /></div><div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-darkRule pt-6"><p className="font-mono text-xs text-inverseMuted">FINAL CERTIFICATE / {stage === 4 ? <span className="text-ship">SHIP · H100 FP8</span> : "AWAITING RERUN"}</p><Link href="/new" className="text-sm font-medium underline decoration-orange underline-offset-4 hover:text-orange">Audit your model →</Link></div>
    </div></div></div></section>;
}

function Matrix() {
  return <section id="comparison" className="bg-paper"><div className="sigil-section"><div className="sigil-section-inner"><Rail index="07" /><div className="sigil-content px-6 py-16 sm:px-10 lg:px-16 lg:py-24"><SectionLabel>PUBLIC BENCHMARK VS PRODUCTION PROOF</SectionLabel><h2 className="sigil-h2 mt-6">Preference is a signal.<br />Execution is a test.</h2><p className="sigil-body mt-5 max-w-2xl text-muted">Arena rankings help compare conversational quality. They cannot certify that a candidate meets your hardware and workload limits.</p><div className="mt-12 overflow-x-auto border border-rule bg-white"><table className="w-full min-w-[640px] border-collapse text-left"><thead><tr className="border-b border-rule"><th scope="col" className="w-[28%] px-5 py-5 font-mono text-[11px] font-medium tracking-[0.06em] text-muted">TEST DIMENSION</th><th scope="col" className="w-[34%] border-l border-rule px-5 py-5 font-mono text-[11px] font-medium tracking-[0.06em] text-muted">ARENA.AI</th><th scope="col" className="w-[38%] border-l border-rule bg-orangeWash px-5 py-5 font-mono text-[11px] font-medium tracking-[0.06em] text-orangeDeep">SANDBOXPROOF</th></tr></thead><tbody>{matrix.map(([label, arena, proof]) => <tr key={label} className="border-b border-rule last:border-b-0"><th scope="row" className="px-5 py-5 text-sm font-medium">{label}</th><td className="border-l border-rule px-5 py-5 text-sm leading-6 text-muted">{arena}</td><td className="border-l border-rule px-5 py-5 text-sm leading-6">{proof}</td></tr>)}</tbody></table></div></div></div></div></section>;
}

const demoPassport: PassportData = { model: "nvidia/Nemotron-3-Nano-30B", status: "SHIP", hardware: "H100 80GB FP8", p95Ms: 1642, toolAccuracy: 0.93, concurrency: 18, fingerprint: "a7f4d0c2e18b96a53f1d7e490bf3e241e18b9f7d2c04a6b8e93f115d7c240abc", label: "ILLUSTRATIVE PREVIEW · NOT CERTIFIED" };

function PassportSection() {
  const [exportError, setExportError] = useState("");
  async function download() { try { setExportError(""); await downloadPassportPng(demoPassport); } catch { setExportError("PNG export is unavailable in this browser."); } }
  function share() { window.open(passportShareUrl(demoPassport), "_blank", "noopener,noreferrer"); void download(); }
  return <section id="passport" className="bg-ink text-white"><div className="sigil-section border-darkRule"><div className="sigil-section-inner"><Rail index="11" dark /><div className="sigil-content px-6 py-16 sm:px-10 lg:px-16 lg:py-24"><SectionLabel dark>THE DEVELOPER TROPHY</SectionLabel><div className="mt-6 grid gap-10 lg:grid-cols-[.75fr_1.25fr] lg:items-center"><div><h2 className="sigil-h2">A model passport<br />with receipts.</h2><p className="sigil-body mt-5 text-inverseMuted">Every completed audit becomes a shareable proof card, a production serving command, and a deterministic certificate. Simulated results stay visibly simulated.</p><div className="mt-8 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row"><button type="button" onClick={share} className="sigil-technical-button border border-white bg-white px-5 font-medium text-ink hover:bg-paper">Share to X / Twitter →</button><button type="button" onClick={() => void download()} className="sigil-technical-button border border-darkRule px-5 font-mono text-xs hover:border-white">DOWNLOAD 1200 × 630 PNG</button></div>{exportError && <p role="alert" className="mt-3 text-sm text-block">{exportError}</p>}<p className="mt-4 font-mono text-[10px] leading-5 text-inverseMuted">Preview data is illustrative. An actual certificate links to its measured experiment and digest. Attach the downloaded PNG to your post.</p></div><ModelPassport data={demoPassport} /></div></div></div></div></section>;
}

export default function LandingPage() {
  return <><TopNav /><main><section className="bg-paper"><div className="sigil-section"><div className="sigil-section-inner"><Rail index="01" /><div className="sigil-content"><div className="flex min-h-12 items-center justify-between gap-4 border-b border-rule bg-white px-6 font-mono text-[10px] tracking-[0.05em] text-muted sm:px-10 lg:px-16"><span>CI/CD FOR INFERENCE / NEBIUS × NVIDIA</span><span className="hidden sm:inline">AI PROPOSES · POLICY APPROVES · METRICS DECIDE</span></div><div className="px-6 pb-16 pt-14 sm:px-10 lg:px-16 lg:pb-24 lg:pt-20"><SectionLabel>CI/CD FOR INFERENCE</SectionLabel><h1 className="sigil-display mt-7 max-w-[900px]">PROPOSE.<br /><span className="text-orange">CRASH.</span> SHIP.</h1><p className="sigil-body mt-7 max-w-[760px] text-muted">Crash-test open-weight models before they hit production. Nebius Sandboxes replay your actual agent workload under concurrent stress, Nemotron diagnoses failures, and we issue a verifiable SHIP or BLOCK certificate with receipts.</p><div className="mt-12 grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(420px,.95fr)] xl:items-start"><QuickTest /><div className="relative min-h-[470px] overflow-hidden border border-rule bg-white p-6 sm:p-8"><div className="absolute inset-0 sigil-grid opacity-55" aria-hidden="true" /><div className="relative flex h-full min-h-[410px] flex-col justify-between"><div className="flex justify-between font-mono text-[10px] text-muted"><span>RUN MAP / 18 CONCURRENT STREAMS</span><span>OPS · 0148</span></div><div className="mx-auto grid w-full max-w-[340px] gap-3"><div className="flex justify-center"><div className="flex w-36 items-center justify-center border border-rule bg-paper py-3 font-mono text-[10px]">WORKLOAD TWIN</div></div><div className="mx-auto h-7 border-l border-orange" /><div className="grid grid-cols-2 gap-3"><div className="border border-orange bg-orangeWash p-4"><span className="sigil-label text-orangeDeep">01 / L40S</span><p className="mt-3 font-mono text-xl text-block">OOM</p><p className="mt-2 text-[11px] text-muted">48 GB · blocked</p></div><div className="border border-rule bg-ink p-4 text-white"><span className="sigil-label text-orange">02 / H100</span><p className="mt-3 font-mono text-xl text-ship">SHIP</p><p className="mt-2 text-[11px] text-inverseMuted">80 GB · FP8</p></div></div><div className="mx-auto h-7 border-l border-orange" /><div className="mx-auto flex w-52 items-center justify-center border border-ink bg-white py-3 font-mono text-[10px]">SHA-256 CERTIFICATE</div></div><div className="flex justify-between border-t border-rule pt-4 font-mono text-[10px] text-muted"><span>ISOLATED EXECUTION</span><span>01 → 02 / ADAPTIVE RETRY</span></div></div></div></div></div></div></div></div></section><CrashDemo /><Matrix /><section className="bg-paper"><div className="sigil-section"><div className="sigil-section-inner"><Rail index="09" /><div className="sigil-content px-6 py-16 sm:px-10 lg:px-16 lg:py-24"><SectionLabel>HOW THE PROOF IS MADE</SectionLabel><div className="mt-6 grid gap-10 lg:grid-cols-[.9fr_1.1fr]"><h2 className="sigil-h2">One workload.<br />Every experiment.</h2><p className="sigil-body max-w-lg text-muted">The workload twin is sealed before the first run. Nemotron can change a proposal after a failure, but deterministic policy never relaxes your SLA gates or budget cap.</p></div><div className="mt-12 grid border border-rule bg-white md:grid-cols-3">{[["01", "Seal the twin", "Choose tool calling, structured JSON, or burst concurrency. Every retry uses the same deterministic workload."],["02", "Crash in isolation", "Start a fresh Nebius microVM. Capture operation IDs, image UUIDs, logs, latency, accuracy, memory, and cost."],["03", "Issue the verdict", "Hard gates decide SHIP or BLOCK. The certificate contains the exact serving command and verifiable fingerprint."]].map(([index, title, text], i) => <div key={index} className={`p-6 sm:p-8 ${i < 2 ? "border-b border-rule md:border-b-0 md:border-r" : ""}`}><span className="font-mono text-xs text-orangeDeep">{index}</span><h3 className="mt-12 text-[26px] font-semibold tracking-[-0.04em]">{title}</h3><p className="mt-4 text-sm leading-6 text-muted">{text}</p></div>)}</div></div></div></div></section><PassportSection /></main><SiteFooter /></>;
}
