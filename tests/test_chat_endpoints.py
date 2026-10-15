"""Offline tests for the live chat mapping (no network, no keys)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from apps.api.app.main import MODEL_ENDPOINTS


def test_all_mapped_endpoints_have_provider_and_model():
    assert len(MODEL_ENDPOINTS) >= 4
    for slug, route in MODEL_ENDPOINTS.items():
        assert "/" in slug, slug
        assert route["provider"] in ("tokenfactory", "nim"), slug
        assert route["model"].strip(), slug


def test_pinned_flagship_mapped():
    assert MODEL_ENDPOINTS["Qwen/Qwen3.8-27B"]["provider"] == "tokenfactory"


def test_unknown_slug_unmapped():
    assert "meta-llama/Llama-3.3-70B-Instruct" not in MODEL_ENDPOINTS
