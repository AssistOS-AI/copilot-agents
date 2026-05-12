---
id: DS011
title: Security and Observability
status: planned
owner: copilot-agents-team
summary: Defines safety, telemetry, logging, trace, transcript, and artifact rules for research-agent execution.
---

# DS011 - Security and Observability

## Introduction

The research agents can execute code, call LLM providers, generate manuscripts, and run long workflows. This specification defines the repository-wide safety and observability requirements.

## Core Content

Every tool that can execute commands, mutate files, call external services, or start long-running research work must require explicit user intent in its schema. Defaults must favor dry-run, status, or planning behavior over execution.

Telemetry must be opt-in unless an upstream integration provides a documented local-only mode. Open Interpreter telemetry must be disabled by default. OpenHands observability through OpenTelemetry or Laminar must be opt-in and documented as potentially containing LLM, tool, and conversation data.

Logs must not contain provider credentials, bearer tokens, invocation JWTs, raw prompts, hidden policy text, or internal payloads. Status APIs should expose artifact references, phase names, and high-level progress rather than raw logs.

Generated artifacts must be treated as workspace data. Agents must not place generated papers, experiment outputs, or prompt transcripts in plugin asset folders or static documentation. Manuscript-generating agents must preserve upstream disclosure requirements.

Runtime isolation is defense in depth. Container, lite-sandbox, or profile choices do not make enabled agents safe for hostile multi-tenant execution. The documentation must state that operators are intentionally enabling trusted local research code inside a workspace.

Cancellation and status behavior must be planned before heavy agents are considered complete. Long tasks should be async MCP tasks with task IDs, status tools, artifact listing, and bounded log tails.

## Decisions & Questions

### Question #1: Why require explicit execution intent?

Response:
The upstream systems can execute shell commands or produce long-running side effects. Explicit intent makes potentially destructive or expensive actions visible at the tool boundary and in future UI prompts.

### Question #2: Why avoid raw logs in status output?

Response:
Raw upstream logs may contain prompts, code, environment details, provider responses, or secrets. Structured status gives the UI enough information without expanding the default data exposure surface.

## Conclusion

The repository must make execution intent explicit, keep telemetry opt-in, redact logs, preserve artifact disclosure requirements, and expose long-running work through structured async status paths.
