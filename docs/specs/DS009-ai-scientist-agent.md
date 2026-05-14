---
id: DS009
title: MLJAR and DeepAnalyze Backends
status: planned
owner: copilot-agents-team
summary: Reserves the future MLJAR and DeepAnalyze provider backend contracts.
---

# DS009 - MLJAR and DeepAnalyze Backends

## Introduction

`@mljar` and `@deepanalyze` are reserved future research tags. They are not
currently exposed by `researchRelay` and are not direct Ploinky chat agents in
the current architecture.

## Core Content

Before either tag becomes active, the repository must add a provider agent
that owns the backend's runtime preparation, task staging, and local sandbox
execution from a container based on the shared bwrap-runner image.

The current provider path does not collect `/outputs` artifacts or run async jobs.
Backends that require longer runtime, large data files, network access, or
artifact export need provider-owned async, artifact, and local runner support
before they are considered complete.

## Decisions & Questions

### Question #1: Why share one planned DS for MLJAR and DeepAnalyze?

Response:
Both are planned data-analysis backends with similar sandbox and artifact
questions. They can split into separate DS files after concrete provider
agents define different runtime and artifact needs.

## Conclusion

`@mljar` and `@deepanalyze` remain reserved until provider agents own runtime
setup and local sandbox execution.
