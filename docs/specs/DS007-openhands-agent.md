---
id: DS007
title: OpenHands Agent
status: planned
owner: copilot-agents-team
summary: Defines the constrained OpenHands adapter and the boundaries for headless, MCP, observability, and future server modes.
---

# DS007 - OpenHands Agent

## Introduction

`openHandsAgent` adapts OpenHands CLI or SDK workflows into Ploinky. It is more powerful and riskier than the Open Interpreter adapter, so it must be introduced behind explicit profile selection.

## Core Content

The default implementation should use OpenHands headless or SDK mode inside a Python 3.12 runtime. A prebuilt image is preferred over startup installation.

The default profile must not mount a Docker socket, launch nested Docker containers, or run the OpenHands Agent Server. Any Agent Server or Docker mode must be isolated in a separate profile with explicit documentation, tests, and operator warnings.

The agent may expose:

- `openhands_run_headless`
- `openhands_status`
- `openhands_resume`
- `openhands_list_conversations`
- `openhands_configure_mcp`

OpenHands headless mode runs with broad approval upstream. The Ploinky adapter must require an explicit argument such as `allowExecution` or `approvalMode` before running tasks that can modify files or execute commands. A dry-run or config-only path should exist for safer inspection.

OpenHands MCP server configuration must use router-mediated Ploinky endpoints or stdio wrappers. Direct container ports must not be written into OpenHands MCP config.

OpenHands observability must be opt-in. If OpenTelemetry or Laminar variables are configured, the agent must document that traces may include LLM, tool, and conversation data and must apply repository redaction rules where possible.

## Decisions & Questions

### Question #1: Why exclude OpenHands Agent Server from the default profile?

Response:
The Agent Server manages isolated workspaces and Docker containers. In Ploinky, Docker access and nested runtime behavior are broad operational grants, so they require a separate profile and review rather than default enablement.

### Question #2: Why require explicit execution approval for headless mode?

Response:
OpenHands headless mode is appropriate for automation but has upstream approval semantics that are too broad for an implicit Copilot launch. Tool schemas must make execution intent explicit.

## Conclusion

`openHandsAgent` must start as a constrained, profile-gated CLI or SDK adapter and must defer server or Docker modes until their operational grants are documented and tested.
