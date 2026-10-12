"""Model Migration Advisor — deterministic VRAM / KV-cache sizing & Hardware Fit Engine.

Deep module behind POST /advisor and GET /models/inspect.
Evaluates local open-source setups (RTX 4090, 3090, Dual 3090, Apple Silicon Mac Studio)
vs production cloud GPUs (Nebius L40S, H100, H200, A100).
Supports ANY model via clean Hugging Face URL parsing, live Hub metadata inspection,
and deterministic fallback mathematical heuristics.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
import urllib.error

# Bytes per parameter by precision (weights only).
BYTES_PER_PARAM = {"FP32": 4.0, "FP16": 2.0, "BF16": 2.0, "FP8": 1.0, "INT8": 1.0, "INT4": 0.5}

# GPU catalog: Local developer setups and Cloud production instances.
# Prices mirror services/cost_engine.py (L40S/H100); local GPUs have usd_hr=0.0.
GPU_CATALOG: dict[str, dict] = {
    # Consumer & Homelab Local Hardware (The Open-Source Community Standard)
    "RTX4090": {
        "vram_gb": 24, "usd_hr": 0.90, "label": "NVIDIA RTX 4090 24GB",
        "category": "local_gpu", "bandwidth_gbs": 1008, "type": "Consumer Flagship"
    },
    "RTX3090": {
        "vram_gb": 24, "usd_hr": 0.60, "label": "NVIDIA RTX 3090 24GB",
        "category": "local_gpu", "bandwidth_gbs": 936, "type": "Homelab Workhorse"
    },
    "DUAL_RTX3090": {
        "vram_gb": 48, "usd_hr": 1.20, "label": "Dual RTX 3090 / 4090 48GB",
        "category": "local_gpu", "bandwidth_gbs": 936, "type": "Homelab Multi-GPU"
    },
    "MAC_STUDIO_128GB": {
        "vram_gb": 128, "usd_hr": 0.00, "label": "Apple Mac Studio 128GB Unified Memory",
        "category": "local_mac", "bandwidth_gbs": 800, "type": "Local Heavy-Weight (Metal/MLX)"
    },
    "MAC_STUDIO_192GB": {
        "vram_gb": 192, "usd_hr": 0.00, "label": "Apple Mac Studio 192GB Unified Memory",
        "category": "local_mac", "bandwidth_gbs": 800, "type": "Local Flagship (Metal/MLX)"
    },
    "MACBOOK_MAX_64GB": {
        "vram_gb": 64, "usd_hr": 0.00, "label": "Apple MacBook Pro Max 64GB Unified Memory",
        "category": "local_mac", "bandwidth_gbs": 400, "type": "Mobile Workstation"
    },
    "RTX4080": {
        "vram_gb": 16, "usd_hr": 0.70, "label": "NVIDIA RTX 4080 / 4070Ti Super 16GB",
        "category": "local_gpu", "bandwidth_gbs": 717, "type": "Mid-tier Consumer"
    },
    "RTX6000_ADA": {
        "vram_gb": 48, "usd_hr": 1.80, "label": "NVIDIA RTX 6000 Ada 48GB",
        "category": "workstation_gpu", "bandwidth_gbs": 960, "type": "Pro Workstation"
    },
    # Cloud Production Tier (Nebius AI Cloud)
    "L40S": {
        "vram_gb": 48, "usd_hr": 1.35, "label": "Nebius NVIDIA L40S 48GB",
        "category": "cloud_gpu", "bandwidth_gbs": 864, "type": "Production Cloud Workhorse"
    },
    "A100": {
        "vram_gb": 80, "usd_hr": 2.10, "label": "NVIDIA A100 80GB SXM4",
        "category": "cloud_gpu", "bandwidth_gbs": 2039, "type": "Enterprise Cloud Classic"
    },
    "H100": {
        "vram_gb": 80, "usd_hr": 3.20, "label": "Nebius NVIDIA H100 80GB SXM5",
        "category": "cloud_gpu", "bandwidth_gbs": 3350, "type": "Enterprise Flagship"
    },
    "H200": {
        "vram_gb": 141, "usd_hr": 3.95, "label": "Nebius NVIDIA H200 141GB SXM5",
        "category": "cloud_gpu", "bandwidth_gbs": 4800, "type": "Ultra-Capacity Cloud"
    },
}

# Known curated baseline models (used as quick presets & exact parameter counts)
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

# In-memory cache for live Hugging Face lookups
_HF_CACHE: dict[str, dict] = {}

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
    "3090": "RTX3090", "rtx3090": "RTX3090", "rtx 3090": "RTX3090",
    "dual 3090": "DUAL_RTX3090", "dual rtx 3090": "DUAL_RTX3090", "dual 4090": "DUAL_RTX3090",
    "mac studio": "MAC_STUDIO_128GB", "mac studio 128": "MAC_STUDIO_128GB", "mac studio 192": "MAC_STUDIO_192GB",
    "macbook": "MACBOOK_MAX_64GB", "macbook pro": "MACBOOK_MAX_64GB",
    "4080": "RTX4080", "rtx 4080": "RTX4080", "6000 ada": "RTX6000_ADA",
}


def extract_hf_repo_id(input_str: str) -> str:
    """Extract clean Hugging Face repo ID ('org/model-name') from ANY URL or input.

    Handles:
    - https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct
    - https://hf.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B/tree/main
    - huggingface.co/Qwen/Qwen2.5-72B-Instruct?tab=files
    - https://huggingface.co/models/google/gemma-2-27b-it
    - meta-llama/Llama-3.3-70B-Instruct (already clean)
    """
    s = (input_str or "").strip()
    if not s:
        return ""
    # Strip protocol and domain
    s = re.sub(r"^(?:https?://)?(?:www\.)?(?:huggingface\.co|hf\.co)/", "", s)
    # Strip query parameters or hashes
    s = re.sub(r"[?#].*$", "", s)
    # Split path parts
    parts = [p for p in s.strip("/").split("/") if p]
    if len(parts) >= 2:
        if parts[0] == "models" and len(parts) >= 3:
            return f"{parts[1]}/{parts[2]}"
        return f"{parts[0]}/{parts[1]}"
    if len(parts) == 1:
        return parts[0]
    return s


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9. ]+", " ", (text or "").lower()).strip()


def detect_model(query: str) -> str:
    """Return a catalog key or clean HF slug for any query."""
    clean_id = extract_hf_repo_id(query)
    if "/" in clean_id:
        return clean_id

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
    if "INT4" in q or "AWQ" in q or "GPTQ" in q or "4-BIT" in q or "4BIT" in q or "Q4" in q:
        return "INT4"
    if "FP8" in q:
        return "FP8"
    if "INT8" in q or "8-BIT" in q or "Q8" in q:
        return "INT8"
    if "FP16" in q or "FP 16" in q:
        return "FP16"
    return "BF16"


def weights_gb(params_b: float, precision: str) -> float:
    return round(params_b * BYTES_PER_PARAM.get(precision, 2.0), 2)


def kv_cache_gb(layers: int, hidden: int, seq_len: int, batch: int, precision: str) -> float:
    """PagedAttention KV cache: 2 (K+V) * layers * hidden * seq * batch * bytes / 1e9."""
    b = BYTES_PER_PARAM.get(precision, 2.0)
    return round(2 * layers * hidden * seq_len * batch / 1e9 * b, 2)


def fetch_hf_metadata(repo_id: str) -> dict | None:
    """Fetch live metadata from Hugging Face Hub public API. Zero auth required for public models."""
    if not repo_id or "/" not in repo_id:
        return None
    if repo_id in _HF_CACHE:
        return _HF_CACHE[repo_id]

    headers = {"User-Agent": "GPUProof-Hardware-Fit/1.0"}
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    data: dict = {"slug": repo_id, "display": repo_id.split("/")[-1]}

    # 1. Probe config.json
    try:
        req = urllib.request.Request(f"https://huggingface.co/{repo_id}/raw/main/config.json", headers=headers)
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            cfg = json.loads(resp.read().decode("utf-8"))
            data["layers"] = cfg.get("num_hidden_layers") or cfg.get("n_layer")
            data["hidden"] = cfg.get("hidden_size") or cfg.get("d_model")
            data["max_position_embeddings"] = cfg.get("max_position_embeddings") or cfg.get("max_seq_len")
            data["architectures"] = cfg.get("architectures", [])
            data["torch_dtype"] = cfg.get("torch_dtype")
    except Exception:
        pass

    # 2. Probe API model endpoint for downloads, safetensors, tags
    try:
        req2 = urllib.request.Request(f"https://huggingface.co/api/models/{repo_id}", headers=headers)
        with urllib.request.urlopen(req2, timeout=3.0) as resp2:
            info = json.loads(resp2.read().decode("utf-8"))
            data["downloads"] = info.get("downloads", 0)
            data["likes"] = info.get("likes", 0)
            data["tags"] = info.get("tags", [])
            data["pipeline_tag"] = info.get("pipeline_tag", "text-generation")
            # If safetensors param count is available
            safetensors = info.get("safetensors", {})
            if isinstance(safetensors, dict) and safetensors.get("total"):
                data["params_b"] = round(safetensors["total"] / 1e9, 2)
    except Exception:
        pass

    if "params_b" in data or "layers" in data:
        _HF_CACHE[repo_id] = data
        return data
    return None


def get_model_info(key: str) -> dict:
    """Return model architecture metadata. Resolves catalog, live HF Hub, or heuristic."""
    # 1. Exact catalog match
    if key in MODEL_CATALOG:
        return {"key": key, **MODEL_CATALOG[key]}

    # 2. Extract clean repo ID if it's a slug or URL
    slug = extract_hf_repo_id(key)
    if "/" in slug:
        # Check known catalog by slug
        for k, v in MODEL_CATALOG.items():
            if v["slug"].lower() == slug.lower():
                return {"key": k, **v}

        # Try live Hugging Face Hub probe
        hf = fetch_hf_metadata(slug)
        if hf and hf.get("params_b"):
            params = float(hf["params_b"])
            layers = int(hf.get("layers") or (80 if params >= 65 else 48 if params >= 14 else 32))
            hidden = int(hf.get("hidden") or (8192 if params >= 65 else 5120 if params >= 14 else 4096))
            return {
                "key": slug,
                "params_b": params,
                "layers": layers,
                "hidden": hidden,
                "slug": slug,
                "display": hf.get("display") or slug.split("/")[-1],
                "context_window": hf.get("max_position_embeddings") or 8192,
                "downloads": hf.get("downloads", 0),
                "is_live_hf": True,
            }

    # 3. Dynamic parameter heuristic from string (e.g. '70b', '32b', '8b', '123b')
    m = re.search(r"(\d+(?:\.\d+)?)\s*b\b", key.lower())
    params = float(m.group(1)) if m else 30.0
    layers = 80 if params >= 65 else 64 if params >= 30 else 48 if params >= 14 else 32
    hidden = 8192 if params >= 65 else 5120 if params >= 14 else 4096
    display_name = slug.split("/")[-1] if "/" in slug else f"Custom {params:g}B model"

    return {
        "key": key,
        "params_b": params,
        "layers": layers,
        "hidden": hidden,
        "slug": slug if "/" in slug else key,
        "display": display_name,
        "context_window": 8192,
        "is_live_hf": False,
    }


def cheapest_gpu_for(total_gb: float, cloud_only: bool = True) -> str | None:
    """Find the most cost-effective GPU tier capable of holding total_gb."""
    items = [(k, v) for k, v in GPU_CATALOG.items() if v["vram_gb"] >= total_gb]
    if cloud_only:
        items = [x for x in items if x[1]["category"] == "cloud_gpu"]
    if not items:
        # Fall back to any fitting GPU
        items = [(k, v) for k, v in GPU_CATALOG.items() if v["vram_gb"] >= total_gb]
    if not items:
        return None
    items.sort(key=lambda kv: kv[1]["usd_hr"])
    return items[0][0]


def inspect_model_fit(model_query: str, seq_len: int = 4096) -> dict:
    """Full hardware compatibility evaluation for ANY Hugging Face model or URL.

    Answers the crucial questions for both local users and enterprise deployments:
    1. Can it run locally on consumer hardware (RTX 4090, 3090, Dual 3090, Mac Studio)?
    2. At what quantization level (FP16, FP8, INT4 / Q4_K_M)?
    3. What is the production cloud deployment recommendation on Nebius Cloud?
    """
    clean_id = extract_hf_repo_id(model_query) or model_query
    info = get_model_info(clean_id)
    params_b = float(info["params_b"])
    layers = int(info["layers"])
    hidden = int(info["hidden"])

    # Weight memory calculations
    w_fp16 = weights_gb(params_b, "FP16")
    w_fp8 = weights_gb(params_b, "FP8")
    w_int4 = weights_gb(params_b, "INT4")

    # KV Cache calculations (PagedAttention)
    kv_4k_b1 = kv_cache_gb(layers, hidden, 4096, 1, "FP16")
    kv_8k_b1 = kv_cache_gb(layers, hidden, 8192, 1, "FP16")
    kv_32k_b1 = kv_cache_gb(layers, hidden, 32768, 1, "FP16")
    kv_4k_b16 = kv_cache_gb(layers, hidden, 4096, 16, "FP16")

    # Total single-request memory needed at INT4 (standard local Ollama/llama.cpp)
    overhead = 2.0
    total_local_int4 = round(w_int4 + kv_4k_b1 + overhead, 1)
    total_prod_fp8 = round(w_fp8 + kv_4k_b16 + overhead, 1)
    total_prod_fp16 = round(w_fp16 + kv_4k_b16 + overhead, 1)

    # Assess hardware fit for key hardware profiles
    hardware_matrix = []
    for gkey, ginfo in GPU_CATALOG.items():
        vram = ginfo["vram_gb"]
        if total_prod_fp16 <= vram * 0.95:
            fit = "NATIVE_FP16"
            label = "Runs Full Precision (FP16/BF16)"
        elif total_prod_fp8 <= vram * 0.95:
            fit = "QUANTIZED_FP8"
            label = "Fits High-Speed FP8"
        elif total_local_int4 <= vram * 0.95:
            fit = "QUANTIZED_INT4"
            label = "Fits Quantized (INT4 / AWQ / Q4_K_M)"
        elif total_local_int4 <= vram * 1.5:
            fit = "OOM_OFFLOAD"
            label = "Requires CPU/RAM Offloading (Slow ~2-5 tok/s)"
        else:
            fit = "IMPOSSIBLE"
            label = "Out of Memory (OOM)"

        hardware_matrix.append({
            "gpu_key": gkey,
            "label": ginfo["label"],
            "vram_gb": vram,
            "category": ginfo["category"],
            "type": ginfo["type"],
            "usd_hr": ginfo["usd_hr"],
            "fit_status": fit,
            "fit_label": label,
        })

    # Local verdict
    rtx4090_fit = next((h for h in hardware_matrix if h["gpu_key"] == "RTX4090"), None)
    mac128_fit = next((h for h in hardware_matrix if h["gpu_key"] == "MAC_STUDIO_128GB"), None)
    dual3090_fit = next((h for h in hardware_matrix if h["gpu_key"] == "DUAL_RTX3090"), None)

    if rtx4090_fit and rtx4090_fit["fit_status"] in ("NATIVE_FP16", "QUANTIZED_FP8"):
        local_verdict = f"Fully supported on single RTX 4090 / 3090 (needs ~{total_local_int4}GB - {round(w_fp16 + kv_4k_b1 + overhead, 1)}GB VRAM)."
        local_status = "LOCAL_EXCELLENT"
    elif rtx4090_fit and rtx4090_fit["fit_status"] == "QUANTIZED_INT4":
        local_verdict = f"Fits on single RTX 4090 24GB using 4-bit quantization (AWQ/GPTQ/GGUF Q4_K_M, ~{total_local_int4}GB VRAM)."
        local_status = "LOCAL_QUANTIZED"
    elif dual3090_fit and dual3090_fit["fit_status"] in ("NATIVE_FP16", "QUANTIZED_FP8", "QUANTIZED_INT4"):
        local_verdict = f"Requires Dual RTX 3090/4090 (48GB) or Apple Mac Studio 128GB. A single 24GB card will OOM."
        local_status = "LOCAL_MULTI_GPU_OR_MAC"
    elif mac128_fit and mac128_fit["fit_status"] in ("NATIVE_FP16", "QUANTIZED_FP8", "QUANTIZED_INT4"):
        local_verdict = f"Too large for consumer NVIDIA cards. Runs locally on Apple Mac Studio 128GB+ unified memory."
        local_status = "LOCAL_MAC_STUDIO_ONLY"
    else:
        local_verdict = f"Exceeds local consumer memory limits ({params_b:g}B params). Cloud GPU cluster mandatory."
        local_status = "CLOUD_ONLY"

    # Cloud recommendation
    cloud_rec_key = cheapest_gpu_for(total_prod_fp8, cloud_only=True) or "H100"
    cloud_rec = GPU_CATALOG[cloud_rec_key]

    return {
        "model_slug": info["slug"],
        "display_name": info["display"],
        "params_b": params_b,
        "layers": layers,
        "hidden": hidden,
        "weights_fp16_gb": w_fp16,
        "weights_fp8_gb": w_fp8,
        "weights_int4_gb": w_int4,
        "kv_4k_gb": kv_4k_b1,
        "kv_8k_gb": kv_8k_b1,
        "kv_32k_gb": kv_32k_b1,
        "total_local_int4_gb": total_local_int4,
        "total_prod_fp8_gb": total_prod_fp8,
        "hardware_matrix": hardware_matrix,
        "local_status": local_status,
        "local_verdict": local_verdict,
        "recommended_cloud_gpu": cloud_rec_key,
        "recommended_cloud_label": cloud_rec["label"],
        "recommended_cloud_price": cloud_rec["usd_hr"],
        "is_live_hf": info.get("is_live_hf", False),
    }


def advise(query: str, current_gpu: str | None = None, seq_len: int = 4096) -> dict:
    """Deterministic sizing answer. Never raises on bad input; zero cost."""
    query = (query or "").strip() or "Can I run this model on my GPU?"
    clean_slug = extract_hf_repo_id(query)
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
    overhead = 2.0
    total1 = round(w + kv1 + overhead, 2)
    total16 = round(w + kv16 + overhead, 2)

    cheapest_single = cheapest_gpu_for(total1, cloud_only=True)
    cheapest_conc = cheapest_gpu_for(total16, cloud_only=True)

    if gpu:
        cap = GPU_CATALOG[gpu]["vram_gb"]
        fits_single = total1 <= cap * 0.95
        fits_conc = total16 <= cap * 0.95
    else:
        fits_single, fits_conc = False, False

    # Structured-output / tool-call risk heuristic
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

    # Local open-source hardware note
    if params_b <= 15:
        local_note = "💻 **Local Hardware:** Fits cleanly on a single RTX 4090 / 3090 24GB at FP16/BF16."
    elif params_b <= 35:
        local_note = "💻 **Local Hardware:** Fits on a single RTX 4090 24GB at 4-bit (AWQ/Q4_K_M), or MacBook Max 64GB."
    elif params_b <= 75:
        local_note = "💻 **Local Hardware:** Needs Dual RTX 3090/4090 (48GB) or Apple Mac Studio 128GB. A single 24GB GPU will OOM."
    else:
        local_note = "💻 **Local Hardware:** Ultra-heavy weights require Apple Mac Studio 192GB or multi-node cloud clusters."

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
        f"{local_note}\n"
        f"**Recommended Cloud GPU:** {rec_label} "
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
