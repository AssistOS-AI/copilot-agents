#!/usr/bin/env python3
"""Open Interpreter status tool.

Reports whether the upstream package is importable, the configured topology,
the telemetry posture, and the durable-data root. Never emits raw prompts,
provider keys, or operator secrets.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.envelope import read_envelope, write_error, write_ok  # noqa: E402
from lib.paths import workspace_root  # noqa: E402
from lib.redact import safe_log  # noqa: E402


def _bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.lower() in ("1", "true", "yes", "y", "on")


def main() -> None:
    try:
        read_envelope()  # consume to keep stdin pipe well-formed
    except Exception as exc:
        write_error(str(exc))
        return

    spec = importlib.util.find_spec("interpreter")
    interpreter_installed = spec is not None
    version: str | None = None
    if interpreter_installed:
        try:
            import interpreter  # type: ignore  # noqa: WPS433

            version = getattr(interpreter, "__version__", None)
        except Exception as exc:  # pragma: no cover - import failure surface
            safe_log(f"oi_status import failure: {exc}")
            interpreter_installed = False

    root = workspace_root()

    payload = {
        "agent": "openInterpreterAgent",
        "interpreter": {
            "installed": interpreter_installed,
            "version": version,
        },
        "telemetry": {
            "disabled": _bool("DISABLE_TELEMETRY", default=True),
            "anonymized_disabled": _bool("ANONYMIZED_TELEMETRY", default=False) is False,
        },
        "config": {
            "model": os.environ.get("OPEN_INTERPRETER_MODEL") or None,
            "api_base": os.environ.get("OPEN_INTERPRETER_API_BASE") or None,
            "offline": _bool("OPEN_INTERPRETER_OFFLINE", default=True),
            "auto_run": _bool("OPEN_INTERPRETER_AUTO_RUN", default=False),
        },
        "paths": {
            "workspace_root": str(root) if root else None,
            "data_root": "/data",
        },
    }
    write_ok(payload)


if __name__ == "__main__":
    main()
