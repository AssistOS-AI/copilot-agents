---
id: DS008
title: Agentic Data Scientist Backend
status: planned
owner: copilot-agents-team
summary: Reserves the future Agentic Data Scientist provider backend contract.
---

# DS008 - Agentic Data Scientist Backend

## Introduction

`agentic-data-scientist` is a reserved future provider backend id. It is not
currently exposed by `copilotProviderRelay`.

## Core Content

Before the backend becomes active, the repository must add a provider agent that
owns Agentic Data Scientist runtime preparation, task staging, and local
sandbox execution from a container based on the shared bwrap-runner image.
Generated artifacts should be written under
`/outputs` only when future provider and runner support exposes artifact
collection.

The adapter must not assume host path mounts, direct network access, GPU access,
or long-running async support unless those capabilities are documented in the
runner image and specs.

## Decisions & Questions

### Question #1: Why keep this backend planned?

Response:
Agentic data-science tools vary in dependencies and runtime assumptions.
Activating the backend before a provider exists would push those assumptions into
the relay. A provider agent keeps runtime ownership out of `copilotProviderRelay`.

## Conclusion

`agentic-data-scientist` remains reserved until a provider agent owns runtime
setup and local sandbox execution.
