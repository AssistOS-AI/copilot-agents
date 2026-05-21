---
id: DS007
title: OpenHands Backend
status: planned
owner: copilot-agents-team
summary: Reserves the future OpenHands provider backend contract.
---

# DS007 - OpenHands Backend

## Introduction

`openhands` is a reserved future provider backend id. It is not currently
exposed by `copilotProviderRelay` and is not a direct chat agent in the current
architecture.

## Core Content

Before `openhands` becomes an active backend, the repository must add an
OpenHands provider agent. That provider must own OpenHands-specific runtime
preparation, task staging, and local sandbox execution from a container based
on the shared bwrap-runner image. The default bundle must not enable an
OpenHands direct chat target.

OpenHands headless mode has broad upstream approval semantics, so command
templates must be reviewed before operators enable them. Docker socket mounts,
OpenHands Agent Server mode, and nested container orchestration are outside the
default contract and require a separate DS decision.

OpenHands observability must be opt-in because traces can include LLM, tool,
and conversation data.

## Decisions & Questions

### Question #1: Why is OpenHands not active yet?

Response:
OpenHands has broad headless automation semantics and a non-trivial runtime.
Activating it through relay-owned command strings would violate the
provider-owned runtime architecture. It needs a provider agent first.

## Conclusion

`openhands` remains reserved until an OpenHands provider agent owns runtime
setup and local sandbox execution.
