---
title: DS012-semantic-copilot-routing
summary: Defines optional consumer launchers, authenticated provider dispatch and cacheability boundaries without assuming built-in RoboTeam integration.
---

# DS012 - Semantic Copilot Routing and Launcher Skills

## Introduction

Provider selection belongs to the consuming application. This repository supplies deterministic launcher cskills and provider tools; it does not implement a semantic router inside RoboTeam.

## Core Content

A consuming application owns semantic routing. Ploinky WebChat remains a transport-only surface that forwards prompt text, sanitized WebChat envelopes, attachments, workspace references, and the selected-agent invocation token. Ploinky WebChat must not know [`copilotProviderRelay`](wiki.html#definition-copilot-provider-relay), [`openInterpreterAgent`](wiki.html#definition-open-interpreter), backend ids, provider MCP tool names, or AKU result-cache policy.

RoboTeam uses ALA and Anthropic instruction skills. Its bundled catalog does not contain the historical copilot-router oskill or the provider launch-* cskills. Consumer-specific prompt interpretation must remain outside Ploinky WebChat and the provider relay.

Each provider launcher is a deterministic cskill. A launcher validates that the provider path is available, materializes only safe context supplied by the consuming application, calls [`copilotProviderRelay.copilot_provider_task_submit`](wiki.html#definition-copilot-provider-relay) through Ploinky's certified [`AgentMcpClient`](wiki.html#definition-agent-mcp-client) after signed [Router](wiki.html#definition-router) descriptor verification. The current invocation token is carried as user delegation metadata, and the launcher returns structured output:

```json
{
  "ok": true,
  "backend": "open-interpreter",
  "cacheable": false,
  "result_text": "natural-language answer",
  "persistence_hint": {
    "ku_type": "code_work",
    "record_result": true,
    "ttl_hint_seconds": null
  },
  "diagnostics": {}
}
```

[`copilotProviderRelay`](wiki.html#definition-copilot-provider-relay) remains the secure dispatcher to provider agents. AchillesCLI launchers must not bypass it by directly calling provider agents such as [`openInterpreterAgent`](wiki.html#definition-open-interpreter) for task execution. A provider-specific launcher may call that provider's status tool with the same verified [`AgentMcpClient`](wiki.html#definition-agent-mcp-client) and current invocation token before submitting to the relay; this is an availability probe, not execution dispatch, and must remain out of Ploinky framework code.

Open Interpreter is an execution backend. Its launcher must set `cacheable: false`; repeated execution prompts must execute again.

Web Search is a pure-information provider. Its launcher `launch-web-search` declares `cacheable: true` and `ttl_hint_seconds: 86400`. The [`webSearchAgent`](wiki.html#definition-web-search) provider executes searches through its own local headless browser runtime and returns a markdown answer with citations. The `persistence_hint.ku_type` is `agent.result.web-search`. If the local browser runtime is not configured, the provider returns a clear unavailable message instead of fabricating information. Deprecated tokens such as `@web-search` and `@search` are ordinary chat text and must not trigger provider dispatch.

Browser Use is an interactive provider. Its launcher `launch-browser-use` declares `cacheable: false`. The [`browserUseAgent`](wiki.html#definition-browser-use) provider controls persistent Chromium sessions for logged-in web application tasks. When login is required, the launcher returns a protected viewer URL and waiting instructions. The `persistence_hint.ku_type` is `agent.result.browser-use`. Deprecated tokens such as `@browser-use` and `@browser` are ordinary chat text and must not trigger provider dispatch.

Browser-use launcher dispatch may include a provider id. Provider selection uses explicit provider input first, then provider aliases from the `browser_use_status` provider catalog matched against the prompt, then the provider marked `default` in the [`browserUseAgent`](wiki.html#definition-browser-use) registry. Browser providers are subproviders of [`browserUseAgent`](wiki.html#definition-browser-use), not separate relay backends. The relay preserves this provider selection when calling [`browserUseAgent.browser_use_run_task`](wiki.html#definition-browser-use).

Result caching and durable memory are consumer policy. The distributed launchers return persistence hints; they do not implement an automatic AKU cache. A consumer using AgenticKnowledgeUnits must use its public APIs and must not store secrets, invocation tokens, hidden reasoning, raw private prompts or sensitive resource content.

Provider launchers live under this repository's achilles-skills/ directory and retain self-contained descriptors and source. A consumer must install compatible skills explicitly. The sibling RoboTeam skill-selection policy is a separate instruction-skill contract and does not automatically discover these typed cskills.

### Rationale

#### Rationale 1

Users should ask for the work they want, not memorize provider names. Semantic routing also keeps Ploinky WebChat agent-agnostic and places provider policy in AchillesCLI, where prompt interpretation already belongs.

#### Rationale 2

The relay is the secure dispatcher that validates backend ids, materializes bounded resources, and forwards provider tasks with router invocation grants. Keeping it in the path prevents AchillesCLI launchers from duplicating path confinement and result normalization logic.

#### Rationale 3

Open Interpreter performs execution. Reusing an old execution result for a new run would hide side effects, stale code, or changed files. The result may be recorded as durable work when useful, but it is never an automatic cache hit.

#### Rationale 4

Static relay catalogs can show a backend contract while the provider route is not actually reachable. A bounded provider status probe lets the launcher return an explicit unavailable-provider result before task submission. The probe uses the verified [`AgentMcpClient`](wiki.html#definition-agent-mcp-client) and the current invocation token as user delegation metadata, and execution still flows through [`copilotProviderRelay.copilot_provider_task_submit`](wiki.html#definition-copilot-provider-relay).

#### Rationale 5

Generated-local routing separates the physical connection origin from the signed request authority. Native `fetch` and hand-built `/mcps/` calls used the physical Host and could receive HTTP 421. [`AgentMcpClient`](wiki.html#definition-agent-mcp-client) owns descriptor verification, authority presentation, agent assertions, and user delegation without redirects or alternate-Host retries.


Provider invocation must use a selected launcher or another authorized MCP consumer, the authenticated relay and the provider-owned runtime. Visible @agent text is not an invocation token.
