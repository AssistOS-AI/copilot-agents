---
id: DS000
title: Vision
status: planned
owner: copilot-agents-team
summary: Defines the purpose, boundaries, and success criteria for the Ploinky research agents repository.
---

# DS000 - Vision

## Introduction

`copilot-agents` is a Ploinky agent repository for explicitly deployed research and development copilots. It integrates Open Interpreter, OpenHands, Agent Laboratory, and The AI Scientist through Ploinky MCP agents while preserving AssistOSExplorer and AchillesCLI boundaries.

## Core Content

The repository must provide agent implementations that are usable inside a Ploinky workspace without becoming default AssistOSExplorer dependencies. A user or operator must explicitly enable the research-agent bundle before any research copilot surfaces or execution agents become active.

The repository must treat Ploinky as the runtime and trust broker. Browser launches, MCP calls, delegated calls, status checks, and any HTTP services must flow through Ploinky routing and authentication. Direct agent ports must not become public or documented integration surfaces.

The repository must treat AssistOSExplorer as the host shell. Explorer may discover and mount `IDE-plugins` after the research bundle is enabled, but Explorer must not absorb research-agent domain logic.

The repository must treat AchillesCLI as the Copilot chat launch surface. The first integration path must work through AchillesCLI external skill roots and `/exec <skill-name>`. Exact direct slash commands such as `/open-interpreter` require a later generic AchillesCLI dynamic slash-alias extension.

The first useful slice is complete only when the bundle agent can deploy the lightweight suite, Open Interpreter exposes a bounded MCP tool, Explorer can discover the research copilot plugin after explicit deployment, and AchillesCLI WebChat can load the launcher skill root and run `/exec launch-open-interpreter`.

## Decisions & Questions

### Question #1: Why is this repository not enabled by Explorer by default?

Response:
The upstream research agents can execute code, run long research workflows, or require heavy Python and LaTeX dependencies. Keeping them behind an explicit Ploinky bundle command preserves Explorer's normal startup behavior and makes operator intent visible.

### Question #2: Why keep Explorer, AchillesCLI, and Ploinky responsibilities separate?

Response:
Explorer owns the IDE shell, AchillesCLI owns Copilot chat and skills, and Ploinky owns runtime deployment and routed MCP invocation. Preserving these boundaries prevents research-agent behavior from leaking into the wrong host and keeps future integration changes reviewable.

## Conclusion

The repository must deliver explicitly deployed Ploinky research agents that remain router-mediated, workspace-confined, plugin-hosted, and launchable from the existing AchillesCLI Copilot path.
