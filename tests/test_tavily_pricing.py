"""Offline tests for services/tavily_pricing.py + live economics wiring.

No network: all Tavily payloads below are recorded fixtures. Failure
paths (missing key) are asserted to raise RuntimeError before any I/O.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import tavily_pricing as tp
from services.certificate_engine import build_deployment_prescription

# ---------------------------------------------------------------- fixtures


def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _days_ago_iso(n):
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat(timespec="seconds")


RECORDED_RESULTS = [
    {"title": "Nebius GPU pricing — H100 clusters",
     "url": "https://example.com/nebius-h100",
     "content": "Nebius H100 80GB SXM5 instances start at $3.20/hr per GPU, billed per minute."},
    {"title": "Nebius H200 price list 2026",
     "url": "https://example.com/nebius-h200",
     "content": "The H200 141GB tier is listed at $4.50 per hour on demand."},
    {"title": "GPU cloud comparison: L40S vs B200",
     "url": "https://example.com/gpu-compare",
     "content": "L40S 48GB at $1.35/hr is the budget pick; B200 systems run about $6.10/hr per GPU."},
    {"title": "AWS p5 reference (H100/H200)",
     "url": "https://example.com/aws-p5",
     "content": "For reference, AWS p5 H100 capacity is often quoted near $5.00 per hour on demand."},
]

RADAR_RESULTS = [
    {"title": "Qwen3-Max-Think — new open-weight reasoning model",
     "url": "https://example.com/qwen3-max",
     "content": "Released 3 days ago with FP8 quantized checkpoints for vLLM.",
     "published_date": None},
    {"title": "Some blog | daily roundup",
     "url": "https://example.com/roundup",
     "content": "Covers the Nemotron-3-Nano FP8 quant published 12 days ago."},
    {"title": "No URL entry",
     "url": "",
     "content": "H100 at $3.20/hr but no link — must be skipped."},
    {"title": "FTP junk",
     "url": "ftp://example.com/x",
     "content": "Should never appear in output."},
]

# ---------------------------------------------------------------- parser


def test_extract_rates_parses_all_tiers():
    rates, evidence = tp.extract_rates_from_results(RECORDED_RESULTS)
    assert rates["H100"] == pytest.approx(3.20)
    assert rates["H200"] == pytest.approx(4.50)
    assert rates["B200"] == pytest.approx(6.10)
    assert rates["L40S"] == pytest.approx(1.35)
    assert {e["title"] for e in evidence} and all(
        set(e) == {"title", "url"} for e in evidence)


def test_extract_rates_nearest_association():
    blob = ("Rent an H100 at $3.20/hr for training. " * 2
            + "Separately, an H200 node costs $9.00 per hour on another cloud.")
    rates, _ = tp.extract_rates_from_results(
        [{"title": "t", "url": "https://example.com/t", "content": blob}])
    assert rates["H100"] == pytest.approx(3.20)
    assert rates["H200"] == pytest.approx(9.00)


def test_extract_rates_ignores_implausible_values():
    results = [
        {"title": "H100 pricing", "url": "https://example.com/a",
         "content": "H100 promo cluster absurdly listed at $999.00/hr (ignore)."},
        {"title": "L40S pricing", "url": "https://example.com/b",
         "content": "L40S at $1.35/hr."},
    ]
    rates, _ = tp.extract_rates_from_results(results)
    assert "H100" not in rates  # only implausible mention -> no rate
    assert rates["L40S"] == pytest.approx(1.35)


def test_extract_rates_raises_when_nothing_found():
    with pytest.raises(RuntimeError):
        tp.extract_rates_from_results(
            [{"title": "t", "url": "https://example.com/t",
              "content": "No prices here at all."}])


def test_extract_rates_rejects_per_token_prices():
    # $0.65 per 1M tokens next to H100 must NOT become a $/hr GPU rate.
    results = [
        {"title": "H100 inference pricing", "url": "https://example.com/a",
         "content": "H100 inference from $0.65 per 1M tokens on serverless endpoints."},
    ]
    with pytest.raises(RuntimeError):
        tp.extract_rates_from_results(results)


def test_extract_rates_rejects_below_floor_hourly():
    # An explicit hourly figure below the tier floor is a confused/spot
    # number, not a plannable rate — reject rather than certify it.
    results = [
        {"title": "H100 deals", "url": "https://example.com/a",
         "content": "Flash sale: H100 at $1.10/hr for one weekend only!"},
    ]
    with pytest.raises(RuntimeError):
        tp.extract_rates_from_results(results)


def test_evidence_extraction_skips_bad_urls_and_caps():
    ev = tp.extract_evidence(RADAR_RESULTS, limit=2)
    assert len(ev) == 2
    assert all(u.startswith("http") for u in (e["url"] for e in ev))
    assert all(set(e) == {"title", "url"} for e in ev)


# ---------------------------------------------------------------- freshness


def test_is_fresh_boundaries():
    assert tp.is_fresh(_now_iso()) is True
    assert tp.is_fresh(_days_ago_iso(6)) is True
    assert tp.is_fresh(_days_ago_iso(8)) is False
    assert tp.is_fresh("not-a-date") is False
    assert tp.is_fresh(None) is False
    assert tp.is_fresh("") is False


# ---------------------------------------------------------------- cache


def test_cache_roundtrip_prices(tmp_path):
    doc = {"source": "tavily", "fetched_at": _now_iso(),
           "rates": {"L40S": 1.35, "H100": 3.2, "H200": 4.5, "B200": 6.1},
           "evidence": [{"title": "t", "url": "https://example.com/t"}]}
    p = tmp_path / "prices.json"
    tp.save_prices(doc, path=p)
    assert tp.load_cached_prices(path=p) == doc
    assert tp.is_fresh(tp.load_cached_prices(path=p)["fetched_at"]) is True


def test_cache_roundtrip_radar(tmp_path):
    items = [{"model": "m", "note": "n",
              "url": "https://example.com/m", "days_ago_hint": 3}]
    p = tmp_path / "radar.json"
    tp.save_radar(items, path=p)
    assert tp.load_cached_radar(path=p) == items


def test_load_cached_rejects_missing_and_corrupt(tmp_path):
    assert tp.load_cached_prices(path=tmp_path / "nope.json") is None
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    assert tp.load_cached_prices(path=bad) is None
    wrong = tmp_path / "wrong.json"
    wrong.write_text(json.dumps({"source": "tavily"}), encoding="utf-8")
    assert tp.load_cached_prices(path=wrong) is None


# ---------------------------------------------------------------- radar


def test_radar_parser_shape_and_days_hint():
    items = tp.parse_radar_results(RADAR_RESULTS)
    assert len(items) == 2  # url-less + ftp entries skipped
    for it in items:
        assert set(it) == {"model", "note", "url", "days_ago_hint"}
        assert it["url"].startswith("http")
    assert items[0]["model"].startswith("Qwen3-Max-Think")
    assert items[0]["days_ago_hint"] == 3
    assert items[1]["days_ago_hint"] == 12


def test_radar_empty_raises_nothing_parseable():
    assert tp.parse_radar_results([]) == []
    assert tp.parse_radar_results([{"title": "x", "url": "", "content": "y"}]) == []


# ---------------------------------------------------------------- failure contract (no network)


def test_fetch_raises_without_key(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    with pytest.raises(RuntimeError):
        tp.fetch_gpu_prices(cache=False)
    with pytest.raises(RuntimeError):
        tp.release_radar(cache=False)


# ---------------------------------------------------------------- certificate wiring


def _live_doc(rate_h100=2.10, days_old=0):
    return {
        "source": "tavily",
        "fetched_at": _days_ago_iso(days_old),
        "rates": {"L40S": 1.35, "H100": rate_h100, "H200": 4.5, "B200": 6.1},
        "evidence": [{"title": "Nebius H100 pricing",
                      "url": "https://example.com/nebius-h100"}],
    }


def test_certificate_backward_compat_static_defaults():
    dep = build_deployment_prescription(
        plan={"gpu_type": "H100"}, metrics={"count": 60}, spend_usd=0.0)
    eco = dep["economics"]
    assert eco["cost_per_1k_queries_usd"] > 0
    assert eco["provenance"] == "static-table"
    assert eco["evidence_urls"] == []
    assert eco["hourly_rate_source"] == "static-table"
    assert eco["fetched_at"] is None


def test_certificate_live_rates_drive_estimate():
    live = _live_doc(rate_h100=2.10)
    dep = build_deployment_prescription(
        plan={"gpu_type": "H100"}, metrics={"count": 60},
        spend_usd=0.0, live_rates=live)
    eco = dep["economics"]
    all_in = round(2.10 + 8 * 0.012 + 32 * 0.0032, 4)
    assert eco["hourly_rate_usd"] == pytest.approx(all_in)
    assert eco["cost_per_1k_queries_usd"] == pytest.approx(
        round(all_in / 3600.0 * 60.0 / 60 * 1000.0, 4))
    assert eco["provenance"].startswith("tavily-live ")
    assert eco["evidence_urls"] == ["https://example.com/nebius-h100"]
    assert eco["hourly_rate_source"] == "tavily-live"
    # static fallback must differ (static H100 table = $3.20/hr)
    static = build_deployment_prescription(
        plan={"gpu_type": "H100"}, metrics={"count": 60}, spend_usd=0.0)
    assert eco["cost_per_1k_queries_usd"] != static["economics"]["cost_per_1k_queries_usd"]


def test_certificate_stale_live_falls_back_to_static():
    live = _live_doc(rate_h100=2.10, days_old=8)
    dep = build_deployment_prescription(
        plan={"gpu_type": "H100"}, metrics={"count": 60},
        spend_usd=0.0, live_rates=live)
    eco = dep["economics"]
    static = build_deployment_prescription(
        plan={"gpu_type": "H100"}, metrics={"count": 60}, spend_usd=0.0)
    assert eco["provenance"] == "static-table"
    assert eco["evidence_urls"] == []
    assert eco["cost_per_1k_queries_usd"] == static["economics"]["cost_per_1k_queries_usd"]


def test_certificate_measured_spend_beats_live():
    live = _live_doc(rate_h100=0.50)  # absurdly cheap must not override spend
    dep = build_deployment_prescription(
        plan={"gpu_type": "H100"}, metrics={"count": 60},
        spend_usd=1.20, live_rates=live)
    eco = dep["economics"]
    assert eco["cost_per_1k_queries_usd"] == pytest.approx(round(1.20 / 60 * 1000.0, 4))
    assert eco["provenance"] == "static-table"
