---
id: DS010
title: AchillesCLI Semantic Copilot Integration
status: implemented
owner: copilot-agents-team
summary: Defines how AchillesCLI Copilot launches semantic provider tasks through deterministic launcher skills and the Research Relay.
---

# DS010 - AchillesCLI Launch Integration

## Introduction

AchillesCLI is integrated into Explorer as the Copilot chat dependency. This
specification defines how `copilot-agents` participates in that path after the
visible tagged-chat contract has been replaced by semantic Copilot routing.

## Core Content

Explorer must keep the normal `Open Copilot here` action as the only visible
chat entry point. Launch metadata may add only generic Copilot transport
parameters, such as envelope forwarding and workspace-relative directory
selection. It must not add `research-tags`, `tag-relay-*`, provider backend
tags, or provider MCP tool names to the WebChat URL.

The preferred URL shape is:

```text
/webchat?agent=achilles-cli&forward-envelope=1&workspace-dir=<relativeWorkspacePath>
```

`dir=<absolutePath>` remains a Ploinky WebChat compatibility parameter, but Explorer launch extensions owned by this repository must avoid exposing absolute host paths in browser URLs when a workspace-relative path can be computed.

Ploinky WebChat is only the transport. It may forward generic launch parameters
to AchillesCLI and, when `forward-envelope=1` is present, send the WebChat
envelope with sanitized attachment metadata, generic workspace references, and
the selected-agent invocation token. It must not detect research tags, name
`researchRelay`, call `research_task_submit`, or own a provider catalog.

The Research Relay must not contribute an `Open Research Relay here` Explorer
menu action or a separate visible toolbar button. Doing so creates two chat
entry points and contradicts the user model: open Copilot, then ask for the
work in natural language.

AchillesCLI must route non-slash Copilot WebChat turns through its
`copilot-router` oskill. The router may call deterministic provider launcher
cskills, such as `launch-open-interpreter`, when the prompt and context require
execution. Launchers call `researchRelay.research_task_submit` through
router-mediated MCP with the current invocation token and return
natural-language result text. Deprecated text such as `@open-interpreter list
primes` is ordinary chat text and must not trigger provider dispatch.

Provider availability for semantic Copilot routing is defined by launcher skill
discovery. If AchillesCLI discovers a `launch-*` skill, the corresponding
provider can be selected by the router; no Ploinky `enable research` command,
bundle command, or WebChat toggle participates in that decision. A launcher may
still return a clear runtime-unavailable message when the relay catalog or
provider status probe fails, but that message must not instruct the user to run
a Ploinky research enable command.

When `forward-envelope=1` is present and a message is not a research tag, WebChat may forward the full WebChat envelope to AchillesCLI. AchillesCLI must normalize that envelope back to plain text before invoking slash or natural-language paths so ordinary chat is not polluted by raw JSON. Attachment metadata may be appended as readable context for non-research prompts.

The `launch-open-interpreter` cskill is the deterministic launcher for Open
Interpreter execution. It is discoverable from AchillesCLI's built-in skill
root, validates relay availability, performs a bounded provider status probe
through router-mediated MCP, forwards only file path strings to the relay,
submits execution through `researchRelay`, and declares `cacheable: false`.

The `launch-web-search` cskill is the deterministic launcher for cacheable web
search. It validates relay and provider availability, submits the search query
through `researchRelay`, and declares `cacheable: true` with
`ttl_hint_seconds: 86400`. Its `persistence_hint.ku_type` is
`agent.result.web-search`. Web search is selected semantically by AchillesCLI,
not through visible `@web-search` or `@search` tags.

## Decisions & Questions

### Question #1: Why keep provider routing out of Ploinky WebChat?

Response:
Ploinky is the framework transport and must not know optional catalog agents
such as `researchRelay`. AchillesCLI is the selected chat agent, so it owns
prompt interpretation and provider launcher policy. The relay still owns secure
provider dispatch, while Ploinky only carries the envelope and invocation grant.

### Question #2: Why still normalize WebChat envelopes in AchillesCLI?

Response:
Envelope forwarding is useful for attachment-aware chat surfaces. AchillesCLI must tolerate it even when a message is not a research tag, otherwise ordinary Copilot prompts would receive raw `__webchatMessage` JSON.

## Conclusion

The AchillesCLI integration preserves normal Copilot chat while allowing
semantic Copilot routing to invoke deterministic provider launchers and return
relay output in the same stream.
