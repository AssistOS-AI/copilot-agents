---
id: DS003
title: Agent Inventory
status: planned
owner: copilot-agents-team
summary: Defines the planned agents, launcher skills, ownership boundaries, and default enablement posture.
---

# DS003 - Agent Inventory

## Introduction

This specification lists the repository-owned agents and AchillesCLI launcher skills. It is the inventory source for future documentation and implementation ordering.

## Core Content

The repository must contain these Ploinky agents:

1. `research-agents`: the explicit deployment bundle.
2. `researchCopilot`: the Explorer-facing UI and orchestration agent.
3. `openInterpreterAgent`: the Open Interpreter MCP adapter.
4. `openHandsAgent`: the OpenHands CLI or SDK adapter.
5. `agentLaboratoryAgent`: the Agent Laboratory workflow adapter.
6. `aiScientistAgent`: The AI Scientist workflow and reviewer adapter.

The repository must contain deterministic AchillesCLI launcher skills under `achilles-skills/`. The first launcher must be the `launch-open-interpreter` cskill; additional launchers should follow the same cskill contract for OpenHands, Agent Laboratory, and AI Scientist.

Only the `research-agents` bundle may auto-enable other research agents. The default and `dev` bundle profiles may enable `researchCopilot` and `openInterpreterAgent`. Heavy agents must stay gated behind Ploinky-selectable profiles until their runtime images, resource requirements, and safety controls are implemented.

Each execution agent must own its domain-specific tools, state, and external upstream integration. `researchCopilot` may provide UI and dispatch affordances but must not duplicate the execution behavior of the individual adapters.

## Decisions & Questions

### Question #1: Why keep `researchCopilot` separate from `research-agents`?

Response:
The bundle is a deployment construct, while `researchCopilot` is a runtime UI and orchestration surface. Keeping them separate allows the bundle to stay lightweight and keeps UI concerns out of deployment metadata.

### Question #2: Why include launcher skills in this repository?

Response:
AchillesCLI already supports external skill roots. Keeping launchers in this repository lets the Copilot chat discover research-agent launch behavior without changing Explorer and without making AchillesCLI depend directly on this repo.

## Conclusion

The repository inventory consists of one deployment bundle, one Explorer-facing copilot agent, four upstream execution adapters, and AchillesCLI launcher skills that bridge Copilot chat to the deployed Ploinky agents.
