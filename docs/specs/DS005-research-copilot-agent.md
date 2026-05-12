---
id: DS005
title: Research Copilot Agent
status: planned
owner: copilot-agents-team
summary: Defines the Explorer-facing UI and orchestration agent for research-agent launch and dispatch.
---

# DS005 - Research Copilot Agent

## Introduction

`researchCopilot` is the Explorer-facing agent. It provides plugin UI and lightweight dispatch while leaving execution behavior to the dedicated research adapters.

## Core Content

The agent must be a lightweight Ploinky MCP agent. It should use a Node container, `lite-sandbox: true`, and the default `AgentServer` with `mcp-config.json`.

The agent may expose tools such as `research_copilot_status`, `research_copilot_plan_task`, `research_copilot_dispatch`, and `research_copilot_list_backends`. These tools must report backend availability and create launch or dispatch requests; they must not embed Open Interpreter, OpenHands, Agent Laboratory, or AI Scientist internals.

The agent must own Explorer `IDE-plugins` for research copilot controls. The first plugin should mount in an existing Explorer application slot such as `file-exp:toolbar-plugins-dropdown` or `file-exp:right-bar`. Menu contributions may target file and directory context menus.

Explorer plugin actions must use host-provided filesystem context such as `selectedFsPath` and `currentFsPath`. When application-slot context only contains Explorer paths, plugin code must use Explorer's workspace-root utility or SDK-backed root resolution instead of assuming `workspaceRoot` or `workspaceFsRoot` are present.

The agent may provide an action named `Open Research Copilot here`. That action should open AchillesCLI WebChat with both `dir` and `skill-root` query parameters so the launcher skills in this repository are available in the chat session.

Browser-side status calls must go through Explorer `appServices.callTool` or an equivalent MCP session-aware helper. The plugin must not post raw JSON-RPC `tools/call` requests to `/mcps/<agent>/mcp`, because those calls bypass MCP initialization and fail Ploinky's session contract.

Server-side backend probes must use delegated secure-wire calls. `researchCopilot` tools must read the router-provided invocation token from tool metadata and forward it as `x-ploinky-caller-jwt` when probing backend agents.

## Decisions & Questions

### Question #1: Why not put all launch behavior in Explorer core?

Response:
Explorer's contract is to host plugins and preserve the shell. Research-agent launch behavior belongs to the agent that owns the research integration, so the IDE shell does not accumulate domain-specific logic.

### Question #2: Why open AchillesCLI with `skill-root` instead of adding direct buttons only?

Response:
AchillesCLI is already the Copilot chat surface. Passing the research launcher skill root lets users launch agents from chat while preserving existing WebChat and skill execution paths.

### Question #3: Why require Explorer SDK calls for plugin status?

Response:
Explorer's SDK owns MCP client sessions and authentication recovery. Raw plugin fetch calls do not perform MCP initialization and can incorrectly report healthy agents as offline because the router rejects sessionless `tools/call` requests.

## Conclusion

`researchCopilot` must remain a thin Explorer plugin and dispatch layer that routes users to dedicated Ploinky agents and AchillesCLI launcher skills.
