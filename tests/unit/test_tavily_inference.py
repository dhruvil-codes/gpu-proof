"""Offline tests for Tavily inference-price parsing + cache (no network)."""
import json

from services import tavily_pricing as tp


def _blob(title, content):
    return {"title": title, "content": content, "url": "https://example.com/x"}


def test_extract_inference_rates_basic():
    results = [_blob(
        "Nemotron pricing",
        "Nemotron-3-Nano at $0.06 per 1M tokens input. Qwen3 at $0.45 / 1M tokens.",
    )]
    rates, evidence = tp.extract_inference_rates(results)
    assert rates["nemotron"] == 0.06
    assert rates["qwen"] == 0.45
    assert evidence and evidence[0]["url"].startswith("http")


def test_extract_inference_rates_rejects_hourly():
    # $/hr GPU figures must not leak into $/1M inference rates.
    results = [_blob("GPU cloud", "H100 at $3.85/hr, H200 $4.50 per hour.")]
    try:
        tp.extract_inference_rates(results)
    except RuntimeError:
        return
    raise AssertionError("expected RuntimeError for hourly-only blob")


def test_inference_cache_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("TAVILY_CACHE_DIR", str(tmp_path))
    doc = {"source": "tavily", "fetched_at": "2026-10-16T00:00:00+00:00",
           "rates": {"nemotron": 0.06}, "evidence": [], "queries": ["q"]}
    p = tp.save_inference_prices(doc)
    assert p.exists()
    loaded = tp.load_cached_inference_prices()
    assert loaded and loaded["rates"]["nemotron"] == 0.06


def test_inference_cache_rejects_bad_shape(tmp_path, monkeypatch):
    monkeypatch.setenv("TAVILY_CACHE_DIR", str(tmp_path))
    bad = tmp_path / "inference_prices.json"
    bad.write_text(json.dumps({"source": "tavily"}), encoding="utf-8")
    assert tp.load_cached_inference_prices() is None
