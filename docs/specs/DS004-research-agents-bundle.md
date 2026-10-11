---
title: DS004-research-agents-bundle
summary: Defines the explicit deployment bundle that enables the copilot provider relay suite without making it an Explorer default.
---

# DS004 - Research Agents Bundle

## Introduction

[`research-agents`](wiki.html#definition-research-agents) is the bundle agent used to deploy this repository's Copilot provider relay suite. It exists to keep deployment explicit and reversible.

## Core Content

The bundle must be a normal Ploinky agent directory named [`research-agents`](wiki.html#definition-research-agents). Operators should deploy the suite with:

```bash
ploinky enable agent copilot-agents/research-agents global
```

The implementation must not require or introduce a Ploinky core shorthand such as `ploinky enable research`, [`ploinky enable research-agents`](wiki.html#definition-research-agents), or any other research-specific availability command. Runtime deployment remains ordinary manifest enablement, and chat-provider selectability is derived from launcher skill discovery in the selected chat agent.

The bundle manifest may expose lightweight MCP status tools, but it must not run upstream research workloads. Its primary contract is the manifest `enable` graph.

The default bundle profile should enable:

- [`copilotProviderRelay global`](wiki.html#definition-copilot-provider-relay)
- [`openInterpreterAgent global no-wait`](wiki.html#definition-open-interpreter)
- [`webSearchAgent global no-wait`](wiki.html#definition-web-search)
- [`browserUseAgent global no-wait`](wiki.html#definition-browser-use)
- [`GPTResearcher global no-wait`](wiki.html#definition-gpt-researcher)

Current Ploinky only selects the global profile names `default`, `dev`, `qa`, and `prod`. The bundle must therefore use those names until Ploinky supports bundle-local profile selectors. The supported bundle profile mapping is:

- `default`: [`copilotProviderRelay global`](wiki.html#definition-copilot-provider-relay), [`openInterpreterAgent global no-wait`](wiki.html#definition-open-interpreter), [`webSearchAgent global no-wait`](wiki.html#definition-web-search), [`browserUseAgent global no-wait`](wiki.html#definition-browser-use), and [`GPTResearcher global no-wait`](wiki.html#definition-gpt-researcher)
- `dev`: same as `default`
- `qa`: same as `default`
- `prod`: same as `default`

Backend differences are controlled by provider agents and by the selected provider container image. Code-execution providers must use the shared bwrap-runner image as their sandbox base. Browser-search providers may use a browser-enabled container when they do not execute arbitrary code. Backend differences are not controlled by a separate `bwrap-runner` agent, direct backend chat agents, or relay-owned command configuration. Future provider backends must add provider agents before the bundle enables them.

The bundle must not be listed in AssistOSExplorer's default dependency list. Runtime activation and readiness must follow the selected Ploinky lifecycle contract.

Every optional provider entry remains `no-wait`, so an unavailable Open Interpreter provider cannot block relay, web search, browser use, GPTResearcher, or unrelated running agents. `research_agents_status` exposes this isolation contract and reports Open Interpreter's terminal `PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE` disposition. [GPTResearcher](wiki.html#definition-gpt-researcher) is an AchillesCLI-owned shared-image consumer and does not depend on a separately enabled sandbox service.

### Rationale

#### Rationale 1

A bundle agent is visible to Ploinky's manifest and registry model. It can use the existing `enable` graph, profiles, and no-wait semantics without adding an out-of-band deployment script that Ploinky cannot inspect.

#### Rationale 2

The runtime model moves backend execution into provider agents that run their own local sandboxes from the shared bwrap-runner image. Keeping all current profiles identical avoids exposing half-implemented direct chat agents or backends without provider ownership.

#### Rationale 3

Ploinky accepts default and profile names present in installed manifests. The bundle declares default, dev, qa and prod with the same provider graph; heavier provider-specific graphs require explicit manifest declarations and validated runtime contracts.

#### Rationale 4

The research execution dependency is the bwrap-runner image, not a Ploinky agent. Enabling a separate runner agent would reintroduce a central service that provider agents have to call, which is the coupling this architecture removes. Provider agents remain independently deployable Ploinky agents and use the shared sandbox image locally.

#### Rationale 5

The bundle is a deployment graph, not an all-or-nothing readiness barrier. Optional provider nodes use no-wait isolation. A deterministic, terminal Open Interpreter disposition therefore prevents futile retries without destabilizing the relay, browser/search providers, [GPTResearcher](wiki.html#definition-gpt-researcher), or existing routes.


The [`research-agents`](wiki.html#definition-research-agents) bundle is the only deployment path for this repository's provider relay suite and must enable [`copilotProviderRelay`](wiki.html#definition-copilot-provider-relay) plus provider agents such as [`openInterpreterAgent`](wiki.html#definition-open-interpreter), [`webSearchAgent`](wiki.html#definition-web-search), and [`browserUseAgent`](wiki.html#definition-browser-use), plus the direct OpenAI-compatible [`GPTResearcher`](wiki.html#definition-gpt-researcher) document agent, without exposing unsupported direct backend chat agents or enabling a separate `basic/bwrap-runner` agent.
