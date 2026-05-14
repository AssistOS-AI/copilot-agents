# Implementation Prompt: Provider-Local Bwrap Sandbox Migration

Run from `/Users/danielsava/work/file-parser`, which contains `basic`,
`copilot-agents`, `ploinky`, and `AssistOSExplorer`.

## Read First

Read these files before editing:

1. `AGENTS.md`
2. `copilot-agents/AGENTS.md`
3. `copilot-agents/docs/plans/provider-local-bwrap-sandbox-migration-plan.md`
4. `copilot-agents/docs/plans/ploinky-research-agents-plan.md`
5. `copilot-agents/docs/specs/DS002-ploinky-runtime-invariants.md`
6. `copilot-agents/docs/specs/DS003-agent-inventory.md`
7. `copilot-agents/docs/specs/DS004-research-agents-bundle.md`
8. `copilot-agents/docs/specs/DS005-research-relay-agent.md`
9. `copilot-agents/docs/specs/DS006-open-interpreter-agent.md`
10. `copilot-agents/docs/specs/DS011-security-observability.md`
11. `copilot-agents/docs/specs/DS012-tagged-research-chat-relay.md`
12. `basic/docs/specs/DS002-bwrap-runner-agent.md`
13. `basic/bwrap-runner/README.md`
14. `basic/docs/bwrap-runner.html`

## Goal

Implement the provider-local bwrap sandbox architecture for research agents.
The `basic/bwrap-runner` Ploinky agent is not part of the research runtime
path. The shared artifact is the bwrap-runner Docker image plus reusable local
sandbox runner code installed in that image. Each research provider agent runs
in that image or a documented derived image and starts its own inner bwrap job
locally.

Required flow:

```text
chat @backend prompt/resources
  -> researchRelay.research_task_submit
  -> backend provider agent
  -> provider-owned runtime setup
  -> provider-local sandbox runner inside provider container
  -> backend command in inner bwrap
  -> natural-language chat reply
```

## Hard Invariants

- Do not enable `basic/bwrap-runner` from `research-agents`.
- Do not call `basic/bwrap-runner.sandbox_exec` from research providers.
- Do not add research-specific ids, backend tags, provider tool names, or
  routing to Ploinky framework code.
- Do not install Open Interpreter or other backend packages in the shared
  bwrap-runner image.
- Do not duplicate bwrap argv/staging/runtime-validation policy in provider
  agents; keep it in Basic shared runner code.
- Do not pass host paths, raw bwrap flags, network selectors, capabilities,
  provider credentials, or invocation JWTs into the inner sandbox.
- Do not broadly bind `/shared` into inner jobs.
- Do not use `/shared/research-runtimes` as the required runtime handoff path.
- Do not intercept arbitrary `@word` mentions.
- Do not deploy to `skills.axiologic.dev`.
- Do not print Docker Hub tokens, local auth passwords, provider credentials,
  invocation JWTs, or raw prompts/resources.
- Do not add coding-agent attribution to commits, docs, metadata,
  changelogs, or PRs.

## Implementation Order

1. Inspect dirty state in `basic`, `copilot-agents`, and `ploinky`; preserve
   unrelated changes.
2. Update Basic so `assistos/bwrap-runner:node24-python-bookworm` contains a
   stable local runner entrypoint and shared runner modules.
3. Keep the Basic image generic and keep any compatibility MCP agent separate
   from the research execution path.
4. Update `openInterpreterAgent`:
   - use the bwrap-runner image as the provider container;
   - request `containerSecurity.privileged: true`;
   - default `OI_RUNTIME_ROOT` to `/data/research-runtimes`;
   - remove `RESEARCH_BWRAP_AGENT`;
   - prepare Open Interpreter under `/data/research-runtimes`;
   - call the local runner instead of remote `sandbox_exec`;
   - return natural-language configuration messages for missing model setup.
5. Update `researchRelay` so it remains a thin tag router:
   - no bwrap-runner reachability status;
   - no runtime roots, versions, shim paths, or sandbox argv;
   - delegate `@open-interpreter` to `openInterpreterAgent`.
6. Update `research-agents` bundle profiles to enable only `researchRelay`
   and `openInterpreterAgent`.
7. Update tests to assert the new invariant and reject the old coupling.
8. Update docs/specs in the same change if behavior differs from the files
   listed above.

## Files Likely To Change

Basic:

- `basic/bwrap-runner/Dockerfile`
- `basic/bwrap-runner/bin/sandbox-exec.mjs`
- `basic/bwrap-runner/lib/*.mjs`
- `basic/bwrap-runner/README.md`
- `basic/docs/bwrap-runner.html`
- `basic/docs/specs/DS002-bwrap-runner-agent.md`
- `basic/tests/unit/*.test.mjs`

Copilot agents:

- `copilot-agents/research-agents/manifest.json`
- `copilot-agents/research-agents/mcp-config.json`
- `copilot-agents/researchRelay/tools/lib/backends.mjs`
- `copilot-agents/researchRelay/tools/status.mjs`
- `copilot-agents/openInterpreterAgent/manifest.json`
- `copilot-agents/openInterpreterAgent/mcp-config.json`
- `copilot-agents/openInterpreterAgent/tools/lib/*.mjs`
- `copilot-agents/openInterpreterAgent/tools/prepare-runtime.mjs`
- `copilot-agents/openInterpreterAgent/tools/open-interpreter-run-task.mjs`
- `copilot-agents/openInterpreterAgent/tools/status.mjs`
- `copilot-agents/tests/unit/*.test.mjs`
- affected DS files under `copilot-agents/docs/specs/`

## Required Searches Before Finishing

Run these searches and address stale references, except where a plan or prompt
intentionally describes what to remove:

```bash
rg -n "basic/bwrap|bwrap-runner\\.sandbox_exec|RESEARCH_BWRAP_AGENT|runtimeBundle|/shared/research-runtimes|bwrap-runner global" basic copilot-agents ploinky
rg -n "researchRelay|openInterpreterAgent|@open-interpreter|research_task_submit" ploinky
```

The second search should not show hardcoded research coupling in Ploinky
framework code. Generic launch parameters and tests for generic behavior are
acceptable.

## Verification

Run from `basic`:

```bash
node --check bwrap-runner/bin/sandbox-exec.mjs \
  bwrap-runner/lib/policy.mjs \
  bwrap-runner/lib/staging.mjs \
  bwrap-runner/lib/runtime-bundles.mjs
node --test tests/unit/bwrapRunnerPolicy.test.mjs \
  tests/unit/bwrapRunnerSmoke.test.mjs \
  tests/unit/bwrapRunnerRuntimeBundles.test.mjs
./fileSizesCheck.sh
git diff --check
```

Run from `copilot-agents`:

```bash
node --check researchRelay/tools/lib/task.mjs \
  researchRelay/tools/submit-task.mjs \
  researchRelay/tools/status.mjs \
  openInterpreterAgent/tools/prepare-runtime.mjs \
  openInterpreterAgent/tools/open-interpreter-run-task.mjs \
  openInterpreterAgent/tools/status.mjs
python3 -m py_compile openInterpreterAgent/runtime/research-open-interpreter.py
node --test tests/unit/*.test.mjs
node scripts/validate-manifests.mjs
git diff --check
```

After unit tests pass, run the fresh-workspace browser check from
`copilot-agents/docs/plans/provider-local-bwrap-sandbox-migration-plan.md`.

## Done Means

- `research-agents` does not enable `bwrap-runner`.
- `openInterpreterAgent` does not call `basic/bwrap-runner.sandbox_exec`.
- Open Interpreter runtime is prepared under `/data/research-runtimes`.
- The provider invokes the Basic local runner inside its own container.
- `researchRelay` remains generic and provider-backed.
- Ploinky framework code remains agent-agnostic.
- The fresh-workspace browser check returns a natural-language answer.
