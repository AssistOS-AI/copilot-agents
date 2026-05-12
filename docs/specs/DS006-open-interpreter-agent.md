---
id: DS006
title: Open Interpreter Agent
status: planned
owner: copilot-agents-team
summary: Defines the Ploinky MCP adapter around Open Interpreter for bounded local coding and analysis tasks.
---

# DS006 - Open Interpreter Agent

## Introduction

`openInterpreterAgent` adapts Open Interpreter into a Ploinky MCP agent. It is the first execution adapter and the first useful backend for the research copilot suite.

## Core Content

The agent should use a Python 3.12 runtime. A prebuilt image with Open Interpreter installed is preferred. Development profiles may use a `python:3.12-slim` base with a `python3 -m pip` install hook only when cold-start cost is acceptable.

Telemetry must be disabled by default. The agent must set or enforce the upstream-supported telemetry controls such as `DISABLE_TELEMETRY=true` and equivalent Python configuration.

The agent must expose at least:

- `oi_status`
- `oi_chat` or `oi_run_task`
- `oi_reset_session` when session state is introduced

The first bounded execution tool may be synchronous only if it has a strict timeout and explicit execution mode. Longer or stateful work must move to async MCP tasks and status polling.

The wrapper should call Open Interpreter through Python APIs when possible rather than building unstructured shell strings. It must validate all target paths against `PLOINKY_WORKSPACE_ROOT`, default to local/offline provider settings when configured, and return compact JSON output.

The agent must not enable `-y` or comparable auto-run behavior by default. Any execution mode that can mutate files or run shell commands must be explicit in tool input and reflected in the schema.

The durable `/data` mount must be declared with Ploinky's manifest volume object-map shape:

```json
{
  ".ploinky/data/openInterpreterAgent": "/data"
}
```

Array or Docker-style `host:container` volume strings are not valid for this repository.

## Decisions & Questions

### Question #1: Why implement Open Interpreter first?

Response:
Open Interpreter is the smallest useful vertical slice. It validates the Ploinky MCP adapter pattern, telemetry defaults, Explorer status calls, and AchillesCLI launcher path before heavier agents are added.

### Question #2: Why disable telemetry by default?

Response:
The agent may process local code, prompts, and workspace context. Default-off telemetry keeps data movement explicit and aligns with the repository's redaction and observability posture.

### Question #3: Why require the Ploinky object-map volume shape?

Response:
Ploinky resolves `manifest.volumes` with `Object.entries()` and applies host-path policy checks to each map key. Docker-style strings are interpreted incorrectly and fail the `.ploinky/` confinement policy at startup.

## Conclusion

`openInterpreterAgent` must provide a bounded, telemetry-disabled, workspace-confined Open Interpreter adapter that proves the end-to-end Ploinky and UI integration path.
