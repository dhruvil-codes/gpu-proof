"""Live endpoint benchmark client — real measured timings ONLY.

OpenAI-compatible ``POST {base_url}/chat/completions`` (non-streaming),
stdlib ``urllib`` only. Wall-clock is measured with ``time.perf_counter``;
``ttft_ms`` is the total elapsed time (documented approximation — without
streaming there is no first-token signal), ``itl_ms`` is elapsed/out_tokens.
Any HTTP/API failure raises ``RuntimeError``. This module NEVER simulates,
NEVER fabricates numbers, and NEVER falls back to canned metrics.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request


def normalize_base_url(base_url: str) -> str:
    """Strip trailing slashes; empty string raises (refuse to guess)."""
    base = (base_url or "").strip().rstrip("/")
    if not base:
        raise RuntimeError("endpoint base_url is empty; refusing to fabricate")
    return base


def chat_completions_url(base_url: str) -> str:
    """Join base URL to the chat-completions path (idempotent)."""
    base = normalize_base_url(base_url)
    if base.endswith("/chat/completions"):
        return base
    return base + "/chat/completions"


def build_chat_body(model: str, prompt: str, max_tokens: int = 256,
                    temperature: float = 0) -> dict:
    """Pure prompt/body builder (offline-testable, no I/O)."""
    if not (model or "").strip():
        raise RuntimeError("model is empty; refusing to send an unscoped request")
    if not (prompt or "").strip():
        raise RuntimeError("prompt is empty; refusing to send an empty request")
    mt = int(max_tokens)
    if mt <= 0 or mt > 16384:
        raise RuntimeError(f"max_tokens out of range: {max_tokens!r}")
    return {"model": model.strip(),
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": mt, "temperature": temperature, "stream": False}


def estimate_tokens(text: str) -> int:
    """Whitespace word-count estimate used ONLY when the API omits usage.

    Timings are always measured; this is a clearly-labelled fallback for
    token counts, never a substitute for measured latency.
    """
    if not text:
        return 0
    return max(1, len(text.split()))


def parse_chat_payload(payload: dict) -> tuple[str, int, int]:
    """Extract (text, tokens_in, tokens_out) from a chat-completions payload.

    Raises RuntimeError on API errors or malformed payloads — never returns
    placeholder text.
    """
    if not isinstance(payload, dict):
        raise RuntimeError("endpoint returned a non-object payload")
    if payload.get("error"):
        raise RuntimeError(f"endpoint API error: {payload['error']!r}"[:500])
    try:
        choice = payload["choices"][0]
        text = choice["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"endpoint payload missing choices/message/content: {e}") from e
    if not isinstance(text, str) or not text:
        raise RuntimeError("endpoint returned empty completion text")
    usage = payload.get("usage") or {}
    if "prompt_tokens" in usage and "completion_tokens" in usage:
        try:
            tokens_in = int(usage["prompt_tokens"])
            tokens_out = int(usage["completion_tokens"])
        except (TypeError, ValueError) as e:
            raise RuntimeError(f"endpoint usage block malformed: {e}") from e
    else:
        # No (or partial) usage block: prompt count patched by the caller
        # (which holds the original prompt); completion falls back to a
        # word-count estimate, clearly documented, never a timing fake.
        try:
            tokens_in = int(usage.get("prompt_tokens", 0))
        except (TypeError, ValueError) as e:
            raise RuntimeError(f"endpoint usage block malformed: {e}") from e
        if "completion_tokens" in usage:
            try:
                tokens_out = int(usage["completion_tokens"])
            except (TypeError, ValueError) as e:
                raise RuntimeError(f"endpoint usage block malformed: {e}") from e
        else:
            tokens_out = estimate_tokens(text)
    return text, max(0, tokens_in), max(0, tokens_out)


def compute_timing(elapsed_ms: float, tokens_out: int) -> tuple[float, float]:
    """(ttft_ms, itl_ms) from measured elapsed ms. Pure helper.

    Non-streaming: ttft == total elapsed (documented). itl = total/out_tokens.
    """
    if elapsed_ms < 0:
        raise RuntimeError(f"negative elapsed time: {elapsed_ms!r}")
    ttft = round(float(elapsed_ms), 2)
    itl = round(float(elapsed_ms) / max(1, int(tokens_out)), 2)
    return ttft, itl


def is_retryable_status(status: int | None) -> bool:
    """429 and 5xx are retryable; everything else (incl. None) is not."""
    if status is None:
        return False
    return status == 429 or 500 <= status <= 599


def parse_retry_after(value: str | None) -> float | None:
    """Parse a Retry-After header value (seconds). None when absent/invalid."""
    if value is None:
        return None
    try:
        secs = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if secs < 0 or secs > 300:
        return None
    return secs


def retry_delay_s(attempt: int, retry_after: float | None = None) -> float:
    """Exponential backoff 1/2/4s (capped at 8s), Retry-After wins when set."""
    if retry_after is not None:
        return retry_after
    return min(8.0, 1.0 * (2.0 ** max(0, int(attempt))))


class EndpointBench:
    """Non-streaming OpenAI-compatible benchmark client (stdlib urllib)."""

    def __init__(self, base_url: str, api_key: str = "", model: str = "",
                 timeout: int = 60, max_retries: int = 3) -> None:
        self.base_url = normalize_base_url(base_url)
        self.api_key = (api_key or "").strip()
        self.model = (model or "").strip()
        if not self.model:
            raise RuntimeError("model is empty; refusing to construct EndpointBench")
        self.timeout = int(timeout or 60)
        self.max_retries = max(0, int(max_retries))

    @property
    def url(self) -> str:
        return chat_completions_url(self.base_url)

    def complete(self, prompt: str, max_tokens: int = 256,
                 temperature: float = 0) -> dict:
        """POST one completion; return real measured timings.

        Returns ``{"text", "ttft_ms", "itl_ms", "tokens_in", "tokens_out"}``.
        Raises ``RuntimeError`` on any HTTP/API failure (after retries).
        """
        body = build_chat_body(self.model, prompt, max_tokens, temperature)
        # Snapshot prompt token estimate pre-flight for the no-usage fallback.
        prompt_estimate = estimate_tokens(prompt)
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        last_err: Exception | None = None
        for attempt in range(self.max_retries + 1):
            req = urllib.request.Request(
                self.url, data=json.dumps(body).encode(), headers=headers, method="POST")
            t0 = time.perf_counter()
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    raw = r.read().decode()
                    status = getattr(r, "status", 200)
            except urllib.error.HTTPError as e:
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                _ = elapsed_ms  # failed attempts contribute no timing sample
                try:
                    detail = e.read().decode()[:500]
                except Exception:
                    detail = str(e)[:200]
                if is_retryable_status(getattr(e, "code", None)) and attempt < self.max_retries:
                    hdrs = getattr(e, "headers", None)
                    ra = parse_retry_after(hdrs.get("Retry-After") if hdrs else None)
                    time.sleep(retry_delay_s(attempt, ra))
                    last_err = e
                    continue
                raise RuntimeError(
                    f"endpoint HTTP {getattr(e, 'code', '?')}: {detail}") from e
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                if attempt < self.max_retries:
                    time.sleep(retry_delay_s(attempt))
                    last_err = e
                    continue
                raise RuntimeError(f"endpoint connection failed: {e}") from e
            t1 = time.perf_counter()
            elapsed_ms = (t1 - t0) * 1000.0
            try:
                payload = json.loads(raw)
            except (ValueError, TypeError) as e:
                raise RuntimeError(f"endpoint returned invalid JSON: {e}") from e
            # Patch prompt estimate into the no-usage fallback path.
            if isinstance(payload, dict) and "usage" not in payload:
                payload = dict(payload)
            text, tokens_in, tokens_out = parse_chat_payload(payload)
            if tokens_in == 0:
                tokens_in = prompt_estimate
            ttft_ms, itl_ms = compute_timing(elapsed_ms, tokens_out)
            _ = status
            return {"text": text, "ttft_ms": ttft_ms, "itl_ms": itl_ms,
                    "tokens_in": tokens_in, "tokens_out": tokens_out}
        raise RuntimeError(f"endpoint failed after retries: {last_err}")
