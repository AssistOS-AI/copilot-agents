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

The `research-agents` bundle must be the explicit deployment edge. Explorer must not enable this repository by default, and individual research agents must not automatically enable each other. The runtime edge is `researchRelay` plus provider agents such as `openInterpreterAgent`; the bundle must not enable a separate `basic/bwrap-runner` agent. Direct backend chat agents must not be enabled by default.

Research providers that execute arbitrary code must use the shared bwrap-runner
Docker image as their sandbox base. The shared artifact is the image and local
sandbox runner, not a Ploinky runner agent. A code-execution provider may use
the base image directly or a documented derived image, but research execution
tasks must run through an inner bubblewrap sandbox started locally inside that
provider container. `webSearchAgent` is not a code-execution backend; it uses a
browser-enabled container and owns only local headless browser search.

The DS specifications are the source of truth for this repository. When code changes behavior, manifests, MCP schemas, Explorer plugin behavior, routing, security posture, or runtime configuration, the same change must update the affected DS file and the HTML documentation. If implementation and specs diverge, the divergence is a defect; fix the implementation to match the spec or update the spec first with a numbered `Decisions & Questions` entry that explains the new contract.

Executable MCP operations must be authorized by Ploinky secure-wire invocation. Tool code must rely on router-mediated calls and verified invocation metadata for sensitive operations. Browser-side Explorer plugins must call MCP tools through Explorer `appServices.callTool` or an equivalent session-aware SDK. Agent-to-agent tool calls must forward the current invocation token as `x-ploinky-caller-jwt` and must not use `Authorization`, invented principal headers, raw direct ports, or custom bearer-token paths around Ploinky's router.

Ploinky framework code must remain agent-agnostic. It must not hardcode `researchRelay`, `openInterpreterAgent`, backend tag names, provider tool names, or any other optional agent id. Ploinky must not add a research-specific enable command or treat a bundle enable command as the chat availability contract. A provider is selectable in Copilot only when the selected chat agent discovers a launcher skill for it; runtime backend health remains a launcher or relay concern.

Tagged research execution must flow from Copilot/WebMeet chat to
`researchRelay.research_task_submit`, then to the backend provider agent. For
code-execution backends, the provider then starts its own local sandbox runner.
For `web-search`, `webSearchAgent` executes in its local headless browser
service. Research backends receive a natural-language prompt and materialized
resources; callers must not pass host paths as bwrap mounts or direct runtime
flags.

Chat surfaces must only intercept configured research backend tags. Unknown `@name` mentions are ordinary chat text and must fall through to the target chat agent. Server-side relay calls from WebChat must use the local router endpoint and router session cookies; they must not derive the server-side MCP target from the public client `Host` header or forward browser `Authorization` headers.

Durable data must live under `.ploinky/data/<agent>`. Generated runtime inputs must live under `.ploinky/agents/<agent>`. Manifest volumes must use Ploinky's object-map shape, where each key is a host path under `.ploinky/` and each value is an absolute container path. Agent code must not persist secrets, prompts, manuscripts with hidden metadata, or raw tool payloads into plugin assets, static documentation, screenshots, logs, or transcripts.

Bundle profile names must be selectable by the current Ploinky profile system. Until Ploinky supports bundle-local named profiles, this repository may use only `default`, `dev`, `qa`, and `prod` profile keys in manifests. Custom profile names such as `openhands` or `full-research` must remain documentation-only future work until Ploinky can select them.

HTTP services must not be public by default. If a future agent exposes a service, the manifest must declare the service prefix, internal prefix, and auth mode. Public `auth: none` routes require a separate DS decision and must not be added casually.

## Decisions & Questions

### Question #1: Why is `research-agents` a bundle agent instead of a Ploinky core command?

Response:
Ploinky already supports manifest `enable` graphs for deploying runtime agents,
but Copilot availability is not determined by a Ploinky research command. The
selected chat agent owns provider discovery through launcher skills such as
`launch-open-interpreter` or `launch-web-search`. This keeps Ploinky from
acquiring optional research-agent policy while still allowing ordinary manifest
deployment for the relay and provider containers.

### Question #2: Why require router-mediated MCP calls even for local workspaces?

Response:
The router mints invocation JWTs, applies workspace authentication, and maintains consistent routing and audit behavior. Direct ports skip those guarantees and would create a parallel trust path for tools that can execute code.

### Question #3: Why is spec-code synchronization an invariant instead of a documentation preference?

Response:
These agents are deployed through manifests, MCP schemas, Explorer plugins, and AchillesCLI skills that span multiple repositories. Treating DS files as authoritative prevents local tests from validating stale contracts, and it gives future implementers one place to verify intended behavior before changing runtime code.

### Question #4: Why remove the bwrap-runner agent from the research runtime edge?

Response:
Every research backend already needs a provider agent to own package
installation, model topology, prompts, resources, and result normalization. A
separate generic runner agent would be a second runtime hop and would require
runtime bundles to be handed through shared storage. Using the same
bwrap-runner image inside each provider preserves the common sandbox policy
without coupling the research suite to a central runner service.

## Conclusion

The repository must keep all research-agent deployment and invocation inside Ploinky's manifest, router, secure-wire, storage, and logging model.
