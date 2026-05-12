"""Log redaction for the openInterpreterAgent.

Tool wrappers MUST route operator-visible diagnostics through `safe_log` so
provider credentials, invocation tokens, and raw prompt bodies are not leaked
to logs.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Iterable

_DEFAULT_KEYS = (
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPEN_INTERPRETER_API_KEY",
    "PLOINKY_DERIVED_MASTER_KEY",
    "PLOINKY_MASTER_KEY",
    "PLOINKY_INVOCATION_JWT",
)

_TOKEN_PATTERN = re.compile(
    r"(?i)(bearer|jwt|token|api[_-]?key)[\s:=]+[A-Za-z0-9._\-]{4,}"
)


def _secret_values(env_keys: Iterable[str]) -> list[str]:
    secrets: list[str] = []
    for key in env_keys:
        val = os.environ.get(key)
        if val and len(val) >= 8:
            secrets.append(val)
    return secrets


def redact(text: str, extra_secrets: Iterable[str] | None = None) -> str:
    if not text:
        return ""
    redacted = str(text)
    for secret in _secret_values(_DEFAULT_KEYS):
        redacted = redacted.replace(secret, "[REDACTED]")
    if extra_secrets:
        for secret in extra_secrets:
            if secret and len(str(secret)) >= 4:
                redacted = redacted.replace(str(secret), "[REDACTED]")
    redacted = _TOKEN_PATTERN.sub(r"\1=[REDACTED]", redacted)
    return redacted


def safe_log(message: str, *, extra_secrets: Iterable[str] | None = None) -> None:
    """Write a redacted diagnostic line to stderr (never stdout)."""
    sys.stderr.write(redact(message, extra_secrets=extra_secrets) + "\n")
