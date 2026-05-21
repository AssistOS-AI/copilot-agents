---
id: DS003
title: Agent Inventory
status: planned
owner: copilot-agents-team
summary: Defines the copilot provider relay inventory, provider-backed backend ids, and default enablement posture.
---

# DS003 - Agent Inventory

## Introduction

This specification lists the repository-owned Ploinky agents and the provider
backend adapters they expose. It is the inventory source for documentation and
implementation ordering.

## Core Content

The repository must contain these Ploinky agents:

1. `research-agents`: the explicit deployment bundle.
2. `copilotProviderRelay`: the Copilot launch-extension and provider-task relay agent.
3. `openInterpreterAgent`: the Open Interpreter provider agent that owns
   runtime preparation and runs research tasks in its own local bwrap sandbox.
4. `webSearchAgent`: the Web Search provider agent that executes cacheable
   web searches through its own local headless browser runtime.
5. `browserUseAgent`: the Browser Use provider agent that controls interactive
   Chromium sessions for logged-in web application tasks and exposes a
   protected viewer URL for login, OAuth, 2FA, and CAPTCHA flows.

The repository must expose these active backend ids through `copilotProviderRelay`:

- `open-interpreter`
- `web-search` (cacheable, TTL 86400s)
- `browser-use` (interactive, not cacheable)

The provider backends are not public chat or slash-command targets. They are
adapter records inside `copilotProviderRelay`. Each adapter receives a
natural-language prompt and materialized input resources. Active backends must
declare `provider: { agent, tool }`; the relay forwards the task to that MCP
tool with the router invocation token, and the provider agent owns runtime
preparation and local sandbox execution. Future backends such as
DeepAnalyze, OpenHands, Agentic Data Scientist, and MLJAR are reserved
concepts, not active relay backends, until they have provider agents.

The relay must not own backend command strings, runtime ids, package
versions, shim paths, model/provider setup, or direct backend-specific calls
to a sandbox runner.

Only the `research-agents` bundle may auto-enable the relay. The default,
`dev`, `qa`, and `prod` bundle profiles must enable `copilotProviderRelay`,
`openInterpreterAgent`, `webSearchAgent`, and `browserUseAgent`; they must not
enable `basic/bwrap-runner` or direct backend chat agents by default.

## Decisions & Questions

### Question #1: Why keep `copilotProviderRelay` separate from `research-agents`?

Response:
The bundle is a deployment construct, while `copilotProviderRelay` is the
runtime provider-task relay. Keeping them separate allows the bundle to stay
lightweight and keeps task-dispatch behavior out of deployment metadata.

### Question #2: Why are backend tasks routed through provider agents?

Response:
The chat-facing contract is "ask Copilot for a provider-backed task." A single relay
validates backend ids, materializes resources, and forwards the request to the
provider agent that owns that backend's runtime. This keeps the chat surface
stable without making the relay responsible for backend runtimes or local
sandbox execution.

### Question #3: Why use the `copilotProviderRelay` name?

Response:
The name describes the stable role: provider-task relay behavior for Copilot
launchers. The relay validates supported backend ids, materializes inputs, calls
provider agents, and returns the provider result.

### Question #4: Why keep future backends out of the active catalog?

Response:
The target architecture is backend-owned runtime setup with execution inside
the provider's own container based on the shared bwrap-runner image.
Advertising a backend before its provider exists would either force the relay to
own backend command setup or produce a misleading half-enabled backend. Future
backends become active only when their provider agent owns runtime preparation
and sandbox execution.

## Conclusion

The repository inventory consists of one deployment bundle, one semantic relay
(the **Copilot Provider Relay**, under the `copilotProviderRelay` agent id), the
Open Interpreter provider agent that owns its runtime and local sandbox
execution, and the Web Search provider agent that owns local browser search
execution. Additional backend ids require provider agents before they enter the
active catalog.
