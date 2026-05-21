---
id: DS000
title: Vision
status: planned
owner: copilot-agents-team
summary: Defines the purpose, boundaries, and success criteria for the Ploinky research agents repository.
---

# DS000 - Vision

## Introduction

`copilot-agents` is a Ploinky agent repository for explicitly deployed research providers. It integrates provider-owned backends that receive natural-language tasks through AchillesCLI Copilot launchers and execute inside each provider's own local bubblewrap sandbox while preserving AssistOSExplorer, WebMeet, AchillesCLI, and Ploinky boundaries. The active backend in this implementation is Open Interpreter through `openInterpreterAgent`; additional backends require provider agents before semantic launchers can use them.

## Core Content

The repository must provide research-task infrastructure that is usable inside a Ploinky workspace without becoming a default AssistOSExplorer dependency. Runtime relay and provider containers are deployed explicitly through the `research-agents` bundle, while Copilot availability is determined by launcher skills discovered by the selected chat agent.

The repository must treat Ploinky as the runtime and trust broker. Browser launches, MCP calls, delegated calls, status checks, and any HTTP services must flow through Ploinky routing and authentication. Direct agent ports must not become public or documented integration surfaces.

The repository must treat AssistOSExplorer as the host shell. Explorer may discover and mount `IDE-plugins` after the research bundle is enabled, but Explorer must not absorb research-agent domain logic.

The repository must treat AchillesCLI Copilot as the semantic routing owner, not as a user-visible tag dispatcher. Launcher skills submit routed provider tasks to `copilotProviderRelay`, which delegates to provider agents such as `openInterpreterAgent`, executes inside that provider's own local sandbox, and returns natural-language output. User text such as `@open-interpreter summarize these notes` is ordinary chat text unless the semantic router chooses a provider from the actual request.

The implementation is complete only when the bundle deploys `copilotProviderRelay` and provider agents such as `openInterpreterAgent` without enabling a separate `bwrap-runner` agent, AchillesCLI Copilot can route execution requests through deterministic provider launcher skills, WebMeet treats provider-looking `@word` text as ordinary chat, and the relay returns a natural-language result or a clear backend-configuration error without exposing direct backend chat endpoints. Ploinky WebChat remains a generic transport and must not know the copilot provider relay agent id.

## Decisions & Questions

### Question #1: Why is this repository not enabled by Explorer by default?

Response:
The upstream research agents can execute code, run long research workflows, or require heavy Python and LaTeX dependencies. Keeping runtime containers behind an explicit manifest bundle preserves Explorer's normal startup behavior and makes operator intent visible. The bundle is not a chat availability switch: Copilot can select a provider only when AchillesCLI or another selected chat agent exposes the matching launcher skill.

### Question #2: Why keep Explorer, AchillesCLI, and Ploinky responsibilities separate?

Response:
Explorer owns the IDE shell, AchillesCLI owns Copilot chat and skills, and Ploinky owns runtime deployment and routed MCP invocation. Preserving these boundaries prevents research-agent behavior from leaking into the wrong host and keeps future integration changes reviewable.

## Conclusion

The repository must deliver explicitly deployed research providers that remain router-mediated, workspace-confined, plugin-hosted, Copilot-routed, and sandbox-executed inside provider containers based on the shared bwrap-runner image.
