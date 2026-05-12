# Ploinky Research Agents Implementation Plan

Status: planning document
Last analyzed: 2026-05-12

## Purpose

Create a new Ploinky-compatible agent repository, `copilot-agents`, that integrates four upstream research/development agent systems with AssistOSExplorer and the Ploinky runtime:

- Open Interpreter
- OpenHands CLI / SDK
- Agent Laboratory
- The AI Scientist

The target outcome is a set of Ploinky agents that are not enabled by Explorer by default, can be deployed through an explicit research-agent bundle command, discovered by Explorer through `IDE-plugins` only after that explicit deployment, invoked through Ploinky MCP routes, and operated without violating Ploinky routing, auth, storage, or logging invariants.

## Current Repository State

The workspace is a multi-repo checkout. Before editing, check status and logs in the affected repo.

At the time of this plan:

- `copilot-agents` is clean and contains only `README.md` and `LICENSE`.
- `copilot-agents` latest commit is `62e4084 Initial commit`.
- `AssistOSExplorer` and `ploinky` are separate sibling repos and should not be modified for the first implementation pass unless an integration gap is proven.
- The workspace root guidance forbids staging unrelated sibling repos, `node_modules`, or unrelated untracked files.
- `AssistOSExplorer/AchillesCLI` is a separate clean repo. Its latest local history includes webchat control handling and slash-command catalog exposure.

## Local Contracts From AssistOSExplorer

Explorer is the IDE shell and filesystem surface. It owns routing, preview/editing, static-agent behavior, runtime plugin hosting, and dependency attachment. Dependent agents own their domain logic, state, and UI components.

Implications for this project:

- Do not add research-agent behavior directly to Explorer core.
- Put user-facing controls in agent-owned `IDE-plugins` bundles.
- Use existing Explorer plugin slots:
  - `file-exp:toolbar`
  - `file-exp:toolbar-plugins-dropdown`
  - `file-exp:right-bar`
  - `file-exp:global`
  - `file-exp:account-menu`
  - `file-exp:context-menu:file`
  - `file-exp:context-menu:directory`
  - `file-exp:new-menu`
- Application plugin IDs must start with a letter and use only letters, numbers, and dashes.
- Application plugins use policy keys of the form `agent/id`.
- Document plugins use policy keys of the form `agent/component`.
- Menu plugins contribute semantic menu metadata and action handlers; Explorer owns actual menu rendering and focus behavior.
- Host-provided menu context includes absolute filesystem targets such as `selectedFsPath`, `currentFsPath`, and `currentDirectory`. Plugin code should use those instead of guessing workspace paths.

Explorer should discover plugins under enabled agent-owned `IDE-plugins` folders. The first implementation should rely on that discovery path instead of changing Explorer's manifest or code.

## Local Contracts From Ploinky

Ploinky agents are manifest-discovered directories under `.ploinky/repos/<repo>/<agent>/manifest.json`.

Important runtime constraints:

- Browser surfaces, MCP calls, delegated MCP calls, uploads, blobs, and HTTP services must enter through the Ploinky router.
- Direct agent ports are implementation details.
- Executable MCP tool calls are authorized by router-minted invocation JWTs.
- Agents receive `PLOINKY_DERIVED_MASTER_KEY`; they must not require `PLOINKY_MASTER_KEY`.
- Any generated agent-owned secret should derive from `PLOINKY_DERIVED_MASTER_KEY` with a domain-separated label.
- External provider keys remain explicit operator secrets.
- Manifest volumes must resolve under `.ploinky/`.
- Durable service data should live under `.ploinky/data/<agent-or-service>/...`.
- Generated runtime inputs should live under `.ploinky/agents/<agent>/...`.
- Logs and user-facing errors must redact secrets, cookies, bearer tokens, invocation JWTs, API keys, raw prompts, hidden policy text, and internal payloads.
- Runtime isolation is defense in depth, not a hostile multi-tenant boundary.

Ploinky's default `AgentServer` can expose tools from `mcp-config.json`. Each tool command receives a JSON payload on stdin:

```json
{
  "tool": "tool_name",
  "input": {},
  "metadata": {}
}
```

Use this default server for initial agents unless a specific upstream system requires a long-running HTTP service.

For long-running research jobs, use async MCP tools in `mcp-config.json` and provide status/export tools instead of blocking a browser request for the full workflow.

## AchillesCLI Integration Findings

Explorer currently enables `AchillesCLI/achilles-cli global` as one of its own dependencies. This is the Copilot chat entry point the research agents should integrate with after the research-agent bundle is explicitly deployed.

Relevant local files:

- `AssistOSExplorer/AchillesCLI/achilles-cli/manifest.json`
- `AssistOSExplorer/AchillesCLI/achilles-cli/mcp-config.json`
- `AssistOSExplorer/AchillesCLI/achilles-cli/IDE-plugins/achilles-cli-tool-button/config.json`
- `AssistOSExplorer/AchillesCLI/achilles-cli/IDE-plugins/achilles-cli-tool-button/menu-contributions.js`
- `AssistOSExplorer/AchillesCLI/achilles-cli/src/index.mjs`
- `AssistOSExplorer/AchillesCLI/achilles-cli/src/repl/SlashCommandHandler.mjs`
- `AssistOSExplorer/AchillesCLI/docs/specs/DS005-repl-and-command-processing.md`
- `AssistOSExplorer/AchillesCLI/docs/specs/DS010-ecosystem-integration.md`

Observed integration behavior:

- AchillesCLI is a Ploinky agent with `cli: "node /code/src/index.mjs"`.
- AchillesCLI exposes `list_achilles_cli_commands` as an MCP tool for slash-command catalog/autocomplete metadata.
- The `achilles-cli-tool-button` Explorer plugin contributes a directory context-menu item named `Open Copilot here`.
- That menu action opens `/webchat?agent=achilles-cli&dir=<selectedFsPath>`.
- Ploinky WebChat treats `agent=achilles-cli` as a dynamic agent override.
- Ploinky WebChat forwards non-reserved query parameters to the target agent CLI as long-form flags. For example, `dir=/workspace/foo` becomes `--dir=/workspace/foo`.
- AchillesCLI accepts `--dir` and `--skill-root` arguments.
- AchillesCLI registers skill roots from built-ins, bundled bash skills, repeated `--skill-root` flags, and discoverable package skill folders in local `node_modules`.
- AchillesCLI webchat mode uses the same slash-command handler as REPL mode for inputs that start with `/`.
- Exact direct slash commands such as `/open-interpreter` are currently static in `SlashCommandHandler.COMMAND_DEFINITIONS`.
- Existing AchillesCLI behavior can execute arbitrary discovered user skills through `/exec <skill-name> [input]`.

Implications:

- `copilot-agents` can add AchillesCLI launcher skills without changing Explorer or AchillesCLI by passing an additional `skill-root` query parameter when opening Copilot chat.
- The no-core-change launch command is `/exec launch-open-interpreter` or `/exec open-interpreter`, depending on the skill name.
- Supporting exact aliases such as `/open-interpreter`, `/openhands`, `/agent-lab`, and `/ai-scientist` requires a small AchillesCLI extension because `SlashCommandHandler` does not currently build direct commands from discovered skill metadata.
- The preferred direct-slash design is not to hard-code each research command in AchillesCLI. Add a generic dynamic slash-command extension point that reads slash metadata from discovered skills and maps aliases to skill execution.

Recommended phased approach:

1. First implementation slice: avoid sibling repo changes and expose launcher skills through `/exec <skill-name>`.
2. Second implementation slice: add dynamic slash alias support to AchillesCLI, with docs/tests, so installed launcher skills can declare direct aliases such as `/open-interpreter`.
3. Only after direct aliases exist, update the Copilot launch prompt/docs to advertise `/open-interpreter` as the primary command.

## Upstream Agent Findings

### Open Interpreter

Relevant sources:

- https://github.com/openinterpreter/open-interpreter
- https://docs.openinterpreter.com/guides/running-locally
- https://docs.openinterpreter.com/telemetry/telemetry

Observed constraints:

- Open Interpreter can run code locally and exposes a terminal/chat style interface.
- It supports local model providers through `interpreter --local` and OpenAI-compatible `--api_base` plus `--model` settings.
- Python usage supports `interpreter.offline = True`, local model/base URL settings, and `interpreter.chat(...)`.
- Telemetry exists and should be disabled by default in this integration. Supported controls include `--disable_telemetry`, profile `disable_telemetry: true`, Python `interpreter.disable_telemetry = True`, and `DISABLE_TELEMETRY=true`.
- Open Interpreter can execute code and shell commands. The Ploinky adapter must keep this scoped to the workspace and avoid auto-running destructive actions without explicit user intent.

### OpenHands

Relevant sources:

- https://github.com/OpenHands/OpenHands
- https://docs.openhands.dev/openhands/usage/cli/installation
- https://docs.openhands.dev/openhands/usage/cli/quick-start
- https://docs.openhands.dev/openhands/usage/cli/headless
- https://docs.openhands.dev/sdk/arch/agent-server
- https://docs.openhands.dev/openhands/usage/cli/mcp-servers
- https://docs.openhands.dev/sdk/guides/observability

Observed constraints:

- OpenHands offers an SDK, CLI, local GUI, cloud, and enterprise surfaces.
- CLI installation currently expects Python 3.12+ and supports `uv tool install openhands --python 3.12`.
- CLI modes include interactive `openhands`, headless `openhands --headless`, web `openhands web`, GUI server `openhands serve`, and ACP.
- Headless mode is suitable for automation and can emit JSONL with `--json`.
- Headless mode always runs in always-approve mode and cannot use `--llm-approve`; this is a major safety concern.
- OpenHands can consume MCP servers via HTTP/SSE or stdio. MCP config is stored in `~/.openhands/mcp.json`.
- The Agent Server package exposes HTTP APIs and WebSockets, creates isolated workspaces, manages Docker containers, and is intended for multi-user / remote execution.
- Agent Server Docker mode requires Docker access. In Ploinky, mounting Docker sockets or launching nested containers must be treated as a separate high-risk profile decision, not the v1 default.
- OpenHands observability uses OpenTelemetry/Laminar instrumentation and can capture agent steps, tool executions, LLM calls, and conversation lifecycle. This should be opt-in and redacted.

### Agent Laboratory

Relevant sources:

- https://huggingface.co/papers/2501.04227
- https://agentlaboratory.github.io/
- https://github.com/SamuelSchmidgall/AgentLaboratory

Observed constraints:

- Agent Laboratory accepts a human research idea and outputs a research report plus code repository.
- It is explicitly positioned as human-guided research assistance.
- The workflow has three phases:
  - literature review
  - experimentation
  - report writing
- It integrates tools such as arXiv, Hugging Face, Python, and LaTeX.
- It supports a copilot mode through configuration.
- The repository recommends Python 3.12 and `pip install -r requirements.txt`.
- `pdflatex` is optional; PDF compiling can be disabled with `--compile-latex "false"`.
- The runner is `python ai_lab_repo.py --yaml-location "experiment_configs/MATH_agentlab.yaml"`.
- The adapter should expose phase-level controls, not just a single opaque "run everything" command.

### The AI Scientist

Relevant source:

- https://github.com/sakanaai/ai-scientist

Observed constraints:

- The AI Scientist is designed for automated open-ended scientific discovery.
- Its workflows involve idea generation, experiment execution, paper generation, and LLM-generated paper review.
- It uses template-specific setups such as NanoGPT, 2D diffusion, and grokking.
- Template setup can require data preparation, Python dependencies, LaTeX, and possibly GPU resources.
- Paper generation is run through `launch_scientist.py`.
- Paper review is available through `ai_scientist.perform_review`.
- The project license/responsible-use section requires disclosure in resulting scientific manuscripts or papers. The adapter must preserve that requirement in generated manuscript outputs and documentation.

## Target Repository Structure

Use this initial structure:

```text
copilot-agents/
  AGENTS.md
  CLAUDE.md
  README.md
  LICENSE
  docs/
    index.html
    specsLoader.html
    plans/
      ploinky-research-agents-plan.md
    prompts/
      implement-ploinky-research-agents.md
    specs/
      matrix.md
      DS000-vision.md
      DS001-coding-style.md
      DS002-ploinky-runtime-invariants.md
      DS003-agent-inventory.md
      DS004-research-agents-bundle.md
      DS005-research-copilot-agent.md
      DS006-open-interpreter-agent.md
      DS007-openhands-agent.md
      DS008-agent-laboratory-agent.md
      DS009-ai-scientist-agent.md
      DS010-achilles-cli-launch-integration.md
      DS011-security-observability.md
  research-agents/
    manifest.json
    mcp-config.json
    tools/
  researchCopilot/
    manifest.json
    package.json
    mcp-config.json
    tools/
    IDE-plugins/
      research-copilot/
        config.json
        research-copilot.html
        research-copilot.js
        research-copilot.css
      research-copilot-menu/
        config.json
        menu.js
  openInterpreterAgent/
    manifest.json
    mcp-config.json
    requirements.txt
    tools/
  openHandsAgent/
    manifest.json
    mcp-config.json
    tools/
  agentLaboratoryAgent/
    manifest.json
    mcp-config.json
    tools/
  aiScientistAgent/
    manifest.json
    mcp-config.json
    tools/
  achilles-skills/
    launch-open-interpreter/
      cskill.md
      src/
        index.mjs
    launch-openhands/
      cskill.md
      src/
        index.mjs
    launch-agent-lab/
      cskill.md
    launch-ai-scientist/
      cskill.md
  scripts/
    smoke/
```

Do not introduce a root `src/` tree for agent runtime code unless Ploinky mounting makes that code available to each agent. By default, each agent sees its own directory as `/code`, so shared helpers should either be copied into each agent, packaged explicitly, or generated by a script.

## Generated Specification Set

The plan has been expanded into a GAMP-style contiguous DS specification set. Future implementation work should treat these specs as the source of truth and update them with code and documentation changes:

- [DS000 - Vision](../specs/DS000-vision.md)
- [DS001 - Coding Style](../specs/DS001-coding-style.md)
- [DS002 - Ploinky Runtime Invariants](../specs/DS002-ploinky-runtime-invariants.md)
- [DS003 - Agent Inventory](../specs/DS003-agent-inventory.md)
- [DS004 - Research Agents Bundle](../specs/DS004-research-agents-bundle.md)
- [DS005 - Research Copilot Agent](../specs/DS005-research-copilot-agent.md)
- [DS006 - Open Interpreter Agent](../specs/DS006-open-interpreter-agent.md)
- [DS007 - OpenHands Agent](../specs/DS007-openhands-agent.md)
- [DS008 - Agent Laboratory Agent](../specs/DS008-agent-laboratory-agent.md)
- [DS009 - AI Scientist Agent](../specs/DS009-ai-scientist-agent.md)
- [DS010 - AchillesCLI Launch Integration](../specs/DS010-achilles-cli-launch-integration.md)
- [DS011 - Security and Observability](../specs/DS011-security-observability.md)
- [Specification Matrix](../specs/matrix.md)

## Agent Specifications

### `research-agents`

Role:

- Bundle/deployment agent for the research copilot suite.
- Exists so users can explicitly deploy the research agents without making them Explorer defaults.
- Owns no heavy domain behavior.
- May expose a lightweight MCP status tool that reports which child agents are enabled/reachable.

Command recommendation:

Use the native Ploinky agent-enable syntax and make the bundle name carry the user-facing shorthand:

```bash
ploinky add repo copilot-agents <repo-url-or-local-path>
ploinky enable repo copilot-agents
ploinky enable agent copilot-agents/research-agents global
ploinky start explorer 8080
```

If the repository is already enabled and `research-agents` is unique, this shorter form should work:

```bash
ploinky enable agent research-agents global
```

Do not require a Ploinky core change for `ploinky enable research-agents` in the first implementation. If that exact shorthand is still desired later, add it as a Ploinky CLI alias after the bundle-agent contract is working.

Manifest:

- Use `node:20-alpine`.
- `lite-sandbox: true`.
- Keep it lightweight and safe to start.
- Do not put this agent in Explorer's `enable` array.
- Put child-agent deployment in this manifest's `enable` entries.
- Use only Ploinky-selectable profile names for optional heavy agents until bundle-local profile selection exists.

Recommended enable graph:

- Top-level/default:
  - `researchCopilot global`
  - `openInterpreterAgent global`
- Profile `dev`:
  - Same as default.
- Profile `qa`:
  - `openHandsAgent global no-wait`
- Profile `prod`:
  - `openHandsAgent global no-wait`
  - `agentLaboratoryAgent global no-wait`
  - `aiScientistAgent global no-wait`

MCP tools:

- `research_agents_status`
- `research_agents_manifest`

Implementation notes:

- This bundle is the only place that should auto-enable other research agents.
- Individual agents should not pull in each other by default.
- The bundle should be safe to keep enabled, but heavy work should not start until a user invokes a tool or opens a session.

### `researchCopilot`

Role:

- Lightweight orchestration and Explorer UI agent.
- Owns the Explorer plugin UI for research/development copilots.
- Calls the execution agents through Ploinky MCP routes.

Manifest:

- Use `node:20-alpine` or `node:20-bullseye`.
- `lite-sandbox: true`.
- Default `AgentServer` with `mcp-config.json` is sufficient.
- No guest mode.
- No public HTTP services.

MCP tools:

- `research_copilot_status`
- `research_copilot_plan_task`
- `research_copilot_dispatch`
- `research_copilot_list_backends`

Explorer plugin:

- Application mount plugin ID: `research-copilot`.
- Slot: start with `file-exp:toolbar-plugins-dropdown` or `file-exp:right-bar`.
- Optional global status overlay: `file-exp:global`.
- Menu contribution slots:
  - `file-exp:context-menu:file`
  - `file-exp:context-menu:directory`
  - `file-exp:new-menu`

Plugin actions:

- Analyze selected path with Open Interpreter.
- Run OpenHands task in selected directory.
- Start Agent Laboratory project from selected directory.
- Review or extend a paper with AI Scientist.
- Open AchillesCLI Copilot with the research launcher skill root preloaded.

AchillesCLI launch integration:

- The plugin may add a menu action such as `Open Research Copilot here`.
- That action should open AchillesCLI WebChat with both directory and skill-root context:

```text
/webchat?agent=achilles-cli&dir=<selectedFsPath>&skill-root=<workspaceRoot>/.ploinky/repos/copilot-agents/achilles-skills
```

- Ploinky will forward `dir` and `skill-root` to AchillesCLI as `--dir=...` and `--skill-root=...`.
- The skill-root path must be derived from the workspace root, not hard-coded to a local machine path.
- If the skill root is unavailable, the plugin should fall back to the existing AchillesCLI chat URL and explain that research launcher skills are not installed.

### `openInterpreterAgent`

Role:

- Local execution/code-analysis adapter around Open Interpreter.

Manifest:

- Prefer a prebuilt Python 3.12 image with Open Interpreter installed.
- Development fallback can use `python:3.12-slim` with an install hook, but this will make cold starts slower.
- Set `DISABLE_TELEMETRY=true` by default.
- Set profile defaults for non-secret model topology:
  - `OPEN_INTERPRETER_MODEL`
  - `OPEN_INTERPRETER_API_BASE`
  - `OPEN_INTERPRETER_OFFLINE`
- External provider keys remain explicit env/secrets.
- Durable state: `.ploinky/data/openInterpreterAgent`.

MCP tools:

- `oi_chat`
- `oi_run_task`
- `oi_reset_session`
- `oi_status`

Implementation notes:

- Wrap Open Interpreter through Python code rather than shelling directly with unstructured strings.
- Validate target paths against `PLOINKY_WORKSPACE_ROOT`.
- Default to offline/local model mode when configured.
- Return compact JSON.
- Redact prompt bodies and command output in logs unless a debug flag is explicitly enabled.
- Avoid `-y`/auto-run defaults unless the user explicitly requests an execution mode that permits it.

### `openHandsAgent`

Role:

- Development automation adapter around OpenHands CLI/SDK.

Manifest:

- Prefer a prebuilt Python 3.12 image with OpenHands installed.
- Mount durable state at `.ploinky/data/openHandsAgent` and map it to the OpenHands home/config location.
- Keep Docker socket / nested container use out of the default profile.
- Add a separate `docker-server` or `unsafe-local` profile only if needed later and document the risk.

MCP tools:

- `openhands_run_headless`
- `openhands_status`
- `openhands_resume`
- `openhands_list_conversations`
- `openhands_configure_mcp`

Implementation notes:

- Use headless JSONL output for automation.
- Since headless mode is always-approve upstream, require an explicit `approvalMode` or `allowExecution` argument and surface that risk in the tool schema.
- Support `dryRun` where possible by preparing task files/config without running.
- Keep all target paths under the workspace.
- Treat OpenHands observability as opt-in. If OTEL/Laminar env vars are present, pass them through only after documenting that traces may include LLM/tool data.

MCP integration:

- When configuring MCP servers for OpenHands, prefer stdio wrappers or Ploinky router URLs.
- Do not configure OpenHands to call direct agent container ports.
- If calling Ploinky MCP endpoints from OpenHands, preserve router auth and secure-wire expectations.

### `agentLaboratoryAgent`

Role:

- Phase-driven adapter for Agent Laboratory research workflows.

Manifest:

- Python 3.12.
- Prefer prebuilt image with `requirements.txt` installed.
- Include LaTeX only in an image/profile that needs PDF compilation.
- Durable state: `.ploinky/data/agentLaboratoryAgent`.
- Default to async MCP tools.

MCP tools:

- `lab_init_project`
- `lab_run_literature_review`
- `lab_run_experimentation`
- `lab_write_report`
- `lab_status`
- `lab_export`

Implementation notes:

- Generate YAML config from validated tool input.
- Keep project outputs under `.ploinky/data/agentLaboratoryAgent/projects/<id>` or a user-selected workspace path after validation.
- Preserve human-guided copilot mode as a first-class option.
- Allow `compileLatex: false` for environments without LaTeX.
- Capture progress as structured status, not raw upstream logs.

### `aiScientistAgent`

Role:

- Optional heavy adapter for The AI Scientist workflows and paper review.

Manifest:

- Prebuilt Python image strongly preferred.
- Add profile-gated variants for CPU/GPU/LaTeX.
- Durable state: `.ploinky/data/aiScientistAgent`.
- Default to async MCP tools.
- Do not enable by default from the lightweight hub unless the profile explicitly asks for full research.

MCP tools:

- `scientist_generate_ideas`
- `scientist_run_experiment`
- `scientist_generate_paper`
- `scientist_review_paper`
- `scientist_status`
- `scientist_export`

Implementation notes:

- Treat templates as allow-listed workloads.
- Require template setup validation before launching experiments.
- Separate paper review from full experiment execution so users can use the lower-risk reviewer independently.
- Preserve the upstream manuscript disclosure requirement in generated manuscript artifacts.
- Add concurrency limits and cancellation/status surfaces before enabling long runs from Explorer UI.

### AchillesCLI launcher skills

Role:

- Let the existing AchillesCLI Copilot chat launch or hand off to the research agents.
- Keep this as an integration layer, not as a replacement for the Ploinky MCP agents.

Location:

- Store these under `copilot-agents/achilles-skills/`.
- Pass that folder to AchillesCLI through `--skill-root` from WebChat URL query parameters.

Initial launcher skills:

- `launch-open-interpreter`
- `launch-openhands`
- `launch-agent-lab`
- `launch-ai-scientist`

Behavior:

- Validate the current working directory from AchillesCLI context.
- Check whether the target Ploinky agent appears enabled/routed.
- Return a WebChat launch URL, for example `/webchat?agent=openInterpreterAgent&dir=<workingDir>`.
- Optionally run a lightweight status check through Ploinky CLI or router-visible status before returning the link.
- Never try to start heavy workloads directly inside AchillesCLI.
- If the research bundle is not deployed, return the exact enable command for the bundle.

First-slice command syntax:

```text
/exec launch-open-interpreter
/exec launch-openhands
/exec launch-agent-lab
/exec launch-ai-scientist
```

Direct-slash command syntax after AchillesCLI dynamic aliases:

```text
/open-interpreter
/openhands
/agent-lab
/ai-scientist
```

Dynamic alias design for a later AchillesCLI change:

- Extend AchillesCLI skill discovery or slash-command initialization to read optional slash metadata from discovered user skills.
- A launcher skill should be able to declare:

```json
{
  "slashCommands": [
    {
      "name": "open-interpreter",
      "skill": "launch-open-interpreter",
      "usage": "/open-interpreter [prompt]",
      "description": "Open the Open Interpreter Ploinky agent for this workspace context."
    }
  ]
}
```

- `SlashCommandHandler` should merge these aliases with static `COMMAND_DEFINITIONS`.
- Static built-in commands must win on name conflicts.
- `list_achilles_cli_commands` must include dynamic aliases so WebChat autocomplete sees them.
- Tests must cover parsing, execution, conflict handling, catalog output, and webchat mode.

## Profiles And Enablement

Default behavior must be conservative:

- Do not add `copilot-agents` or any research agent to Explorer's `enable` array.
- Do not make `researchCopilot` auto-enable execution agents.
- Deploy the suite only when the operator explicitly enables the `research-agents` bundle.
- Keep heavy research agents opt-in through Ploinky-selectable profile-level `enable` entries.
- Use `no-wait` only for optional/background dependencies.

Recommended profile split:

- `default`: bundle deploys `researchCopilot` and `openInterpreterAgent`.
- `dev`: same as `default`.
- `qa`: adds `openHandsAgent`.
- `prod`: adds `openHandsAgent`, `agentLaboratoryAgent`, and `aiScientistAgent`, likely with `no-wait` edges.

Recommended operator flow:

```bash
cd <workspace-root>
ploinky add repo copilot-agents <repo-url-or-local-path>
ploinky enable repo copilot-agents
ploinky enable agent copilot-agents/research-agents global
ploinky start explorer 8080
```

For a full research profile:

```bash
ploinky profile prod
ploinky enable agent copilot-agents/research-agents global
ploinky start explorer 8080
```

If Explorer is already running, confirm whether Ploinky supports refreshing the running dependency graph in the current branch before promising hot deployment. The documented safe path is to enable the bundle, then restart the Ploinky workspace/router.

## Security And Safety Rules

Apply these across every agent:

- Validate all paths against `PLOINKY_WORKSPACE_ROOT`.
- Reject null bytes, traversal, symlink escapes, and writes outside workspace/data roots.
- Require explicit execution mode for tools that run shell commands or modify files.
- Use async jobs for long-running tasks.
- Redact secrets, invocation tokens, raw prompts, internal payloads, and provider keys from logs.
- Do not expose public `auth: none` HTTP services.
- Do not trust `x-ploinky-auth-info` by itself.
- Check verified invocation metadata for sensitive operations.
- Keep durable state under `.ploinky/data/<agent>`.
- Keep generated runtime files under `.ploinky/agents/<agent>`.
- Treat local/container sandboxing as defense in depth, not strong multi-tenant isolation.
- Do not mount Docker sockets or host-wide paths in the default profile.

## Documentation Work

Initialize the repo documentation before or alongside the first code slice:

- `docs/index.html` with architecture overview and links to specs.
- `docs/specs/matrix.md`.
- `docs/specs/DS000-vision.md`.
- `docs/specs/DS001-coding-style.md`.
- `docs/specs/DS002-ploinky-runtime-invariants.md`.
- `docs/specs/DS003-agent-inventory.md`.
- One DS file for the `research-agents` bundle.
- One DS file for each planned runtime agent.
- One DS file for AchillesCLI launch integration.
- One DS file for security/observability.
- `docs/specs/matrix.md` generated from DS frontmatter.

`AGENTS.md` and `CLAUDE.md` must be kept small and identical if created.

## Testing And Verification

Unit tests:

- JSON envelope normalization.
- Tool argument validation.
- Path confinement.
- Redaction.
- Command construction.
- Status parsing.
- Upstream output parsing.

Static checks:

- Validate every `manifest.json`.
- Validate every `mcp-config.json`.
- Validate every `IDE-plugins/*/config.json` against Explorer's expected shape.
- Ensure DS numbering remains contiguous.

Ploinky smoke tests:

1. Add or enable `copilot-agents` from the workspace.
2. Enable only `copilot-agents/research-agents` in global mode.
3. Start Explorer as the static agent.
4. Verify Explorer can discover the copilot plugin.
5. Verify `ploinky client methods <agent>` lists expected tools.
6. Invoke a dry-run or status tool through Ploinky MCP.
7. Run one bounded workspace-scoped Open Interpreter task.
8. Verify logs do not expose secrets or raw prompts.
9. Open AchillesCLI Copilot for a directory with `skill-root` pointing to `copilot-agents/achilles-skills`.
10. Run `/exec launch-open-interpreter` and verify it returns a valid WebChat launch URL for the Open Interpreter agent.

Heavy-agent integration tests:

- Gate behind required env vars and profile flags.
- Use sample fixtures and small workloads.
- Do not require real paid LLM calls in default CI.

## Implementation Sequence

1. Add repo guidance and documentation skeleton.
2. Add the `research-agents` bundle agent with profile-level deployment edges.
3. Add shared adapter conventions per agent directory.
4. Implement `openInterpreterAgent` first.
5. Implement `researchCopilot` plugin and status/dispatch tools.
6. Add `achilles-skills/launch-open-interpreter` and document `/exec launch-open-interpreter`.
7. Add first Ploinky smoke test path for bundle deployment, Explorer plugin discovery, AchillesCLI skill-root loading, and Open Interpreter status.
8. Implement `openHandsAgent` in constrained headless mode.
9. Add `agentLaboratoryAgent` with project init/status/export before phase execution.
10. Add Agent Laboratory phase execution.
11. Add `aiScientistAgent` paper review first.
12. Add AI Scientist experiment execution after template setup validation.
13. Add dynamic AchillesCLI slash aliases in a separate AchillesCLI change if exact `/open-interpreter` style commands are required.
14. Add full profile docs and smoke scripts.

## High-Risk Decisions To Capture In DS Files

- Whether to ship prebuilt images or install Python dependencies at startup.
- Whether OpenHands may use Agent Server / Docker socket mode.
- Whether heavy research agents are enabled by any default dependency edge.
- Whether exact `/open-interpreter` slash commands are implemented now or delayed behind an AchillesCLI dynamic alias extension.
- Whether AchillesCLI launcher skills only return launch links or may call Ploinky management/status commands.
- How much prompt/output data can be retained for status, logs, or transcripts.
- How generated manuscripts preserve upstream responsible-use disclosure requirements.
- Whether Open Interpreter can auto-run code by default.

## Definition Of Done For The First Useful Slice

The first useful slice is complete when:

- `copilot-agents` has repo guidance, docs, and specs.
- The research suite is deployed only through the `research-agents` bundle, not through Explorer defaults.
- `openInterpreterAgent` exposes a working status tool and one bounded chat/task tool.
- `researchCopilot` contributes an Explorer plugin visible in an existing slot.
- The plugin can call the Open Interpreter status tool through Ploinky MCP.
- AchillesCLI Copilot can load `copilot-agents/achilles-skills` through `--skill-root`.
- `/exec launch-open-interpreter` returns a valid Open Interpreter launch/status path from AchillesCLI WebChat.
- All path, logging, and telemetry defaults follow this plan.
- Basic tests and one Ploinky smoke path are documented and runnable.
