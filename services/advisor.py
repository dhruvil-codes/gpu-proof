"""Model Migration Advisor — deterministic VRAM / KV-cache sizing & Hardware Fit Engine.

Deep module behind POST /advisor and GET /models/inspect.
Evaluates local open-source setups (Mac Mini, RTX 4090, Dual 3090, Apple Mac Studio)
vs production cloud GPUs (Nebius L40S, H100 SXM5, H200, A100).
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
# Covers the full spectrum: 16GB Mac Mini -> 192GB Mac Studio -> multi-GPU
# homelab clusters -> Nebius production cloud (L40S/A100/H100/H200 + NVLink clusters).
GPU_CATALOG: dict[str, dict] = {
    # Apple Silicon Unified Memory (Metal/MLX)
    "MAC_MINI_16GB": {
        "vram_gb": 16, "usd_hr": 0.00, "label": "Apple Mac Mini 16GB Unified Memory",
        "category": "local_mac", "bandwidth_gbs": 100, "type": "Budget Desktop (Ollama/MLX)"
    },
    "MAC_MINI_24GB": {
        "vram_gb": 24, "usd_hr": 0.00, "label": "Apple Mac Mini 24GB Unified Memory",
        "category": "local_mac", "bandwidth_gbs": 120, "type": "Budget Desktop (Ollama/MLX)"
    },
    "MACBOOK_36GB": {
        "vram_gb": 36, "usd_hr": 0.00, "label": "Apple MacBook Pro 36GB Unified Memory",
        "category": "local_mac", "bandwidth_gbs": 150, "type": "Mobile Workstation (Metal/MLX)"
    },
    "MACBOOK_48GB": {
        "vram_gb": 48, "usd_hr": 0.00, "label": "Apple MacBook Pro 48GB Unified Memory",
        "category": "local_mac", "bandwidth_gbs": 150, "type": "Mobile Workstation (Metal/MLX)"
    },
    "MACBOOK_MAX_64GB": {
        "vram_gb": 64, "usd_hr": 0.00, "label": "Apple MacBook Pro Max 64GB Unified Memory",
        "category": "local_mac", "bandwidth_gbs": 400, "type": "Mobile Workstation"
    },
    "MACBOOK_MAX_128GB": {
        "vram_gb": 128, "usd_hr": 0.00, "label": "Apple MacBook Pro Max 128GB Unified Memory",
        "category": "local_mac", "bandwidth_gbs": 400, "type": "Mobile Flagship (Metal/MLX)"
    },
    "MAC_STUDIO_64GB": {
        "vram_gb": 64, "usd_hr": 0.00, "label": "Apple Mac Studio 64GB Unified Memory",
        "category": "local_mac", "bandwidth_gbs": 400, "type": "Local Workstation (Metal/MLX)"
    },
    "MAC_STUDIO_128GB": {
        "vram_gb": 128, "usd_hr": 0.00, "label": "Apple Mac Studio 128GB Unified Memory",
        "category": "local_mac", "bandwidth_gbs": 800, "type": "Local Heavy-Weight (Metal/MLX)"
    },
    "MAC_STUDIO_192GB": {
        "vram_gb": 192, "usd_hr": 0.00, "label": "Apple Mac Studio 192GB Unified Memory",
        "category": "local_mac", "bandwidth_gbs": 800, "type": "Local Flagship (Metal/MLX)"
    },
    # PC Workstations (System RAM Offload via CPU/GGUF)
    "PC_16GB": {
        "vram_gb": 16, "usd_hr": 0.00, "label": "PC Workstation 16GB System RAM",
        "category": "local_gpu", "bandwidth_gbs": 80, "type": "Local CPU/RAM Offload (16GB)"
    },
    "PC_24GB": {
        "vram_gb": 24, "usd_hr": 0.00, "label": "PC Workstation 24GB System RAM",
        "category": "local_gpu", "bandwidth_gbs": 120, "type": "Local CPU/RAM Offload (24GB)"
    },
    "PC_32GB": {
        "vram_gb": 32, "usd_hr": 0.00, "label": "PC Workstation 32GB System RAM",
        "category": "local_gpu", "bandwidth_gbs": 120, "type": "Local CPU/RAM Offload (32GB)"
    },
    "PC_64GB": {
        "vram_gb": 64, "usd_hr": 0.00, "label": "PC Workstation 64GB System RAM",
        "category": "local_gpu", "bandwidth_gbs": 150, "type": "Local CPU/RAM Offload (64GB)"
    },
    "PC_128GB": {
        "vram_gb": 128, "usd_hr": 0.00, "label": "PC Workstation 128GB System RAM",
        "category": "local_gpu", "bandwidth_gbs": 200, "type": "Local CPU/RAM Offload (128GB)"
    },
    # Consumer & Homelab GPUs
    "RTX3060": {
        "vram_gb": 12, "usd_hr": 0.35, "label": "NVIDIA RTX 3060 12GB",
        "category": "local_gpu", "bandwidth_gbs": 360, "type": "Budget Consumer"
    },
    "RTX4070": {
        "vram_gb": 12, "usd_hr": 0.55, "label": "NVIDIA RTX 4070 / 4070 Super 12GB",
        "category": "local_gpu", "bandwidth_gbs": 504, "type": "Mid-tier Consumer"
    },
    "RTX4080": {
        "vram_gb": 16, "usd_hr": 0.70, "label": "NVIDIA RTX 4080 16GB",
        "category": "local_gpu", "bandwidth_gbs": 717, "type": "Mid-tier Consumer"
    },
    "RTX3090": {
        "vram_gb": 24, "usd_hr": 0.60, "label": "NVIDIA RTX 3090 24GB",
        "category": "local_gpu", "bandwidth_gbs": 936, "type": "Homelab Workhorse"
    },
    "RTX4090": {
        "vram_gb": 24, "usd_hr": 0.90, "label": "NVIDIA RTX 4090 24GB",
        "category": "local_gpu", "bandwidth_gbs": 1008, "type": "Consumer Flagship"
    },
    "RTX6000_ADA": {
        "vram_gb": 48, "usd_hr": 1.80, "label": "NVIDIA RTX 6000 Ada 48GB",
        "category": "workstation_gpu", "bandwidth_gbs": 960, "type": "Pro Workstation"
    },
    # Multi-GPU Local & Homelab Clusters
    "DUAL_RTX3090": {
        "vram_gb": 48, "usd_hr": 1.20, "label": "Dual RTX 3090 / 4090 48GB",
        "category": "local_gpu", "bandwidth_gbs": 936, "type": "Homelab Multi-GPU"
    },
    "QUAD_RTX3090": {
        "vram_gb": 96, "usd_hr": 2.40, "label": "Quad RTX 3090 / 4090 96GB (4x 24GB)",
        "category": "local_gpu", "bandwidth_gbs": 936, "type": "Homelab Multi-GPU"
    },
    "OCTA_RTX4090": {
        "vram_gb": 192, "usd_hr": 7.20, "label": "8x RTX 4090 192GB Cluster",
        "category": "local_gpu", "bandwidth_gbs": 1008, "type": "Homelab Cluster (PCIe)"
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
    "CLUSTER_8X_H100": {
        "vram_gb": 640, "usd_hr": 25.60, "label": "8x Nebius NVIDIA H100 SXM5 640GB Cluster",
        "category": "cloud_gpu", "bandwidth_gbs": 3350, "type": "Production Cluster (NVLink)"
    },
    "CLUSTER_8X_H200": {
        "vram_gb": 1128, "usd_hr": 31.60, "label": "8x Nebius NVIDIA H200 SXM5 1,128GB Cluster",
        "category": "cloud_gpu", "bandwidth_gbs": 4800, "type": "Ultra-Capacity Cluster (NVLink)"
    },
}

# ---------------------------------------------------------------------------
# Breakscale workload stress calibration — real-world stress testing presets.
# Philosophy: "Load a system until it breaks, and watch why."
# ---------------------------------------------------------------------------

# Allowed stepper/slider stops for concurrency (parallel streams) and
# context window (tokens). UI sliders snap to these indices.
CONCURRENCY_STEPS: list[int] = [1, 4, 8, 16, 24, 32]

# Core Breakscale context stops. 2048 is included so the Smoke Test preset
# (8 streams · 2K context) lands exactly on a stop; the five required stops
# from the spec (1024 / 4096 / 8192 / 16384 / 32768) are all present.
CONTEXT_STEPS: list[int] = [1024, 2048, 4096, 8192, 16384, 32768]

# One-click testing presets: streams × context × budget cap (+ replay count).
STRESS_PRESETS: dict[str, dict] = {
    "smoke": {
        "id": "smoke",
        "label": "Smoke Test",
        "description": "Quick cold-start and sanity test.",
        "concurrency": 8,
        "context_len": 2048,
        "budget_usd": 0.50,
        "requests": 50,
    },
    "production": {
        "id": "production",
        "label": "Production SLA Gate",
        "description": "Recommended standard.",
        "concurrency": 16,
        "context_len": 4096,
        "budget_usd": 2.50,
        "requests": 200,
    },
    "soak": {
        "id": "soak",
        "label": "Breakscale Soak Test",
        "description": "Stress to failure limit.",
        "concurrency": 32,
        "context_len": 8192,
        "budget_usd": 8.00,
        "requests": 500,
    },
}

# Runtime overhead (CUDA context + PagedAttention block tables) in GB.
RUNTIME_OVERHEAD_GB: float = 2.0

# Only ~95% of advertised VRAM is safely allocatable before CUDA OOM
# (fragmentation + allocator reserve). Totals above vram * this fraction OOM.
USABLE_VRAM_FRACTION: float = 0.95

# GPUs surfaced in the stress saturation panel (L40S entry → H100 flagship).
STRESS_TARGET_GPUS: list[str] = ["L40S", "H100", "A100", "H200"]

# Real-world production & lab model catalog
MODEL_CATALOG: dict[str, dict] = {
    # The Big Five
    "qwen3.8-27b": {
        "params_b": 27.8, "layers": 64, "hidden": 5120, "license": "Apache 2.0",
        "slug": "Qwen/Qwen3.8-27B", "display": "Qwen3.8 27B",
        "note": "Newest dense Qwen; 256K context; runs on single 24GB GPU, beats larger models on coding."
    },
    "deepseek-v4-pro": {
        "params_b": 685.0, "layers": 64, "hidden": 7168, "moe": True, "license": "MIT",
        "slug": "deepseek-ai/DeepSeek-V4-Pro", "display": "DeepSeek V4 Pro (Frontier MoE)",
        "note": "Reasoning king among open weights (80.6% SWE-bench Verified, 1M context); MIT license."
    },
    "deepseek-v4-flash": {
        "params_b": 38.0, "layers": 64, "hidden": 5120, "license": "MIT",
        "slug": "deepseek-ai/DeepSeek-V4-Flash", "display": "DeepSeek V4 Flash",
        "note": "High-speed reasoning model with native tool-calling; MIT license."
    },
    "llama-4-scout": {
        "params_b": 70.6, "layers": 80, "hidden": 8192, "license": "Meta Community",
        "slug": "meta-llama/Llama-4-Scout", "display": "Llama 4 Scout",
        "note": "10M-token context window on single high-end GPU; most deployed open-weight family."
    },
    "llama-4-maverick": {
        "params_b": 400.0, "layers": 120, "hidden": 12288, "moe": True, "license": "Meta Community",
        "slug": "meta-llama/Llama-4-Maverick", "display": "Llama 4 Maverick (400B MoE)",
        "note": "Flagship open weights for high-throughput enterprise reasoning."
    },
    "gemma-4-31b": {
        "params_b": 31.4, "layers": 48, "hidden": 5120, "license": "Apache 2.0",
        "slug": "google/gemma-4-31b-it", "display": "Gemma 4 31B",
        "note": "Best all-round pick for single-GPU, edge, and on-device work; Apache 2.0."
    },
    "gemma-4-12b": {
        "params_b": 12.2, "layers": 36, "hidden": 4096, "license": "Apache 2.0",
        "slug": "google/gemma-4-12b-it", "display": "Gemma 4 12B Multimodal",
        "note": "Multimodal input on-device efficiency; Apache 2.0."
    },
    "codestral-2501": {
        "params_b": 22.2, "layers": 40, "hidden": 4096, "license": "Apache 2.0",
        "slug": "mistralai/Codestral-2501", "display": "Codestral 2501",
        "note": "Owns IDE autocomplete and coding completions across European & US enterprises."
    },
    "mistral-medium-3.5": {
        "params_b": 54.0, "layers": 64, "hidden": 6144, "license": "Apache 2.0",
        "slug": "mistralai/Mistral-Medium-3.5", "display": "Mistral Medium 3.5",
        "note": "Strong EU business adoption with Apache 2.0 commercial terms."
    },
    # Chinese Frontier Contenders
    "kimi-k2.6": {
        "params_b": 36.0, "layers": 48, "hidden": 5120, "license": "Apache 2.0",
        "slug": "moonshotai/Kimi-K2.6-Instruct", "display": "Kimi K2.6 Agentic",
        "note": "Built for agentic workflows, tops SWE-bench Pro among open models."
    },
    "glm-5-32b": {
        "params_b": 32.0, "layers": 64, "hidden": 5120, "license": "MIT",
        "slug": "THUDM/glm-5-32b", "display": "GLM-5 32B",
        "note": "MIT license, strong coding and ultra long-context, widespread adoption in Asia."
    },
    # Small GPU / Mac Mini Champions
    "gpt-oss-20b": {
        "params_b": 20.4, "layers": 40, "hidden": 4096, "license": "Apache 2.0",
        "slug": "openai/gpt-oss-20b", "display": "gpt-oss 20b",
        "note": "OpenAI open weights; genuinely fast and capable on 16GB Mac Mini or single small GPU."
    },
    "gpt-oss-120b": {
        "params_b": 120.0, "layers": 88, "hidden": 8192, "license": "Apache 2.0",
        "slug": "openai/gpt-oss-120b", "display": "gpt-oss 120b Reasoning",
        "note": "High-context reasoning sibling; runnable on single high-VRAM node."
    },
    "qwen3-coder-30b": {
        "params_b": 30.7, "layers": 48, "hidden": 5120, "license": "Apache 2.0",
        "slug": "Qwen/Qwen3-Coder-30B-A3B", "display": "Qwen3 Coder 30B A3B",
        "note": "The #1 self-hosted coding agent model on one 24GB consumer GPU (RTX 4090 / 3090)."
    },
    "phi-4-14b": {
        "params_b": 14.7, "layers": 40, "hidden": 5120, "license": "MIT",
        "slug": "microsoft/phi-4", "display": "Phi-4 14B",
        "note": "MIT license, built for compact offline/edge deployment."
    },
    "falcon-3-10b": {
        "params_b": 10.0, "layers": 32, "hidden": 4096, "license": "Apache 2.0",
        "slug": "tiiuae/Falcon3-10B-Instruct", "display": "Falcon 3 10B",
        "note": "Compact edge-friendly open weights."
    },
    # Legacy & established production presets
    "nemotron-nano-30b": {
        "params_b": 30.0, "layers": 48, "hidden": 5120, "license": "NVIDIA Open Model",
        "slug": "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "display": "Nemotron Nano 30B",
        "note": "High-throughput, low-latency MoE-assisted production serving."
    },
    "deepseek-r1-32b": {
        "params_b": 32.8, "layers": 64, "hidden": 5120, "license": "MIT",
        "slug": "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B", "display": "DeepSeek R1 Distill 32B",
        "note": "Open reasoning & math powerhouse; MIT license."
    },
    "llama-3.3-70b": {
        "params_b": 70.6, "layers": 80, "hidden": 8192, "license": "Meta Community",
        "slug": "meta-llama/Llama-3.3-70B-Instruct", "display": "Llama 3.3 70B",
        "note": "Enterprise flagship production workhorse."
    },
    "llama-3.1-8b": {
        "params_b": 8.0, "layers": 32, "hidden": 4096, "license": "Meta Community",
        "slug": "meta-llama/Meta-Llama-3.1-8B-Instruct", "display": "Llama 3.1 8B",
        "note": "Low-latency high-throughput baseline."
    },
    "gemma-2-27b": {
        "params_b": 27.2, "layers": 46, "hidden": 4608, "license": "Apache 2.0",
        "slug": "google/gemma-2-27b-it", "display": "Gemma 2 27B",
        "note": "Compact high-performance reasoning."
    },
    "qwen2.5-14b": {
        "params_b": 14.7, "layers": 48, "hidden": 5120, "license": "Apache 2.0",
        "slug": "Qwen/Qwen2.5-14B-Instruct", "display": "Qwen 2.5 14B",
        "note": "Proven coding and tool-calling model."
    },
    "qwen2.5-72b": {
        "params_b": 72.7, "layers": 80, "hidden": 8192, "license": "Apache 2.0",
        "slug": "Qwen/Qwen2.5-72B-Instruct", "display": "Qwen 2.5 72B",
        "note": "High-context multilingual workhorse."
    },
}

# In-memory cache for live Hugging Face lookups
_HF_CACHE: dict[str, dict] = {}

# Alias -> catalog key (lowercase, punctuation-insensitive matching).
_ALIASES: dict[str, str] = {
    # Gemma 2
    "gemma 2 27b": "gemma-2-27b", "gemma2 27b": "gemma-2-27b", "gemma 2": "gemma-2-27b",
    # Qwen 2.5
    "qwen 2.5 14b": "qwen2.5-14b", "qwen2.5 14b": "qwen2.5-14b", "qwen 14b": "qwen2.5-14b",
    "qwen 2.5 72b": "qwen2.5-72b", "qwen2.5 72b": "qwen2.5-72b", "qwen 72b": "qwen2.5-72b",
    # Qwen 3.x family
    "qwen 3.8 27b": "qwen3.8-27b", "qwen3.8 27b": "qwen3.8-27b", "qwen3.8": "qwen3.8-27b",
    "qwen 3.8": "qwen3.8-27b", "qwen3 27b": "qwen3.8-27b", "qwen 27b": "qwen3.8-27b",
    "qwen 3.6 27b": "qwen3.8-27b", "qwen3.6 27b": "qwen3.8-27b", "qwen3.6": "qwen3.8-27b",
    "qwen 3.6": "qwen3.8-27b",
    "qwen3 coder 30b": "qwen3-coder-30b", "qwen3-coder-30b": "qwen3-coder-30b", "qwen3 coder": "qwen3-coder-30b",
    "qwen coder 30b": "qwen3-coder-30b", "qwen 30b": "qwen3-coder-30b",
    # DeepSeek family
    "deepseek v4 pro": "deepseek-v4-pro", "deepseek-v4-pro": "deepseek-v4-pro", "deepseek v4": "deepseek-v4-pro",
    "deepseek v4 flash": "deepseek-v4-flash", "deepseek-v4-flash": "deepseek-v4-flash", "v4 flash": "deepseek-v4-flash",
    "deepseek r1 32b": "deepseek-r1-32b", "deepseek r1": "deepseek-r1-32b",
    # Llama 4 family
    "llama 4 scout": "llama-4-scout", "llama-4-scout": "llama-4-scout", "llama 4": "llama-4-scout",
    "llama 4 maverick": "llama-4-maverick", "llama-4-maverick": "llama-4-maverick",
    "llama 3.3 70b": "llama-3.3-70b", "llama 70b": "llama-3.3-70b", "llama 3.1 8b": "llama-3.1-8b", "llama 8b": "llama-3.1-8b",
    # Gemma 4 family
    "gemma 4 31b": "gemma-4-31b", "gemma-4-31b": "gemma-4-31b", "gemma 4": "gemma-4-31b", "gemma 31b": "gemma-4-31b",
    "gemma 4 12b": "gemma-4-12b", "gemma-4-12b": "gemma-4-12b", "gemma 12b": "gemma-4-12b",
    # Mistral family
    "codestral": "codestral-2501", "codestral 2501": "codestral-2501", "codestral-2501": "codestral-2501",
    "mistral medium": "mistral-medium-3.5", "mistral medium 3.5": "mistral-medium-3.5",
    # Frontier contenders
    "kimi k2.6": "kimi-k2.6", "kimi-k2.6": "kimi-k2.6", "kimi k3": "kimi-k2.6", "kimi": "kimi-k2.6",
    "glm 5 32b": "glm-5-32b", "glm-5-32b": "glm-5-32b", "glm 5": "glm-5-32b", "glm5": "glm-5-32b",
    # OpenAI open weights
    "gpt oss 20b": "gpt-oss-20b", "gpt-oss-20b": "gpt-oss-20b", "gpt oss": "gpt-oss-20b", "gpt-oss": "gpt-oss-20b",
    "gpt oss 120b": "gpt-oss-120b", "gpt-oss-120b": "gpt-oss-120b",
    # Small & edge
    "phi 4": "phi-4-14b", "phi-4": "phi-4-14b", "phi 4 14b": "phi-4-14b", "phi": "phi-4-14b",
    "falcon 3": "falcon-3-10b", "falcon-3": "falcon-3-10b", "falcon 3 10b": "falcon-3-10b",
    "nemotron nano 30b": "nemotron-nano-30b", "nemotron 30b": "nemotron-nano-30b",
}

_GPU_ALIASES: dict[str, str] = {
    "l40s": "L40S", "h100": "H100", "a100": "A100", "h200": "H200",
    "8x h100": "CLUSTER_8X_H100", "8x h200": "CLUSTER_8X_H200",
    "h100 cluster": "CLUSTER_8X_H100", "h200 cluster": "CLUSTER_8X_H200",
    "8xh100": "CLUSTER_8X_H100", "8xh200": "CLUSTER_8X_H200",
    "4090": "RTX4090", "rtx4090": "RTX4090", "rtx 4090": "RTX4090",
    "3090": "RTX3090", "rtx3090": "RTX3090", "rtx 3090": "RTX3090",
    "3060": "RTX3060", "rtx3060": "RTX3060", "rtx 3060": "RTX3060",
    "4070": "RTX4070", "rtx4070": "RTX4070", "rtx 4070": "RTX4070",
    "4070 super": "RTX4070",
    "dual 3090": "DUAL_RTX3090", "dual rtx 3090": "DUAL_RTX3090", "dual 4090": "DUAL_RTX3090",
    "quad 3090": "QUAD_RTX3090", "quad rtx 3090": "QUAD_RTX3090", "quad 4090": "QUAD_RTX3090",
    "4x 3090": "QUAD_RTX3090", "4x 4090": "QUAD_RTX3090",
    "8x 4090": "OCTA_RTX4090", "octa 4090": "OCTA_RTX4090", "octa rtx": "OCTA_RTX4090",
    "8x rtx": "OCTA_RTX4090",
    "mac mini": "MAC_MINI_16GB", "mac mini 16": "MAC_MINI_16GB", "mac mini 24": "MAC_MINI_24GB",
    "macbook 36": "MACBOOK_36GB", "macbook 36gb": "MACBOOK_36GB", "36gb": "MACBOOK_36GB",
    "macbook 48": "MACBOOK_48GB", "macbook 48gb": "MACBOOK_48GB", "48gb macbook": "MACBOOK_48GB",
    "mac studio": "MAC_STUDIO_128GB", "mac studio 128": "MAC_STUDIO_128GB", "mac studio 192": "MAC_STUDIO_192GB",
    "mac studio 64": "MAC_STUDIO_64GB", "mac studio 64gb": "MAC_STUDIO_64GB",
    "macbook": "MACBOOK_MAX_64GB", "macbook pro": "MACBOOK_MAX_64GB",
    "macbook 64": "MACBOOK_MAX_64GB", "macbook max 64": "MACBOOK_MAX_64GB",
    "macbook 128": "MACBOOK_MAX_128GB", "macbook max 128": "MACBOOK_MAX_128GB", "macbook max": "MACBOOK_MAX_64GB",
    "4080": "RTX4080", "rtx 4080": "RTX4080", "6000 ada": "RTX6000_ADA",
    "pc 16gb": "PC_16GB", "pc 16": "PC_16GB", "16gb ram": "PC_16GB",
    "pc 24gb": "PC_24GB", "24gb ram": "PC_24GB", "pc 24": "PC_24GB", "24gb": "PC_24GB",
    "pc 32gb": "PC_32GB", "pc 32": "PC_32GB", "32gb ram": "PC_32GB",
    "pc 64gb": "PC_64GB", "pc 64": "PC_64GB", "64gb ram": "PC_64GB",
    "pc 128gb": "PC_128GB", "pc 128": "PC_128GB", "128gb ram": "PC_128GB",
}


def extract_hf_repo_id(input_str: str) -> str:
    """Extract clean Hugging Face repo ID ('org/model-name') from ANY URL or input."""
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
    return "qwen3.8-27b"


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


def snap_to_step(value: int, steps: list[int]) -> int:
    """Snap an arbitrary value to the nearest allowed stress step."""
    if not steps:
        return value
    return min(steps, key=lambda s: (abs(s - value), steps.index(s)))


# ---------------------------------------------------------------------------
# Active users & concurrency modeling.
# concurrency (parallel streams / batch) maps to real-world user counts:
#   1         -> Personal Developer (1 user)
#   4 to 8    -> Small Team / Internal Tool (5-10 users)
#   16 to 32  -> Production Customer API (High Traffic)
# ---------------------------------------------------------------------------

def describe_concurrency(concurrency: int) -> dict:
    """Map a concurrency level to a real-world user tier + explanation.

    Returns tier key, human label, representative user count, and an
    explanation of why local hardware that fits batch-1 OOMs under load.
    """
    try:
        c = int(concurrency or 1)
    except (TypeError, ValueError):
        c = 1
    if c < 1:
        c = 1
    if c <= 1:
        return {
            "tier": "personal",
            "label": "Personal Developer",
            "users": "1 user",
            "user_count": "1 user",
            "concurrency": c,
            "description": "Single-stream local dev: one prompt at a time on a laptop/workstation.",
            "explanation": (
                "At concurrency=1 (Personal Developer, 1 user) only one KV-cache stream is live, "
                "so weights dominate VRAM and small local GPUs can fit quantized models."
            ),
        }
    if c <= 8:
        return {
            "tier": "team",
            "label": "Small Team / Internal Tool",
            "users": "5-10 users",
            "user_count": "5-10 users",
            "concurrency": c,
            "description": "A few parallel streams: internal tool or small team sharing one endpoint.",
            "explanation": (
                f"At concurrency={c} (Small Team / Internal Tool, 5-10 users) KV cache is ~{c}x "
                "larger than batch-1: KV = 2 x layers x hidden x context x batch x bytes / 1e9. "
                "Weights stay fixed, but KV growth overflows 12-24GB local VRAM while cloud GPUs survive."
            ),
        }
    return {
        "tier": "production",
        "label": "Production Customer API",
        "users": "High Traffic (10+ concurrent, 100s of users)",
        "user_count": "High Traffic (10+ concurrent, 100s of users)",
        "concurrency": c,
        "description": "Production API load: 16-32 parallel streams serving high-traffic customer workloads.",
        "explanation": (
            f"At concurrency={c} (Production Customer API, High Traffic) KV cache dominates: "
            "KV = 2 x layers x hidden x context x batch x bytes / 1e9 scales linearly with users. "
            "Local 16-48GB hardware that fits 1 user OOMs here because KV alone exceeds VRAM; "
            "production needs cloud GPUs (L40S/A100/H100/H200 or NVLink clusters) with headroom."
        ),
    }


def _estimate_arch(params_b: float) -> tuple[int, int]:
    """Heuristic (layers, hidden) for an arbitrary parameter count.

    Mirrors get_model_info() fallback tiers so evaluate_cluster_fit() stays
    consistent with inspect/advise math for ANY model size.
    """
    try:
        p = float(params_b)
    except (TypeError, ValueError):
        p = 27.0
    layers = 80 if p >= 65 else 64 if p >= 30 else 48 if p >= 14 else 32
    hidden = 8192 if p >= 65 else 5120 if p >= 14 else 4096
    return layers, hidden


def evaluate_cluster_fit(
    params_b: float,
    gpu_vram_gb: float,
    gpu_count: int = 1,
    concurrency: int = 1,
    context_len: int = 4096,
    precision: str = "FP16",
) -> dict:
    """Exact mathematical sizing for a multi-GPU / arbitrary-GPU-count cluster.

    Example: 10 GPUs of 24GB each (240GB total) -> evaluate whether a 70B,
    120B, or 685B model fits under tensor parallelism (TP = gpu_count).

    Math (per GPU, TP-sharded):
      total_vram      = gpu_vram_gb * gpu_count
      weights_total   = params_b * bytes_per_param
      weights_per_gpu = weights_total / gpu_count
      kv_total        = 2 * layers * hidden * context_len * concurrency * bytes / 1e9
      kv_per_gpu      = kv_total / gpu_count
      total_per_gpu   = weights_per_gpu + kv_per_gpu + RUNTIME_OVERHEAD_GB
      fits            = total_per_gpu <= gpu_vram_gb * USABLE_VRAM_FRACTION
    """
    try:
        p = float(params_b)
    except (TypeError, ValueError):
        p = 0.0
    try:
        per_gpu = float(gpu_vram_gb)
    except (TypeError, ValueError):
        per_gpu = 0.0
    try:
        n = int(gpu_count or 1)
    except (TypeError, ValueError):
        n = 1
    if n < 1:
        n = 1
    try:
        conc = int(concurrency or 1)
    except (TypeError, ValueError):
        conc = 1
    if conc < 1:
        conc = 1
    try:
        ctx = int(context_len or 4096)
    except (TypeError, ValueError):
        ctx = 4096
    if ctx < 1:
        ctx = 4096
    prec = (precision or "FP16").upper()
    if prec not in BYTES_PER_PARAM:
        prec = "FP16"

    layers, hidden = _estimate_arch(p)
    weights_total = weights_gb(p, prec)
    kv_total = kv_cache_gb(layers, hidden, ctx, conc, prec)
    weights_per_gpu = round(weights_total / n, 2) if n else weights_total
    kv_per_gpu = round(kv_total / n, 2) if n else kv_total
    total_per_gpu = round(weights_per_gpu + kv_per_gpu + RUNTIME_OVERHEAD_GB, 2)
    total_cluster = round(weights_total + kv_total + RUNTIME_OVERHEAD_GB * n, 2)
    total_vram = round(per_gpu * n, 2)
    usable_per_gpu = round(per_gpu * USABLE_VRAM_FRACTION, 2)
    headroom = round(usable_per_gpu - total_per_gpu, 2)
    fits = total_per_gpu <= usable_per_gpu
    pct = round(total_per_gpu / per_gpu * 100.0, 1) if per_gpu else 0.0
    if not fits:
        status = "OOM"
    elif pct >= 85.0:
        status = "TIGHT"
    else:
        status = "FITS"
    tier = describe_concurrency(conc)
    if fits:
        verdict = (
            f"FITS: {p:g}B @ {prec} on {n}x {per_gpu:g}GB ({total_vram:g}GB total, TP={n}): "
            f"~{total_per_gpu}GB/GPU (~{pct}% of {per_gpu:g}GB, {headroom}GB headroom). "
            f"Weights ~{weights_per_gpu}GB/GPU + KV ~{kv_per_gpu}GB/GPU @ {conc}x{ctx} ({tier['label']})."
        )
    else:
        verdict = (
            f"OOM: {p:g}B @ {prec} on {n}x {per_gpu:g}GB ({total_vram:g}GB total, TP={n}) needs "
            f"~{total_per_gpu}GB/GPU vs ~{usable_per_gpu}GB usable ({pct}% of {per_gpu:g}GB, {headroom}GB headroom). "
            f"Weights ~{weights_per_gpu}GB/GPU + KV ~{kv_per_gpu}GB/GPU @ {conc}x{ctx} ({tier['label']}). "
            "Add GPUs, quantize (FP8/INT4), or reduce concurrency/context."
        )
    return {
        "params_b": p,
        "precision": prec,
        "precision_bytes": BYTES_PER_PARAM.get(prec, 2.0),
        "layers": layers,
        "hidden": hidden,
        "concurrency": conc,
        "context_len": ctx,
        "gpu_vram_gb": per_gpu,
        "gpu_count": n,
        "total_vram_gb": total_vram,
        "total_vram": total_vram,
        "tp": n,
        "tensor_parallel": n,
        "weights_total_gb": weights_total,
        "weights_per_gpu_gb": weights_per_gpu,
        "weights_per_gpu": weights_per_gpu,
        "kv_total_gb": kv_total,
        "kv_per_gpu_gb": kv_per_gpu,
        "kv_per_gpu": kv_per_gpu,
        "overhead_per_gpu_gb": RUNTIME_OVERHEAD_GB,
        "total_per_gpu_gb": total_per_gpu,
        "memory_per_gpu_gb": total_per_gpu,
        "total_cluster_gb": total_cluster,
        "usable_per_gpu_gb": usable_per_gpu,
        "headroom_per_gpu_gb": headroom,
        "headroom_gb": headroom,
        "saturation_pct": pct,
        "fits": fits,
        "fit": fits,
        "oom": not fits,
        "fit_status": status,
        "status": status,
        "concurrency_tier": tier,
        "verdict": verdict,
        "explanation": verdict,
    }


def calibrate_stress(
    layers: int,
    hidden: int,
    params_b: float,
    precision: str = "BF16",
    concurrency: int = 16,
    context_len: int = 4096,
    target_gpu: str | None = "H100",
) -> dict:
    """Real-time KV-cache & VRAM failure calculation for a stress point.

    Formula: KV = 2 * layers * hidden_size * context_len * batch * precision_bytes / 1e9
    Total  = weights + KV + RUNTIME_OVERHEAD_GB.
    Saturation = total / vram_gb; OOM when total > vram * USABLE_VRAM_FRACTION.

    Returns weights/kv/total plus a per-GPU saturation map and a target-GPU
    verdict so the UI can warn *before* the user burns budget on a doomed run.
    """
    concurrency = int(concurrency or 16)
    context_len = int(context_len or 4096)
    precision = (precision or "BF16").upper()
    if precision not in BYTES_PER_PARAM:
        precision = "BF16"

    weights = weights_gb(float(params_b), precision)
    kv = kv_cache_gb(int(layers), int(hidden), context_len, concurrency, precision)
    total = round(weights + kv + RUNTIME_OVERHEAD_GB, 2)

    saturation: dict[str, dict] = {}
    for gkey in STRESS_TARGET_GPUS:
        ginfo = GPU_CATALOG.get(gkey)
        if not ginfo:
            continue
        vram = float(ginfo["vram_gb"])
        usable = round(vram * USABLE_VRAM_FRACTION, 2)
        pct = round(total / vram * 100.0, 1) if vram else 0.0
        oom = total > usable
        headroom = round(usable - total, 2)
        saturation[gkey] = {
            "gpu_key": gkey,
            "label": ginfo["label"],
            "vram_gb": vram,
            "usable_gb": usable,
            "saturation_pct": pct,
            "headroom_gb": headroom,
            "oom": oom,
            "status": "OOM" if oom else ("TIGHT" if pct >= 85.0 else "FITS"),
        }

    target_key = (target_gpu or "H100").upper()
    # Resolve common aliases ("h100 80gb", "L40S 48GB") to catalog keys.
    resolved_target = detect_gpu(target_key) or target_key
    if resolved_target not in GPU_CATALOG:
        resolved_target = "H100" if "H100" in GPU_CATALOG else STRESS_TARGET_GPUS[0]
    entry = saturation.get(resolved_target, {})
    oom = bool(entry.get("oom", False))

    if oom:
        verdict = (
            f"CUDA OOM on {resolved_target}: ~{total}GB needed vs "
            f"~{entry.get('usable_gb', 0)}GB usable "
            f"({entry.get('saturation_pct', 0)}% of {entry.get('vram_gb', 0)}GB). "
            f"Reduce concurrency/context or escalate tier before running."
        )
    elif (entry.get("saturation_pct", 0) or 0) >= 85.0:
        verdict = (
            f"TIGHT on {resolved_target}: ~{total}GB (~{entry.get('saturation_pct', 0)}% "
            f"of {entry.get('vram_gb', 0)}GB). Expect fragmentation risk at peak batch."
        )
    else:
        verdict = (
            f"FITS on {resolved_target}: ~{total}GB (~{entry.get('saturation_pct', 0)}% "
            f"of {entry.get('vram_gb', 0)}GB, {entry.get('headroom_gb', 0)}GB headroom)."
        )

    return {
        "formula": "2 * layers * hidden_size * context_len * batch_size * precision_bytes / 1e9",
        "layers": int(layers),
        "hidden": int(hidden),
        "params_b": float(params_b),
        "precision": precision,
        "precision_bytes": BYTES_PER_PARAM.get(precision, 2.0),
        "concurrency": concurrency,
        "context_len": context_len,
        "weights_gb": weights,
        "kv_cache_gb": kv,
        "overhead_gb": RUNTIME_OVERHEAD_GB,
        "total_gb": total,
        "target_gpu": resolved_target,
        "oom": oom,
        "verdict": verdict,
        "saturation": saturation,
        # Active-users mapping: concurrency -> real-world user tier.
        "concurrency_tier": describe_concurrency(concurrency),
        "user_scope": describe_concurrency(concurrency)["label"],
        "users": describe_concurrency(concurrency)["users"],
        "concurrency_explanation": describe_concurrency(concurrency)["explanation"],
    }


def stress_fit_for_model(
    model_query: str,
    concurrency: int = 16,
    context_len: int = 4096,
    precision: str = "BF16",
    target_gpu: str | None = "H100",
) -> dict:
    """Resolve any model query then calibrate its stress point."""
    info = get_model_info(detect_model(model_query))
    cal = calibrate_stress(
        layers=int(info["layers"]),
        hidden=int(info["hidden"]),
        params_b=float(info["params_b"]),
        precision=detect_precision(precision or model_query),
        concurrency=concurrency,
        context_len=context_len,
        target_gpu=target_gpu,
    )
    return {
        "model_slug": info["slug"],
        "display_name": info["display"],
        "params_b": float(info["params_b"]),
        **cal,
    }


def fetch_hf_metadata(repo_id: str) -> dict | None:
    """Fetch live metadata from Hugging Face Hub public API. Zero auth required for public models."""
    if not repo_id or "/" not in repo_id:
        return None
    if repo_id in _HF_CACHE:
        return _HF_CACHE[repo_id]

    headers = {"User-Agent": "SandboxProof-Hardware-Fit/1.0"}
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

    # 2. Probe API model endpoint
    try:
        req2 = urllib.request.Request(f"https://huggingface.co/api/models/{repo_id}", headers=headers)
        with urllib.request.urlopen(req2, timeout=3.0) as resp2:
            info = json.loads(resp2.read().decode("utf-8"))
            data["downloads"] = info.get("downloads", 0)
            data["likes"] = info.get("likes", 0)
            data["tags"] = info.get("tags", [])
            data["pipeline_tag"] = info.get("pipeline_tag", "text-generation")
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
        for k, v in MODEL_CATALOG.items():
            if v["slug"].lower() == slug.lower():
                return {"key": k, **v}

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
                "license": "Custom/Open Weights",
                "downloads": hf.get("downloads", 0),
                "is_live_hf": True,
            }

    # 3. Dynamic parameter heuristic from string
    m = re.search(r"(\d+(?:\.\d+)?)\s*b\b", key.lower())
    params = float(m.group(1)) if m else 27.0
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
        "license": "Open Weights",
        "is_live_hf": False,
    }


def cheapest_gpu_for(total_gb: float, cloud_only: bool = True) -> str | None:
    if cloud_only:
        items = [(k, v) for k, v in GPU_CATALOG.items() if v["category"] == "cloud_gpu" and v["vram_gb"] >= total_gb]
        if not items:
            return "H200"  # Cloud flagship tier for massive memory workloads
        items.sort(key=lambda kv: kv[1]["usd_hr"])
        return items[0][0]
    items = [(k, v) for k, v in GPU_CATALOG.items() if v["vram_gb"] >= total_gb]
    if not items:
        return None
    items.sort(key=lambda kv: kv[1]["usd_hr"])
    return items[0][0]


def inspect_model_fit(
    model_query: str,
    seq_len: int = 4096,
    concurrency: int = 16,
    context_len: int | None = None,
    precision: str = "BF16",
    target_gpu: str | None = "H100",
) -> dict:
    """Full hardware compatibility evaluation for ANY model, mapping to real lab/business deployments.

    Breakscale extension: `concurrency` (parallel streams) + `context_len`
    (tokens) drive a live stress calibration (KV formula + VRAM saturation
    vs L40S/H100) returned as `stress`. `seq_len` is kept as a legacy alias
    for `context_len` so old callers keep working.
    """
    clean_id = extract_hf_repo_id(model_query) or model_query
    info = get_model_info(clean_id)
    params_b = float(info["params_b"])
    layers = int(info["layers"])
    hidden = int(info["hidden"])
    license_type = info.get("license", "Open Weights")
    # Resolve the effective stress point (new args win, legacy seq_len falls back).
    eff_context = int(context_len) if context_len else int(seq_len or 4096)
    eff_concurrency = int(concurrency or 16)
    eff_precision = (precision or "BF16").upper()
    if eff_precision not in BYTES_PER_PARAM:
        eff_precision = "BF16"
    eff_target = (target_gpu or "H100")

    w_fp16 = weights_gb(params_b, "FP16")
    w_fp8 = weights_gb(params_b, "FP8")
    w_int4 = weights_gb(params_b, "INT4")

    kv_4k_b1 = kv_cache_gb(layers, hidden, 4096, 1, "FP16")
    kv_8k_b1 = kv_cache_gb(layers, hidden, 8192, 1, "FP16")
    kv_32k_b1 = kv_cache_gb(layers, hidden, 32768, 1, "FP16")
    kv_4k_b16 = kv_cache_gb(layers, hidden, 4096, 16, "FP16")

    overhead = 2.0
    total_local_int4 = round(w_int4 + kv_4k_b1 + overhead, 1)
    total_prod_fp8 = round(w_fp8 + kv_4k_b16 + overhead, 1)
    total_prod_fp16 = round(w_fp16 + kv_4k_b16 + overhead, 1)

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

    # Evaluate local setups: Mac Mini, RTX 4090, Dual 3090, Mac Studio
    mac_mini_16 = next((h for h in hardware_matrix if h["gpu_key"] == "MAC_MINI_16GB"), None)
    rtx4090_fit = next((h for h in hardware_matrix if h["gpu_key"] == "RTX4090"), None)
    mac128_fit = next((h for h in hardware_matrix if h["gpu_key"] == "MAC_STUDIO_128GB"), None)
    dual3090_fit = next((h for h in hardware_matrix if h["gpu_key"] == "DUAL_RTX3090"), None)

    if mac_mini_16 and mac_mini_16["fit_status"] in ("NATIVE_FP16", "QUANTIZED_FP8", "QUANTIZED_INT4"):
        local_verdict = f"Runs smoothly on Apple Mac Mini (16GB/24GB) via Ollama/MLX at 4-bit (needs ~{total_local_int4}GB VRAM)."
        local_status = "LOCAL_MAC_MINI_VIABLE"
    elif rtx4090_fit and rtx4090_fit["fit_status"] in ("NATIVE_FP16", "QUANTIZED_FP8"):
        local_verdict = f"Fully supported on single RTX 4090 / 3090 24GB at native precision (~{total_local_int4}GB - {round(w_fp16 + kv_4k_b1 + overhead, 1)}GB VRAM)."
        local_status = "LOCAL_EXCELLENT"
    elif rtx4090_fit and rtx4090_fit["fit_status"] == "QUANTIZED_INT4":
        local_verdict = f"Runs on a single 24GB GPU (RTX 4090 / Mac Mini 24GB) at 4-bit quantization (~{total_local_int4}GB VRAM)."
        local_status = "LOCAL_QUANTIZED"
    elif dual3090_fit and dual3090_fit["fit_status"] in ("NATIVE_FP16", "QUANTIZED_FP8", "QUANTIZED_INT4"):
        local_verdict = f"Requires Dual RTX 3090/4090 (48GB) or Apple Mac Studio 128GB. A single 24GB card will OOM."
        local_status = "LOCAL_MULTI_GPU_OR_MAC"
    elif mac128_fit and mac128_fit["fit_status"] in ("NATIVE_FP16", "QUANTIZED_FP8", "QUANTIZED_INT4"):
        local_verdict = f"Too large for consumer GPUs. Runs locally on Apple Mac Studio (128GB/192GB unified memory)."
        local_status = "LOCAL_MAC_STUDIO_ONLY"
    else:
        local_verdict = f"Frontier weight scale ({params_b:g}B params). Cloud GPU cluster (vLLM / SGLang on Nebius) mandatory."
        local_status = "CLOUD_ONLY"

    cloud_rec_key = cheapest_gpu_for(total_prod_fp8, cloud_only=True) or "H100"
    cloud_rec = GPU_CATALOG[cloud_rec_key]

    # Deployment stack recommendations
    deploy_stack = {
        "local_dev": "ollama pull" if params_b <= 75 else "mlx-lm (Apple Silicon)",
        "production_cloud": "vLLM / SGLang on Nebius Cloud GPUs",
        "commercial_license": license_type,
    }

    # Breakscale live stress calibration at the requested operating point.
    stress = calibrate_stress(
        layers=layers,
        hidden=hidden,
        params_b=params_b,
        precision=eff_precision,
        concurrency=eff_concurrency,
        context_len=eff_context,
        target_gpu=eff_target,
    )

    # Active-users mapping for this operating point (backwards-compatible addition).
    user_tier = describe_concurrency(eff_concurrency)

    return {
        "model_slug": info["slug"],
        "display_name": info["display"],
        "params_b": params_b,
        "layers": layers,
        "hidden": hidden,
        "license": license_type,
        "note": info.get("note", ""),
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
        "deploy_stack": deploy_stack,
        "is_live_hf": info.get("is_live_hf", False),
        # Breakscale stress calibration payload (backwards-compatible addition).
        "stress": stress,
        "stress_presets": STRESS_PRESETS,
        "concurrency_steps": CONCURRENCY_STEPS,
        "context_steps": CONTEXT_STEPS,
        # Active users & concurrency modeling (backwards-compatible addition).
        "concurrency": eff_concurrency,
        "context_len": eff_context,
        "concurrency_tier": user_tier,
        "user_scope": user_tier["label"],
        "users": user_tier["users"],
        "concurrency_explanation": user_tier["explanation"],
    }


def advise(
    query: str,
    current_gpu: str | None = None,
    seq_len: int = 4096,
    concurrency: int = 16,
    context_len: int | None = None,
    target_gpu: str | None = None,
) -> dict:
    """Deterministic sizing answer mapping models to local Mac/PC setups vs Nebius Cloud.

    Breakscale extension: `concurrency` + `context_len` (fallback `seq_len`)
    calibrate the same KV/VRAM stress point returned as `stress`, so callers
    can warn about CUDA OOM before spending budget.
    """
    query = (query or "").strip() or "Can I run this model on my GPU?"
    clean_slug = extract_hf_repo_id(query)
    key = detect_model(query)
    info = get_model_info(key)
    precision = detect_precision(query)
    gpu = detect_gpu(query) or detect_gpu(current_gpu)
    eff_context = int(context_len) if context_len else int(seq_len or 4096)
    eff_concurrency = int(concurrency or 16)
    eff_target = target_gpu or gpu or "H100"

    params_b = float(info["params_b"])
    layers = int(info["layers"])
    hidden = int(info["hidden"])
    license_type = info.get("license", "Open Weights")
    w = weights_gb(params_b, precision)
    kv1 = kv_cache_gb(layers, hidden, eff_context, 1, precision)
    kv16 = kv_cache_gb(layers, hidden, eff_context, eff_concurrency, precision)
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
        tool_note = (f"MoE architecture ({params_b:g}B total) delivers high inference throughput, "
                     "but requires multi-GPU tensor parallelism — single-card serving will OOM.")
    elif precision == "INT4":
        tool_note = ("INT4 saves ~4× VRAM but is the #1 cause of broken JSON schemas and degraded "
                     "tool-call arguments. Always certify schema accuracy ≥85% before migrating.")
    elif params_b <= 20:
        tool_note = ("Compact models in this tier maintain strong tool-call accuracy at BF16/FP8; "
                     "ideal for single-GPU or edge deployments.")
    else:
        tool_note = ("Frontier-class models sustain high tool-call fidelity at BF16/FP8; "
                     "verify with a structured-output replay before migrating.")

    if gpu:
        g = GPU_CATALOG[gpu]
        verdict = (f"On {g['label']}: single-request needs ~{total1}GB "
                   f"({'FITS' if fits_single else 'OOM RISK'} vs {g['vram_gb']}GB) · "
                   f"{eff_concurrency}-way concurrency needs ~{total16}GB "
                   f"({'FITS' if fits_conc else 'OOM — escalate tier'}).")
    else:
        verdict = (f"Single-request needs ~{total1}GB; {eff_concurrency}-way concurrency needs ~{total16}GB "
                   f"(weights FP8/BF16 + KV cache @ seq {eff_context} + 2GB runtime).")

    rec = cheapest_conc or cheapest_single or "H200"
    rec_label = GPU_CATALOG[rec]["label"]

    # Local Hardware Mapping Note
    if params_b <= 20:
        local_note = "💻 **Local Hardware:** Runs smoothly on **Apple Mac Mini 16GB** or **RTX 4080/4090** via `ollama pull`."
    elif params_b <= 35:
        local_note = "💻 **Local Hardware:** Fits on a **single 24GB GPU** (RTX 4090 / 3090 / Mac Mini 24GB) at 4-bit (AWQ/GGUF)."
    elif params_b <= 75:
        local_note = "💻 **Local Hardware:** Requires **Dual RTX 3090 (48GB)** or **Apple Mac Studio 128GB**. A single 24GB card will OOM."
    else:
        local_note = "💻 **Local Hardware:** Heavyweight scale requires **Apple Mac Studio 192GB** or **multi-node Nebius Cloud clusters**."

    answer = (
        f"**{info['display']}** ({params_b:g}B params · {license_type}) · @ {precision} · seq {eff_context}\n\n"
        f"**1. Parameter memory (weights):** {params_b:g}B × {BYTES_PER_PARAM.get(precision, 2.0):g} bytes "
        f"= **~{w}GB**.\n"
        f"**2. KV cache growth (PagedAttention):** `2 × {layers} layers × {hidden} hidden × {eff_context} tokens "
        f"× batch × {BYTES_PER_PARAM.get(precision, 2.0):g}B / 1e9` → **~{kv1}GB @ batch 1**, "
        f"**~{kv16}GB @ batch {eff_concurrency}** (concurrency is what OOMs, not weights).\n"
        f"**3. Runtime overhead:** ~{overhead}GB (CUDA context + block tables) → "
        f"**total ~{total1}GB (batch 1) / ~{total16}GB (batch {eff_concurrency})**.\n\n"
        f"**Verdict:** {verdict}\n"
        f"{local_note}\n"
        f"**Recommended Cloud GPU:** {rec_label} "
        f"(${GPU_CATALOG[rec]['usd_hr']:.2f}/hr — cheapest tier fitting batch-{eff_concurrency} via vLLM/SGLang).\n"
        f"**Commercial License:** {license_type}\n"
        f"**Structured JSON / tool calls:** {tool_note}"
    )

    stress = calibrate_stress(
        layers=layers,
        hidden=hidden,
        params_b=params_b,
        precision=precision,
        concurrency=eff_concurrency,
        context_len=eff_context,
        target_gpu=eff_target,
    )

    return {
        "answer": answer,
        "candidate_model": info["slug"],
        "display_model": info["display"],
        "precision": precision,
        "license": license_type,
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
        "stress": stress,
        "concurrency": eff_concurrency,
        "context_len": eff_context,
        # Active-users mapping (backwards-compatible addition).
        "concurrency_tier": describe_concurrency(eff_concurrency),
        "user_scope": describe_concurrency(eff_concurrency)["label"],
        "users": describe_concurrency(eff_concurrency)["users"],
        "concurrency_explanation": describe_concurrency(eff_concurrency)["explanation"],
    }


# ---------------------------------------------------------------------------
# Backwards-compatibility aliases.
# Older callers may import inspect_model() or evaluate_hardware_matrix();
# both delegate to inspect_model_fit() so existing code keeps working.
# ---------------------------------------------------------------------------

def inspect_model(
    model_query: str = "",
    seq_len: int = 4096,
    concurrency: int = 16,
    context_len: int | None = None,
    precision: str = "BF16",
    target_gpu: str | None = "H100",
) -> dict:
    """Alias for inspect_model_fit() (legacy import path)."""
    return inspect_model_fit(
        model_query,
        seq_len=seq_len,
        concurrency=concurrency,
        context_len=context_len,
        precision=precision,
        target_gpu=target_gpu,
    )


def evaluate_hardware_matrix(
    model_query: str = "",
    seq_len: int = 4096,
    concurrency: int = 16,
    context_len: int | None = None,
    precision: str = "BF16",
    target_gpu: str | None = "H100",
) -> dict:
    """Legacy alias returning the full inspect_model_fit() payload.

    The per-GPU fit rows live under the `hardware_matrix` key, so callers
    that only need the matrix can use
    `evaluate_hardware_matrix(...)["hardware_matrix"]`.
    """
    return inspect_model_fit(
        model_query,
        seq_len=seq_len,
        concurrency=concurrency,
        context_len=context_len,
        precision=precision,
        target_gpu=target_gpu,
    )
