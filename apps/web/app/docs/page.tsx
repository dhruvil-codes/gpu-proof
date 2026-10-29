"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { AppShell } from "@/components/ui";

/* ==========================================================================
   Docs — the only guide you need for setting up an AI lab.
   Language: portfolio dot-grid + full-bleed hairline rules + vertical column
   rules (bydhruvil.in). Text-first: ruled rows and dotted dividers, boxes
   only for formulas/code. Two interactive isometric widgets carry the ideas.
   Covers: SandboxProof flow · VRAM · SGLang/vLLM serving · sandboxing ·
   economics · best setups for small systems and production.
   ========================================================================== */

const SECTIONS = [
  { id: "start", label: "What SandboxProof does" },
  { id: "lab", label: "Build your AI lab" },
  { id: "vram", label: "VRAM, simply" },
  { id: "serve", label: "How serving works" },
  { id: "sandbox", label: "Sandboxing" },
  { id: "money", label: "What things cost" },
  { id: "verdict", label: "SHIP vs BLOCK" },
  { id: "modes", label: "Simulator vs Live" },
  { id: "words", label: "Words & FAQ" },
];

const WEIGHTS: Array<[string, string, string, string]> = [
  ["8B", "16 GB", "8 GB", "4 GB"],
  ["32B", "64 GB", "32 GB", "16 GB"],
  ["70B", "140 GB", "70 GB", "35 GB"],
];

const RATES: Array<[string, string, string]> = [
  ["L40S · 48GB", "$1.35/hr", "8B–32B"],
  ["RTX PRO 6000 · 96GB", "$1.80/hr", "70B at INT4"],
  ["H100 SXM5 · 80GB", "$4.50/hr", "production standard"],
  ["H200 · 141GB", "$5.40/hr", "very long context"],
  ["B200 · 180GB", "$8.50/hr", "frontier single GPU"],
  ["8× H100 · 640GB", "$36.00/hr", "multi-GPU cluster"],
];

const GATES: Array<[string, string, string]> = [
  ["Speed (P95)", "under 2,000ms", "95% of replies faster than 2s"],
  ["Accuracy", "at least 85%", "tool calls + answers match schema"],
  ["Reliability", "under 5% errors", "hardly ever crashes or garbles"],
];

const TIERS: Array<[string, string, string]> = [
  ["8GB laptop, no GPU", "3B class (Llama 3.2 3B, Phi-4-mini, Qwen3 1.7–4B)", "Quick chat and helpers; 7B+ will crawl."],
  ["16GB Mac", "8B class (Qwen3 8B, Llama 3.1 8B) · 12B stretch (Gemma 3 12B)", "~11GB is really usable — macOS keeps the rest."],
  ["24GB (Mac or RTX 4090/3090)", "32B Q4 (Qwen3 32B, R1 32B) · 70B is out of reach", "Best consumer CUDA class; 4090 has speed, 3090 has NVLink."],
  ["36–64GB Apple", "32B comfortable · 70B Q4 from ~48–64GB", "Bandwidth, not capacity, sets your tok/s."],
  ["48GB workstation (RTX 6000 Ada)", "32B near-full precision · 70B Q4", "One clean 48GB card: ECC, 300W, dual-slot."],
  ["96GB+ (quad 3090 / big Mac)", "70B comfortable · 100B+ quantised", "Treat as a small server: lanes, cooling, power plan."],
  ["Apple 128–512GB (Studio Ultra)", "70B Q8 / very long context / huge MoE", "1.2 TB/s bandwidth; capacity stops being the limit."],
  ["Nebius cloud", "Anything, by the hour", "Production: batching + KV management, not just GPUs."],
];

const WORDS: Array<[string, string]> = [
  ["VRAM", "The GPU's fast memory. Weights + KV-cache + runtime must all fit inside it."],
  ["KV-cache", "Memory that grows while the model talks — longer chats and more users make it bigger."],
  ["Quantization", "Shrinking weights: BF16 full size → FP8 half → INT4 quarter. Smaller, slightly less precise. AWQ, GPTQ and GGUF are different recipes, not the same file."],
  ["vLLM", "The production serving engine: PagedAttention (no wasted KV memory) + continuous batching (requests join/leave freely)."],
  ["SGLang", "A serving engine built around split prefill/decode pools with KV transfer between them — same direction as vLLM's disaggregated serving."],
  ["Prefill / Decode", "Reading the prompt (compute-heavy, parallel) vs writing the answer one token at a time (memory-bandwidth-heavy). Split them at scale."],
  ["TTFT / ITL", "Time to first token (reply starts) and inter-token latency (streaming speed). The two numbers that define felt speed."],
  ["MoE", "Mixture-of-Experts: huge total size, few active billions per token. Needs expert-parallel traffic planning."],
  ["Multi-LoRA", "One base model + many tiny adapters instead of many full copies — how production serves 'many models' cheaply."],
  ["Speculative decoding", "A small draft model proposes tokens, the big model verifies — fewer slow serial steps."],
  ["Structured output", "The server constrains replies to JSON schema/grammar. Guarantees syntax, not correctness."],
  ["NVLink / InfiniBand", "Fast GPU-to-GPU fabric (NVLink inside a node, InfiniBand between nodes). PCIe at ~31 GB/s is not a substitute."],
  ["Unified memory", "Apple Silicon shares one pool between CPU and GPU — no VRAM copy step, but macOS keeps its share."],
];

const FAQS: Array<[string, string]> = [
  ["Does any of this spend my Nebius tokens?", "No — the backend runs in simulator mode, every audit reads simulated:true and $0. Real billing starts only with an explicit cutover you confirm first."],
  ["I got BLOCK. What now?", "Weights too big → smaller model or INT4. KV-cache too big → shorter context, fewer users, or a bigger GPU. The verdict names the fix."],
  ["What should a small laptop run?", "8GB: 3–4B (Phi-4-mini, Llama 3.2 3B). 16GB Mac: 8B daily (Qwen3 8B, Llama 3.1 8B), 12B stretch. 24GB: 32B Q4."],
  ["What does minting actually run?", "A benchmark loop replays seeded requests on the chosen GPU, measures the three gates, then seals a SHIP/BLOCK certificate with a SHA-256 fingerprint."],
  ["Why is a 70B INT4 sometimes roomier than a 32B BF16?", "Weights are static: 70B×0.5 = 35GB vs 32B×2 = 64GB. Same GPU, more KV headroom left for the bigger model."],
  ["Where do I see spend?", "The Usage page: backend audit ledger plus sandbox session estimates. Simulator rows always read $0.00."],
];

/* ---------- interactive isometric VRAM stack ---------- */
function IsoStack() {
  const [paramsB, setParamsB] = useState(32);
  const [ctx, setCtx] = useState(8192);
  const [users, setUsers] = useState(1);
  const [prec, setPrec] = useState<"BF16" | "FP8" | "INT4">("FP8");
  const [gpuKey, setGpuKey] = useState<"L40S" | "H100" | "H200">("H100");
  const [hover, setHover] = useState<string | null>(null);

  const GPU = { L40S: { vram: 48, label: "L40S · 48GB" }, H100: { vram: 80, label: "H100 · 80GB" }, H200: { vram: 141, label: "H200 · 141GB" } } as const;
  const bytes = prec === "BF16" ? 2 : prec === "FP8" ? 1 : 0.5;
  const L = paramsB >= 65 ? 80 : paramsB >= 30 ? 64 : paramsB >= 14 ? 48 : 32;
  const H = paramsB >= 65 ? 8192 : paramsB >= 14 ? 5120 : 4096;
  const weights = Math.round((paramsB * bytes + (prec === "INT4" ? 0.35 : 0)) * 10) / 10;
  const kv = Math.round(((2 * L * H * ctx * users * bytes) / 1e9) * 10) / 10;
  const total = Math.round((weights + kv + 1.8) * 10) / 10;
  const usable = Math.round(GPU[gpuKey].vram * 0.95 * 10) / 10;
  const oom = total > usable;

  const CX = 160, BASE = 258, W = 78, D = 78;
  const scale = 196 / Math.max(total, usable, 1);
  const hw = 0.866 * W, hd = 0.5 * D;
  const slabs = [
    { id: "weights", gb: weights, h: Math.max(6, weights * scale), top: "#131313", side: "#131313", label: "Weights" },
    { id: "kv", gb: kv, h: Math.max(6, kv * scale), top: oom ? "#B3362A" : "#247B50", side: oom ? "#B3362A" : "#247B50", label: "KV-cache" },
    { id: "rt", gb: 1.8, h: Math.max(6, 1.8 * scale), top: "#FF4D0A", side: "#FF4D0A", label: "Runtime" },
  ];
  let cursor = BASE;
  const drawn = slabs.map((s) => {
    const topY = cursor - s.h;
    cursor = topY;
    return { ...s, topY };
  });
  const boxTop = BASE - usable * scale;
  const faces = (topY: number, h: number) => ({
    top: `${CX},${topY - hd} ${CX + hw},${topY} ${CX},${topY + hd} ${CX - hw},${topY}`,
    right: `${CX + hw},${topY} ${CX},${topY + hd} ${CX},${topY + hd + h} ${CX + hw},${topY + h}`,
    left: `${CX - hw},${topY} ${CX},${topY + hd} ${CX},${topY + hd + h} ${CX - hw},${topY + h}`,
  });

  return (
    <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface data-ui bg-bg">
      <p className="border-b border-rule px-4 py-2.5 text-[13px] text-ink2">
        Try it — drag the sliders, the stack redraws live
      </p>
      <div className="grid gap-2 p-4 sm:grid-cols-[1fr_210px]">
        <svg viewBox="0 0 320 280" role="img" aria-label={`Isometric VRAM stack: ${total}GB of ${usable}GB usable`} className="mx-auto w-full max-w-[320px]">
          <polygon points={`${CX},${boxTop - hd} ${CX + hw},${boxTop} ${CX},${boxTop + hd} ${CX - hw},${boxTop}`} fill="none" stroke={oom ? "#B3362A" : "#131313"} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.7" />
          {[
            `${CX + hw},${boxTop} ${CX + hw},${BASE}`,
            `${CX},${boxTop + hd} ${CX},${BASE + hd}`,
            `${CX - hw},${boxTop} ${CX - hw},${BASE}`,
          ].map((p, i) => (
            <polyline key={i} points={p} fill="none" stroke={oom ? "#B3362A" : "#131313"} strokeWidth="1" strokeDasharray="4 4" opacity="0.45" />
          ))}
          <text x={CX + hw + 4} y={boxTop + 4} fontSize="11.5" fill={oom ? "#B3362A" : "#131313"} style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fontWeight="bold">{usable}GB</text>
          {drawn.map((s) => {
            const f = faces(s.topY, s.h);
            const hot = hover === s.id;
            return (
              <g key={s.id} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)} onClick={() => setHover(s.id)} style={{ cursor: "pointer" }}>
                <polygon points={f.right} fill={s.side} opacity="0.82" stroke={hot ? "#FF4D0A" : "#131313"} strokeWidth={hot ? 2.5 : 1} />
                <polygon points={f.left} fill={s.side} opacity="0.6" stroke={hot ? "#FF4D0A" : "#131313"} strokeWidth={hot ? 2.5 : 1} />
                <polygon points={f.top} fill={s.top === "#131313" ? "#3d3d3b" : s.top} opacity="0.95" stroke={hot ? "#FF4D0A" : "#131313"} strokeWidth={hot ? 2.5 : 1} />
              </g>
            );
          })}
          <text x={CX - hw - 4} y={cursor - 6} fontSize="12" textAnchor="end" fill={oom ? "#B3362A" : "#247B50"} style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fontWeight="bold">
            {oom ? `BLOCK ${total}GB` : `SHIP ${total}GB`}
          </text>
        </svg>
        <div className="min-w-0">
          <ul className="space-y-1.5 text-[12.5px]">
            {drawn.map((s) => (
              <li key={s.id} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)} className={`flex justify-between rounded-lg border px-2 py-1.5 ${hover === s.id ? "border-[#FF4D0A] bg-[#FF4D0A]/5" : "border-line"}`}>
                <span className="font-bold">{s.label}</span>
                <span className="tabular-nums">{s.gb}GB</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-2.5 text-[12.5px]">
            <div>
              <label htmlFor="iso-p" className="flex justify-between font-bold"><span>Params</span><span>{paramsB}B</span></label>
              <input id="iso-p" type="range" min={1} max={70} value={paramsB} onChange={(e) => setParamsB(Number(e.target.value))} className="mt-0.5 w-full cursor-pointer" />
            </div>
            <div>
              <label htmlFor="iso-c" className="flex justify-between font-bold"><span>Context</span><span>{ctx >= 1024 ? `${Math.round(ctx / 1024)}K` : ctx}</span></label>
              <input id="iso-c" type="range" min={1024} max={131072} step={1024} value={ctx} onChange={(e) => setCtx(Number(e.target.value))} className="mt-0.5 w-full cursor-pointer" />
            </div>
            <div>
              <label htmlFor="iso-u" className="flex justify-between font-bold"><span>Users</span><span>{users}</span></label>
              <input id="iso-u" type="range" min={1} max={64} value={users} onChange={(e) => setUsers(Number(e.target.value))} className="mt-0.5 w-full cursor-pointer" />
            </div>
            <div className="flex gap-1">
              {(["BF16", "FP8", "INT4"] as const).map((p) => (
                <button key={p} type="button" onClick={() => setPrec(p)} aria-pressed={prec === p} className={`min-h-[32px] flex-1 cursor-pointer rounded-control border text-[12px] font-medium ${prec === p ? "border-ink bg-ink text-[#F1F1ED]" : "border-line"}`}>{p}</button>
              ))}
            </div>
            <div className="flex gap-1">
              {(Object.keys(GPU) as (keyof typeof GPU)[]).map((g) => (
                <button key={g} type="button" onClick={() => setGpuKey(g)} aria-pressed={gpuKey === g} className={`min-h-[32px] flex-1 cursor-pointer rounded-control border text-[12px] font-medium ${gpuKey === g ? "border-ink bg-ink text-[#F1F1ED]" : "border-line"}`}>{g}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- reference-style isometric kit ----------
   Floating ink-line slabs on a dotted floor, dashed connectors, mono labels.
   Shared by the serving pipeline and the lab-tier climber below. */
const ISOX = 0.8660254;

function isoSlab(cx: number, ty: number, hx: number, hy: number, h: number) {
  return {
    top: `${cx},${ty - hy} ${cx + hx},${ty} ${cx},${ty + hy} ${cx - hx},${ty}`,
    right: `${cx + hx},${ty} ${cx},${ty + hy} ${cx},${ty + hy + h} ${cx + hx},${ty + h}`,
    left: `${cx - hx},${ty} ${cx},${ty + hy} ${cx},${ty + hy + h} ${cx - hx},${ty + h}`,
    bottom: `${cx},${ty + hy + h}`,
  };
}

const SERVE: Array<{ id: string; t: string; d: string; tag?: string }> = [
  { id: "gateway", t: "Gateway", d: "Auth, quotas, rate limits. One front door for every client.", tag: "auth" },
  { id: "router", t: "Router", d: "Sends each request where its prefix is already cached — not round-robin.", tag: "cache affinity" },
  { id: "prefill", t: "Prefill", d: "Reads the whole prompt at once. Compute-heavy, parallel.", tag: "TTFT" },
  { id: "decode", t: "Decode", d: "Writes one token at a time. Memory-bandwidth-heavy — this sets your tok/s.", tag: "ITL · tok/s" },
  { id: "kv", t: "KV tiers", d: "HBM first, host RAM second, NVMe beyond. Hot prefixes stay resident.", tag: "HBM → SSD" },
  { id: "gpu", t: "Engines + GPUs", d: "vLLM / SGLang on NVLink + InfiniBand fabric. Metrics + traces feed the SLOs.", tag: "NVLink · IB" },
];

function IsoServing() {
  const [sel, setSel] = useState("decode");
  // stations sit exactly on the rails; KV is the interchange of two lines
  const ST = {
    gateway: { x: 90, y: 110 }, router: { x: 250, y: 110 }, prefill: { x: 410, y: 110 },
    decode: { x: 530, y: 250 }, kv: { x: 330, y: 250 }, gpu: { x: 150, y: 250 },
  } as const;
  const LABEL: Record<string, { dx: number; dy: number; anchor?: "start" | "middle" | "end"; sub: string }> = {
    gateway: { dx: 0, dy: 32, sub: "auth" },
    router: { dx: 0, dy: -26, sub: "cache affinity" },
    prefill: { dx: 0, dy: -26, sub: "TTFT" },
    decode: { dx: 16, dy: 4, anchor: "start", sub: "ITL · tok/s" },
    kv: { dx: 0, dy: 32, sub: "tiers" },
    gpu: { dx: 0, dy: 32, sub: "NVLink · IB" },
  };
  const detail = SERVE.find((n) => n.id === sel);
  const order = ["gateway", "router", "prefill", "decode", "kv", "gpu"];
  return (
    <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface data-ui bg-bg">
      <p className="flex items-center justify-between border-b border-rule px-4 py-2.5 text-[13px] text-ink2">
        <span>Request line → KV interchange — tap a station</span>
        <span className="hidden gap-3 sm:flex" aria-hidden="true">
          <span>● request</span>
          <span className="text-ship">● KV line</span>
        </span>
      </p>
      <div className="overflow-x-auto"><svg viewBox="0 0 640 330" role="img" aria-label="Serving pipeline as a metro map" className="w-full min-w-[640px]">
        <defs>
          <pattern id="serve-dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1.6" cy="1.6" r="1.3" fill="#131313" opacity="0.22" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="640" height="330" fill="url(#serve-dots)" />
        {/* request line */}
        <path d="M90,110 H410 L490,190 V250 H150" fill="none" stroke="#131313" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        {/* KV line */}
        <path d="M330,158 V274" fill="none" stroke="#247B50" strokeWidth="5" strokeLinecap="round" />
        <circle cx="330" cy="158" r="4" fill="#247B50" />
        <circle cx="330" cy="274" r="4" fill="#247B50" />
        <text x={330} y={148} textAnchor="middle" fontSize="12" style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fill="#247B50">HBM</text>
        <text x={342} y={270} fontSize="12" style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fill="#247B50">SSD</text>
        {/* termini */}
        <rect x="82" y="102" width="9" height="16" rx="2" fill="#131313" />
        <rect x="145" y="242" width="9" height="16" rx="2" fill="#131313" />
        {/* looping trains */}
        <path id="serve-route" d="M90,110 H410 L490,190 V250 H150" fill="none" stroke="none" />
        {[0, -5].map((b, i) => (
          <rect key={i} x="-13" y="-5" width="26" height="10" rx="5" fill="#F1F1ED" stroke="#131313" strokeWidth="1.5" className="flow-dot">
            <animateMotion dur="10s" begin={`${b}s`} repeatCount="indefinite" rotate="auto">
              <mpath href="#serve-route" />
            </animateMotion>
          </rect>
        ))}
        {order.map((id) => {
          const s = ST[id as keyof typeof ST];
          const lb = LABEL[id];
          const hot = sel === id;
          const interchange = id === "kv";
          return (
            <motion.g
              key={id}
              onClick={() => setSel(id)}
              style={{ cursor: "pointer" }}
              whileTap={{ scale: 0.9 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            >
              {interchange ? (
                <>
                  <circle cx={s.x} cy={s.y} r="13" fill="#F1F1ED" stroke="#131313" strokeWidth="4" />
                  <circle cx={s.x} cy={s.y} r="4.5" fill={hot ? "#131313" : "#247B50"} />
                </>
              ) : (
                <>
                  <circle cx={s.x} cy={s.y} r={hot ? 12 : 9} fill={hot ? "#131313" : "#F1F1ED"} stroke="#131313" strokeWidth="3" />
                  {hot && <circle cx={s.x} cy={s.y} r="4" fill="#F1F1ED" />}
                </>
              )}
              <text x={s.x + lb.dx} y={s.y + lb.dy} textAnchor={lb.anchor ?? "middle"} fontSize="12" style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fontWeight="bold" fill="#131313">
                {SERVE.find((n) => n.id === id)?.t}
              </text>
              <text x={s.x + lb.dx} y={s.y + lb.dy + (lb.dy < 0 ? -13 : 13)} textAnchor={lb.anchor ?? "middle"} fontSize="12" style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fill="#6B6B66">
                {lb.sub}
              </text>
            </motion.g>
          );
        })}
      </svg></div>
      <div className="border-t border-line px-4 py-3 text-[13.5px] leading-relaxed" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={sel}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <strong>{detail?.t}:</strong> <span className="text-ink2">{detail?.d}</span>
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------- lab-tier climber: pick a platform, see its envelope ---------- */
const PLATFORMS: Array<{ t: string; e: string; p: string; b: string }> = [
  { t: "8GB laptop", e: "3B class", p: "Llama 3.2 3B · Phi-4-mini · Qwen3 1.7–4B", b: "RAM is the ceiling — 7B+ will crawl." },
  { t: "16GB Mac", e: "8B daily · 12B stretch", p: "Qwen3 8B · Llama 3.1 8B · Gemma 3 12B", b: "macOS keeps ~30% of the pool." },
  { t: "24GB class", e: "32B Q4", p: "Qwen3 32B · R1 32B · Qwen3-30B-A3B", b: "VRAM ceiling — 70B out of reach." },
  { t: "48–96GB workstation", e: "32B precise · 70B Q4", p: "RTX 6000 Ada · dual 3090 · quad for 96GB", b: "Lanes, cooling, power plan." },
  { t: "128GB+ & cloud", e: "70B Q8 · huge MoE · long context", p: "Mac Studio Ultra · Nebius hourly", b: "Bandwidth first, then scheduling." },
];

function IsoLab() {
  const [sel, setSel] = useState(1);
  const d = PLATFORMS[sel];
  // nested containment: each ring holds everything inside it
  const HX = [40, 74, 108, 142, 176];
  const SHORT = ["8GB", "16GB", "24GB", "48–96GB", "128GB+"];
  const LX = [552, 88, 552, 88, 552];
  const LY = [112, 140, 196, 224, 252];
  const CX = 290, CY = 168;
  return (
    <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface data-ui bg-bg">
      <p className="border-b border-rule px-4 py-2.5 text-[13px] text-ink2">
        Each ring holds everything inside it — tap a ring
      </p>
      <div className="overflow-x-auto"><svg viewBox="0 0 640 320" role="img" aria-label="AI lab tiers as nested containment" className="w-full min-w-[640px]">
        <defs>
          <pattern id="lab-dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1.6" cy="1.6" r="1.3" fill="#131313" opacity="0.22" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="640" height="320" fill="url(#lab-dots)" />
        {[...HX].reverse().map((hx, ri) => {
          const i = HX.length - 1 - ri;
          const p = PLATFORMS[i];
          const hy = hx * 0.5;
          const hot = sel === i;
          const leftSide = i % 2 === 0;
          return (
            <motion.g
              key={p.t}
              onClick={() => setSel(i)}
              style={{ cursor: "pointer" }}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            >
              <polygon
                points={`${CX},${CY - hy} ${CX + hx},${CY} ${CX},${CY + hy} ${CX - hx},${CY}`}
                fill={hot ? "#131313" : "#F1F1ED"}
                stroke="#131313"
                strokeWidth={hot ? 2.5 : 1.3}
                strokeDasharray={hot ? "none" : "7 4"}
                className={hot ? "" : "flow-line"}
              />
              <line x1={leftSide ? CX - hx : CX + hx} y1={CY} x2={LX[i]} y2={LY[i]} stroke="#131313" strokeWidth="1" strokeDasharray="3 3" opacity="0.55" />
              <circle cx={LX[i]} cy={LY[i]} r="2.5" fill={hot ? "#131313" : "#F1F1ED"} stroke="#131313" strokeWidth="1.2" />
              <text x={LX[i] + (leftSide ? -10 : 10)} y={LY[i] + 4} textAnchor={leftSide ? "end" : "start"} fontSize="12" style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fontWeight="bold" fill={hot ? "#131313" : "#6B6B66"}>
                {SHORT[i]}
              </text>
            </motion.g>
          );
        })}
        <circle cx={CX} cy={CY} r="5" fill="#131313" />
        <text x={CX} y={308} textAnchor="middle" fontSize="12" style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fill="#6B6B66">inner rings live inside outer rings — tap any ring</text>
      </svg></div>
      <div className="border-t border-line px-4 py-3 text-[13.5px] leading-relaxed" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={sel}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <strong>{d.t}:</strong> <span className="text-ink2">{d.e} — {d.p}</span>
          </motion.p>
        </AnimatePresence>
        <p className="mt-0.5 text-[13px] text-ink2">Bottleneck: {d.b}</p>
      </div>
    </div>
  );
}

/* Looping auto-advance that respects reduced motion + user takeover. */
function useLoop(n: number, ms: number) {
  const [idx, setIdx] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % n), ms);
    return () => clearInterval(t);
  }, [auto, n, ms]);
  const go = (i: number) => {
    setIdx(((i % n) + n) % n);
    setAuto(false);
  };
  const resume = () => setAuto(true);
  return { idx, auto, go, resume };
}

/* ---------- 60-minute sandbox flow: loops forever, tap to inspect ---------- */
const FLOW: Array<{ t: string; d: string }> = [
  { t: "Stage", d: "0–5 min — nvidia-smi, clocks, VRAM sanity. Weights staged before the clock starts." },
  { t: "Sweep 27B", d: "5–18 min — warm-up, concurrency 1 → 32. Find the TTFT/ITL frontier." },
  { t: "Swap", d: "Container lives, only vllm serve restarts — seconds, image version pinned." },
  { t: "Sweep 32B·70B", d: "18–48 min — identical sweeps. 70B INT4 often leaves more KV room than 32B BF16." },
  { t: "Export", d: "48–60 min — winner A/B, persist metrics + traces. Export mints the certificate." },
];

function IsoSandboxFlow() {
  const [min, setMin] = useState(0);
  const [run, setRun] = useState(true);
  const [focus, setFocus] = useState<number | null>(null);
  useEffect(() => {
    if (!run) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setMin((m) => (m >= 60 ? 0 : m + 1)), 200);
    return () => clearInterval(t);
  }, [run]);
  const X0 = 48, X1 = 592, RY = 118;
  const x = (m: number) => X0 + (m / 60) * (X1 - X0);
  const spans = [
    { ...FLOW[0], w0: 0, w1: 5 }, { ...FLOW[1], w0: 5, w1: 18 },
    { ...FLOW[3], w0: 18, w1: 48 }, { ...FLOW[4], w0: 48, w1: 60 },
  ];
  const activeByMin = spans.findIndex((s) => min >= s.w0 && min < s.w1);
  const show = focus ?? (activeByMin === -1 ? 0 : activeByMin);
  const tap = (i: number, atMin: number) => {
    setFocus(i);
    setMin(atMin);
    setRun(false);
  };
  return (
    <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface data-ui bg-bg">
      <p className="flex items-center justify-between border-b border-rule px-4 py-2.5 text-[13px] text-ink2">
        <span>Ruler of one hour — playhead on loop</span>
        <button
          type="button"
          onClick={() => {
            if (run) setRun(false);
            else {
              setFocus(null);
              setRun(true);
            }
          }}
          aria-pressed={run}
          className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-[12px] transition-colors hover:border-ink"
        >
          {run ? "Pause" : "Play"}
        </button>
      </p>
      <div className="overflow-x-auto"><svg viewBox="0 0 640 210" role="img" aria-label="Sandbox hour ruler timeline" className="w-full min-w-[640px]">
        <defs>
          <pattern id="flow-dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1.6" cy="1.6" r="1.3" fill="#131313" opacity="0.22" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="640" height="210" fill="url(#flow-dots)" />
        {/* ruler */}
        <line x1={X0} y1={RY} x2={X1} y2={RY} stroke="#131313" strokeWidth="2" />
        {Array.from({ length: 13 }, (_, i) => i * 5).map((m) => (
          <g key={m}>
            <line x1={x(m)} y1={RY} x2={x(m)} y2={RY + (m % 10 === 0 ? 10 : 6)} stroke="#131313" strokeWidth="1.2" />
            {m % 10 === 0 && (
              <text x={x(m)} y={RY + 24} textAnchor="middle" fontSize="12" style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fill="#6B6B66">
                {m === 0 ? "0" : `${m}′`}
              </text>
            )}
          </g>
        ))}
        {/* span blocks */}
        {spans.map((s, i) => {
          const hot = (focus ?? activeByMin) === i;
          const si = [0, 1, 3, 4][i];
          return (
            <motion.g
              key={s.t}
              onClick={() => tap(si, s.w0)}
              style={{ cursor: "pointer" }}
              whileTap={{ scale: 0.96 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            >
              <rect x={x(s.w0) + 1} y={RY - 44} width={Math.max(20, x(s.w1) - x(s.w0) - 2)} height={26} rx={7} fill={hot ? "#131313" : "#F1F1ED"} stroke="#131313" strokeWidth={hot ? 2 : 1.3} />
              <text x={(x(s.w0) + x(s.w1)) / 2} y={RY - 27} textAnchor="middle" fontSize="11.5" style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fontWeight="bold" fill={hot ? "#F1F1ED" : "#131313"}>
                {s.t}
              </text>
            </motion.g>
          );
        })}
        {/* swap instant marker */}
        <g onClick={() => tap(2, 18)} style={{ cursor: "pointer" }}>
          <polygon points={`${x(18)},${RY - 9} ${x(18) + 7},${RY} ${x(18)},${RY + 9} ${x(18) - 7},${RY}`} fill="#FF4D0A" stroke="#131313" strokeWidth="1.2" />
          <text x={x(18)} y={RY + 40} textAnchor="middle" fontSize="12" style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fontWeight="bold" fill="#131313">swap</text>
        </g>
        {/* playhead */}
        <line x1={x(min)} y1={RY - 52} x2={x(min)} y2={RY} stroke="#B3362A" strokeWidth="2" />
        <polygon points={`${x(min)},${RY - 60} ${x(min) + 6},${RY - 50} ${x(min) - 6},${RY - 50}`} fill="#B3362A" />
        <text x={Math.min(Math.max(x(min), X0 + 18), X1 - 18)} y={RY - 64} textAnchor="middle" fontSize="11.5" style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fontWeight="bold" fill="#B3362A">
          {min}′
        </text>
      </svg></div>
      <div className="border-t border-line px-4 py-3 text-[13.5px] leading-relaxed" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={show}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <strong>{FLOW[show].t}:</strong> <span className="text-ink2">{FLOW[show].d}</span>
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------- verdict gates: slabs light up in a loop, then the seal ---------- */
const GATEINFO = [
  { t: "Speed", v: "P95 ≤ 2000ms", d: "95% of replies faster than 2s. Tails, not averages." },
  { t: "Accuracy", v: "≥ 85%", d: "Tool calls + answers match schema. Semantics measured, not vibes." },
  { t: "Errors", v: "≤ 5%", d: "Crashes, garbles, OOMs — all inside one budget." },
];

function IsoGates() {
  const { idx: phase, auto, go, resume } = useLoop(4, 1300);
  const sealed = phase === 3;
  return (
    <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface data-ui bg-bg">
      <p className="flex items-center justify-between border-b border-rule px-4 py-2.5 text-[13px] text-ink2">
        <span>Three gates, then the seal — on loop</span>
        <button type="button" onClick={() => (auto ? go(phase) : resume())} aria-pressed={auto} className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-[12px] transition-colors hover:border-ink">
          {auto ? "Pause loop" : "Resume"}
        </button>
      </p>
      <div className="overflow-x-auto"><svg viewBox="0 0 640 240" role="img" aria-label="SHIP gates diagram" className="w-full min-w-[640px]">
        <defs>
          <pattern id="gates-dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1.6" cy="1.6" r="1.3" fill="#131313" opacity="0.22" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="640" height="240" fill="url(#gates-dots)" />
        {GATEINFO.map((g, i) => {
          // dial gauges: measured value vs gate threshold, needle sweeps in a loop
          const cx = 140 + i * 180, cy = 178, r = 56;
          const frac = [0.62, 0.55, 0.24][i];
          const lit = phase > i;
          const ang = (f: number) => ((180 - f * 180) * Math.PI) / 180;
          const px = (f: number, rr: number) => cx + rr * Math.cos(ang(f));
          const py = (f: number, rr: number) => cy - rr * Math.sin(ang(f));
          const nx = lit ? px(frac, r - 12) : cx;
          const ny = lit ? py(frac, r - 12) : cy;
          return (
            <motion.g
              key={g.t}
              onClick={() => go(i)}
              style={{ cursor: "pointer" }}
              whileTap={{ scale: 0.96 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            >
              <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} fill="none" stroke="#131313" strokeWidth="3" opacity="0.2" strokeLinecap="round" />
              {lit && (
                <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${px(frac, r)},${py(frac, r)}`} fill="none" stroke="#247B50" strokeWidth="5" strokeLinecap="round" />
              )}
              {[0, 0.5, 1].map((t, k) => (
                <line key={k} x1={px(t, r - 7)} y1={py(t, r - 7)} x2={px(t, r + 1)} y2={py(t, r + 1)} stroke="#131313" strokeWidth="1.4" />
              ))}
              <motion.line
                x1={cx} y1={cy}
                animate={{ x2: nx, y2: ny }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                stroke="#131313" strokeWidth="2.5" strokeLinecap="round"
              />
              <circle cx={cx} cy={cy} r="5" fill="#131313" />
              <text x={cx} y={cy + 24} textAnchor="middle" fontSize="12" style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fontWeight="bold" fill={lit ? "#247B50" : "#131313"}>
                {g.t}
              </text>
              <text x={cx} y={cy + 38} textAnchor="middle" fontSize="11.5" style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fill="#6B6B66">{g.v}</text>
              {lit && (
                <g key={`badge-${phase}`} className="gp-pop">
                  <circle cx={cx + r - 4} cy={cy - r - 6} r="10" fill="#247B50" stroke="#F1F1ED" strokeWidth="2" />
                  <path d={`M${cx + r - 9},${cy - r - 6} l3.5,3.5 l6,-7`} fill="none" stroke="#F1F1ED" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              )}
            </motion.g>
          );
        })}
        {sealed && (
          <g className="gp-pop">
            <rect x={218} y={8} width={204} height={26} rx={13} fill="#247B50" />
            <text x={320} y={25} textAnchor="middle" fontSize="12" style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }} fontWeight="bold" fill="#fff">SHIP — sealed</text>
          </g>
        )}
      </svg></div>
      <div className="border-t border-line px-4 py-3 text-[13.5px] leading-relaxed" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={sealed ? "seal" : phase}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {sealed ? (
              <><strong>Seal:</strong> <span className="text-ink2">all three gates green — sealed with a SHA-256 workload digest.</span></>
            ) : (
              <><strong>{GATEINFO[phase].t} {GATEINFO[phase].v}:</strong> <span className="text-ink2">{GATEINFO[phase].d}</span></>
            )}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-[22px] font-semibold tracking-[-0.02em] md:text-[26px]">
      {children}
    </h2>
  );
}

export default function DocsPage() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    document.title = "Docs — SandboxProof in plain language";
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id);
        });
      },
      { rootMargin: "-25% 0px -65% 0px" }
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    const onScroll = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(total > 0 ? Math.min(1, Math.max(0, window.scrollY / total)) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      obs.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <AppShell>
      <div className="app-pad mx-auto max-w-shell">
        <div className="max-w-2xl">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Will it run? Will it ship?</h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-ink2">
            Everything SandboxProof knows — what it measures, how serving and sandboxing actually work,
            what things cost, and the best setup for a laptop or a production fleet — in plain words,
            with diagrams you can touch.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/#launch" className="btn btn-primary btn-round h-10 px-4 text-sm">Verify hardware fit</Link>
            <Link href="/sandbox-console" className="btn btn-ghost btn-round h-10 px-4 text-sm">Open the sandbox console</Link>
          </div>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-[240px_1fr]">
          <aside aria-label="Guide progress and sections">
            <div className="lg:sticky lg:top-24">
              <nav aria-label="On this page">
                <p className="flex items-center justify-between text-[13px] text-ink2">
                  On this page
                  <span className="tabular-nums text-ship">{Math.round(progress * 100)}%</span>
                </p>
                <ol className="mt-3 space-y-0.5 border-l border-line">
                  {SECTIONS.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        aria-current={active === s.id ? "location" : undefined}
                        className={`-ml-px block cursor-pointer border-l-2 py-1.5 pl-3 text-[13.5px] leading-snug transition-colors ${active === s.id ? "border-ink font-medium text-ink" : "border-transparent text-ink2 hover:text-ink"}`}
                      >
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ol>
                <div className="mt-5 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink2 tabular-nums">
                  <p>Gates: ≤2000 ms · ≥85% · ≤5%</p>
                  <p className="mt-1">Total = W + KV + 1.8 GB</p>
                </div>
                <Link href="/usage" className="btn btn-ghost btn-round mt-4 h-9 w-full px-3 text-[13px]">
                  Usage &amp; spend →
                </Link>
              </nav>
            </div>
          </aside>

          {/* Article */}
          <div className="min-w-0">
            <section aria-label="What SandboxProof does" className="py-10">
              <H2 id="start">What SandboxProof does</H2>
              <p className="mt-4 text-sm leading-relaxed">
                Picking an open model is guesswork: <em>will 32B fit my GPU? Will tool calls survive
                quantization? What does a million queries cost?</em> SandboxProof replaces guessing with
                measurement — size it, try it, prove it.
              </p>
              <div className="mt-4 text-[14px] leading-relaxed">
                <p className="border-t border-line py-2.5"><strong>Size it</strong> <span className="text-ink2">— exact VRAM math before you download anything. → <Link href="/new" className="font-bold underline-offset-4 hover:underline">Verify Hardware Fit</Link></span></p>
                <p className="border-t border-line py-2.5"><strong>Try it</strong> <span className="text-ink2">— an hour on a cloud GPU with live telemetry. → <Link href="/sandbox-console" className="font-bold underline-offset-4 hover:underline">Live Sandbox</Link></span></p>
                <p className="border-t border-line py-2.5 border-b border-b-line"><strong>Prove it</strong> <span className="text-ink2">— a sealed SHIP / BLOCK certificate anyone can re-check.</span></p>
              </div>
              <p className="mt-4 border-t border-line pt-3 text-[13px] text-ink2">Integrations: Token Factory Sandboxes (isolated runs) · Hugging Face (models + live specs) · hosted-endpoint replay telemetry · BYOK keys that never leave your browser.</p>
            </section>

            <section aria-label="Build your AI lab" className="py-10">
              <H2 id="lab">Build your AI lab</H2>
              <p className="mt-4 text-sm leading-relaxed">
                Match the machine to the model class. Small systems want small models at 4-bit; big
                Apple memory wants 70B; production wants scheduling, not just GPUs.
              </p>
              <div className="mt-4 text-[14px] leading-relaxed">
                {TIERS.map((t) => (
                  <details key={t[0]} className="group border-t border-line py-2.5 last:border-b">
                    <summary className="cursor-pointer list-none font-bold [&::-webkit-details-marker]:hidden">
                      <span className="text-ink2">▸</span> {t[0]} <span className="font-normal text-ink2">— {t[1]}</span>
                    </summary>
                    <p className="mt-1.5 pl-5 text-ink2">{t[2]}</p>
                  </details>
                ))}
              </div>
              <IsoLab />
              <p className="mt-4 border-t border-line pt-3 text-[13px] text-ink2">Best small-system rule: 16GB Mac ≈ an 8B machine with 12B upside — macOS keeps ~30% of the pool. Best production rule: never compare hourly prices alone; compare cost per thousand queries at your SLO.</p>
            </section>

            <section aria-label="VRAM simply" className="py-10">
              <H2 id="vram">VRAM, simply</H2>
              <p className="mt-4 text-sm leading-relaxed">
                Three chunks must fit: <strong>weights</strong> (static), <strong>KV-cache</strong> (grows
                with context × users), <strong>runtime</strong> (~1.8GB flat, plus room for your OS).
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="ttable w-full min-w-[420px] !text-[13.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-ink2">
                      <th className="py-1.5 pr-3">Params</th>
                      <th className="py-1.5 pr-3">BF16</th>
                      <th className="py-1.5 pr-3">FP8</th>
                      <th className="py-1.5">INT4</th>
                    </tr>
                  </thead>
                  <tbody>
                    {WEIGHTS.map((w) => (
                      <tr key={w[0]} className="border-b border-dotted border-line last:border-b-0">
                        <td className="py-1.5 pr-3 font-bold">{w[0]}</td>
                        <td className="py-1.5 pr-3 tabular-nums !text-right">{w[1]}</td>
                        <td className="py-1.5 pr-3 tabular-nums !text-right">{w[2]}</td>
                        <td className="py-1.5 tabular-nums">{w[3]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[13px] text-ink2">A 70B INT4 checkpoint (35GB) can leave more KV headroom than a 32B BF16 one (64GB) on the same card.</p>
              <IsoStack />
            </section>

            <section aria-label="How serving works" className="py-10">
              <H2 id="serve">How serving works</H2>
              <p className="mt-4 text-sm leading-relaxed">
                Production inference is a scheduling problem, not a GPU problem. The stack that wins in
                2026: continuous batching, paged KV-cache, split prefill/decode, tiered KV storage,
                speculative decoding, and structured outputs — in vLLM, SGLang and TensorRT-LLM alike.
              </p>
              <IsoServing />
              <div className="mt-4 text-[14px] leading-relaxed">
                <p className="border-t border-line py-2"><strong>vLLM</strong> <span className="text-ink2">— PagedAttention kills KV fragmentation; prefix caching reuses shared prompts.</span></p>
                <p className="border-t border-line py-2"><strong>SGLang</strong> <span className="text-ink2">— prefill and decode run in separate pools with KV transfer between them.</span></p>
                <p className="border-t border-line py-2"><strong>Structured output</strong> <span className="text-ink2">— the server enforces JSON schema. Syntax guaranteed; correctness still must be measured.</span></p>
                <p className="border-y border-line py-2"><strong>Speed math</strong> <span className="text-ink2">— TTFT = first token − request · ITL = token − previous token · decode ≈ bandwidth ÷ active weights.</span></p>
              </div>
            </section>

            <section aria-label="Sandboxing" className="py-10">
              <H2 id="sandbox">Sandboxing</H2>
              <p className="mt-4 text-sm leading-relaxed">
                A sandbox is a one-hour benchmark experiment, not a playground. Weights are staged
                before the clock starts; the container stays alive while only the server process
                restarts to hot-swap models — that is why swaps take seconds, and why Multi-LoRA
                (one base + tiny adapters) beats full weight swaps in production.
              </p>
              <div className="mt-4 text-[14px] leading-relaxed">
                <p className="border-t border-line py-2"><strong>0–5 min</strong> <span className="text-ink2">— nvidia-smi, clocks, VRAM sanity.</span></p>
                <p className="border-t border-line py-2"><strong>5–48 min</strong> <span className="text-ink2">— one model per block, concurrency 1 → 32. Find the Pareto frontier, not one tok/s number.</span></p>
                <p className="border-t border-line py-2"><strong>48–56 min</strong> <span className="text-ink2">— winner config A/B (quant, prefix cache, speculation).</span></p>
                <p className="border-y border-line py-2"><strong>56–60 min</strong> <span className="text-ink2">— persist metrics, traces, logs. Export mints the certificate.</span></p>
              </div>
              <IsoSandboxFlow />
            </section>

            <section aria-label="What things cost" className="py-10">
              <H2 id="money">What things cost</H2>
              <p className="mt-4 text-sm leading-relaxed">
                October 2026 Nebius PAYG rates. The number that matters is cost per 1,000 queries at
                your SLO: <span className="mono text-[14px]">C = 1000 × $/hr ÷ (3600 × queries/sec)</span> —
                a $1.35 L40S can beat a $4.50 H100 for a quiet 8B service.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="ttable w-full min-w-[420px] !text-[13.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-ink2">
                      <th className="py-1.5 pr-3">GPU</th>
                      <th className="py-1.5 pr-3">Rate</th>
                      <th className="py-1.5">Good for</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RATES.map((r) => (
                      <tr key={r[0]} className="border-b border-dotted border-line last:border-b-0">
                        <td className="py-1.5 pr-3 font-bold">{r[0]}</td>
                        <td className="py-1.5 pr-3 tabular-nums !text-right">{r[1]}</td>
                        <td className="py-1.5 text-ink2">{r[2]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 border-t border-line pt-3 text-[13px] text-ink2">Safety caps are backend-enforced: $10 per audit, $20 project total. See <Link href="/usage" className="font-bold underline-offset-4 hover:underline">Usage</Link> for your ledger.</p>
            </section>

            <section aria-label="SHIP vs BLOCK" className="py-10">
              <H2 id="verdict">SHIP vs BLOCK</H2>
              <p className="mt-4 text-sm leading-relaxed">A model ships only if it passes all three gates under replayed real traffic:</p>
              <div className="mt-4 overflow-x-auto">
                <table className="ttable w-full min-w-[420px] !text-[13.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-ink2">
                      <th className="py-1.5 pr-3">Gate</th>
                      <th className="py-1.5 pr-3">Must be</th>
                      <th className="py-1.5">Plain meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GATES.map((g) => (
                      <tr key={g[0]} className="border-b border-dotted border-line last:border-b-0">
                        <td className="py-1.5 pr-3 font-bold">{g[0]}</td>
                        <td className="py-1.5 pr-3">{g[1]}</td>
                        <td className="py-1.5 text-ink2">{g[2]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[14px]">
                <span className="pill pill-ship">SHIP</span>{" "}
                <span className="text-ink2">safe to deploy.</span>{" "}
                <span className="pill pill-block">BLOCK</span>{" "}
                <span className="text-ink2">the verdict names the fix.</span>
              </p>
              <IsoGates />
            </section>

            <section aria-label="Simulator vs Live" className="py-10">
              <H2 id="modes">Simulator vs Live</H2>
              <div className="mt-4 text-[14px] leading-relaxed">
                <p className="border-t border-line py-2.5"><strong>Simulator (current)</strong> <span className="text-ink2">— deterministic, instant, $0.00 always. Verdicts read SIMULATED, dev-grade only.</span></p>
                <p className="border-t border-line py-2.5 border-b border-b-line"><strong>Live (later cutover)</strong> <span className="text-ink2">— real Nebius GPUs billed to a key, $10/audit + $20 total caps. One explicit switch, never automatic.</span></p>
              </div>
            </section>

            <section aria-label="Words and FAQ" className="py-10">
              <H2 id="words">Words &amp; FAQ</H2>
              <dl className="mt-4">
                {WORDS.map((w) => (
                  <div key={w[0]} className="grid gap-1 border-t border-line py-2.5 last:border-b sm:grid-cols-[150px_1fr]">
                    <dt className="text-[13.5px] font-semibold">{w[0]}</dt>
                    <dd className="text-sm leading-relaxed text-ink2">{w[1]}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-6">
                {FAQS.map((f) => (
                  <details key={f[0]} className="border-t border-line py-3 last:border-b">
                    <summary className="cursor-pointer text-[14.5px] font-medium">{f[0]}</summary>
                    <p className="mt-2 text-sm leading-relaxed text-ink2">{f[1]}</p>
                  </details>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
