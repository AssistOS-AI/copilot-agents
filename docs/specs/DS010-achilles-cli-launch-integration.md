---
id: DS010
title: AchillesCLI Tagged Chat Integration
status: implemented
owner: copilot-agents-team
summary: Defines how AchillesCLI Copilot chat participates in tagged research task dispatch.
---

# DS010 - AchillesCLI Launch Integration

## Introduction

AchillesCLI is already integrated into Explorer as a Copilot chat dependency. This specification defines how `copilot-agents` uses that existing path for tagged research tasks without making AchillesCLI own backend-specific runtime logic.

## Core Content

The current integration path must use AchillesCLI's configured WebChat tag-relay mode. `researchRelay` should open AchillesCLI WebChat with query parameters equivalent to:

```text
/webchat?agent=achilles-cli&research-tags=1&forward-envelope=1&tag-relay-agent=researchRelay&tag-relay-submit-tool=research_task_submit&tag-relay-tags=open-interpreter,oi&tag-relay-list-tool=research_relay_list_backends&dir=<selectedFsPath>
```

The preferred URL shape is now:

```text
/webchat?agent=achilles-cli&research-tags=1&forward-envelope=1&tag-relay-agent=researchRelay&tag-relay-submit-tool=research_task_submit&tag-relay-tags=open-interpreter,oi&tag-relay-list-tool=research_relay_list_backends&workspace-dir=<relativeWorkspacePath>
```

`dir=<absolutePath>` remains a Ploinky WebChat compatibility parameter, but Explorer plugins owned by this repository must avoid exposing absolute host paths in browser URLs.

Ploinky WebChat is only the transport. It must forward agent-owned query parameters to AchillesCLI and, when `forward-envelope=1` is present, send the WebChat envelope with sanitized attachment metadata and the selected-agent invocation token. It must not detect research tags, name `researchRelay`, call `research_task_submit`, or own the known-backend catalog.

When `research-tags=1` and the tag-relay parameters are present, AchillesCLI must detect only tags named by `tag-relay-tags` or, if no explicit tag list is provided, tags returned by `researchRelay.research_relay_list_backends`. It must materialize supported shared attachments, call `researchRelay.research_task_submit`, and write the natural-language result back to stdout for the same WebChat stream. Unknown mentions such as `@teammate` must fall through to AchillesCLI as normal chat. Tagged research messages must not be forwarded to AchillesCLI as normal LLM prompts after the relay handles them.

When `forward-envelope=1` is present and a message is not a research tag, WebChat may forward the full WebChat envelope to AchillesCLI. AchillesCLI must normalize that envelope back to plain text before invoking slash or natural-language paths so ordinary chat is not polluted by raw JSON. Attachment metadata may be appended as readable context for non-research prompts.

The legacy `launch-open-interpreter` cskill may remain for migration, but it is no longer the primary contract. Exact direct commands such as `/open-interpreter` are out of scope unless implemented as generic tag aliases that submit to the same relay.

## Decisions & Questions

### Question #1: Why keep tag interception out of Ploinky WebChat?

Response:
Ploinky is the framework transport and must not know optional catalog agents such as `researchRelay`. AchillesCLI is the selected chat agent, so it can opt into a generic tag-relay mode through explicit launch parameters. The relay still owns the backend catalog and provider routing, while Ploinky only carries the envelope and invocation grant.

### Question #2: Why still normalize WebChat envelopes in AchillesCLI?

Response:
Envelope forwarding is useful for attachment-aware chat surfaces. AchillesCLI must tolerate it even when a message is not a research tag, otherwise ordinary Copilot prompts would receive raw `__webchatMessage` JSON.

## Conclusion

The AchillesCLI integration must preserve normal Copilot chat while allowing the explicitly configured tag relay to handle known research tags and return relay output in the same stream.
