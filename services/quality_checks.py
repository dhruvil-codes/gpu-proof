"""Deterministic quality checks: JSON validity, schema, tool selection + args."""
from __future__ import annotations

import json
import re


def check_json_valid(text: str) -> tuple[bool, dict | None]:
    if not text or not isinstance(text, str):
        return False, None
    raw = text.strip()
    # Strip <think>...</think> reasoning blocks from reasoning models
    raw = re.sub(r"<think>[\s\S]*?</think>", "", raw, flags=re.DOTALL).strip()

    # 1. Direct JSON parse
    try:
        return True, json.loads(raw)
    except Exception:
        pass

    # 2. Markdown code block extraction (```json ... ``` or ``` ... ```)
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw, re.DOTALL)
    if match:
        try:
            return True, json.loads(match.group(1).strip())
        except Exception:
            pass

    # 3. Outermost brace scan to recover embedded JSON
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return True, json.loads(raw[start : end + 1])
        except Exception:
            pass

    return False, None


def check_schema(obj: dict, schema: dict) -> bool:
    if not isinstance(obj, dict):
        return False
    for k, t in schema.items():
        if k not in obj:
            return False
        val = obj[k]
        if t == "string" and not isinstance(val, str):
            return False
        if t == "number" and not isinstance(val, (int, float)):
            return False
        if t == "boolean" and not isinstance(val, bool):
            return False
    return True


def check_tool(obj: dict, expect_tool: str | None, expect_args: dict | None) -> tuple[bool, bool]:
    if expect_tool is None:
        return True, True
    if not isinstance(obj, dict):
        return False, False
    actual_tool = obj.get("tool") or obj.get("name")
    tool_ok = bool(actual_tool and str(actual_tool).strip().lower() == expect_tool.strip().lower())
    args = obj.get("arguments") or obj.get("args") or obj.get("parameters") or {}
    args_ok = isinstance(args, dict) and all(args.get(k) == v for k, v in (expect_args or {}).items())
    return tool_ok, args_ok


def score_response(text: str, item: dict) -> dict:
    valid, obj = check_json_valid(text)
    schema_ok = check_schema(obj, item["expect_schema"]) if valid and item.get("expect_schema") else valid
    tool_ok, args_ok = check_tool(obj, item.get("expect_tool"), item.get("expect_args")) if valid else (False, False)
    if item.get("expect_tool") is None:
        quality = 1.0 if (valid and schema_ok) else 0.0
    else:
        quality = 1.0 if (valid and tool_ok and args_ok) else 0.0
    return {"json_valid": valid, "schema_ok": schema_ok, "tool_ok": tool_ok,
            "args_ok": args_ok, "quality": quality}
