"""Deterministic quality checks: JSON validity, schema, tool selection + args."""
from __future__ import annotations

import json


def check_json_valid(text: str) -> tuple[bool, dict | None]:
    try:
        return True, json.loads(text)
    except Exception:
        return False, None


def check_schema(obj: dict, schema: dict) -> bool:
    if not isinstance(obj, dict):
        return False
    for k, t in schema.items():
        if k not in obj:
            return False
        if t == "string" and not isinstance(obj[k], str):
            return False
        if t == "number" and not isinstance(obj[k], (int, float)):
            return False
    return True


def check_tool(obj: dict, expect_tool: str | None, expect_args: dict | None) -> tuple[bool, bool]:
    if expect_tool is None:
        return True, True
    if not isinstance(obj, dict):
        return False, False
    tool_ok = obj.get("tool") == expect_tool
    args = obj.get("arguments", {})
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
