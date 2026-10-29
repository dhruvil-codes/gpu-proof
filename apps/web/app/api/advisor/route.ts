import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BYTES: Record<string, number> = { FP32: 4, FP16: 2, BF16: 2, FP8: 1, INT8: 1, INT4: 0.5 };

const GPUS: Record<string, { vram_gb: number; usd_hr: number; label: string }> = {
  RTX4090: { vram_gb: 24, usd_hr: 0.9, label: "RTX 4090 24GB" },
  L40S: { vram_gb: 48, usd_hr: 1.35, label: "NVIDIA L40S 48GB" },
  A100: { vram_gb: 80, usd_hr: 2.1, label: "NVIDIA A100 80GB" },
  H100: { vram_gb: 80, usd_hr: 4.5, label: "NVIDIA H100 80GB SXM5" },
  H200: { vram_gb: 141, usd_hr: 5.4, label: "NVIDIA H200 141GB" },
};

type ModelInfo = { params_b: number; layers: number; hidden: number; slug: string; display: string; moe?: boolean };

const MODELS: Record<string, ModelInfo> = {
  "gemma-2-27b": { params_b: 27.2, layers: 46, hidden: 4608, slug: "google/gemma-2-27b-it", display: "Gemma 2 27B" },
  "qwen2.5-14b": { params_b: 14.7, layers: 48, hidden: 5120, slug: "Qwen/Qwen2.5-14B-Instruct", display: "Qwen 2.5 14B" },
  "nemotron-nano-30b": { params_b: 30, layers: 48, hidden: 5120, slug: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", display: "Nemotron Nano 30B" },
  "deepseek-v3": { params_b: 671, layers: 61, hidden: 7168, slug: "deepseek-ai/DeepSeek-V3", display: "DeepSeek-V3 671B MoE", moe: true },
  "llama-3.1-70b": { params_b: 70.6, layers: 80, hidden: 8192, slug: "meta-llama/Llama-3.1-70B-Instruct", display: "Llama 3.1 70B" },
  "mistral-7b": { params_b: 7.3, layers: 32, hidden: 4096, slug: "mistralai/Mistral-7B-Instruct-v0.3", display: "Mistral 7B" },
  "qwen3-8b": { params_b: 8.2, layers: 36, hidden: 4096, slug: "Qwen/Qwen3-8B", display: "Qwen3 8B" },
};

const ALIASES: Record<string, string> = {
  "gemma 2 27b": "gemma-2-27b", "gemma2 27b": "gemma-2-27b", "gemma 27b": "gemma-2-27b",
  "qwen 2.5 14b": "qwen2.5-14b", "qwen 14b": "qwen2.5-14b",
  "nemotron nano 30b": "nemotron-nano-30b", "nemotron 30b": "nemotron-nano-30b", "nano 30b": "nemotron-nano-30b",
  "deepseek v3": "deepseek-v3", "deepseek 671b": "deepseek-v3",
  "llama 70b": "llama-3.1-70b", "llama 3.1 70b": "llama-3.1-70b",
  "mistral 7b": "mistral-7b", "qwen3 8b": "qwen3-8b", "qwen 8b": "qwen3-8b",
};

const GPU_ALIASES: Record<string, string> = {
  l40s: "L40S", h100: "H100", a100: "A100", h200: "H200", "4090": "RTX4090", rtx4090: "RTX4090",
};

function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9. ]+/g, " ").trim();
}

function detectModel(query: string): string {
  const q = norm(query);
  for (const [alias, key] of Object.entries(ALIASES)) {
    if (q.includes(alias)) return key;
  }
  const m = q.match(/(\d+(?:\.\d+)?)\s*b\b/);
  if (m) return `generic-${m[1]}b`;
  return "nemotron-nano-30b";
}

function detectGpu(text?: string | null): string | null {
  if (!text) return null;
  const t = norm(text);
  for (const [alias, key] of Object.entries(GPU_ALIASES)) {
    if (t.includes(alias)) return key;
  }
  return null;
}

function detectPrecision(query: string): string {
  const q = (query || "").toUpperCase();
  if (q.includes("INT4") || q.includes("AWQ") || q.includes("GPTQ") || q.includes("4-BIT") || q.includes("4BIT")) return "INT4";
  if (q.includes("FP8")) return "FP8";
  if (q.includes("FP16")) return "FP16";
  return "BF16";
}

function localAdvise(query: string, currentGpu?: string | null) {
  const key = detectModel(query);
  const base: ModelInfo = MODELS[key] ?? (() => {
    const m = key.match(/generic-(\d+(?:\.\d+)?)b/);
    const params = m ? parseFloat(m[1]) : 30;
    return { params_b: params, layers: params >= 14 ? 48 : 32, hidden: params >= 14 ? 5120 : 4096, slug: key, display: `Custom ${params}B model` };
  })();
  const precision = detectPrecision(query);
  const gpu = detectGpu(query) ?? detectGpu(currentGpu ?? null);
  const b = BYTES[precision] ?? 2;
  const seq = 4096;
  const w = Math.round(base.params_b * b * 100) / 100;
  const kv = (batch: number) => Math.round((2 * base.layers * base.hidden * seq * batch * b) / 1e9 * 100) / 100;
  const kv1 = kv(1);
  const kv16 = kv(16);
  const total1 = Math.round((w + kv1 + 2) * 100) / 100;
  const total16 = Math.round((w + kv16 + 2) * 100) / 100;

  const fits = (total: number) => Object.entries(GPUS).filter(([, v]) => v.vram_gb >= total).sort((a, b2) => a[1].usd_hr - b2[1].usd_hr)[0]?.[0] ?? "H200";
  const rec = fits(total16) ?? fits(total1);

  let verdict: string;
  if (gpu && GPUS[gpu]) {
    const cap = GPUS[gpu].vram_gb;
    const s = total1 <= cap * 0.95 ? "FITS" : "OOM RISK";
    const c = total16 <= cap * 0.95 ? "FITS" : "OOM — escalate tier";
    verdict = `On a single ${GPUS[gpu].label}: single-request needs ~${total1}GB (${s} vs ${cap}GB) · 16-way concurrency needs ~${total16}GB (${c}).`;
  } else {
    verdict = `Single-request needs ~${total1}GB; 16-way concurrency needs ~${total16}GB (weights FP8/BF16 + KV cache @ seq ${seq} + 2GB runtime).`;
  }

  const toolNote = base.moe
    ? "MoE routing (671B total / ~37B active) is healthy for tool calls at BF16/FP8, but needs 2×H100/H200 tensor-parallel — single-GPU serving will OOM."
    : precision === "INT4"
      ? "INT4 saves ~4× weights VRAM but is the #1 breaker of strict JSON schemas and tool-call argument fidelity — certify schema accuracy ≥85% before migrating."
      : base.params_b <= 15
        ? "Mid-size dense models in this class usually keep JSON/tool-call accuracy high at BF16/FP8; verify with a structured-output replay before migrating."
        : "Large dense models keep tool-call accuracy at BF16/FP8; INT4/FP8 compression is where schema regressions appear — certify before migrating.";

  const answer =
    `**${base.display}** · ${base.params_b}B params @ ${precision} · seq ${seq}\n\n` +
    `**1. Parameter memory (weights):** ${base.params_b}B × ${b} bytes = **~${w}GB**.\n` +
    `**2. KV cache growth (PagedAttention):** \`2 × ${base.layers} layers × ${base.hidden} hidden × ${seq} tokens × batch × ${b}B / 1e9\` → **~${kv1}GB @ batch 1**, **~${kv16}GB @ batch 16** (concurrency is what OOMs, not weights).\n` +
    `**3. Runtime overhead:** ~2GB (CUDA context + block tables) → **total ~${total1}GB (batch 1) / ~${total16}GB (batch 16)**.\n\n` +
    `**Verdict:** ${verdict}\n` +
    `**Recommended GPU tier:** ${GPUS[rec].label} ($${GPUS[rec].usd_hr.toFixed(2)}/hr — cheapest tier fitting batch-16).\n` +
    `**Structured JSON / tool calls:** ${toolNote}`;

  return {
    answer,
    candidate_model: base.slug,
    display_model: base.display,
    precision,
    weights_gb: w,
    kv_gb_batch1: kv1,
    kv_gb_batch16: kv16,
    total_gb_batch1: total1,
    total_gb_batch16: total16,
    asked_gpu: gpu,
    recommended_gpu: rec,
    source: "deterministic" as const,
    cta: `/new?candidate_model=${base.slug}`,
  };
}

export async function POST(req: Request) {
  let body: { query?: string; current_gpu?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const query = (body.query || "").trim() || "Can I run this model on my GPU?";
  const currentGpu = body.current_gpu ?? null;

  // Prefer the FastAPI advisor (Nemotron-Ultra enrichment) when reachable;
  // fall back to local deterministic math so the drawer works offline.
  const base = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const byokKey = req.headers.get("X-Nebius-Api-Key");
    const upstream = await fetch(`${base}/advisor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(byokKey ? { "X-Nebius-Api-Key": byokKey } : {}),
      },
      body: JSON.stringify({ query, current_gpu: currentGpu }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (upstream.ok) {
      const j = await upstream.json();
      if (j?.answer && j?.candidate_model) return NextResponse.json(j);
    }
  } catch {
    /* offline / API down — fall through to local math */
  }
  return NextResponse.json(localAdvise(query, currentGpu));
}
