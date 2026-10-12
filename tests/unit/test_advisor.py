"""Advisor sizing is pure math: offline, deterministic, zero spend."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from services import advisor as adv


def test_gemma27b_detected_with_vram_math_and_cta():
    r = adv.advise("Can I run Gemma 2 27B on a single L40S 48GB?")
    assert r["candidate_model"] == "google/gemma-2-27b-it"
    assert r["asked_gpu"] == "L40S"
    assert r["weights_gb"] > 50  # 27.2B x 2 bytes
    assert r["kv_gb_batch16"] > r["kv_gb_batch1"] > 0
    assert r["recommended_gpu"] in ("H100", "A100", "H200")
    assert "KV" in r["answer"] and "48GB" in r["answer"]
    assert r["cta"] == "/new?candidate_model=google/gemma-2-27b-it"
    assert r["source"] == "deterministic"


def test_qwen14b_toolcall_note_and_slug():
    r = adv.advise("Will Qwen 2.5 14B break structured JSON tool calls?")
    assert r["candidate_model"] == "Qwen/Qwen2.5-14B-Instruct"
    assert "tool" in r["answer"].lower() or "JSON" in r["answer"]


def test_nano_cheapest_tier_recommended():
    r = adv.advise("What's the cheapest GPU to serve Nemotron Nano 30B?")
    assert r["candidate_model"] == "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
    assert r["recommended_gpu"] in ("L40S", "A100", "H100", "H200", "RTX4090")


def test_unknown_model_never_raises():
    r = adv.advise("", current_gpu="H100")
    assert r["answer"] and r["candidate_model"] and r["cta"].startswith("/new?candidate_model=")
