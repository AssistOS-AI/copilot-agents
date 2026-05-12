"""Path confinement helpers for the openInterpreterAgent."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Optional, Tuple


_FORBIDDEN = re.compile(r"\x00")


def workspace_root() -> Optional[Path]:
    root = os.environ.get("PLOINKY_WORKSPACE_ROOT")
    if not root:
        return None
    try:
        return Path(root).resolve(strict=False)
    except OSError:
        return None


def confined_path(candidate: str) -> Tuple[Optional[Path], Optional[str]]:
    """Resolve `candidate` against the workspace root with confinement checks.

    Returns a tuple of (resolved_path, error_message). Either field is None on
    success/failure as appropriate. Symlink escapes, null bytes, and traversal
    outside the workspace root cause an error.
    """
    if candidate is None:
        candidate = ""
    if not isinstance(candidate, str):
        return None, "working_directory must be a string"
    if _FORBIDDEN.search(candidate):
        return None, "working_directory contains null bytes"

    root = workspace_root()
    if root is None:
        return None, "PLOINKY_WORKSPACE_ROOT is not set"

    target = (root / candidate).resolve() if candidate else root
    try:
        target.relative_to(root)
    except ValueError:
        return None, "working_directory escapes workspace root"

    if target.exists():
        # Resolve any symlinks to catch symlink-escape cases.
        try:
            real_target = target.resolve(strict=True)
            real_target.relative_to(root.resolve(strict=False))
        except (ValueError, OSError):
            return None, "working_directory resolves outside workspace root"
    return target, None
