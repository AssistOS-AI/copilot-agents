# Implementation Prompt

You are running from the workspace root that contains `copilot-agents`, `AssistOSExplorer`, and `ploinky`.

Read and follow:

1. Workspace guidance: `AGENTS.md`
2. Implementation plan: `copilot-agents/docs/plans/ploinky-research-agents-plan.md`
3. Explorer contracts:
   - `AssistOSExplorer/explorer/AGENTS.md`
   - `AssistOSExplorer/docs/specs/DS02-plugin-hosting-and-dependencies.md`
   - `AssistOSExplorer/docs/specs/DS06-ploinky-runtime-invariants.md`
4. Ploinky contracts:
   - `ploinky/docs/specs/DS003-agent-manifest-and-registry.md`
   - `ploinky/docs/specs/DS004-runtime-execution-and-isolation.md`
   - `ploinky/docs/specs/DS005-routing-and-web-surfaces.md`
   - `ploinky/docs/specs/DS006-auth-capabilities-and-secure-wire.md`
   - `ploinky/docs/specs/DS009-observability-and-transcripts.md`
   - `ploinky/docs/specs/DS011-security-model.md`
5. AchillesCLI contracts:
   - `AssistOSExplorer/AchillesCLI/achilles-cli/manifest.json`
   - `AssistOSExplorer/AchillesCLI/achilles-cli/IDE-plugins/achilles-cli-tool-button/config.json`
   - `AssistOSExplorer/AchillesCLI/achilles-cli/IDE-plugins/achilles-cli-tool-button/menu-contributions.js`
   - `AssistOSExplorer/AchillesCLI/achilles-cli/src/index.mjs`
   - `AssistOSExplorer/AchillesCLI/achilles-cli/src/repl/SlashCommandHandler.mjs`
   - `AssistOSExplorer/AchillesCLI/docs/specs/DS005-repl-and-command-processing.md`
   - `AssistOSExplorer/AchillesCLI/docs/specs/DS010-ecosystem-integration.md`

Goal:

Implement the first useful slice of `copilot-agents` as described in the plan.

Scope for this pass:

- Work only in `copilot-agents` unless you prove a blocking integration gap in `AssistOSExplorer` or `ploinky`.
- Do not add the research agents to Explorer's default dependency list.
- Do not make individual research agents auto-enable one another. Use the explicit `research-agents` bundle.
- Do not modify sibling repos for convenience.
- Do not stage unrelated files, sibling repos, `node_modules`, caches, or generated runtime state.
- Do not add generated-code, coding-agent, or tool attribution to commits, docs, comments, metadata, release notes, changelogs, or PR text.

Required first slice:

1. Add repo guidance:
   - Create small identical `copilot-agents/AGENTS.md` and `copilot-agents/CLAUDE.md`.
   - Point to the docs entry point and specs.
   - State that DS specs are source of truth.
   - State that `AGENTS.md` and `CLAUDE.md` must stay identical.

2. Add documentation skeleton:
   - `docs/index.html`
   - `docs/specs/matrix.md`
   - `docs/specs/DS000-vision.md`
   - `docs/specs/DS001-coding-style.md`
   - `docs/specs/DS002-ploinky-runtime-invariants.md`
   - `docs/specs/DS003-agent-inventory.md`
   - `docs/specs/DS004-research-agents-bundle.md`
   - `docs/specs/DS005-research-copilot-agent.md`
   - `docs/specs/DS006-open-interpreter-agent.md`
   - `docs/specs/DS007-openhands-agent.md`
   - `docs/specs/DS008-agent-laboratory-agent.md`
   - `docs/specs/DS009-ai-scientist-agent.md`
   - `docs/specs/DS010-achilles-cli-launch-integration.md`
   - `docs/specs/DS011-security-observability.md`
   - `docs/specs/matrix.md`

3. Implement the explicit deployment bundle:
   - Add `research-agents/manifest.json`.
   - The bundle should enable `researchCopilot global` and `openInterpreterAgent global` in its default profile.
   - Heavy agents must stay profile-gated.
   - Document this command as the supported deployment path:
     `ploinky enable agent copilot-agents/research-agents global`
   - Do not require a Ploinky core shorthand like `ploinky enable research-agents` in this pass.

4. Implement `openInterpreterAgent`:
   - Ploinky `manifest.json`.
   - `mcp-config.json`.
   - Python wrapper tools.
   - At minimum expose `oi_status` and one bounded task/chat tool.
   - Disable Open Interpreter telemetry by default.
   - Validate target paths against `PLOINKY_WORKSPACE_ROOT`.
   - Return compact JSON with `{ "ok": true }` or `{ "ok": false, "error": "..." }`.
   - Redact secrets, invocation tokens, and raw prompt bodies from logs.

5. Implement `researchCopilot`:
   - Ploinky `manifest.json`.
   - `mcp-config.json`.
   - A minimal Explorer application plugin under `IDE-plugins/research-copilot`.
   - Mount into an existing Explorer slot, preferably `file-exp:toolbar-plugins-dropdown` or `file-exp:right-bar`.
   - Add a status action that calls `openInterpreterAgent` through the Ploinky/Explorer MCP path.
   - Add or document an action that opens AchillesCLI WebChat with both `dir` and `skill-root` query parameters.
   - Keep domain logic inside the agent/tools, not in Explorer core.

6. Add AchillesCLI launcher skills:
   - Add `achilles-skills/launch-open-interpreter`.
   - The no-AchillesCLI-change launch command for this pass is `/exec launch-open-interpreter`.
   - The skill should validate context, check or report whether `openInterpreterAgent` is deployed, and return a `/webchat?agent=openInterpreterAgent&dir=<workingDir>` launch URL.
   - Document that exact `/open-interpreter` requires a later AchillesCLI dynamic slash-alias extension because direct slash commands are currently static in `SlashCommandHandler`.

7. Add tests and smoke documentation:
   - Unit tests for envelope parsing, path confinement, redaction, and tool output shape.
   - Static validation for manifests, MCP configs, and plugin config shape.
   - A documented Ploinky smoke path that enables only `research-agents`, starts Explorer, verifies plugin discovery, verifies `oi_status`, opens AchillesCLI Copilot with `--skill-root`, and runs `/exec launch-open-interpreter`.

Implementation constraints:

- Use the existing Ploinky default AgentServer and `mcp-config.json` tool pattern where practical.
- Use async MCP tools for long-running tasks, but the first Open Interpreter bounded task may be synchronous if it has a strict timeout.
- Do not add public unauthenticated HTTP services.
- Do not use direct agent container ports.
- Do not mount host paths outside `.ploinky/`.
- Keep durable state under `.ploinky/data/<agent>`.
- Keep generated runtime inputs under `.ploinky/agents/<agent>`.
- Treat OpenHands, Agent Laboratory, and AI Scientist as documented future agents in this first pass unless there is time to scaffold empty manifests safely.
- If you decide exact `/open-interpreter` must be implemented in this pass, first update AchillesCLI with a generic dynamic slash alias mechanism rather than hard-coding research-specific commands, and update AchillesCLI docs/tests in the same change. Otherwise leave it as planned future work and use `/exec launch-open-interpreter`.

Verification before finishing:

- Run the narrowest relevant tests.
- Run static validation scripts if you add them.
- Show `git status --short` for `copilot-agents`.
- Summarize exactly what changed, what tests ran, and what remains for the next slice.
