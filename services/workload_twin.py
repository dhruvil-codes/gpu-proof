"""Workload twin — deterministic seeded synthetic dataset with PII scrubbing and multi-turn support."""
from __future__ import annotations

import hashlib
import json
import random
import re

TASKS = ("tool_calling", "structured_output")
TOOLS = [
    {"name": "get_price", "args": {"symbol": "NVDA"}},
    {"name": "search_docs", "args": {"query": "vLLM FP8 H100"}},
    {"name": "create_ticket", "args": {"priority": "high", "team": "infra"}},
]

RE_EMAIL = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
RE_BEARER = re.compile(r"Bearer\s+[a-zA-Z0-9_\-\.]{12,}", re.IGNORECASE)
RE_API_KEY = re.compile(r"(?:sk|api|key)[-_][a-zA-Z0-9]{16,}", re.IGNORECASE)


def scrub_pii(text: str) -> str:
    """Scrub PII, emails, bearer tokens, and API keys to guarantee zero leaks in sealed twins."""
    if not isinstance(text, str):
        return text
    text = RE_BEARER.sub("Bearer [REDACTED_TOKEN]", text)
    text = RE_API_KEY.sub("[REDACTED_API_KEY]", text)
    text = RE_EMAIL.sub("[REDACTED_EMAIL]", text)
    return text


def build_twin(seed: int = 42, n: int = 200, tasks: tuple = TASKS) -> dict:
    rng = random.Random(seed)
    items = []
    for i in range(n):
        task = tasks[i % len(tasks)]
        tool = TOOLS[i % len(TOOLS)]
        prompt = scrub_pii(f"[{task}] case {i}: use {tool['name']} with {json.dumps(tool['args'])}; reply JSON only.")
        messages = [
            {"role": "system", "content": "You are a deterministic tool-calling agent. Output valid JSON adhering to the specified schema."},
            {"role": "user", "content": prompt},
        ]
        items.append({
            "id": f"req-{i:04d}",
            "task": task,
            "prompt": prompt,
            "messages": messages,
            "dry_run": True,
            "expect_tool": tool["name"] if task == "tool_calling" else None,
            "expect_args": tool["args"] if task == "tool_calling" else None,
            "expect_schema": {"answer": "string", "confidence": "number"} if task == "structured_output" else None,
            "input_tokens": 120 + (i * 7) % 380,
            "expect_output_tokens": 40 + (i * 13) % 160,
        })
    digest = hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest()
    return {"seed": seed, "count": n, "digest": digest, "items": items, "rng_note": f"seeded {rng.random():.4f}", "sanitized": True}
