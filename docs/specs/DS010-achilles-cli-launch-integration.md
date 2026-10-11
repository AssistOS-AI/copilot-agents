---
title: DS010-achilles-cli-launch-integration
summary: Defines how AchillesCLI Copilot launches semantic provider tasks through deterministic launcher skills and the Copilot Provider Relay.
---

# DS010 - AchillesCLI Launch Integration

## Introduction

RoboTeam is the AchillesCLI-owned conversational agent used by Explorer. This provider repository contributes generic launch metadata and optional compatibility skills; it does not install them into RoboTeam conversations or choose their instruction-skill policy.

## Core Content

Explorer must keep the normal `Open Copilot here` action as the only visible chat entry point. Launch metadata may add only generic Copilot transport parameters, such as envelope forwarding and workspace-relative directory selection. It must not add provider backend ids, provider MCP tool names, or legacy relay launch parameters to the WebChat URL.

The preferred URL shape is:

```text
/webchat?agent=roboTeamAgent&robot=default&forward-envelope=1&workspace-dir=<relativeWorkspacePath>
```

`dir=<absolutePath>` remains a Ploinky WebChat compatibility parameter, but Explorer launch extensions owned by this repository must avoid exposing absolute host paths in browser URLs when a workspace-relative path can be computed.

Ploinky WebChat is only the transport. It may forward generic launch parameters to AchillesCLI and, when `forward-envelope=1` is present, send the WebChat envelope with sanitized attachment metadata, generic workspace references, and the selected-agent invocation token. It must not detect provider mentions, name [`copilotProviderRelay`](wiki.html#definition-copilot-provider-relay), call `copilot_provider_task_submit`, or own a provider catalog.

The Copilot Provider Relay must not contribute an `Open Copilot Provider Relay here` Explorer menu action or a separate visible toolbar button. Doing so creates two chat entry points and contradicts the user model: open Copilot, then ask for the work in natural language.

Consumer applications that install a provider launcher must submit execution through [copilotProviderRelay](wiki.html#definition-copilot-provider-relay) using [AgentMcpClient](wiki.html#definition-agent-mcp-client) and the current [Router](wiki.html#definition-router) delegation token. The bundled RoboTeam copilot has bash and launch-gpt-researcher, plus its workflow skills; it does not include copilot-router, launch-open-interpreter or launch-web-search. Provider-looking @word text alone establishes no dispatch contract.

Provider deployment and launcher selection are separate requirements. The [research-agents](wiki.html#definition-research-agents) bundle enables runtime providers; a consumer must expose its selected launcher before it can invoke that provider from a conversation. A local catalog entry or compatibility test does not prove that RoboTeam has installed the skill.

When `forward-envelope=1` is present, WebChat may forward the full WebChat envelope to AchillesCLI. AchillesCLI must normalize that envelope back to plain text before invoking slash or natural-language paths so ordinary chat is not polluted by raw JSON. Attachment metadata may be appended as readable context for non-provider prompts. If the envelope includes a sanitized `origin.publicBaseUrl` hint, AchillesCLI should pass it through launcher context so user-facing provider links can use the same browser origin as WebChat rather than container-internal router hosts.

The optional launch-open-interpreter cskill is distributed under achilles-skills/launch-open-interpreter. It probes provider status with [AgentMcpClient](wiki.html#definition-agent-mcp-client), submits execution to the relay and returns non-cacheable output. Its presence in this repository does not make it an AchillesCLI built-in.

The optional launch-web-search cskill is distributed under achilles-skills/launch-web-search. It probes availability, submits to the relay and preserves cacheable results with a TTL hint of 86400 seconds and persistence_hint.ku_type agent.result.web-search. The consuming application owns selection and cache policy.

### Rationale

#### Rationale 1

Ploinky is the framework transport and must not know optional catalog agents such as [`copilotProviderRelay`](wiki.html#definition-copilot-provider-relay). AchillesCLI is the selected chat agent, so it owns prompt interpretation and provider launcher policy. The relay still owns secure provider dispatch, while Ploinky only carries the envelope and invocation grant.

#### Rationale 2

Envelope forwarding is useful for attachment-aware chat surfaces. AchillesCLI must tolerate it for ordinary prompts, otherwise Copilot prompts would receive raw `__webchatMessage` JSON.

#### Rationale 3

Launcher calls carry both an agent assertion and the current user's delegation grant. The platform client verifies the signed [Router](wiki.html#definition-router) descriptor before either credential can reach a socket and presents the descriptor's request authority without retrying a different Host after HTTP 421.


Generic Explorer launch metadata preserves ordinary RoboTeam chat. Provider dispatch requires a separately installed consumer integration and must not be inferred from the relay catalog.
