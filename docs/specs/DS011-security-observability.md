---
id: DS011
title: Security and Observability
status: planned
owner: copilot-agents-team
summary: Defines safety, telemetry, logging, trace, transcript, artifact, and local sandbox rules for research-agent execution.
---

# DS011 - Security and Observability

## Introduction

The research agents can execute code, call LLM providers, generate manuscripts,
and run long workflows. This specification defines the repository-wide safety
and observability requirements.

## Core Content

Every tool that can execute commands, mutate files, call external services, or
start long-running research work must require explicit user intent in its
schema. In the tagged-task model, the explicit intent is the chat message that
names a supported `@backend` tag plus a natural-language task. Defaults must
favor status or a clear "backend not configured" answer over silent execution.

Telemetry must be opt-in unless an upstream integration provides a documented
local-only mode. Open Interpreter telemetry must be disabled by default, both
in the provider agent and in the runtime shim executed inside the bwrap
sandbox. OpenHands observability through OpenTelemetry or Laminar must be
opt-in and documented as potentially containing LLM, tool, and conversation
data.

Logs must not contain provider credentials, bearer tokens, invocation JWTs,
hidden policy text, raw prompts, materialized resource contents, base64
resource bodies, command stdin payloads, or internal payloads. Status APIs
should expose backend ids, job ids, artifact references, phase names, and
high-level progress rather than raw logs. Chat transcripts are allowed to
contain the user's chat prompt and the returned natural-language answer
because they are the originating user-visible record.

Generated artifacts must be treated as workspace data. Agents must not place
generated papers, experiment outputs, or prompt transcripts in plugin asset
folders or static documentation. Manuscript-generating agents must preserve
upstream disclosure requirements.

Runtime isolation is defense in depth. Backend execution must happen inside a
local inner bubblewrap sandbox started by the provider agent container. Each
provider that executes research code must use the shared bwrap-runner Docker
image as its sandbox base, either directly or through a documented derived
image. Provider agents must not call a separate `basic/bwrap-runner` Ploinky
agent for research execution. The Research Relay must pass prompt and resource
content through staged data and must not pass caller-supplied mounts, bwrap
flags, network selectors, generated setup programs, or inline executable
driver code. Container, lite-sandbox, nested bwrap, or profile choices do not
make enabled agents safe for hostile multi-tenant execution. The documentation
must state that operators are intentionally enabling trusted local research
code inside a workspace.

`/shared` is a convenience and coordination channel among trusted, explicitly
enabled agents in a single workspace. It is not a hostile-agent security
boundary. Enabled agents can write to `/shared`, so `/shared` must not be the
required runtime handoff between a provider and a central runner agent.
Providers may read shared attachments or coordination artifacts only through
their own resource validation, then stage accepted content into `/work`. Inner
sandbox jobs must not receive a broad `/shared` bind. Documentation and status
surfaces must not claim multi-tenant isolation.

Cancellation and status behavior must be planned before heavy agents are
considered complete. Long tasks should be async MCP tasks with task IDs,
status tools, artifact listing, and bounded log tails.

## Decisions & Questions

### Question #1: Why require explicit execution intent?

Response:
The upstream systems can execute shell commands or produce long-running side
effects. Explicit intent makes potentially destructive or expensive actions
visible at the tool boundary and in future UI prompts.

### Question #2: Why avoid raw logs in status output?

Response:
Raw upstream logs may contain prompts, code, environment details, provider
responses, or secrets. Structured status gives the UI enough information
without expanding the default data exposure surface.

### Question #3: Why redact raw prompts and resources from MCP server logs?

Response:
The tagged relay intentionally accepts user prompts and document contents as
tool arguments. The MCP server may log tool arguments and payload metadata
for debugging, so redaction must treat prompt, content, base64, resources,
stdin, task, message, and payload fields as sensitive by default.

### Question #4: Why is `/shared` not a security boundary against hostile agents?

Response:
`/shared` is mounted into enabled agents so they can coordinate blob storage
and scratch state. A malicious enabled agent could write attacker-controlled
data there. Treating `/shared` as multi-tenant isolation would mislead
operators about the threat model. The repository explicitly relies on trusted
enablement, provider-owned runtime roots, and narrow local sandbox binds
instead.

### Question #5: Why execute inside each provider instead of a central runner agent?

Response:
A central runner agent would become a shared service that all research
providers depend on and would require runtime handoff through shared storage.
Running the same local sandbox runner inside each provider keeps the sandbox
policy common while preserving provider ownership of backend dependencies and
reducing cross-agent coupling.

## Conclusion

The repository must make execution intent explicit, keep telemetry opt-in,
redact logs, preserve artifact disclosure requirements, expose long-running
work through structured async status paths, and document that `/shared` is a
trusted coordination channel rather than a hostile-agent isolation boundary.
