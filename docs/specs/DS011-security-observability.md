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
start long-running provider work must require explicit user intent in its
schema. In the semantic Copilot model, the explicit intent is the
natural-language task routed by AchillesCLI to a deterministic launcher and a
known backend id. Defaults must favor status or a clear "backend not
configured" answer over silent execution.

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

Runtime isolation is defense in depth. Code-execution backend work must happen
inside a local inner bubblewrap sandbox started by the provider agent
container. Each provider that executes research code must use the shared
bwrap-runner Docker image as its sandbox base, either directly or through a
documented derived image. Browser-search providers may use a browser-enabled
container when their provider task is limited to browser navigation and result
normalization. Interactive browser providers such as `browserUseAgent` use a
browser-enabled container with persistent user profiles; their viewer surface
must use `access: "authenticated"` and browser profiles must be isolated per
authenticated user and provider. Provider agents must not call a separate
`basic/bwrap-runner` Ploinky agent for research execution. The Copilot
Provider Relay must pass prompt and resource content through staged data and
must not pass caller-supplied mounts, bwrap flags, network selectors,
generated setup programs, or inline executable driver code. Container,
lite-sandbox, nested bwrap, browser image, or profile choices do not make
enabled agents safe for hostile multi-tenant execution. The documentation must
state that operators are intentionally enabling trusted local research code
and browser automation inside a workspace.

Interactive browser providers must not log credentials, cookies,
localStorage, sessionStorage, OAuth callback URLs, authorization codes,
screenshots, DOM dumps, raw auth headers, or invocation tokens by default.
Debug screenshots, if ever added, must be opt-in and written under the
agent data volume, not tracked source.

Interactive browser providers must bind sessions to the verified authenticated
user from secure-wire invocation metadata or protected HTTP service auth
headers. They must reject viewer access when the authenticated user id is
missing or does not match the session owner, and must not use a shared
`anonymous` profile for browser tasks that can hold cookies.

Provider credentials must stay outside inner sandbox payloads by default.
For Open Interpreter's normal hosted path, `SOUL_GATEWAY_API_KEY` is exposed
to `openInterpreterAgent` only. The provider starts a short-lived
OpenAI-compatible loopback broker outside the inner bwrap sandbox, stages only
the broker `/v1` URL and a dummy broker token into
`/work/config/open-interpreter.json`, and injects the raw Soul Gateway bearer
token only when the broker forwards the chat-completions request. The broker
must not log prompt bodies, response bodies, authorization headers, or raw
provider keys. Because loopback broker access requires the inner bwrap job to
inherit the provider container network, this path protects the raw provider
key but must not be described as blocking all outbound network access from
that sandbox job.

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

`opencodeAgent.execute-task` is an operator-observability exception for
workspace-local AKU construction: it may stream OpenCode stdout and stderr to
the container logs because operators need live visibility into long OpenCode
runs. The MCP tool response must remain structured JSON, and failure responses
must include only bounded output tails. Operators should treat those container
logs as potentially containing prompt or WAC-derived content. The tool is
internal-only and runs OpenCode with permission auto-approval for the selected
project directory; callers must continue to route access through MCP policy and
must not expose this execution surface directly. A completed OpenCode process
is not sufficient success for AKU construction; the wrapper must verify the
expected AKU manifest under the selected project directory before returning
`ok: true`. The only cross-agent filesystem mount for this workflow is the
webAssist data root mounted read-write at `/webAssist-data` inside
`opencodeAgent`; arbitrary workspace paths must not be mounted for this task.

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
The provider relay intentionally accepts user prompts and document contents as
tool arguments. The MCP server may log tool arguments and payload metadata for
debugging, so redaction must treat prompt, content, base64, resources, stdin,
task, message, and payload fields as sensitive by default.

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

### Question #6: Why use a local broker for Open Interpreter provider credentials?

Response:
Open Interpreter is configured through a staged runtime file inside the inner
sandbox, while Soul Gateway authentication must stay in the outer provider
process. A broker separates those concerns: the sandbox can call a narrow
OpenAI-compatible loopback endpoint with a dummy token, and the provider-owned
broker can inject `SOUL_GATEWAY_API_KEY` without placing it in sandbox env,
argv, staged files, stdout, or stderr.

## Conclusion

The repository must make execution intent explicit, keep telemetry opt-in,
redact logs, preserve artifact disclosure requirements, expose long-running
work through structured async status paths, and document that `/shared` is a
trusted coordination channel rather than a hostile-agent isolation boundary.
