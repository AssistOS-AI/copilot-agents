---
title: DS015-agent-inventory
summary: Defines the local provider-agent inventory, AchillesCLI compatibility surfaces, backend ids, and default enablement posture.
---

# DS015 - Agent Inventory

## Introduction

This specification lists the repository-owned Ploinky agents and the provider backend adapters they expose. It is the inventory source for documentation and implementation ordering.

## Core Content

The repository owns and validates these Ploinky agent directories:

1. [`research-agents`](wiki.html#definition-research-agents): the explicit deployment bundle.
2. [`copilotProviderRelay`](wiki.html#definition-copilot-provider-relay): the Copilot launch-extension and provider-task relay agent.
3. [`openInterpreterAgent`](wiki.html#definition-open-interpreter): the Open Interpreter provider agent that owns runtime preparation and runs research tasks in its own local bwrap sandbox.
4. [`webSearchAgent`](wiki.html#definition-web-search): the Web Search provider agent that executes cacheable web searches through its own local headless browser runtime.
5. [`browserUseAgent`](wiki.html#definition-browser-use): the Browser Use provider agent that controls interactive Chromium sessions for logged-in web application tasks and exposes a protected viewer URL for login, OAuth, 2FA, and CAPTCHA flows.

[`GPTResearcher`](wiki.html#definition-gpt-researcher) is owned by the sibling `AchillesCLI` repository, not this repository. Historical OpenCode, Pi and Codex fixtures are compatibility-test inputs, not local deployable provider agents or a promise that the sibling repository retains those agents. They remain integration consumers of the bundle or launcher topology, so this repository keeps explicit cross-repository compatibility tests rooted at the saved workspace's `AchillesCLI` checkout. Missing sibling roots fail deterministically; they are not added to this repository's local manifest validator inventory.

The [`GPTResearcher`](wiki.html#definition-gpt-researcher) compatibility boundary covers its shared runner image, manual startup, MCP readiness, cold-install script, bounded settings schema, and minimal task adapter. Its shared runner image is pinned by an immutable digest; replacing that identity requires native publication evidence. The OpenCode and PI compatibility boundary verifies their stable `PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE` contract, fixed production Bubblewrap path, credential filtering, and privilege transition gate. Codex compatibility checks its non-interactive user-local installer contract.

The repository must expose these active backend ids through [`copilotProviderRelay`](wiki.html#definition-copilot-provider-relay):

- `open-interpreter`
- `web-search` (cacheable, TTL 86400s)
- `browser-use` (interactive, not cacheable)

The provider backends are not public chat or slash-command targets. They are adapter records inside [`copilotProviderRelay`](wiki.html#definition-copilot-provider-relay). Each adapter receives a natural-language prompt and materialized input resources. Active backends must declare `provider: { agent, tool }`; the relay forwards the task to that MCP tool with the router invocation token, and the provider agent owns runtime preparation and local sandbox execution. Future backends such as DeepAnalyze, OpenHands, Agentic Data Scientist, and MLJAR are reserved concepts, not active relay backends, until they have provider agents.

The relay must not own backend command strings, runtime ids, package versions, shim paths, model/provider setup, or direct backend-specific calls to a sandbox runner.

Only the [`research-agents`](wiki.html#definition-research-agents) bundle may auto-enable the relay. The default, `dev`, `qa`, and `prod` bundle profiles must enable [`copilotProviderRelay`](wiki.html#definition-copilot-provider-relay), [`openInterpreterAgent`](wiki.html#definition-open-interpreter), [`webSearchAgent`](wiki.html#definition-web-search), [`browserUseAgent`](wiki.html#definition-browser-use), and [`GPTResearcher`](wiki.html#definition-gpt-researcher); they must not enable `basic/bwrap-runner` or direct backend chat agents by default.

### Rationale

#### Rationale 1

The bundle is a deployment construct, while [`copilotProviderRelay`](wiki.html#definition-copilot-provider-relay) is the runtime provider-task relay. Keeping them separate allows the bundle to stay lightweight and keeps task-dispatch behavior out of deployment metadata.

#### Rationale 2

The chat-facing contract is "ask Copilot for a provider-backed task." A single relay validates backend ids, materializes resources, and forwards the request to the provider agent that owns that backend's runtime. This keeps the chat surface stable without making the relay responsible for backend runtimes or local sandbox execution.

#### Rationale 3

The name describes the stable role: provider-task relay behavior for Copilot launchers. The relay validates supported backend ids, materializes inputs, calls provider agents, and returns the provider result.

#### Rationale 4

The target architecture is backend-owned runtime setup with execution inside the provider's own container based on the shared bwrap-runner image. Advertising a backend before its provider exists would either force the relay to own backend command setup or produce a misleading half-enabled backend. Future backends become active only when their provider agent owns runtime preparation and sandbox execution.


The local repository inventory consists of one deployment bundle, one semantic relay (the **Copilot Provider Relay**, under the [`copilotProviderRelay`](wiki.html#definition-copilot-provider-relay) agent id), and provider agents for Open Interpreter, Web Search, and Browser Use. AchillesCLI-owned consumers remain explicit cross-repository compatibility surfaces. Additional backend ids require provider agents before they enter the active catalog.
