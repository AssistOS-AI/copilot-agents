---
id: DS005
title: Copilot Provider Relay Agent (copilotProviderRelay)
status: planned
owner: copilot-agents-team
summary: Defines the semantic Copilot provider-task relay under the `copilotProviderRelay` agent id.
---

# DS005 - Copilot Provider Relay Agent

## Introduction

The Copilot Provider Relay is the secure relay for semantic Copilot provider
tasks. Its agent id is `copilotProviderRelay`. It owns the provider backend
catalog, validates bounded task inputs, forwards tasks to provider agents over
router-mediated MCP, and normalizes provider results.

The relay is not a chat agent, not a backend runtime, and not a visible
provider selector. AchillesCLI owns semantic routing. Provider agents own
runtime setup and execution.

## Core Content

The agent must be a lightweight Ploinky MCP agent. It should use a Node
container, `lite-sandbox: true`, and the default `AgentServer` with
`mcp-config.json`.

The agent must expose exactly these MCP tools:

- `copilot_provider_status`: reports relay mode and the configured backend
  catalog.
- `copilot_provider_list_backends`: returns the canonical backend catalog,
  including `provider` metadata for provider-backed backends.
- `copilot_provider_task_submit`: accepts a backend id, natural-language
  prompt, browser-use provider id when the backend supports it, optional
  resource payloads or workspace-confined paths, and origin metadata. It
  forwards the task to the declared provider agent's MCP tool and returns
  normalized natural-language output.

The relay must not expose compatibility dispatch tools, direct WebChat launch
helpers, backend chat endpoints, or visible provider-tag dispatch. The durable
user path is the normal Explorer `Open Copilot here` action, followed by
AchillesCLI semantic routing to deterministic launcher skills.

The active provider-backed backend ids are:

- `open-interpreter` through `openInterpreterAgent.open_interpreter_run_task`
- `web-search` through `webSearchAgent.web_search_run_task`
- `browser-use` through `browserUseAgent.browser_use_run_task` (interactive, not cacheable)

Browser providers such as ChatGPT, Gemini, and Perplexity are subproviders of
`browserUseAgent`, not separate relay backends. The relay forwards the optional
`provider` string to `browserUseAgent`, which validates it through its own
agent-local provider adapter registry.

The backend catalog must use backend ids, not visible chat tags. Catalog
entries must not advertise `tags`, and `copilot_provider_task_submit` must not
accept `@backend` aliases. Future backends such as DeepAnalyze, OpenHands,
Agentic Data Scientist, and MLJAR must not be added to the active catalog until
they have provider agents that own their runtime setup and execution.

The relay must not embed backend command strings for backends that have a
provider agent. It must not own runtime ids, package versions, shim paths,
model/provider configuration, browser profiles, or sandbox command setup.
Backend execution belongs to provider agents.

The `web-search` backend declares `cacheable: true` and
`ttl_hint_seconds: 86400`. Cache lookup and persistence remain AchillesCLI
policy; the relay only preserves provider cacheability metadata.

The agent must not expose a separate user-facing Explorer menu item or toolbar
button. The metadata-only Explorer plugin may contribute only generic
`copilotLaunch.query` values, currently `forward-envelope=1`, and
`workspaceDirParam: "workspace-dir"`. It must not contribute provider backend
ids, provider agent ids, MCP tool names, or legacy relay launch flags.

Browser-side status calls must go through Explorer `appServices.callTool` or an
equivalent MCP session-aware helper. The plugin must not post raw JSON-RPC
`tools/call` requests to `/mcps/<agent>/mcp`, because those calls bypass MCP
initialization and fail Ploinky's session contract.

Server-side execution must use delegated secure-wire calls. Relay tools must
read the router-provided invocation token from tool metadata and forward it as
`x-ploinky-caller-jwt` when calling provider agents.

The relay must materialize resources as staged content, not as host bind
mounts. It may accept small inline text/base64 resources from WebChat, and may
read workspace-confined paths only when those paths are available inside its
runtime. It must not pass caller-provided mount paths, raw bwrap flags, network
selectors, credentials, capabilities, invocation JWTs, or generated setup
programs to provider agents. Provider-backed backends receive resources as a
typed array and own sandbox staging.

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

### Question #1: Why keep a relay between launchers and providers?

Response:
The relay provides one stable provider-task contract for backend catalog lookup,
input validation, resource materialization, secure invocation-token forwarding,
and result normalization. Keeping that in one agent prevents every AchillesCLI
launcher from duplicating provider discovery, path confinement, and output
shape logic.

### Question #2: Why remove visible tag semantics from the relay contract?

Response:
Users route providers semantically through AchillesCLI, not with visible
`@agent` syntax. Keeping tag aliases in the relay catalog would preserve a
second, deprecated dispatch model and make future providers inherit a UI
contract they do not need.

### Question #3: Why not keep a compatibility dispatch tool?

Response:
The normal Copilot launch path already comes from Explorer and WebChat. A relay
dispatch helper creates a stale second launch contract that can drift from
AchillesCLI launcher discovery. Removing it keeps the relay focused on provider
task submission.

### Question #4: Why require provider agents for active backends?

Response:
Backends need backend-specific runtime setup, package pins, shims, browser
state, model configuration, and result normalization. Provider agents own those
details. The relay owns only the generic task envelope and secure forwarding.

## Conclusion

The Copilot Provider Relay (`copilotProviderRelay`) is a thin provider-task
broker. It validates backend ids and bounded resources, forwards tasks through
Ploinky secure-wire to provider agents, and returns normalized provider output
to AchillesCLI launchers. It must not own backend runtimes, visible tag
dispatch, compatibility launch helpers, or a separate user-facing chat surface.
