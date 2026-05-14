# Implementation Prompt

Run from the workspace root that contains `copilot-agents`, `basic`,
`ploinky`, and `AssistOSExplorer`.

Read first:

1. Workspace `AGENTS.md`
2. `copilot-agents/AGENTS.md`
3. `copilot-agents/docs/plans/ploinky-research-agents-plan.md`
4. `copilot-agents/docs/plans/provider-local-bwrap-sandbox-migration-plan.md`
5. `copilot-agents/docs/prompts/implement-provider-local-bwrap-sandbox-migration.md`
6. `copilot-agents/docs/specs/DS002-ploinky-runtime-invariants.md`
7. `copilot-agents/docs/specs/DS006-open-interpreter-agent.md`
8. `copilot-agents/docs/specs/DS012-tagged-research-chat-relay.md`
9. `basic/docs/specs/DS002-bwrap-runner-agent.md`
10. `ploinky/docs/specs/DS005-routing-and-web-surfaces.md`
11. `AssistOSExplorer/webmeetAgent/docs/specs/DS09-ploinky-runtime-invariants.md`

Goal:

Implement or extend the tagged research-agent relay. Research agents are not
direct chat targets. A user tags a backend from Copilot or WebMeet chat, gives
it a natural-language task and optional resources, and receives a
natural-language answer in the originating chat.

Required invariant:

```text
chat @backend prompt/resources
  -> researchRelay.research_task_submit
  -> backend provider agent
  -> provider-owned runtime setup
  -> provider-local sandbox runner inside provider container
  -> backend command in inner bwrap
  -> natural-language chat reply
```

Do not require or enable a `basic/bwrap-runner` Ploinky agent for research
execution. The shared artifact is the bwrap-runner Docker image and local
sandbox runner. Every research provider agent must run in that image or a
documented derived image and start its own inner bubblewrap sandbox locally.

Do not:

- Enable direct backend chat agents by default.
- Enable `basic/bwrap-runner` from the `research-agents` bundle.
- Add research-agent ids, backend tags, or provider tool names to Ploinky
  framework code.
- Pass host paths as bwrap mounts.
- Follow symlinks outside `PLOINKY_WORKSPACE_ROOT`, `.ploinky/shared`, or a
  provider-owned runtime root when materializing inputs.
- Pass raw bwrap flags, network selectors, capabilities, provider credentials,
  or invocation JWTs into the sandbox.
- Intercept arbitrary `@word` mentions; only configured backend tags are
  research invocations.
- Place absolute host workspace paths in browser launch URLs when a
  workspace-relative parameter can be used.
- Log raw prompts, resource contents, base64 payloads, command stdin, or
  invocation payloads.
- Add research-agent logic to Explorer core or Ploinky core.
- Add coding-agent attribution to commits, docs, metadata, changelogs, or PRs.

Only provider-backed tags are active. Keep `@open-interpreter` routed through
`openInterpreterAgent`; do not add DeepAnalyze, OpenHands, MLJAR, or Agentic
Data Scientist as active tags until each has a provider agent that owns
runtime setup and local sandbox execution.

When changing behavior, update the affected DS file in the same change because
the specs are the source of truth.

Verification:

```bash
cd basic
node --check bwrap-runner/bin/sandbox-exec.mjs \
  bwrap-runner/lib/policy.mjs \
  bwrap-runner/lib/staging.mjs
node --test tests/unit/bwrapRunnerPolicy.test.mjs \
  tests/unit/bwrapRunnerSmoke.test.mjs \
  tests/unit/bwrapRunnerRuntimeBundles.test.mjs
./fileSizesCheck.sh
git diff --check

cd ../copilot-agents
node --check researchRelay/tools/lib/task.mjs \
  researchRelay/tools/submit-task.mjs \
  openInterpreterAgent/tools/prepare-runtime.mjs \
  openInterpreterAgent/tools/open-interpreter-run-task.mjs \
  openInterpreterAgent/tools/status.mjs
python3 -m py_compile openInterpreterAgent/runtime/research-open-interpreter.py
node --test tests/unit/*.test.mjs
node scripts/validate-manifests.mjs
git diff --check
```

Also run syntax checks on any touched JavaScript files in `ploinky`,
`AssistOSExplorer/AchillesCLI`, or `AssistOSExplorer/webmeetAgent`, and run the
fresh-workspace browser check described in the plan after unit tests pass.
