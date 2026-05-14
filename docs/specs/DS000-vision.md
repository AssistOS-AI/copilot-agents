---
id: DS000
title: Vision
status: planned
owner: copilot-agents-team
summary: Defines the purpose, boundaries, and success criteria for the Ploinky research agents repository.
---

# DS000 - Vision

## Introduction

`copilot-agents` is a Ploinky agent repository for explicitly deployed tagged research agents. It integrates provider-owned research backends that receive natural-language tasks from chat and execute inside each provider's own local bubblewrap sandbox while preserving AssistOSExplorer, WebMeet, AchillesCLI, and Ploinky boundaries. The active backend in this implementation is Open Interpreter through `openInterpreterAgent`; additional backends require provider agents before their tags become active.

## Core Content

The repository must provide research-task infrastructure that is usable inside a Ploinky workspace without becoming a default AssistOSExplorer dependency. A user or operator must explicitly enable the `research-agents` bundle before any research relay surface becomes active.

The repository must treat Ploinky as the runtime and trust broker. Browser launches, MCP calls, delegated calls, status checks, and any HTTP services must flow through Ploinky routing and authentication. Direct agent ports must not become public or documented integration surfaces.

The repository must treat AssistOSExplorer as the host shell. Explorer may discover and mount `IDE-plugins` after the research bundle is enabled, but Explorer must not absorb research-agent domain logic.

The repository must treat Copilot chat and WebMeet chat as tag surfaces, not as direct research-agent terminals. Messages such as `@open-interpreter summarize these notes` must be relayed to `researchRelay`, delegated to `openInterpreterAgent`, executed inside that provider's own local sandbox, and returned as natural-language chat output.

The implementation is complete only when the bundle deploys `researchRelay` and provider agents such as `openInterpreterAgent` without enabling a separate `bwrap-runner` agent, AchillesCLI Copilot chat can intercept configured research tags through explicit tag-relay launch parameters, WebMeet MCP chat can dispatch the same tags, and the relay returns a natural-language result or a clear backend-configuration error without exposing direct backend chat endpoints. Ploinky WebChat remains a generic transport and must not know the research relay agent id.

## Decisions & Questions

### Question #1: Why is this repository not enabled by Explorer by default?

Response:
The upstream research agents can execute code, run long research workflows, or require heavy Python and LaTeX dependencies. Keeping them behind an explicit Ploinky bundle command preserves Explorer's normal startup behavior and makes operator intent visible.

### Question #2: Why keep Explorer, AchillesCLI, and Ploinky responsibilities separate?

Response:
Explorer owns the IDE shell, AchillesCLI owns Copilot chat and skills, and Ploinky owns runtime deployment and routed MCP invocation. Preserving these boundaries prevents research-agent behavior from leaking into the wrong host and keeps future integration changes reviewable.

## Conclusion

The repository must deliver explicitly deployed tagged research agents that remain router-mediated, workspace-confined, plugin-hosted, chat-originated, and sandbox-executed inside provider containers based on the shared bwrap-runner image.
