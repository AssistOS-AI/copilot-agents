#!/usr/bin/env python3
"""Open Interpreter shim executed inside the provider-local bwrap sandbox.

The shim is shipped as part of the openInterpreterAgent runtime. It is copied
into /runtime/bin/ during runtime preparation and invoked inside the inner
bwrap sandbox started locally by openInterpreterAgent. Telemetry is forced
off, auto-run is disabled, and a missing model/provider configuration is
reported as a natural-language message instead of a Python traceback so the
chat surface can relay it back to the user.
"""

from __future__ import annotations

import os
import sys
import json
from pathlib import Path

DEFAULT_PROMPT_PATH = "/work/prompt.md"
DEFAULT_CONFIG_PATH = "/work/config/open-interpreter.json"


def emit(message: str) -> None:
    print(str(message or "").strip())


def as_bool(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on", "y")


def model_is_configured(config: dict[str, object]) -> bool:
    if config.get("model"):
        return True
    if config.get("api_base"):
        return True
    if config.get("local"):
        return True
    return False


def read_prompt(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        emit(
            "Open Interpreter could not find the staged prompt at "
            f"{path}. The relay did not pass a prompt to the sandbox."
        )
        return None
    except OSError as exc:
        emit(f"Open Interpreter could not read the staged prompt: {exc}.")
        return None


def read_config(path: Path) -> dict[str, object]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError) as exc:
        emit(f"Open Interpreter could not read its staged runtime config: {exc}.")
        return {}
    if not isinstance(parsed, dict):
        emit("Open Interpreter staged runtime config is not an object.")
        return {}
    return parsed


def main() -> int:
    os.environ["DISABLE_TELEMETRY"] = "true"
    os.environ.setdefault("ANONYMIZED_TELEMETRY", "false")

    prompt_path = Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PROMPT_PATH)
    config_path = Path(sys.argv[2] if len(sys.argv) > 2 else DEFAULT_CONFIG_PATH)
    prompt = read_prompt(prompt_path)
    if prompt is None:
        return 0
    config = read_config(config_path)

    if not model_is_configured(config):
        emit(
            "Open Interpreter is installed in the runtime bundle, but no model "
            "or local endpoint is configured for this workspace. Set "
            "OPEN_INTERPRETER_MODEL (and OPEN_INTERPRETER_API_BASE for a local "
            "credentialless endpoint) on the openInterpreterAgent before "
            "re-running the task. Provider API keys are intentionally not "
            "forwarded into the sandbox."
        )
        return 0

    try:
        from interpreter import interpreter  # type: ignore
    except Exception as exc:  # pragma: no cover - exercised via the missing-bundle test path
        emit(
            "Open Interpreter is registered, but the runtime bundle does not "
            "contain the open-interpreter Python package. Ask the operator to "
            f"re-run the prepare_runtime tool. Details: {exc}."
        )
        return 0

    try:
        interpreter.offline = as_bool(config.get("offline"), True)
        interpreter.auto_run = False
        interpreter.disable_telemetry = True
        model = config.get("model")
        if model:
            interpreter.llm.model = str(model)
        api_base = config.get("api_base")
        if api_base:
            interpreter.llm.api_base = str(api_base)
    except Exception as exc:  # pragma: no cover - upstream API drift
        emit(f"Open Interpreter configuration failed: {exc}.")
        return 0

    try:
        messages = interpreter.chat(prompt, display=False, stream=False)
    except Exception as exc:
        emit(
            "Open Interpreter started but could not complete the task: "
            f"{exc}. Verify the configured model/provider and that the local "
            "endpoint is reachable from the sandbox runtime."
        )
        return 0

    if isinstance(messages, list) and messages:
        tail = messages[-1]
        if isinstance(tail, dict):
            content = tail.get("content")
            if isinstance(content, str) and content.strip():
                emit(content)
                return 0

    emit("Open Interpreter finished without a natural-language response.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
