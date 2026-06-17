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
6. `opencodeAgent`: the internal OpenCode task runner agent. Its
   `execute-task` MCP tool accepts `{ prompt, projectDir, model }`, creates the
   `.opencode/skills` symlink in the effective project directory, and runs
   OpenCode with explicit `--dir`, the caller-selected model, and permission
   auto-approval because the tool is internal. The agent mounts
   `.ploinky/agents/webAssist/data` at `/webAssist-data` and remaps caller
   workspace paths under `$PLOINKY_WORKSPACE_ROOT/.ploinky/agents/webAssist/data`
   into that mounted root. Callers own task-specific prompt construction and
   artifact location instructions. The tool streams OpenCode stdout and stderr
   to the `opencodeAgent` container logs with clear prefixes and is registered
   as an async MCP tool so AgentServer task status exposes bounded log-tail
   updates while it runs. It treats known OpenCode permission and missing-skill
   output as failure even when OpenCode exits with code `0`, keeps MCP stdout
   reserved for the final JSON result, and includes only a bounded final
   OpenCode output tail in that JSON for caller visibility. It does not impose
   a task-specific artifact validation contract; callers decide which files or
   directories constitute success for their prompt. Its manifest readiness and
   liveness probes must verify that `/root/.opencode/bin/opencode` is
   executable, so Ploinky startup and CLI attachment wait for the OpenCode
   installer to finish before invoking the declared `cli` command.
   Its
   `create-akus` skill transforms WAC JSON into an Achilles-compatible `.aku`
   tree, fetches every `siteMap` URL for document KUs, preserves profile text
   as document material, and writes root aggregate AKU indexes including
   `search-index.jsonl`, `search-stats.json`, and `index-meta.json`.
7. `piAgent`: the internal Pi task runner agent. Its `execute-task` MCP tool
   accepts `{ prompt, projectDir, model }`, runs the `pi` CLI in the supplied
   project directory, streams prefixed stdout and stderr to container logs, and
   returns a bounded JSON result. The agent installs Pi non-interactively by
   bypassing the official interactive installer and installing the
   `@earendil-works/pi-coding-agent` npm package under `/root/.local`, using a
   standalone Node.js/npm fallback when the container's bundled npm is not
   usable.

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
