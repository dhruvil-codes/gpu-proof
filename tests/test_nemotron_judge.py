"""Offline unit tests for services/nemotron_judge.py. No network."""
import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import nemotron_judge as nj


# --- recorded fixtures (authored, never fetched) ------------------------------

JUDGE_OK_RAW = json.dumps({"accuracy": 1.0, "semantic_ok": True,
                            "detail": "Correct tool and args, valid JSON."})

JUDGE_FENCED_RAW = ("```json\n" + json.dumps(
    {"accuracy": 0.5, "semantic_ok": False,
     "detail": "Right tool, wrong symbol arg."}) + "\n```")

JUDGE_PREFACED_RAW = ("Here is my evaluation: " + json.dumps(
    {"accuracy": 0.0, "semantic_ok": False,
     "detail": "Chose the wrong tool entirely."}) + " thanks.")

KEYS = ("NEBIUS_TF_KEY", "NEBIUS_API_KEY", "NVIDIA_NIM_KEY",
        "TOKENFACTORY_URL", "JUDGE_MODEL")


def _clear_env(monkeypatch):
    for k in KEYS:
        monkeypatch.delenv(k, raising=False)


# --- prompt builder ------------------------------------------------------------

def test_build_messages_has_strict_json_instruction():
    msgs = nj.build_judge_messages("get NVDA price",
                                   '{"tool": "get_price"}',
                                   '{"tool": "string"}')
    assert msgs[0]["role"] == "system"
    assert "accuracy" in msgs[0]["content"] and "semantic_ok" in msgs[0]["content"]
    assert "ONLY" in msgs[0]["content"] and "JSON" in msgs[0]["content"]
    assert "get NVDA price" in msgs[1]["content"]
    assert "tool-calling" in msgs[1]["content"]


def test_build_messages_rejects_empty():
    with pytest.raises(RuntimeError):
        nj.build_judge_messages("  ", "resp", "schema")
    with pytest.raises(RuntimeError):
        nj.build_judge_messages("prompt", "   ", "schema")


# --- parsing -------------------------------------------------------------------

def test_parse_valid():
    out = nj.parse_judge_content(JUDGE_OK_RAW)
    assert out == {"accuracy": 1.0, "semantic_ok": True,
                   "detail": "Correct tool and args, valid JSON."}


def test_parse_fenced_and_prefaced():
    assert nj.parse_judge_content(JUDGE_FENCED_RAW)["accuracy"] == 0.5
    assert nj.parse_judge_content(JUDGE_PREFACED_RAW)["accuracy"] == 0.0


def test_parse_invalid_raises_never_fabricates():
    for bad in ["", "no json here", '{"accuracy": 0.5}', "[1,2,3]",
                json.dumps({"accuracy": "high", "semantic_ok": True})]:
        with pytest.raises(RuntimeError):
            nj.parse_judge_content(bad)


def test_clamp_and_coerce():
    assert nj.clamp_accuracy(1.5) == 1.0
    assert nj.clamp_accuracy(-0.2) == 0.0
    assert nj.clamp_accuracy("0.75") == 0.75
    with pytest.raises(RuntimeError):
        nj.clamp_accuracy("high")
    assert nj.coerce_bool(True) is True and nj.coerce_bool("false") is False
    with pytest.raises(RuntimeError):
        nj.coerce_bool("maybe")


def test_retry_helpers():
    assert nj.is_retryable_status(429) and nj.is_retryable_status(500)
    assert not nj.is_retryable_status(400) and not nj.is_retryable_status(None)
    assert nj.parse_retry_after("2") == 2.0
    assert nj.parse_retry_after("nope") is None
    assert nj.retry_delay_s(1) == 2.0 and nj.retry_delay_s(0, 0.5) == 0.5


# --- credential resolution -------------------------------------------------------

def test_tokenfactory_preferred(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("NEBIUS_TF_KEY", "tf-key")
    monkeypatch.setenv("NVIDIA_NIM_KEY", "nim-key")
    cfg = nj.resolve_judge_config()
    assert cfg["source"] == "tokenfactory" and cfg["api_key"] == "tf-key"
    assert cfg["base_url"] == nj.TOKENFACTORY_DEFAULT_URL
    assert cfg["model"] == nj.DEFAULT_JUDGE_MODEL


def test_tokenfactory_custom_url_and_model(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("NEBIUS_TF_KEY", "tf-key")
    monkeypatch.setenv("TOKENFACTORY_URL", "https://custom.example/v1/")
    cfg = nj.resolve_judge_config(model="my-judge-v2")
    assert cfg["base_url"] == "https://custom.example/v1"
    assert cfg["model"] == "my-judge-v2"


def test_nim_fallback(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("NVIDIA_NIM_KEY", "nim-key")
    cfg = nj.resolve_judge_config()
    assert cfg["source"] == "nim" and cfg["base_url"] == nj.NIM_URL


def test_no_credentials_raises(monkeypatch):
    _clear_env(monkeypatch)
    with pytest.raises(RuntimeError, match="no judge credentials"):
        nj.resolve_judge_config()
    with pytest.raises(RuntimeError, match="no judge credentials"):
        nj.score_tool_call("p", "r", "s")


def test_explicit_key_wins(monkeypatch):
    _clear_env(monkeypatch)
    cfg = nj.resolve_judge_config(api_key="explicit")
    assert cfg["api_key"] == "explicit" and cfg["source"] == "tokenfactory"


# --- score_tool_call with stubbed transport ---------------------------------------

def test_score_tool_call_live_path_stubbed(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("NEBIUS_TF_KEY", "tf-key")
    monkeypatch.setattr(nj, "_post_chat", lambda *a, **k: JUDGE_OK_RAW)
    out = nj.score_tool_call("get NVDA price", '{"tool": "get_price"}',
                             '{"tool": "string"}')
    assert out["accuracy"] == 1.0 and out["semantic_ok"] is True
    assert "detail" in out and out["source"] == "tokenfactory"


def test_score_tool_call_bad_judge_json_raises(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("NEBIUS_TF_KEY", "tf-key")
    monkeypatch.setattr(nj, "_post_chat", lambda *a, **k: "not json")
    with pytest.raises(RuntimeError):
        nj.score_tool_call("p", "r", "s")


def test_post_chat_retries_429(monkeypatch):
    _clear_env(monkeypatch)
    ok_body = json.dumps({"choices": [{"message": {"content": JUDGE_OK_RAW}}]})

    class _FakeResp:
        def read(self):
            return ok_body.encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    err = urllib.error.HTTPError("http://x", 429, "slow down", {},
                                 io.BytesIO(b"busy"))
    calls = {"n": 0}

    def _fake(req, timeout=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise err
        return _FakeResp()

    monkeypatch.setattr(nj.urllib.request, "urlopen", _fake)
    monkeypatch.setattr(nj.time, "sleep", lambda s: None)
    raw = nj._post_chat("https://x/v1", "k", "m", [{"role": "user", "content": "x"}])
    assert calls["n"] == 2 and json.loads(raw)["accuracy"] == 1.0
