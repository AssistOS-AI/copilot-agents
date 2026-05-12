---
id: DS008
title: Agent Laboratory Agent
status: planned
owner: copilot-agents-team
summary: Defines the phase-driven Agent Laboratory adapter for literature review, experimentation, report writing, and export.
---

# DS008 - Agent Laboratory Agent

## Introduction

`agentLaboratoryAgent` adapts Agent Laboratory research workflows into Ploinky. It should expose phase-level control rather than a single opaque long-running command.

## Core Content

The agent should use Python 3.12 with a prebuilt image containing Agent Laboratory dependencies. LaTeX support should be included only in images or profiles that require PDF compilation.

The agent must store durable project state under `.ploinky/data/agentLaboratoryAgent`. Project outputs may be copied or exported to a user-selected workspace path only after path validation.

The agent should expose async tools such as:

- `lab_init_project`
- `lab_run_literature_review`
- `lab_run_experimentation`
- `lab_write_report`
- `lab_status`
- `lab_export`

The adapter must generate upstream YAML configuration from validated tool input. It must support `compileLatex: false` so users can run workflows in environments without LaTeX.

Progress reporting must be structured. Tool output should expose phase, status, artifacts, and user-action requirements without streaming raw upstream logs by default.

The adapter should preserve Agent Laboratory's human-guided copilot mode as a first-class option. Fully automated runs must be explicit.

## Decisions & Questions

### Question #1: Why expose phase-level tools?

Response:
Agent Laboratory workflows include literature review, experimentation, and report writing. Phase-level tools let users inspect intermediate artifacts, recover from failures, and avoid opaque long-running tasks.

### Question #2: Why make LaTeX optional?

Response:
LaTeX increases image size and runtime complexity. Agent Laboratory can disable PDF compilation, so the default integration should not require LaTeX unless a profile explicitly chooses it.

## Conclusion

`agentLaboratoryAgent` must provide an async, phase-driven, workspace-confined research workflow adapter with structured progress and export behavior.
