# copilot-agents smoke path

This document tracks the manual, end-to-end smoke check for the first
implementation slice. It is intentionally manual: heavy agents are gated, and
the smoke path is written to be runnable in a developer workspace without
external secrets or paid LLM calls in the default case.

## Prerequisites

- A Ploinky workspace under `<workspace-root>`.
- `node 20+` available for static validation.
- `python 3.12+` available (only required to import Open Interpreter when
  running `oi_run_task`; `oi_status` works without it and reports
  `installed: false`).

## 1. Static validation

From `<workspace-root>/copilot-agents`:

```bash
node scripts/validate-manifests.mjs
node --test tests/unit/*.test.mjs
python3 -m unittest discover -s tests/python -p "test_*.py"
```

All three must pass before continuing.

## 2. Enable the bundle

Use the documented Ploinky path. Do not add `copilot-agents` to Explorer's
default dependency list.

```bash
cd <workspace-root>
ploinky add repo copilot-agents <repo-url-or-local-path>
ploinky enable repo copilot-agents
ploinky enable agent copilot-agents/research-agents global
ploinky start explorer 8080
```

Heavy agents stay gated behind Ploinky's selectable profiles:

```bash
ploinky profile qa
ploinky enable agent copilot-agents/research-agents global

ploinky profile prod
ploinky enable agent copilot-agents/research-agents global
```

## 3. Verify Ploinky discovery

```bash
ploinky client methods research-agents
ploinky client methods researchCopilot
ploinky client methods openInterpreterAgent
```

Expected tools:

- `research-agents`: `research_agents_status`
- `researchCopilot`: `research_copilot_status`, `research_copilot_list_backends`, `research_copilot_dispatch`
- `openInterpreterAgent`: `oi_status`, `oi_run_task`

## 4. Verify status without secrets

```bash
ploinky client invoke openInterpreterAgent oi_status '{}'
```

Expected: `ok: true`, structured `interpreter`, `telemetry`, `config`, and
`paths` blocks. `telemetry.disabled` must be `true` by default.

## 5. Verify Explorer plugin discovery

Open `http://127.0.0.1:8080/explorer/index.html`. Confirm:

- The `Research Copilot` plugin shows up under the toolbar plugins dropdown.
- Right-click a directory in the file tree: `Research Copilot` context menu
  entries appear (Open Research Copilot here, Open Open Interpreter agent here).

## 6. Verify AchillesCLI launch with `--skill-root`

From the AchillesCLI plugin, open the Copilot for a workspace directory. From
the URL bar, add the `skill-root` query parameter pointing at this
repository's `achilles-skills` folder:

```text
/webchat?agent=achilles-cli&dir=<workingDir>&skill-root=<workspaceRoot>/.ploinky/repos/copilot-agents/achilles-skills
```

`researchCopilot`'s menu actions already build this URL. Inside the chat, run:

```text
/exec launch-open-interpreter
```

The reply must include a line that starts with
`/webchat?agent=openInterpreterAgent` and, when the working directory is
known, includes `&dir=<workingDir>`. When `openInterpreterAgent` is not
deployed, the reply must include a `note:` line that points to the
`ploinky enable agent copilot-agents/research-agents global` command.

## 7. Confirm log hygiene

Tail the router and watchdog logs while exercising the tools above:

```bash
tail -f .ploinky/logs/router.log
tail -f .ploinky/logs/watchdog.log
```

The following strings must never appear:

- raw `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `PLOINKY_*KEY` values
- raw prompt bodies passed to `oi_run_task`
- invocation JWTs or bearer tokens

## Known first-slice limitations

- `/exec launch-open-interpreter` is the supported deterministic launcher path.
  Direct slash aliases such as `/open-interpreter` require a future generic
  AchillesCLI dynamic-alias extension (see DS010).
- `openHandsAgent`, `agentLaboratoryAgent`, and `aiScientistAgent` are documented
  in DS007/DS008/DS009 but not yet implemented in this repository.
- `oi_run_task` requires the upstream `open-interpreter` Python package; the
  install hook in the manifest pins version `0.4.3`. CI environments without
  network egress should set `OPEN_INTERPRETER_SKIP_INSTALL=1` and skip the
  bounded-task test.
