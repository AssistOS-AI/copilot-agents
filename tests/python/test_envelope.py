"""Unit tests for the openInterpreterAgent envelope, path, and redaction helpers."""

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "openInterpreterAgent" / "tools"))

from lib.envelope import _normalize, write_error, write_ok  # noqa: E402
from lib.paths import confined_path, workspace_root  # noqa: E402
from lib.redact import redact  # noqa: E402


class EnvelopeTests(unittest.TestCase):
    def test_normalize_returns_defaults_for_invalid(self):
        self.assertEqual(_normalize(None), {"tool": "", "input": {}, "metadata": {}})
        self.assertEqual(_normalize("garbage"), {"tool": "", "input": {}, "metadata": {}})

    def test_normalize_passes_through_explicit_input(self):
        result = _normalize({"tool": "oi_status", "input": {"prompt": "hi"}})
        self.assertEqual(result["tool"], "oi_status")
        self.assertEqual(result["input"], {"prompt": "hi"})

    def test_normalize_unwraps_single_key_nested_input(self):
        result = _normalize({"input": {"input": {"prompt": "hi"}}})
        self.assertEqual(result["input"], {"prompt": "hi"})

    def test_normalize_parses_string_input_as_json(self):
        result = _normalize({"input": '{"a": 1}'})
        self.assertEqual(result["input"], {"a": 1})


class WriteHelperTests(unittest.TestCase):
    def setUp(self):
        self.original = sys.stdout
        self.buffer = io.StringIO()
        sys.stdout = self.buffer

    def tearDown(self):
        sys.stdout = self.original

    def test_write_ok_includes_payload(self):
        write_ok({"foo": "bar"})
        payload = json.loads(self.buffer.getvalue())
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["foo"], "bar")

    def test_write_error_includes_message(self):
        write_error("boom")
        payload = json.loads(self.buffer.getvalue())
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"], "boom")


class PathConfinementTests(unittest.TestCase):
    def test_workspace_root_returns_none_without_env(self):
        original = os.environ.pop("PLOINKY_WORKSPACE_ROOT", None)
        try:
            self.assertIsNone(workspace_root())
        finally:
            if original is not None:
                os.environ["PLOINKY_WORKSPACE_ROOT"] = original

    def test_confined_path_accepts_subdirectory(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["PLOINKY_WORKSPACE_ROOT"] = tmp
            sub = Path(tmp) / "projects"
            sub.mkdir()
            target, err = confined_path("projects")
            self.assertIsNone(err)
            self.assertEqual(Path(target).resolve(), sub.resolve())

    def test_confined_path_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["PLOINKY_WORKSPACE_ROOT"] = tmp
            _target, err = confined_path("../escape")
            self.assertIsNotNone(err)

    def test_confined_path_rejects_null_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["PLOINKY_WORKSPACE_ROOT"] = tmp
            _target, err = confined_path("ok\x00name")
            self.assertEqual(err, "working_directory contains null bytes")

    def test_confined_path_rejects_non_string(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["PLOINKY_WORKSPACE_ROOT"] = tmp
            _target, err = confined_path(42)  # type: ignore[arg-type]
            self.assertIsNotNone(err)


class RedactionTests(unittest.TestCase):
    def test_redacts_env_secret(self):
        os.environ["OPENAI_API_KEY"] = "sk-test-1234567890abcdef"
        try:
            text = "calling provider with key sk-test-1234567890abcdef in tail"
            redacted = redact(text)
            self.assertNotIn("sk-test-1234567890abcdef", redacted)
            self.assertIn("[REDACTED]", redacted)
        finally:
            del os.environ["OPENAI_API_KEY"]

    def test_redacts_inline_token_patterns(self):
        text = "Authorization: Bearer abcdefghij"
        redacted = redact(text)
        self.assertNotIn("abcdefghij", redacted)


if __name__ == "__main__":
    unittest.main()
