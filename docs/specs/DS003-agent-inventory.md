---
id: DS003
title: Agent Inventory
status: planned
owner: copilot-agents-team
summary: Defines the tagged research relay inventory, provider-backed backend tags, and default enablement posture.
---

# DS003 - Agent Inventory

## Introduction

This specification lists the repository-owned Ploinky agents and the tagged
backend adapters they expose. It is the inventory source for documentation and
implementation ordering.

## Core Content

The repository must contain these Ploinky agents:

1. `research-agents`: the explicit deployment bundle.
2. `researchRelay`: the Copilot launch-extension and tagged-task relay agent.
3. `openInterpreterAgent`: the Open Interpreter provider agent that owns
   runtime preparation and runs research tasks in its own local bwrap sandbox.

The repository must expose these active backend tags through `researchRelay`:

- `@open-interpreter`

The tagged backends are not public chat or slash-command targets. They are
adapter records inside `researchRelay`. Each adapter receives a
natural-language prompt and materialized input resources. Active backends must
declare `provider: { agent, tool }`; the relay forwards the task to that MCP
tool with the router invocation token, and the provider agent owns runtime
preparation and local sandbox execution. Future backends such as
DeepAnalyze, OpenHands, Agentic Data Scientist, and MLJAR are reserved
concepts, not active relay tags, until they have provider agents.

The relay must not own backend command strings, runtime ids, package
versions, shim paths, model/provider setup, or direct backend-specific calls
to a sandbox runner.

Only the `research-agents` bundle may auto-enable the relay. The default,
`dev`, `qa`, and `prod` bundle profiles must enable `researchRelay` and
`openInterpreterAgent`; they must not enable `basic/bwrap-runner` or direct
backend chat agents by default.

## Decisions & Questions

### Question #1: Why keep `researchRelay` separate from `research-agents`?

Response:
The bundle is a deployment construct, while `researchRelay` is a runtime UI
and relay surface. Keeping them separate allows the bundle to stay lightweight
and keeps UI and task-dispatch behavior out of deployment metadata.

### Question #2: Why are backend tags routed through provider agents?

Response:
The chat-facing contract is "tag an agent and give it a task." A single relay
validates tags, materializes resources, and forwards the request to the
provider agent that owns that backend's runtime. This keeps the chat surface
stable without making the relay responsible for backend runtimes or local
sandbox execution.

### Question #3: Why rename the relay to `researchRelay`?

Response:
The previous name implied an assistant-like copilot. The agent's durable
responsibility is relay behavior: detect supported tags, validate and
materialize inputs, call provider agents, and return the provider result. The
repository, bundle, Ploinky WebChat handler, MCP helper names, and Explorer
plugins now use `researchRelay`.

### Question #4: Why keep future backends out of the active tag catalog?

Response:
The target architecture is backend-owned runtime setup with execution inside
the provider's own container based on the shared bwrap-runner image.
Advertising a tag before its provider exists would either force the relay to
own backend command setup or produce a misleading half-enabled backend. Future
backends become active only when their provider agent owns runtime preparation
and sandbox execution.

## Conclusion

The repository inventory consists of one deployment bundle, one tagged relay
(the **Research Relay**, kept under the `researchRelay` agent id), and the
Open Interpreter provider agent that owns its runtime and local sandbox
execution. Additional backend tags require provider agents before they enter
the active catalog.
