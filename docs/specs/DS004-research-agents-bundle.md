---
id: DS004
title: Research Agents Bundle
status: planned
owner: copilot-agents-team
summary: Defines the explicit deployment bundle that enables the copilot provider relay suite without making it an Explorer default.
---

# DS004 - Research Agents Bundle

## Introduction

`research-agents` is the bundle agent used to deploy this repository's Copilot
provider relay suite. It exists to keep deployment explicit and reversible.

## Core Content

The bundle must be a normal Ploinky agent directory named `research-agents`. Operators should deploy the suite with:

```bash
ploinky enable agent copilot-agents/research-agents global
```

The implementation must not require or introduce a Ploinky core shorthand such as `ploinky enable research`, `ploinky enable research-agents`, or any other research-specific availability command. Runtime deployment remains ordinary manifest enablement, and chat-provider selectability is derived from launcher skill discovery in the selected chat agent.

The bundle manifest may expose lightweight MCP status tools, but it must not run upstream research workloads. Its primary contract is the manifest `enable` graph.

The default bundle profile should enable:

- `copilotProviderRelay global`
- `openInterpreterAgent global no-wait`
- `webSearchAgent global no-wait`

Current Ploinky only selects the global profile names `default`, `dev`, `qa`, and `prod`. The bundle must therefore use those names until Ploinky supports bundle-local profile selectors. The supported bundle profile mapping is:

- `default`: `copilotProviderRelay global`, `openInterpreterAgent global no-wait`, and `webSearchAgent global no-wait`
- `dev`: same as `default`
- `qa`: same as `default`
- `prod`: same as `default`

Backend differences are controlled by provider agents and by the selected
provider container image. Code-execution providers must use the shared
bwrap-runner image as their sandbox base. Browser-search providers may use a
browser-enabled container when they do not execute arbitrary code. Backend
differences are not controlled by a separate `bwrap-runner` agent, direct
backend chat agents, or relay-owned command configuration. Future provider
backends must add provider agents before the bundle enables them.

The bundle must not be listed in AssistOSExplorer's default dependency list. Restarting the Ploinky workspace after enabling the bundle is the safe documented activation path unless the current Ploinky branch later documents hot dependency refresh.

## Decisions & Questions

### Question #1: Why make the bundle an agent instead of a script?

Response:
A bundle agent is visible to Ploinky's manifest and registry model. It can use the existing `enable` graph, profiles, and no-wait semantics without adding an out-of-band deployment script that Ploinky cannot inspect.

### Question #2: Why does every current profile enable the same runtime agents?

Response:
The runtime model moves backend execution into provider agents that run their
own local sandboxes from the shared bwrap-runner image. Keeping all current
profiles identical avoids exposing half-implemented direct chat agents or
backends without provider ownership.

### Question #3: Why use `qa` and `prod` instead of domain profile names?

Response:
Ploinky currently accepts only `default`, `dev`, `qa`, and `prod` as active profile names. Domain names such as `openhands`, `full-research`, or `research-cpu` would be visible in the manifest but not selectable by the current runtime, so the implementation must map heavier bundles onto the supported names until Ploinky adds bundle-local profile selection.

### Question #4: Why must the bundle not enable `basic/bwrap-runner`?

Response:
The research execution dependency is the bwrap-runner image, not a Ploinky
agent. Enabling a separate runner agent would reintroduce a central service
that provider agents have to call, which is the coupling this architecture
removes. Provider agents remain independently deployable Ploinky agents and
use the shared sandbox image locally.

## Conclusion

The `research-agents` bundle is the only deployment path for this repository's
provider relay suite and must enable `copilotProviderRelay` plus provider agents
such as `openInterpreterAgent` and `webSearchAgent` without exposing direct
backend chat agents or enabling a separate `basic/bwrap-runner` agent.
