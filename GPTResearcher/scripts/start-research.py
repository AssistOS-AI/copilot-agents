#!/usr/bin/env python3

import asyncio
import contextlib
import io
import json
import sys
import time
import traceback


def parse_input(raw):
    text = (raw or "").strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict) and isinstance(parsed.get("input"), dict):
        return parsed["input"]
    return parsed if isinstance(parsed, dict) else None


def normalize_string(value):
    return value.strip() if isinstance(value, str) else ""


def write_json(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str))


def build_research_query(query, more_context):
    if not more_context:
        return query
    return f"{query}\n\nAdditional context:\n{more_context}"


def optional_call(obj, name):
    method = getattr(obj, name, None)
    if not callable(method):
        return None
    try:
        return method()
    except Exception:
        return None


async def run_research(payload):
    query = normalize_string(payload.get("query"))
    more_context = normalize_string(payload.get("moreContext"))
    report_type = normalize_string(payload.get("reportType")) or "research_report"

    if not query:
        write_json({
            "ok": False,
            "error": "query is required and must be a non-empty string.",
        })
        return 1

    started_at = time.time()
    effective_query = build_research_query(query, more_context)
    log_buffer = io.StringIO()

    try:
        from gpt_researcher import GPTResearcher

        researcher = GPTResearcher(query=effective_query, report_type=report_type)
        with contextlib.redirect_stdout(log_buffer), contextlib.redirect_stderr(log_buffer):
            await researcher.conduct_research()
            report = await researcher.write_report()

        write_json({
            "ok": True,
            "query": query,
            "moreContext": more_context,
            "reportType": report_type,
            "report": report,
            "researchContext": optional_call(researcher, "get_research_context"),
            "costs": optional_call(researcher, "get_costs"),
            "images": optional_call(researcher, "get_research_images"),
            "sources": optional_call(researcher, "get_research_sources"),
            "sourceUrls": optional_call(researcher, "get_source_urls"),
            "logTail": log_buffer.getvalue()[-16384:].strip(),
            "durationMs": int((time.time() - started_at) * 1000),
        })
        return 0
    except Exception as error:
        sys.stderr.write(f"[GPTResearcher/start_research] {error}\n")
        sys.stderr.write(traceback.format_exc())
        write_json({
            "ok": False,
            "error": str(error),
            "query": query,
            "moreContext": more_context,
            "reportType": report_type,
            "logTail": log_buffer.getvalue()[-16384:].strip(),
            "durationMs": int((time.time() - started_at) * 1000),
        })
        return 1


async def main():
    payload = parse_input(sys.stdin.read())
    if payload is None:
        write_json({
            "ok": False,
            "error": "Invalid or missing input. Expected JSON with query.",
        })
        return 1
    return await run_research(payload)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
