---
id: DS004
title: Research Agents Bundle
status: planned
owner: copilot-agents-team
summary: Defines the explicit deployment bundle that enables the research copilot suite without making it an Explorer default.
---

# DS004 - Research Agents Bundle

## Introduction

`research-agents` is the bundle agent used to deploy this repository's research copilot suite. It exists to keep deployment explicit and reversible.

## Core Content

The bundle must be a normal Ploinky agent directory named `research-agents`. Operators should deploy the suite with:

```bash
ploinky enable agent copilot-agents/research-agents global
```

The first implementation must not require a Ploinky core shorthand such as `ploinky enable research-agents`. If that shorthand is desired later, it must be implemented as a separate Ploinky CLI alias after the bundle behavior is proven.

The bundle manifest may expose lightweight MCP status tools, but it must not run upstream research workloads. Its primary contract is the manifest `enable` graph.

The default bundle profile should enable:

- `researchCopilot global`
- `openInterpreterAgent global`

Current Ploinky only selects the global profile names `default`, `dev`, `qa`, and `prod`. The bundle must therefore use those names until Ploinky supports bundle-local profile selectors. The supported bundle profile mapping is:

- `default`: `researchCopilot global` and `openInterpreterAgent global`
- `dev`: same as `default`
- `qa`: default agents plus `openHandsAgent global no-wait`
- `prod`: default agents plus `openHandsAgent`, `agentLaboratoryAgent`, and `aiScientistAgent` with `no-wait`

The bundle must not be listed in AssistOSExplorer's default dependency list. Restarting the Ploinky workspace after enabling the bundle is the safe documented activation path unless the current Ploinky branch later documents hot dependency refresh.

## Decisions & Questions

### Question #1: Why make the bundle an agent instead of a script?

Response:
A bundle agent is visible to Ploinky's manifest and registry model. It can use the existing `enable` graph, profiles, and no-wait semantics without adding an out-of-band deployment script that Ploinky cannot inspect.

### Question #2: Why should heavy agents be profile-gated?

Response:
OpenHands, Agent Laboratory, and The AI Scientist can require large dependencies, long-running tasks, nested runtime choices, LaTeX, or GPU resources. Profile gates make those operational decisions explicit.

### Question #3: Why use `qa` and `prod` instead of domain profile names?

Response:
Ploinky currently accepts only `default`, `dev`, `qa`, and `prod` as active profile names. Domain names such as `openhands`, `full-research`, or `research-cpu` would be visible in the manifest but not selectable by the current runtime, so the implementation must map heavier bundles onto the supported names until Ploinky adds bundle-local profile selection.

## Conclusion

The `research-agents` bundle is the only default deployment path for this repository's agents and must keep heavy research capabilities behind explicit profile selection.
