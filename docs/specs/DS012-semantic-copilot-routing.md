---
id: DS012
title: Semantic Copilot Routing and Launcher Skills
status: implemented
owner: copilot-agents-team
summary: Defines the semantic AchillesCLI Copilot routing contract, deterministic provider launchers, and cacheability boundaries for provider-backed tasks.
---

# DS012 - Semantic Copilot Routing and Launcher Skills

## Introduction

Research providers are selected by AchillesCLI Copilot from the user's prompt,
runtime context, attachments, and available provider capabilities. Users do
not dispatch providers with visible `@agent` syntax.

## Core Content

AchillesCLI owns semantic routing. Ploinky WebChat remains a transport-only
surface that forwards prompt text, sanitized WebChat envelopes, attachments,
workspace references, and the selected-agent invocation token. Ploinky WebChat
must not know `copilotProviderRelay`, `openInterpreterAgent`, backend ids, provider
MCP tool names, or AKU result-cache policy.

The `copilot-router` skill is an AchillesCLI orchestration skill using
`## Session Type: loop`. It decides whether to answer normally or call a
deterministic provider launcher cskill. Deprecated tokens such as
`@open-interpreter` are ordinary chat text and must not trigger provider
dispatch. Generic `@file:` or workspace-path references may remain file
reference syntax.

Each provider launcher is a deterministic cskill. A launcher validates that
the provider path is available, materializes only safe context supplied by
AchillesCLI, calls `copilotProviderRelay.copilot_provider_task_submit` through
router-mediated MCP with the current invocation token, and returns structured
output:

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

`copilotProviderRelay` remains the secure dispatcher to provider agents. AchillesCLI
launchers must not bypass it by directly calling provider agents such as
`openInterpreterAgent` for task execution. A provider-specific launcher may call
that provider's status tool through router-mediated MCP with the current
invocation token before submitting to the relay; this is an availability probe,
not execution dispatch, and must remain out of Ploinky framework code.

Open Interpreter is an execution backend. Its launcher must set
`cacheable: false`; repeated execution prompts must execute again.

Web Search is a pure-information provider. Its launcher `launch-web-search`
declares `cacheable: true` and `ttl_hint_seconds: 86400`. The
`webSearchAgent` provider executes searches through its own local headless
browser runtime and returns a markdown answer with citations. The
`persistence_hint.ku_type` is `agent.result.web-search`. If the local browser
runtime is not configured, the provider returns a clear unavailable message
instead of fabricating information. Deprecated tokens such as `@web-search`
and `@search` are ordinary chat text and must not trigger provider dispatch.

Browser Use is an interactive provider. Its launcher `launch-browser-use`
declares `cacheable: false`. The `browserUseAgent` provider controls persistent
Chromium sessions for logged-in web application tasks. When login is required,
the launcher returns a protected viewer URL and waiting instructions. The
`persistence_hint.ku_type` is `agent.result.browser-use`. Deprecated tokens
such as `@browser-use` and `@browser` are ordinary chat text and must not
trigger provider dispatch.

Browser-use launcher dispatch may include a provider id. Provider selection
uses explicit provider input first, then provider aliases from the
`browser_use_status` provider catalog matched against the prompt, then the
provider marked `default` in the `browserUseAgent` registry. Browser
providers are subproviders of `browserUseAgent`, not separate relay backends.
The relay preserves this provider selection when calling
`browserUseAgent.browser_use_run_task`.

AKU result caching is AchillesCLI policy. Cache lookup and persistence must go
through `AkuMemoryAdapter` and the public `AgenticKnowledgeUnits` APIs only.
Launchers and adapters must not store secrets, invocation tokens, hidden
reasoning, raw private prompts, or sensitive file content in AKU records or
logs.

Provider launcher skills live in AchillesCLI's built-in skill root so they are
discoverable without relying on a host-specific `copilot-agents/achilles-skills`
path. The `copilot-agents/achilles-skills` copy remains a compatibility source
for packaging and tests, but AchillesCLI runtime discovery is explicit and
owned by AchillesCLI.

## Decisions & Questions

### Question #1: Why route semantically?

Response:
Users should ask for the work they want, not memorize provider names. Semantic
routing also keeps Ploinky WebChat agent-agnostic and places provider policy in
AchillesCLI, where prompt interpretation already belongs.

### Question #2: Why keep `copilotProviderRelay` between Copilot launchers and providers?

Response:
The relay is the secure dispatcher that validates backend ids, materializes
bounded resources, and forwards provider tasks with router invocation grants.
Keeping it in the path prevents AchillesCLI launchers from duplicating path
confinement and result normalization logic.

### Question #3: Why is Open Interpreter not cacheable?

Response:
Open Interpreter performs execution. Reusing an old execution result for a new
run would hide side effects, stale code, or changed files. The result may be
recorded as durable work when useful, but it is never an automatic cache hit.

### Question #4: Why may a launcher call a provider status tool directly?

Response:
Static relay catalogs can show a backend contract while the provider route is
not actually reachable. A bounded provider status probe lets the launcher return
an explicit unavailable-provider result before task submission. The probe uses
router-mediated MCP and the current invocation token, and execution still flows
through `copilotProviderRelay.copilot_provider_task_submit`.

## Conclusion

Copilot provider invocation is now semantic, launcher-mediated, relay-dispatched,
and cache-policy-aware. Visible `@agent` routing is not part of the user
contract.
