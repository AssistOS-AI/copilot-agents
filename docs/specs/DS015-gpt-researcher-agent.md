---
id: DS015
title: GPTResearcher OpenAI Research Agent
status: implemented
owner: copilot-agents-team
summary: Defines the GPTResearcher agent that accepts OpenAI-compatible requests, reads workspace context, uses configurable web search, and writes research documents into the workspace.
---

# DS015 - GPTResearcher OpenAI Research Agent

## Introduction

`GPTResearcher` is a native Ploinky research agent for document generation.
Unlike the MCP provider agents in this repository, its primary execution
surface is the OpenAI-compatible `/v1/chat/completions` HTTP endpoint. It is
intended for callers that already speak the OpenAI chat-completions protocol
and need a workspace-local research document as the output artifact.

## Core Content

The agent must run as a repository-owned Ploinky agent directory named
`GPTResearcher`. Its canonical id is `agent:copilot-agents/GPTResearcher`.
The runtime must use the bundled Ploinky `AgentServer.mjs`; the manifest
declares `endpoints.chatCompletions.command` and `args` for the handler script.
The runtime must expose `/health`, an authenticated `/v1/chat/completions`
surface, static IDE plugin assets, and exactly one MCP settings tool named
`gpt_researcher_update_settings`. It must not expose research work as MCP tools
and must not replace the bundled AgentServer with a custom HTTP server.

The chat-completions handler must extract the latest user message, inspect
readable local workspace files, optionally search the web through the selected
provider, and write the generated research artifact into the mounted project
folder. Markdown is the default document format. If the prompt names a safe
`.md`, `.txt`, `.json`, or `.html` output file, the handler may use that name,
but output path resolution must keep the file inside the workspace root.

The local workspace scan must skip dependency caches, repository internals,
Ploinky runtime folders, build outputs, large files, binary content, and
secret-like filenames. The generated response must report the relative output
path, local files used, selected provider, collected sources, and any provider
warning.

Search configuration must default to DuckDuckGo. The supported provider ids are
`duckduckgo`, `tavily`, `serper`, `google`, `bing`, and `searxng`. The selected
provider and non-secret parameters must be stored in workspace-local
`.gpt-researcher/settings.json`, written by the MCP settings tool. OpenAI
requests must read that file internally instead of carrying settings in the
request body. API keys remain credentials and must come from environment or
secret injection, not from committed files or browser-local plugin state.
Provider-specific missing configuration must be reported without printing raw
secrets.

The `GPTResearcher` IDE plugin must contribute a workspace settings entry
with a provider dropdown and non-secret parameter fields. The plugin stores the
settings by calling `gpt_researcher_update_settings` through `/GPTResearcher/mcp`;
that tool writes `.gpt-researcher/settings.json` in the current workspace.
Static plugin assets may be guest-readable through the explicit
`/IDE-plugins/gpt-researcher-settings/*` route.

The `research-agents` bundle must enable `GPTResearcher global no-wait`
alongside the relay and provider agents. GPTResearcher is not a
`copilotProviderRelay` backend until a separate relay contract explicitly
defines such dispatch.

## Decisions & Questions

### Question #1: Why is GPTResearcher not exposed as an MCP tool?

Response:
The intended caller uses the OpenAI-compatible chat-completions API directly.
Adding a research MCP tool would create a second execution contract and would
make provider configuration and artifact generation harder to reason about.
The only non-chat HTTP surface is the authenticated settings endpoint used by
the IDE plugin.

### Question #2: Why does GPTResearcher use the bundled AgentServer command hook?

Response:
Ploinky already mounts and starts the bundled AgentServer in agent containers.
Declaring `endpoints.chatCompletions` keeps the public HTTP contract aligned
with the rest of Ploinky and avoids a second custom server implementation.
Provider settings are written through the narrow MCP settings tool and then
read from the workspace file by the OpenAI handler instead of being passed in
each OpenAI request or through a custom settings route.

### Question #3: Why is DuckDuckGo the default provider?

Response:
DuckDuckGo gives a zero-secret startup path. API-backed providers such as
Tavily, Serper, Google, and Bing are available when operators provide their
keys. SearXNG is available when an operator provides a self-hosted or trusted
instance URL.

## Conclusion

`GPTResearcher` adds a direct OpenAI-compatible document-research agent to the
repository. It remains router-mediated, keeps provider configuration explicit,
stores no raw secrets, and writes generated artifacts only inside the mounted
workspace.
