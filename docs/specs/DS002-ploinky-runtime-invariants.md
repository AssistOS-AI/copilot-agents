---
id: DS002
title: Ploinky Runtime Invariants
status: planned
owner: copilot-agents-team
summary: Captures the routing, deployment, authentication, storage, and logging invariants every research agent must preserve.
---

# DS002 - Ploinky Runtime Invariants

## Introduction

The research agents run inside Ploinky. This specification restates the Ploinky-facing requirements that must remain local to this repository.

## Core Content

All research agents must be manifest-discoverable Ploinky agents. Each runnable agent directory must contain a `manifest.json`, and MCP-capable agents should use `mcp-config.json` with the default Ploinky `AgentServer` unless a documented service process is required.

The `research-agents` bundle must be the explicit deployment edge. Explorer must not enable this repository by default, and individual research agents must not automatically enable each other. Optional or heavy dependencies must be introduced through bundle profile `enable` entries.

The DS specifications are the source of truth for this repository. When code changes behavior, manifests, MCP schemas, Explorer plugin behavior, routing, security posture, or runtime configuration, the same change must update the affected DS file and the HTML documentation. If implementation and specs diverge, the divergence is a defect; fix the implementation to match the spec or update the spec first with a numbered `Decisions & Questions` entry that explains the new contract.

Executable MCP operations must be authorized by Ploinky secure-wire invocation. Tool code must rely on router-mediated calls and verified invocation metadata for sensitive operations. Browser-side Explorer plugins must call MCP tools through Explorer `appServices.callTool` or an equivalent session-aware SDK. Agent-to-agent tool calls must forward the current invocation token as `x-ploinky-caller-jwt` and must not use `Authorization`, invented principal headers, raw direct ports, or custom bearer-token paths around Ploinky's router.

Durable data must live under `.ploinky/data/<agent>`. Generated runtime inputs must live under `.ploinky/agents/<agent>`. Manifest volumes must use Ploinky's object-map shape, where each key is a host path under `.ploinky/` and each value is an absolute container path. Agent code must not persist secrets, prompts, manuscripts with hidden metadata, or raw tool payloads into plugin assets, static documentation, screenshots, logs, or transcripts.

Bundle profile names must be selectable by the current Ploinky profile system. Until Ploinky supports bundle-local named profiles, this repository may use only `default`, `dev`, `qa`, and `prod` profile keys in manifests. Custom profile names such as `openhands` or `full-research` must remain documentation-only future work until Ploinky can select them.

HTTP services must not be public by default. If a future agent exposes a service, the manifest must declare the service prefix, internal prefix, and auth mode. Public `auth: none` routes require a separate DS decision and must not be added casually.

## Decisions & Questions

### Question #1: Why is `research-agents` a bundle agent instead of a Ploinky core command?

Response:
Ploinky already supports manifest `enable` graphs. A bundle agent uses existing runtime semantics and avoids a Ploinky core change for the first implementation. A future shorthand such as `ploinky enable research-agents` may be added after the bundle contract works.

### Question #2: Why require router-mediated MCP calls even for local workspaces?

Response:
The router mints invocation JWTs, applies workspace authentication, and maintains consistent routing and audit behavior. Direct ports skip those guarantees and would create a parallel trust path for tools that can execute code.

### Question #3: Why is spec-code synchronization an invariant instead of a documentation preference?

Response:
These agents are deployed through manifests, MCP schemas, Explorer plugins, and AchillesCLI skills that span multiple repositories. Treating DS files as authoritative prevents local tests from validating stale contracts, and it gives future implementers one place to verify intended behavior before changing runtime code.

## Conclusion

The repository must keep all research-agent deployment and invocation inside Ploinky's manifest, router, secure-wire, storage, and logging model.
