---
id: DS001
title: Coding Style
status: implemented
owner: copilot-agents-team
summary: Establishes coding, layout, documentation, and testing conventions for the research agents repository.
---

# DS001 - Coding Style

## Introduction

This specification is the coding-style authority for `copilot-agents`. Future changes must keep implementation, documentation, and tests aligned with this file.

## Core Content

All source, documentation, specifications, comments, and user-facing strings must be written in English. Repository records must not include generated-code, coding-agent, or tool attribution.

The repository should prefer small agent-local modules over a shared root runtime because Ploinky mounts each agent directory as `/code`. Shared helper code may be generated into each agent, packaged explicitly, or copied deliberately, but agent implementations must not assume that a root `src/` tree is mounted into every agent.

Code must obey SOLID and DRY design principles. Validation, path confinement,
transport, backend catalog resolution, sandbox payload building, and result
normalization must stay in cohesive modules with explicit contracts. Use design
patterns only when they clarify stable responsibilities or extension points;
avoid speculative abstractions that make an agent harder to audit.

Ploinky tools should follow the default `AgentServer` pattern unless a specific service requires a custom long-running process. Tool wrappers must read the JSON envelope from stdin, normalize nested MCP input safely, validate required fields, and write compact JSON to stdout. The normal success shape should be `{ "ok": true, ... }`, and the normal failure shape should be `{ "ok": false, "error": "..." }`.

Path handling must be centralized per agent. Tools must resolve paths against `PLOINKY_WORKSPACE_ROOT`, the agent work directory, or an explicit `.ploinky/data/<agent>` root. Tools must reject null bytes, traversal, symlink escape, and writes outside the allowed roots.

Logging must be conservative by default. Logs and errors must redact provider credentials, cookies, bearer tokens, invocation JWTs, raw prompts, materialized resource contents, base64 payloads, command stdin, hidden policy text, and internal payloads. Debug output may be added only behind explicit opt-in environment flags and must still redact sensitive values.

Tests must cover envelope parsing, path confinement, redaction, command construction, status parsing, and output shape. Heavy upstream integrations must be opt-in and must not run real paid LLM calls in default tests.

## Decisions & Questions

### Question #1: Why avoid a shared root `src/` tree?

Response:
Ploinky mounts each enabled agent directory at `/code`. A root `src/` tree outside the agent directory would not be available to the default runtime unless additional packaging or mounts are introduced. Keeping first-slice code agent-local makes the runtime contract explicit.

### Question #2: Why standardize compact JSON tool output?

Response:
Explorer plugins, AchillesCLI launcher skills, smoke scripts, and Ploinky MCP clients need predictable status and failure handling. Compact JSON gives each layer a stable parsing target while still allowing human-readable messages inside explicit fields.

### Question #3: Why make SOLID and DRY explicit coding invariants?

Response:
The repository crosses chat, router, MCP, sandbox, and backend-command
boundaries. Keeping each responsibility isolated and shared logic centralized
reduces duplicated security checks and keeps the relay behavior testable without
introducing broad framework code.

## Conclusion

`copilot-agents` must use explicit, small, agent-local implementations with strict path validation, redacted output, and tests that exercise the Ploinky tool boundary.
