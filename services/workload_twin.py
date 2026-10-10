"""Workload twin — deterministic seeded synthetic dataset (tool_calling + structured_output)."""
from __future__ import annotations

import hashlib
import json
import random

TASKS = ("tool_calling", "structured_output")
TOOLS = [
    {"name": "get_price", "args": {"symbol": "NVDA"}},
    {"name": "search_docs", "args": {"query": "vLLM FP8 H100"}},
    {"name": "create_ticket", "args": {"priority": "high", "team": "infra"}},
]


def build_twin(seed: int = 42, n: int = 200, tasks: tuple = TASKS) -> dict:
    rng = random.Random(seed)
    items = []
    for i in range(n):
        task = tasks[i % len(tasks)]
        tool = TOOLS[i % len(TOOLS)]
        items.append({
            "id": f"req-{i:04d}",
            "task": task,
            "prompt": f"[{task}] case {i}: use {tool['name']} with {json.dumps(tool['args'])}; reply JSON only.",
            "expect_tool": tool["name"] if task == "tool_calling" else None,
            "expect_args": tool["args"] if task == "tool_calling" else None,
            "expect_schema": {"answer": "string", "confidence": "number"} if task == "structured_output" else None,
            "input_tokens": 120 + (i * 7) % 380,
            "expect_output_tokens": 40 + (i * 13) % 160,
        })
    digest = hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest()[:16]
    return {"seed": seed, "count": n, "digest": digest, "items": items, "rng_note": f"seeded {rng.random():.4f}"}
