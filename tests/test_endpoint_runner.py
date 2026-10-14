"""Offline unit tests for services/endpoint_runner.py. No network."""
import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import endpoint_runner as er


# --- recorded fixtures (authored, never fetched) ----------------------------

RECORDED_OK = {
    "id": "chatcmpl-fixture-001",
    "object": "chat.completion",
    "choices": [{"index": 0, "message": {
        "role": "assistant",
        "content": '{"tool": "get_price", "arguments": {"symbol": "NVDA"}}'},
        "finish_reason": "stop"}],
    "usage": {"prompt_tokens": 42, "completion_tokens": 18, "total_tokens": 60},
}

RECORDED_NO_USAGE = {
    "choices": [{"message": {"role": "assistant", "content": "hello world foo bar"},
                 "finish_reason": "stop"}],
}

RECORDED_API_ERROR = {"error": {"message": "model not found", "code": 404}}


class _FakeResp:
    def __init__(self, payload: dict, status: int = 200):
        self._body = json.dumps(payload).encode()
        self.status = status

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _patch_urlopen(monkeypatch, script):
    """script: list of _FakeResp | Exception, consumed in order."""
    calls = {"n": 0}

    def _fake(req, timeout=None):
        item = script[min(calls["n"], len(script) - 1)]
        calls["n"] += 1
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(er.urllib.request, "urlopen", _fake)
    monkeypatch.setattr(er.time, "sleep", lambda s: None)
    return calls


def _http_error(code, body="overloaded", retry_after=None):
    hdrs = {"Retry-After": retry_after} if retry_after else {}
    return urllib.error.HTTPError("http://x/v1/chat/completions", code,
                                  f"HTTP {code}", hdrs, io.BytesIO(body.encode()))


# --- pure helpers ------------------------------------------------------------

def test_url_join_idempotent():
    assert er.chat_completions_url("https://h/v1/") == "https://h/v1/chat/completions"
    assert er.chat_completions_url("https://h/v1/chat/completions") == \
        "https://h/v1/chat/completions"


def test_url_empty_refuses():
    with pytest.raises(RuntimeError):
        er.chat_completions_url("  ")


def test_build_body_ok_and_validation():
    b = er.build_chat_body("m", "hi", max_tokens=10, temperature=0)
    assert b["model"] == "m" and b["messages"][0]["content"] == "hi"
    assert b["stream"] is False
    with pytest.raises(RuntimeError):
        er.build_chat_body("", "hi")
    with pytest.raises(RuntimeError):
        er.build_chat_body("m", "   ")
    with pytest.raises(RuntimeError):
        er.build_chat_body("m", "hi", max_tokens=0)


def test_parse_payload_with_usage():
    text, ti, to = er.parse_chat_payload(RECORDED_OK)
    assert text.startswith('{"tool"') and (ti, to) == (42, 18)


def test_parse_payload_no_usage_falls_back():
    text, ti, to = er.parse_chat_payload(RECORDED_NO_USAGE)
    assert text == "hello world foo bar" and ti == 0 and to == 4


def test_parse_payload_errors_raise():
    with pytest.raises(RuntimeError):
        er.parse_chat_payload(RECORDED_API_ERROR)
    with pytest.raises(RuntimeError):
        er.parse_chat_payload({"choices": []})
    with pytest.raises(RuntimeError):
        er.parse_chat_payload({"choices": [{"message": {"content": ""}}]})
    with pytest.raises(RuntimeError):
        er.parse_chat_payload("not-a-dict")


def test_compute_timing():
    ttft, itl = er.compute_timing(500.0, 10)
    assert (ttft, itl) == (500.0, 50.0)
    _, itl0 = er.compute_timing(500.0, 0)
    assert itl0 == 500.0  # /max(1,0), no ZeroDivision
    with pytest.raises(RuntimeError):
        er.compute_timing(-1.0, 5)


def test_retry_helpers():
    assert er.is_retryable_status(429) and er.is_retryable_status(503)
    assert not er.is_retryable_status(400) and not er.is_retryable_status(200)
    assert not er.is_retryable_status(None)
    assert er.parse_retry_after("3") == 3.0
    assert er.parse_retry_after("junk") is None
    assert er.parse_retry_after(None) is None
    assert er.retry_delay_s(0, 2.5) == 2.5
    assert er.retry_delay_s(0) == 1.0 and er.retry_delay_s(2) == 4.0
    assert er.retry_delay_s(99) == 8.0


# --- complete() with stubbed transport ---------------------------------------

def test_complete_success_measured(monkeypatch):
    _patch_urlopen(monkeypatch, [_FakeResp(RECORDED_OK)])
    times = iter([100.0, 100.5])  # 500 ms wall clock
    monkeypatch.setattr(er.time, "perf_counter", lambda: next(times))
    bench = er.EndpointBench("https://h/v1", api_key="k", model="m")
    out = bench.complete("What is the price of NVDA?")
    assert out["text"].startswith('{"tool"')
    assert out["ttft_ms"] == 500.0
    assert out["itl_ms"] == round(500.0 / 18, 2)
    assert (out["tokens_in"], out["tokens_out"]) == (42, 18)


def test_complete_retries_429_then_succeeds(monkeypatch):
    calls = _patch_urlopen(monkeypatch,
                           [_http_error(429, retry_after="1"), _FakeResp(RECORDED_OK)])
    times = iter([10.0, 10.1, 20.0, 20.4])
    monkeypatch.setattr(er.time, "perf_counter", lambda: next(times))
    bench = er.EndpointBench("https://h/v1", model="m", max_retries=2)
    out = bench.complete("hi")
    assert calls["n"] == 2 and out["tokens_out"] == 18


def test_complete_429_exhausted_raises(monkeypatch):
    _patch_urlopen(monkeypatch, [_http_error(429)])
    bench = er.EndpointBench("https://h/v1", model="m", max_retries=1)
    with pytest.raises(RuntimeError, match="[Rr]etry|429|failed"):
        bench.complete("hi")


def test_complete_400_raises_no_retry(monkeypatch):
    calls = _patch_urlopen(monkeypatch, [_http_error(400, "bad request")])
    bench = er.EndpointBench("https://h/v1", model="m", max_retries=3)
    with pytest.raises(RuntimeError, match="400"):
        bench.complete("hi")
    assert calls["n"] == 1


def test_complete_invalid_json_raises(monkeypatch):
    class _Bad:
        status = 200

        def read(self):
            return b"<html>not json</html>"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    _patch_urlopen(monkeypatch, [_Bad()])
    bench = er.EndpointBench("https://h/v1", model="m", max_retries=0)
    with pytest.raises(RuntimeError, match="invalid JSON"):
        bench.complete("hi")


def test_bench_requires_model():
    with pytest.raises(RuntimeError):
        er.EndpointBench("https://h/v1", model="  ")
