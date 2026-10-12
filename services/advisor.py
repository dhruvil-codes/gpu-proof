"""Model Migration Advisor — deterministic VRAM / KV-cache sizing.

Deep module behind POST /advisor. Pure functions, no network, no cost.
An optional Nemotron-Ultra enrichment layer (in main.py) may rephrase the
deterministic numbers, but the math below is always the ground truth so the
drawer works offline, in simulator mode, and without API keys.
"""
from __future__ import annotations

import re

# Bytes per parameter by precision (weights only).
BYTES_PER_PARAM = {"FP32": 4.0, "FP16": 2.0, "BF16": 2.0, "FP8": 1.0, "INT8": 1.0, "INT4": 0.5}

# GPU catalog: VRAM GiB + Nebius list price used for "cheapest tier" ranking.
# Prices mirror services/cost_engine.py (L40S/H100); others are documented estimates.
GPU_CATALOG: dict[str, dict] = {
    "RTX4090": {"vram_gb": 24, "usd_hr": 0.90, "label": "RTX 4090 24GB"},
    "L40S": {"vram_gb": 48, "usd_hr": 1.35, "label": "NVIDIA L40S 48GB"},
    "A100": {"vram_gb": 80, "usd_hr": 2.10, "label": "NVIDIA A100 80GB"},
    "H100": {"vram_gb": 80, "usd_hr": 3.20, "label": "NVIDIA H100 80GB SXM5"},
    "H200": {"vram_gb": 141, "usd_hr": 3.95, "label": "NVIDIA H200 141GB"},
}

# Known-model catalog: params (B), transformer layers, hidden size, HF slug.
# Layers/hidden are public architecture facts used only for KV-cache sizing.
MODEL_CATALOG: dict[str, dict] = {
    "gemma-2-27b": {"params_b": 27.2, "layers": 46, "hidden": 4608,
                    "slug": "google/gemma-2-27b-it", "display": "Gemma 2 27B"},
    "qwen2.5-14b": {"params_b": 14.7, "layers": 48, "hidden": 5120,
                    "slug": "Qwen/Qwen2.5-14B-Instruct", "display": "Qwen 2.5 14B"},
    "qwen2.5-72b": {"params_b": 72.7, "layers": 80, "hidden": 8192,
                    "slug": "Qwen/Qwen2.5-72B-Instruct", "display": "Qwen 2.5 72B"},
    "nemotron-nano-30b": {"params_b": 30.0, "layers": 48, "hidden": 5120,
                          "slug": "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
                          "display": "Nemotron Nano 30B"},
    "deepseek-r1-32b": {"params_b": 32.8, "layers": 64, "hidden": 5120,
                        "slug": "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
                        "display": "DeepSeek R1 Distill 32B"},
    "deepseek-v3": {"params_b": 671.0, "layers": 61, "hidden": 7168, "moe": True,
                    "slug": "deepseek-ai/DeepSeek-V3", "display": "DeepSeek-V3 671B MoE"},
    "llama-3.3-70b": {"params_b": 70.6, "layers": 80, "hidden": 8192,
                      "slug": "meta-llama/Llama-3.3-70B-Instruct", "display": "Llama 3.3 70B"},
    "llama-3.1-70b": {"params_b": 70.6, "layers": 80, "hidden": 8192,
                      "slug": "meta-llama/Llama-3.1-70B-Instruct", "display": "Llama 3.1 70B"},
    "llama-3.1-8b": {"params_b": 8.0, "layers": 32, "hidden": 4096,
                     "slug": "meta-llama/Meta-Llama-3.1-8B-Instruct", "display": "Llama 3.1 8B"},
    "mistral-large": {"params_b": 123.0, "layers": 88, "hidden": 12288,
                      "slug": "mistralai/Mistral-Large-Instruct-2407", "display": "Mistral Large 123B"},
    "mistral-7b": {"params_b": 7.3, "layers": 32, "hidden": 4096,
                   "slug": "mistralai/Mistral-7B-Instruct-v0.3", "display": "Mistral 7B"},
    "qwen3-8b": {"params_b": 8.2, "layers": 36, "hidden": 4096,
                 "slug": "Qwen/Qwen3-8B", "display": "Qwen3 8B"},
}

# Alias -> catalog key (lowercase, punctuation-insensitive matching).
_ALIASES: dict[str, str] = {
    "gemma 2 27b": "gemma-2-27b", "gemma2 27b": "gemma-2-27b", "gemma-2-27b": "gemma-2-27b",
    "gemma 27b": "gemma-2-27b",
    "qwen 2.5 14b": "qwen2.5-14b", "qwen2.5 14b": "qwen2.5-14b", "qwen 14b": "qwen2.5-14b",
    "qwen 2.5 72b": "qwen2.5-72b", "qwen2.5 72b": "qwen2.5-72b", "qwen 72b": "qwen2.5-72b",
    "nemotron nano 30b": "nemotron-nano-30b", "nemotron 30b": "nemotron-nano-30b",
    "nano 30b": "nemotron-nano-30b", "nemotron-3-nano-30b": "nemotron-nano-30b",
    "deepseek r1 32b": "deepseek-r1-32b", "deepseek r1": "deepseek-r1-32b", "r1 32b": "deepseek-r1-32b",
    "deepseek v3": "deepseek-v3", "deepseek-v3": "deepseek-v3", "deepseek 671b": "deepseek-v3",
    "llama 3.3 70b": "llama-3.3-70b", "llama 3.3": "llama-3.3-70b", "llama3.3 70b": "llama-3.3-70b",
    "llama 70b": "llama-3.3-70b", "llama 3.1 70b": "llama-3.1-70b",
    "llama 8b": "llama-3.1-8b", "llama 3.1 8b": "llama-3.1-8b", "llama3.1 8b": "llama-3.1-8b",
    "mistral large": "mistral-large", "mistral 123b": "mistral-large",
    "mistral 7b": "mistral-7b", "qwen3 8b": "qwen3-8b", "qwen 8b": "qwen3-8b",
}

_GPU_ALIASES: dict[str, str] = {
    "l40s": "L40S", "h100": "H100", "a100": "A100", "h200": "H200",
    "4090": "RTX4090", "rtx4090": "RTX4090", "rtx 4090": "RTX4090",
}


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9. ]+", " ", (text or "").lower()).strip()


def detect_model(query: str) -> str:
    """Return a catalog key for the first known model mentioned, else generic 30B."""
    q = _norm(query)
    for alias, key in _ALIASES.items():
        if alias in q:
            return key
    # "NNb" parameter hint, e.g. "32b model" -> synthesize a generic entry.
    m = re.search(r"(\d+(?:\.\d+)?)\s*b\b", q)
    if m:
        return f"generic-{m.group(1)}b"
    return "nemotron-nano-30b"


def detect_gpu(text: str | None) -> str | None:
    if not text:
        return None
    t = _norm(text)
    for alias, key in _GPU_ALIASES.items():
        if alias in t:
            return key
    return None


def detect_precision(query: str) -> str:
    q = (query or "").upper()
    if "INT4" in q or "AWQ" in q or "GPTQ" in q or "4-BIT" in q or "4BIT" in q:
        return "INT4"
    if "FP8" in q:
        return "FP8"
    if "FP16" in q or "FP 16" in q:
        return "FP16"
    return "BF16"


def weights_gb(params_b: float, precision: str) -> float:
    return round(params_b * BYTES_PER_PARAM.get(precision, 2.0), 2)


def kv_cache_gb(layers: int, hidden: int, seq_len: int, batch: int, precision: str) -> float:
    """PagedAttention KV cache: 2 (K+V) * layers * hidden * seq * batch * bytes / 1e9."""
    b = BYTES_PER_PARAM.get(precision, 2.0)
    return round(2 * layers * hidden * seq_len * batch / 1e9 * b, 2)


def get_model_info(key: str) -> dict:
    if key in MODEL_CATALOG:
        return {"key": key, **MODEL_CATALOG[key]}
    m = re.match(r"generic-(\d+(?:\.\d+)?)b", key or "")
    params = float(m.group(1)) if m else 30.0
    # Scale architecture roughly with size for a sane KV estimate.
    layers = 48 if params >= 14 else 32
    hidden = 5120 if params >= 14 else 4096
    return {"key": key, "params_b": params, "layers": layers, "hidden": hidden,
            "slug": key, "display": f"Custom {params:g}B model"}


def cheapest_gpu_for(total_gb: float) -> str | None:
    fits = [(k, v) for k, v in GPU_CATALOG.items() if v["vram_gb"] >= total_gb]
    if not fits:
        return None
    fits.sort(key=lambda kv: kv[1]["usd_hr"])
    return fits[0][0]


def advise(query: str, current_gpu: str | None = None, seq_len: int = 4096) -> dict:
    """Deterministic sizing answer. Never raises on bad input; never calls network."""
    query = (query or "").strip() or "Can I run this model on my GPU?"
    key = detect_model(query)
    info = get_model_info(key)
    precision = detect_precision(query)
    gpu = detect_gpu(query) or detect_gpu(current_gpu)

    params_b = float(info["params_b"])
    layers = int(info["layers"])
    hidden = int(info["hidden"])
    w = weights_gb(params_b, precision)
    kv1 = kv_cache_gb(layers, hidden, seq_len, 1, precision)
    kv16 = kv_cache_gb(layers, hidden, seq_len, 16, precision)
    overhead = 2.0  # CUDA context + vLLM PagedAttention block tables.
    total1 = round(w + kv1 + overhead, 2)
    total16 = round(w + kv16 + overhead, 2)

    cheapest_single = cheapest_gpu_for(total1)
    cheapest_conc = cheapest_gpu_for(total16)

    if gpu:
        cap = GPU_CATALOG[gpu]["vram_gb"]
        fits_single = total1 <= cap * 0.95
        fits_conc = total16 <= cap * 0.95
    else:
        fits_single, fits_conc = False, False

    # Structured-output / tool-call risk heuristic (quantization + MoE + size).
    if info.get("moe"):
        tool_note = ("MoE routing (671B total / ~37B active) is healthy for tool calls at BF16/FP8, "
                     "but needs 2×H100/H200 tensor-parallel — single-GPU serving will OOM.")
    elif precision == "INT4":
        tool_note = ("INT4 saves ~4× weights VRAM but is the #1 breaker of strict JSON schemas and "
                     "tool-call argument fidelity — certify schema accuracy ≥85% before migrating.")
    elif params_b <= 15:
        tool_note = ("Mid-size dense models in this class usually keep JSON/tool-call accuracy high at "
                     "BF16/FP8; verify with a structured-output replay before migrating.")
    else:
        tool_note = ("Large dense models keep tool-call accuracy at BF16/FP8; INT4/FP8 compression is "
                     "where schema regressions appear — certify before migrating.")

    if gpu:
        g = GPU_CATALOG[gpu]
        verdict = (f"On a single {g['label']}: single-request needs ~{total1}GB "
                   f"({'FITS' if fits_single else 'OOM RISK'} vs {g['vram_gb']}GB) · "
                   f"16-way concurrency needs ~{total16}GB "
                   f"({'FITS' if fits_conc else 'OOM — escalate tier'}).")
    else:
        verdict = (f"Single-request needs ~{total1}GB; 16-way concurrency needs ~{total16}GB "
                   f"(weights FP8/BF16 + KV cache @ seq {seq_len} + 2GB runtime).")

    rec = cheapest_conc or cheapest_single or "H200"
    rec_label = GPU_CATALOG[rec]["label"]

    answer = (
        f"**{info['display']}** · {params_b:g}B params @ {precision} · seq {seq_len}\n\n"
        f"**1. Parameter memory (weights):** {params_b:g}B × {BYTES_PER_PARAM.get(precision, 2.0):g} bytes "
        f"= **~{w}GB**.\n"
        f"**2. KV cache growth (PagedAttention):** `2 × {layers} layers × {hidden} hidden × {seq_len} tokens "
        f"× batch × {BYTES_PER_PARAM.get(precision, 2.0):g}B / 1e9` → **~{kv1}GB @ batch 1**, "
        f"**~{kv16}GB @ batch 16** (concurrency is what OOMs, not weights).\n"
        f"**3. Runtime overhead:** ~{overhead}GB (CUDA context + block tables) → "
        f"**total ~{total1}GB (batch 1) / ~{total16}GB (batch 16)**.\n\n"
        f"**Verdict:** {verdict}\n"
        f"**Recommended GPU tier:** {rec_label} "
        f"(${GPU_CATALOG[rec]['usd_hr']:.2f}/hr — cheapest tier fitting batch-16).\n"
        f"**Structured JSON / tool calls:** {tool_note}"
    )

    return {
        "answer": answer,
        "candidate_model": info["slug"],
        "display_model": info["display"],
        "precision": precision,
        "weights_gb": w,
        "kv_gb_batch1": kv1,
        "kv_gb_batch16": kv16,
        "total_gb_batch1": total1,
        "total_gb_batch16": total16,
        "asked_gpu": gpu,
        "recommended_gpu": rec,
        "fits_single": fits_single if gpu else None,
        "fits_concurrent": fits_conc if gpu else None,
        "source": "deterministic",
        "cta": f"/new?candidate_model={info['slug']}",
    }
