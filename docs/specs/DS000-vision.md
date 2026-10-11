---
title: DS000-vision
summary: Defines the purpose, boundaries, and success criteria for the Ploinky research agents repository.
---

# DS000 - Vision

## Introduction

`copilot-agents` is a Ploinky agent repository for explicitly deployed research providers. It integrates provider-owned backends that receive natural-language tasks through AchillesCLI Copilot launchers and execute inside each provider's own local bubblewrap sandbox while preserving AssistOSExplorer, WebMeet, AchillesCLI, and Ploinky boundaries. The active backend in this implementation is Open Interpreter through [`openInterpreterAgent`](wiki.html#definition-open-interpreter); additional backends require provider agents before semantic launchers can use them.

## Core Content

The repository must provide research-task infrastructure that is usable inside a Ploinky workspace without becoming a default AssistOSExplorer dependency. Runtime relay and provider containers are deployed explicitly through the [`research-agents`](wiki.html#definition-research-agents) bundle, while Copilot availability is determined by launcher skills discovered by the selected chat agent.

The repository must treat Ploinky as the runtime and trust broker. Browser launches, MCP calls, delegated calls, status checks, and any convention-routed agent HTTP traffic must flow through Ploinky routing and authentication. Direct agent ports must not become public or documented integration surfaces.

The repository must treat AssistOSExplorer as the host shell. Explorer may discover and mount `IDE-plugins` after the research bundle is enabled, but Explorer must not absorb research-agent domain logic.

A consuming chat agent owns prompt interpretation and provider selection. The provider suite exposes bounded MCP tasks and must keep provider policy out of Ploinky WebChat. This repository distributes optional launcher skills under `achilles-skills/`; a consumer must select and install them explicitly. RoboTeam does not provide those launchers as its bundled skillset.

The bundle must deploy the relay and declared provider agents without enabling a separate bwrap-runner agent. Authorized MCP callers receive natural-language output or an explicit provider refusal. Ploinky WebChat remains a generic transport and must not know the provider relay agent id.

### Rationale

#### Rationale 1

The upstream research agents can execute code, run long research workflows, or require heavy Python and LaTeX dependencies. Keeping runtime containers behind an explicit manifest bundle preserves Explorer's normal startup behavior and makes operator intent visible. The bundle is not a chat availability switch: Copilot can select a provider only when AchillesCLI or another selected chat agent exposes the matching launcher skill.

#### Rationale 2

Explorer owns the IDE shell, AchillesCLI owns Copilot chat and skills, and Ploinky owns runtime deployment and routed MCP invocation. Preserving these boundaries prevents research-agent behavior from leaking into the wrong host and keeps future integration changes reviewable.


The repository must deliver explicitly deployed research providers that remain router-mediated, workspace-confined, plugin-hosted, Copilot-routed, and sandbox-executed inside provider containers based on the shared bwrap-runner image.
