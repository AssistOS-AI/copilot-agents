---
id: DS010
title: AchillesCLI Launch Integration
status: planned
owner: copilot-agents-team
summary: Defines how AchillesCLI Copilot chat launches research agents through external skills and future dynamic slash aliases.
---

# DS010 - AchillesCLI Launch Integration

## Introduction

AchillesCLI is already integrated into Explorer as a Copilot chat dependency. This specification defines how `copilot-agents` uses that existing path without making Explorer or AchillesCLI depend directly on this repository.

## Core Content

The first integration path must use AchillesCLI external skill roots. `researchCopilot` should open AchillesCLI WebChat with query parameters equivalent to:

```text
/webchat?agent=achilles-cli&dir=<selectedFsPath>&skill-root=<workspaceRoot>/.ploinky/repos/copilot-agents/achilles-skills
```

Ploinky WebChat forwards non-reserved query parameters to the selected agent CLI as long-form flags. AchillesCLI already accepts `--dir` and repeated `--skill-root` arguments, so this path can load launcher skills without changing Explorer or AchillesCLI.

The first launcher command must use existing AchillesCLI slash behavior:

```text
/exec launch-open-interpreter
```

The `launch-open-interpreter` launcher must be a deterministic `cskill` with code under `achilles-skills/launch-open-interpreter/src/index.mjs`. It must validate the working directory, inspect the current Ploinky routing file when possible, and return an actionable launch or status message. It must not directly run Open Interpreter or other upstream systems inside the AchillesCLI process.

Exact direct commands such as `/open-interpreter`, `/openhands`, `/agent-lab`, and `/ai-scientist` require a later AchillesCLI extension. That extension must be generic, reading slash metadata from discovered skills and merging dynamic aliases into the slash-command catalog. It must not hard-code research-agent command names into AchillesCLI.

Static AchillesCLI commands must win on name conflicts. The `list_achilles_cli_commands` MCP catalog must include dynamic aliases after the extension exists so WebChat autocomplete can discover them.

## Decisions & Questions

### Question #1: Why use `/exec launch-open-interpreter` first?

Response:
AchillesCLI already supports `/exec <skill-name>` for discovered user skills. Using that path gives an end-to-end Copilot launch without modifying sibling repositories.

### Question #2: Why not hard-code `/open-interpreter` in AchillesCLI?

Response:
Hard-coding research-specific commands would couple AchillesCLI to this repository. A generic dynamic alias mechanism keeps AchillesCLI reusable and lets other skill roots define their own direct slash commands.

### Question #3: Why use a `cskill` instead of a `cgskill` prompt?

Response:
The launcher is routing glue, not a reasoning task. A `cskill` gives `/exec launch-open-interpreter` a stable skill alias and deterministic URL generation, while avoiding LLM variance in URL encoding, working-directory handling, and deployment notes.

## Conclusion

The launch integration must first use AchillesCLI external skills and `/exec`, then may graduate to exact slash commands only through a generic dynamic alias extension in AchillesCLI.
