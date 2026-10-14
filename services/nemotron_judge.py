"""Nemotron judge — live LLM scoring of tool-calling quality. No fallbacks.

Client order:
  1. Token Factory ``TOKENFACTORY_URL`` (default
     ``https://api.tokenfactory.nebius.com/v1``) with the explicit ``api_key``
     param, else ``NEBIUS_TF_KEY``, else ``NEBIUS_API_KEY`` (server .env compat).
  2. NVIDIA NIM ``https://integrate.api.nvidia.com/v1`` with ``NVIDIA_NIM_KEY``.
  3. Neither key present -> ``RuntimeError("no judge credentials")``.

A judge transport/parse failure raises ``RuntimeError`` — this module NEVER
returns a fabricated score. Default judge model ``"nemotron-3-nano-30b"`` is
configurable (``model`` param / ``JUDGE_MODEL`` env); the orchestrator must
verify live model IDs against the provider.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

TOKENFACTORY_DEFAULT_URL = "https://api.tokenfactory.nebius.com/v1"
NIM_URL = "https://integrate.api.nvidia.com/v1"
DEFAULT_JUDGE_MODEL = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"

JUDGE_SYSTEM = (
    "You are a strict tool-calling evaluator. Given the original prompt, "
    "the model's response text, and a description of the expected tool-call "
    "schema, judge whether the response selects the correct tool with correct "
    "arguments and valid JSON. Return ONLY strict JSON with exactly these keys: "
    '{"accuracy": <float 0..1>, "semantic_ok": <bool>, "detail": <string>}. '
    "accuracy 1.0 means a perfect tool call (right tool, right args, valid JSON); "
    "0.0 means completely wrong. semantic_ok is true only if the call would "
    "achieve the user's intent. detail is one short sentence. No other text."
)


def build_judge_messages(prompt: str, response_text: str, schema_desc: str,
                         task: str = "tool-calling") -> list[dict]:
    """Pure judge prompt builder (offline-testable, no I/O)."""
    if not (prompt or "").strip():
        raise RuntimeError("judge prompt is empty")
    if response_text is None or not str(response_text).strip():
        raise RuntimeError("judge response_text is empty; nothing to score")
    user = (
        f"task: {task}\n"
        f"expected schema: {(schema_desc or '').strip() or '(none provided)'}\n"
        f"original prompt:\n{prompt}\n"
        f"model response:\n{response_text}\n"
        "Score it now. Return ONLY the JSON object."
    )
    return [{"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": user}]


def clamp_accuracy(value: object) -> float:
    """Coerce to float and clamp to [0, 1]; raise on non-numeric."""
    try:
        f = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as e:
        raise RuntimeError(f"judge accuracy is not numeric: {value!r}") from e
    if f != f:  # NaN
        raise RuntimeError("judge accuracy is NaN")
    return max(0.0, min(1.0, f))


def coerce_bool(value: object) -> bool:
    """Coerce judge semantic_ok to bool; raise on uninterpretable values."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        s = value.strip().lower()
        if s in ("true", "yes", "1"):
            return True
        if s in ("false", "no", "0"):
            return False
    raise RuntimeError(f"judge semantic_ok is not boolean: {value!r}")


def extract_json_object(raw: str) -> dict:
    """Defensively extract the first {...} JSON object from raw judge output."""
    if not isinstance(raw, str) or not raw.strip():
        raise RuntimeError("judge returned empty output")
    text = raw.strip()
    # Strip markdown code fences if present.
    if text.startswith("```"):
        lines = text.splitlines()
        # drop opening fence (``` or ```json) and optional closing fence
        lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except (ValueError, TypeError):
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            obj = json.loads(text[start:end + 1])
            if isinstance(obj, dict):
                return obj
        except (ValueError, TypeError):
            pass
    raise RuntimeError(f"judge returned invalid JSON: {raw[:300]!r}")


def parse_judge_content(raw: str) -> dict:
    """Parse raw judge text -> {accuracy, semantic_ok, detail}. Raises on failure."""
    obj = extract_json_object(raw)
    if "accuracy" not in obj or "semantic_ok" not in obj:
        raise RuntimeError(f"judge JSON missing required keys: {sorted(obj)}")
    detail = obj.get("detail", "")
    if not isinstance(detail, str):
        detail = str(detail)
    return {"accuracy": clamp_accuracy(obj["accuracy"]),
            "semantic_ok": coerce_bool(obj["semantic_ok"]),
            "detail": detail.strip()[:2000]}


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


def resolve_judge_config(model: str | None = None,
                         api_key: str | None = None) -> dict:
    """Resolve judge transport without I/O. Raises 'no judge credentials'.

    Order: explicit key / NEBIUS_TF_KEY / NEBIUS_API_KEY -> Token Factory;
    else NVIDIA_NIM_KEY -> NIM; else RuntimeError.
    """
    wanted = (model or "").strip() or os.environ.get("JUDGE_MODEL", "").strip() \
        or DEFAULT_JUDGE_MODEL
    tf_key = ((api_key or "").strip()
              or os.environ.get("NEBIUS_TF_KEY", "").strip()
              or os.environ.get("NEBIUS_API_KEY", "").strip())
    if tf_key:
        base = os.environ.get("TOKENFACTORY_URL", "").strip() or TOKENFACTORY_DEFAULT_URL
        return {"base_url": base.rstrip("/"), "api_key": tf_key,
                "model": wanted, "source": "tokenfactory"}
    nim_key = os.environ.get("NVIDIA_NIM_KEY", "").strip()
    if nim_key:
        return {"base_url": NIM_URL, "api_key": nim_key,
                "model": wanted, "source": "nim"}
    raise RuntimeError("no judge credentials")


def _post_chat(base_url: str, key: str, model: str, messages: list[dict],
               timeout: int = 60, max_retries: int = 3) -> str:
    """POST one chat completion, return raw content string. 429/5xx retried."""
    body = {"model": model, "messages": messages, "temperature": 0,
            "response_format": {"type": "json_object"}}
    last_err: Exception | None = None
    for attempt in range(max(0, int(max_retries)) + 1):
        req = urllib.request.Request(
            base_url.rstrip("/") + "/chat/completions",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {key}"},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                payload = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode()[:500]
            except Exception:
                detail = str(e)[:200]
            if is_retryable_status(getattr(e, "code", None)) and attempt < max_retries:
                hdrs = getattr(e, "headers", None)
                ra = parse_retry_after(hdrs.get("Retry-After") if hdrs else None)
                time.sleep(retry_delay_s(attempt, ra))
                last_err = e
                continue
            raise RuntimeError(f"judge HTTP {getattr(e, 'code', '?')}: {detail}") from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            if attempt < max_retries:
                time.sleep(retry_delay_s(attempt))
                last_err = e
                continue
            raise RuntimeError(f"judge connection failed: {e}") from e
        try:
            return str(payload["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError) as e:
            raise RuntimeError(f"judge payload malformed: {e}") from e
    raise RuntimeError(f"judge failed after retries: {last_err}")


def score_tool_call(prompt: str, response_text: str, schema_desc: str,
                    task: str = "tool-calling", model: str | None = None,
                    api_key: str | None = None, timeout: int = 60) -> dict:
    """Live Nemotron judge score. Raises RuntimeError when unavailable/invalid.

    Returns ``{"accuracy": float 0..1, "semantic_ok": bool, "detail": str,
    "model": str, "source": "tokenfactory"|"nim"}``. Never fabricates a score.
    """
    cfg = resolve_judge_config(model=model, api_key=api_key)
    messages = build_judge_messages(prompt, response_text, schema_desc, task)
    raw = _post_chat(cfg["base_url"], cfg["api_key"], cfg["model"], messages,
                     timeout=timeout)
    parsed = parse_judge_content(raw)
    return {**parsed, "model": cfg["model"], "source": cfg["source"]}
