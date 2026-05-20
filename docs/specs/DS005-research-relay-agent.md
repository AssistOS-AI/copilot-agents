---
id: DS005
title: Research Relay Agent (researchRelay)
status: planned
owner: copilot-agents-team
summary: Defines the Explorer-facing semantic research-task relay under the `researchRelay` agent id.
---

# DS005 - Research Relay Agent

## Introduction

The Research Relay is the secure relay for semantic research tasks. Its agent id
is `researchRelay`. It provides Copilot launch metadata, the backend catalog
tools, and the secure relay that routes semantic research tasks to provider
agents. The relay must not own backend runtime setup and must not call a
sandbox runner directly for backend execution.

**Naming note.** The previous agent id was `researchCopilot`. The
implementation is now renamed to `researchRelay`; bundle enable entries, MCP
helper names, tests, Explorer plugin folders, and AchillesCLI semantic launcher
parameters must use the new id. Ploinky framework code must not reference this
agent id directly.

## Core Content

The agent must be a lightweight Ploinky MCP agent. It should use a Node
container, `lite-sandbox: true`, and the default `AgentServer` with
`mcp-config.json`.

The agent must expose:

- `research_relay_status`: reports relay mode, backend configuration,
  and provider reachability.
- `research_relay_list_backends`: returns the canonical backend
  catalog, including `provider` metadata for provider-backed backends.
- `research_task_submit`: accepts a backend id, natural-language prompt,
  optional resource payloads or workspace-confined paths, and origin metadata.
  It forwards the task to the declared provider agent's MCP tool and returns a
  natural-language result.
- `research_relay_dispatch`: compatibility helper that returns a generic
  AchillesCLI Copilot WebChat URL with envelope forwarding enabled. It must
  not return direct backend WebChat URLs or tag-relay launch parameters.

The relay must not expose direct chat endpoints for Open Interpreter,
OpenHands, Agentic Data Scientist, MLJAR, or DeepAnalyze. Backend-specific
logic lives in provider agents. The active provider-backed backends are
`open-interpreter` through `openInterpreterAgent` and `web-search` through
`webSearchAgent`. Future backends such as DeepAnalyze, OpenHands, Agentic
Data Scientist, and MLJAR must not be added to the active relay catalog until
they have provider agents that own their runtime setup and execution.

The relay must not embed backend command strings for backends that have a
provider agent. It must not own runtime ids, package versions, shim
paths, or model/provider configuration. When invoked for `open-interpreter`,
the relay forwards the task to
`openInterpreterAgent.open_interpreter_run_task` and returns that tool's
natural-language output. When invoked for `web-search`, the relay forwards to
`webSearchAgent.web_search_run_task` and returns the search result with
citations. The `web-search` backend declares `cacheable: true` and
`ttl_hint_seconds: 86400`. Backend execution belongs to provider agents, not
to the relay.

The agent must not expose a separate user-facing Explorer menu item or toolbar
button for research chat. Explorer should show one primary chat entry point:
the existing AchillesCLI action labeled `Open Copilot here`. Research Relay
adds envelope forwarding metadata to that normal Copilot launch through a metadata-only
Explorer plugin in `file-exp:copilot-launch-extension`.

The launch-extension plugin must contribute only generic `copilotLaunch.query`
values, currently `forward-envelope=1`. It must not contribute
`research-tags`, `tag-relay-*`, backend tags, provider agent ids, or provider
MCP tool names. It should set `workspaceDirParam` to `workspace-dir` so the
Copilot launcher can prefer workspace-relative directory parameters over
absolute host paths.

Explorer and helper-generated WebChat URLs must prefer workspace-relative
query parameters such as `workspace-dir` instead of placing absolute host
workspace paths in the browser URL. Ploinky WebChat resolves those relative
values server-side before spawning AchillesCLI.

The relay may keep `research_relay_dispatch` as a compatibility helper that
returns the same generic Copilot WebChat URL shape, but the durable Explorer
path is the normal Copilot launch plus launch-extension metadata. Backend
catalog lookup belongs to AchillesCLI launcher execution, not to the WebChat
launch URL.

Browser-side status calls must go through Explorer `appServices.callTool`
or an equivalent MCP session-aware helper. The plugin must not post raw
JSON-RPC `tools/call` requests to `/mcps/<agent>/mcp`, because those calls
bypass MCP initialization and fail Ploinky's session contract.

Server-side execution must use delegated secure-wire calls. Relay tools must
read the router-provided invocation token from tool metadata and forward it
as `x-ploinky-caller-jwt` when calling provider agents such as
`openInterpreterAgent`.

The relay must materialize resources as staged content, not as host bind
mounts. It may accept small inline text/base64 resources from WebChat, and may
read workspace-confined paths only when those paths are available inside its
runtime. It must not pass caller-provided mount paths, raw bwrap flags,
network selectors, credentials, capabilities, invocation JWTs, or generated
setup programs to provider agents. Provider-backed backends receive resources
as a typed array and own sandbox staging.

Workspace path materialization must resolve real paths and reject symlink
escapes after lexical containment checks. Current resource limits are 16,000
prompt characters, 128 KiB per resource, 384 KiB total raw resource bytes, and
900 KiB maximum encoded provider payload, leaving headroom below downstream
provider and local sandbox runner caps.

If a provider agent is unavailable or returns no natural-language output, the
relay must return a natural-language configuration or routing message. Raw
stderr and stack traces may be retained only as bounded debug previews in
structured output; they must not become the chat-facing final answer.

## Decisions & Questions

### Question #1: Why not put all launch behavior in Explorer core?

Response:
Explorer's contract is to host plugins and preserve the shell. Research-agent
launch behavior belongs to the agent that owns the research integration, so
the IDE shell does not accumulate domain-specific logic.

### Question #2: Why use semantic Copilot launchers instead of direct backend WebChat links?

Response:
The invariant is that users ask naturally in Copilot and receive a
natural-language answer in the same chat. Direct backend WebChat links create
a second interaction model, bypass origin reply handling, and make attachments
harder to relay safely.

### Question #3: Why require Explorer SDK calls for plugin status?

Response:
Explorer's SDK owns MCP client sessions and authentication recovery. Raw
plugin fetch calls do not perform MCP initialization and can incorrectly
report healthy agents as offline because the router rejects sessionless
`tools/call` requests.

### Question #4: Why require provider agents for active research backends?

Response:
Research backends need backend-specific runtime setup, shims, package pins,
and sandbox orchestration. Putting that in provider agents keeps the relay
generic and prevents it from accumulating backend command strings, runtime
paths, or sandbox details. The active catalog therefore includes only backends
with provider agents.

### Question #5: Why rename the legacy `researchCopilot` id?

Response:
The old id sounded like an assistant or executor. The implementation role is
a relay: validate known backend ids, forward to provider agents, and return the
provider's natural-language answer. The rename is implemented across
bundle enable entries, MCP helper names, tests, Explorer plugins, and
AchillesCLI semantic launcher configuration so there is one durable runtime
identity without coupling Ploinky core to the relay.

## Conclusion

The Research Relay (`researchRelay`) must remain a thin launch-extension and
secure semantic-task relay that routes natural-language research tasks through
provider agents and returns normalized natural-language output to the
originating chat. It must not own backend runtimes or a separate visible
Explorer chat entry point.
