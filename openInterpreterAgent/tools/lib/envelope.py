"""Tool I/O envelope helpers for the openInterpreterAgent.

Ploinky mounts each agent directory at /code. Helpers live agent-local so the
tool wrappers do not depend on a shared workspace tree.
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, Optional


def read_envelope() -> Dict[str, Any]:
    """Read and normalize the Ploinky MCP tool envelope from stdin."""
    raw = sys.stdin.read().strip()
    if not raw:
        return {"tool": "", "input": {}, "metadata": {}}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON envelope on stdin: {exc}") from exc

    return _normalize(parsed)


def _normalize(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        return {"tool": "", "input": {}, "metadata": {}}

    tool = value.get("tool", "")
    if not isinstance(tool, str):
        tool = ""

    metadata = value.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}

    tool_input = value.get("input")
    if isinstance(tool_input, dict):
        if (
            "input" in tool_input
            and isinstance(tool_input["input"], dict)
            and len(tool_input) == 1
        ):
            tool_input = tool_input["input"]
    elif isinstance(tool_input, str):
        try:
            parsed = json.loads(tool_input)
            tool_input = parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            tool_input = {}
    else:
        tool_input = {}

    return {"tool": tool, "input": tool_input, "metadata": metadata}


def write_ok(payload: Optional[Dict[str, Any]] = None) -> None:
    body: Dict[str, Any] = {"ok": True}
    if payload:
        for key, val in payload.items():
            if key != "ok":
                body[key] = val
    sys.stdout.write(json.dumps(body, separators=(",", ":")))


def write_error(message: str, extras: Optional[Dict[str, Any]] = None) -> None:
    body: Dict[str, Any] = {"ok": False, "error": str(message or "unknown error")}
    if extras:
        for key, val in extras.items():
            if key not in ("ok", "error"):
                body[key] = val
    sys.stdout.write(json.dumps(body, separators=(",", ":")))
