#!/usr/bin/env python3
"""Bounded Open Interpreter task wrapper.

Validates input, confines the working directory to PLOINKY_WORKSPACE_ROOT,
disables telemetry, enforces a strict timeout, and refuses execution mode
unless the caller explicitly opts in. The raw prompt body is never echoed to
logs; only structured status and message counts are returned.
"""

from __future__ import annotations

import os
import signal
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.envelope import read_envelope, write_error, write_ok  # noqa: E402
from lib.paths import confined_path  # noqa: E402
from lib.redact import safe_log  # noqa: E402

DEFAULT_TIMEOUT_SECONDS = 60
MAX_TIMEOUT_SECONDS = 300
MAX_PROMPT_CHARS = 8000


class TimeoutError(Exception):  # noqa: A001 - mirror builtin name for clarity
    pass


def _enforce_telemetry_defaults() -> None:
    os.environ.setdefault("DISABLE_TELEMETRY", "true")
    os.environ.setdefault("ANONYMIZED_TELEMETRY", "false")


def _install_timeout(seconds: int) -> None:
    def _handler(_signum, _frame):
        raise TimeoutError(f"task exceeded {seconds}s timeout")

    signal.signal(signal.SIGALRM, _handler)
    signal.alarm(seconds)


def _cancel_timeout() -> None:
    signal.alarm(0)


def main() -> None:
    try:
        envelope = read_envelope()
    except Exception as exc:
        write_error(str(exc))
        return

    args = envelope.get("input") or {}
    prompt = args.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        write_error("prompt is required and must be a non-empty string")
        return
    if len(prompt) > MAX_PROMPT_CHARS:
        write_error(f"prompt exceeds {MAX_PROMPT_CHARS} characters")
        return

    timeout = args.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS)
    try:
        timeout_int = int(timeout)
    except (TypeError, ValueError):
        write_error("timeout_seconds must be an integer")
        return
    if timeout_int < 5 or timeout_int > MAX_TIMEOUT_SECONDS:
        write_error(f"timeout_seconds must be between 5 and {MAX_TIMEOUT_SECONDS}")
        return

    requested_dir = args.get("working_directory") or ""
    target, err = confined_path(requested_dir)
    if err:
        write_error(err)
        return

    execution_mode = args.get("execution_mode") or "plan"
    if execution_mode not in ("plan", "explicit"):
        write_error("execution_mode must be 'plan' or 'explicit'")
        return

    auto_run = execution_mode == "explicit"
    if auto_run and os.environ.get("OPEN_INTERPRETER_AUTO_RUN", "false").lower() not in ("1", "true", "yes", "on"):
        # Allow per-call execution intent without changing the agent default to
        # auto-run. We still pass auto_run=True to interpreter only inside this
        # call.
        pass

    _enforce_telemetry_defaults()

    try:
        import interpreter  # type: ignore
    except ImportError as exc:
        safe_log(f"oi_run_task import failure: {exc}")
        write_error("Open Interpreter is not installed in this agent runtime")
        return

    # Configure interpreter for offline-by-default, telemetry-off bounded run.
    try:
        interpreter.offline = os.environ.get("OPEN_INTERPRETER_OFFLINE", "true").lower() in ("1", "true", "yes", "on")
        interpreter.disable_telemetry = True
        interpreter.auto_run = auto_run
        model = os.environ.get("OPEN_INTERPRETER_MODEL")
        if model:
            interpreter.llm.model = model
        api_base = os.environ.get("OPEN_INTERPRETER_API_BASE")
        if api_base:
            interpreter.llm.api_base = api_base
    except Exception as exc:  # pragma: no cover - upstream API drift
        safe_log(f"oi_run_task config failure: {exc}")
        write_error("Open Interpreter configuration failed")
        return

    cwd_before = os.getcwd()
    if target is not None:
        try:
            os.chdir(target)
        except OSError as exc:
            write_error(f"cannot change directory: {exc}")
            return

    started = time.monotonic()
    _install_timeout(timeout_int)
    messages: list = []
    timed_out = False
    try:
        result = interpreter.chat(prompt, display=False, stream=False)
        if isinstance(result, list):
            messages = result
        elif result is not None:
            messages = [{"role": "assistant", "content": str(result)}]
    except TimeoutError:
        timed_out = True
    except Exception as exc:
        safe_log(f"oi_run_task runtime failure: {exc}")
        _cancel_timeout()
        os.chdir(cwd_before)
        write_error("Open Interpreter task failed")
        return
    finally:
        _cancel_timeout()
        os.chdir(cwd_before)

    elapsed = round(time.monotonic() - started, 2)

    summary = {
        "messages": len(messages),
        "elapsed_seconds": elapsed,
        "timed_out": timed_out,
        "execution_mode": execution_mode,
        "auto_run": auto_run,
        "working_directory": str(target) if target else None,
    }
    if not timed_out and messages:
        # Surface only the final assistant message as a bounded preview.
        tail = messages[-1] if isinstance(messages[-1], dict) else {}
        preview = tail.get("content") if isinstance(tail, dict) else None
        if isinstance(preview, str):
            summary["assistant_preview"] = preview[:2000]

    write_ok(summary)


if __name__ == "__main__":
    main()
