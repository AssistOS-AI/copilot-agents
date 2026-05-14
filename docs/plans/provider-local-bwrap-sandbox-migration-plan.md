# Provider-Local Bwrap Sandbox Migration Plan

Status: active implementation plan
Last analyzed: 2026-05-14

## Purpose

Migrate the tagged research-agent runtime away from a central
`basic/bwrap-runner` Ploinky agent. The final architecture uses the
bwrap-runner Docker image and reusable local sandbox runner as shared
infrastructure, while each research provider agent owns its own backend
runtime setup and starts its own inner bubblewrap sandbox locally.

This plan implements the invariant introduced in:

- `copilot-agents/docs/specs/DS002-ploinky-runtime-invariants.md`
- `copilot-agents/docs/specs/DS003-agent-inventory.md`
- `copilot-agents/docs/specs/DS004-research-agents-bundle.md`
- `copilot-agents/docs/specs/DS005-research-relay-agent.md`
- `copilot-agents/docs/specs/DS006-open-interpreter-agent.md`
- `copilot-agents/docs/specs/DS011-security-observability.md`
- `copilot-agents/docs/specs/DS012-tagged-research-chat-relay.md`
- `basic/docs/specs/DS002-bwrap-runner-agent.md`

The umbrella research-agent plan remains
`copilot-agents/docs/plans/ploinky-research-agents-plan.md`; this file is the
implementation plan for the provider-local sandbox migration.

## Invariants

1. The `research-agents` bundle must not enable `basic/bwrap-runner`.
2. `openInterpreterAgent` and future research providers must run in
   `assistos/bwrap-runner:node24-python-bookworm` or a documented derived
   image.
3. Research providers, not the relay and not a runner agent, own backend
   runtime setup.
4. Research providers start the inner bwrap job locally inside their own
   container.
5. The bwrap-runner image must stay generic and must not install
   backend-specific packages such as `open-interpreter`.
6. The reusable sandbox runner must stay DRY; do not copy bwrap argv,
   staging, runtime validation, truncation, or timeout policy into every
   provider.
7. Ploinky framework code must not hardcode research agent ids, backend tags,
   provider tool names, or other optional agent-specific routing.
8. `/shared` is a trusted coordination channel, not a hostile-agent isolation
   boundary and not the required runtime handoff path.
9. Inner bwrap jobs must not receive a broad `/shared` bind.
10. Provider credentials and invocation JWTs must not enter the inner bwrap
    environment or staged files.

## Target Runtime Flow

```text
Copilot WebChat / WebMeet MCP chat
  -> configured @backend tag detection
  -> researchRelay.research_task_submit
  -> provider MCP tool, e.g. openInterpreterAgent.open_interpreter_run_task
  -> provider validates prompt, resources, origin, and timeout
  -> provider prepares/reuses its runtime under an agent-owned root
  -> provider invokes the local bwrap-runner sandbox helper
  -> inner bwrap job receives /work, /outputs, and optional read-only /runtime
  -> provider normalizes stdout/stderr into natural language
  -> relay returns the natural-language answer to the originating chat
```

## Current Couplings To Remove

The implementation may currently contain pieces from the previous design. Find
and remove or replace these research-path couplings:

- `research-agents/manifest.json` enables `bwrap-runner global no-wait`.
- `openInterpreterAgent/manifest.json` describes a shared runtime bundle under
  `/shared/research-runtimes` and includes `RESEARCH_BWRAP_AGENT`.
- `openInterpreterAgent/mcp-config.json` describes delegation to
  `basic/bwrap-runner`.
- `openInterpreterAgent/tools/open-interpreter-run-task.mjs` calls
  `basic/bwrap-runner.sandbox_exec` through the router.
- `openInterpreterAgent/tools/lib/runtime-bundle.mjs` defaults to
  `/shared/research-runtimes`.
- `researchRelay/tools/status.mjs` checks bwrap-runner reachability.
- `researchRelay/tools/lib/backends.mjs` describes Open Interpreter as
  executed through `basic/bwrap-runner`.
- Tests assert remote runner delegation or shared runtime-bundle payloads.

The Basic repo may retain compatibility agent files temporarily, but
`copilot-agents` must not depend on them for research execution.

## Phase 1: Baseline And Search

1. From `/Users/danielsava/work/file-parser`, inspect all relevant dirty
   state before editing:

   ```bash
   git -C basic status --short
   git -C basic diff --stat
   git -C copilot-agents status --short
   git -C copilot-agents diff --stat
   git -C ploinky status --short
   git -C ploinky diff --stat
   ```

2. Search for stale central-runner terms:

   ```bash
   rg -n "basic/bwrap|bwrap-runner\\.sandbox_exec|RESEARCH_BWRAP_AGENT|runtimeBundle|/shared/research-runtimes|bwrap-runner global" basic copilot-agents ploinky
   ```

3. Do not revert unrelated dirty changes. Work with existing edits.
4. Do not deploy to `skills.axiologic.dev`.
5. Do not print Docker Hub tokens, local auth secrets, provider credentials,
   invocation JWTs, or workspace passwords.

## Phase 2: Make Basic A Real Shared Local Runner

The current bwrap-runner image installs OS tooling but the Dockerfile does not
install the bwrap-runner JavaScript runner code into the image. Provider agents
using the image need a stable local entrypoint that exists inside their
container.

1. Update `basic/bwrap-runner/Dockerfile` so the image includes the reusable
   runner code:
   - Copy `bwrap-runner/bin/` and `bwrap-runner/lib/` into a stable image path
     such as `/opt/bwrap-runner/`.
   - Add an executable wrapper such as
     `/usr/local/bin/bwrap-sandbox-exec` that runs the local sandbox CLI.
   - Keep `WORKDIR /code` if existing Basic-agent compatibility needs it.
   - Keep the image generic; do not install Open Interpreter or other backend
     packages.

2. Extract a reusable local runner module if the current CLI is too coupled to
   MCP stdin/stdout:
   - Provide an importable function such as `runSandboxJob(input, options)`.
   - Keep validation, staging, bwrap argv generation, process spawning,
     timeout handling, output truncation, and structured result formatting in
     Basic-owned shared code.
   - Keep `bin/sandbox-exec.mjs` as a thin CLI wrapper over that shared code.

3. Replace remote-tool-shaped runtime input with provider-local runtime input:
   - The local helper may accept an internal object like:

     ```js
     {
       runtime: {
         root: "/data/research-runtimes",
         id: "open-interpreter",
         version: "0.4.3",
         digest: "optional"
       }
     }
     ```

   - `root` must come from provider configuration, not chat, relay, browser,
     or agent-to-agent payloads.
   - Validate id/version patterns, traversal, absolute paths, null bytes,
     manifest schema/id/version, optional digest, realpath containment, and
     symlink escapes.
   - Bind only the validated runtime directory read-only at `/runtime`.
   - Do not bind all `/shared`.

4. Preserve the sandbox policy:
   - `--die-with-parent`
   - unshare user, PID, IPC, UTS, and network by default
   - clear environment
   - set only allowlisted environment values plus manifest-derived values
   - read-only binds for selected system paths
   - `/proc`, `/dev`, tmpfs `/tmp`
   - per-job writable `/work` and `/outputs`

5. Keep compatibility agent behavior, if retained, separate:
   - Compatibility MCP tests must not be the proof that research execution
     works.
   - Basic docs must continue to say the research invariant is image/local
     runner, not agent delegation.

## Phase 3: Migrate Open Interpreter Runtime Ownership

1. Update `copilot-agents/openInterpreterAgent/manifest.json`:
   - Keep `"container": "assistos/bwrap-runner:node24-python-bookworm"` unless
     a documented derived image is introduced.
   - Add `"containerSecurity": { "privileged": true }`.
   - Remove `RESEARCH_BWRAP_AGENT` from `env`.
   - Change `OI_RUNTIME_ROOT` default to `/data/research-runtimes`.
   - Keep `.ploinky/data/openInterpreterAgent` mounted at `/data`.
   - Update `about` to say the provider runs local bwrap jobs in its own
     container.

2. Update `openInterpreterAgent/mcp-config.json`:
   - `prepare_runtime` describes `/data/research-runtimes`.
   - `open_interpreter_run_task` describes local sandbox execution.
   - Remove references to `basic/bwrap-runner`, `sandbox_exec`, shared runtime
     bundles, and `/shared/research-runtimes`.

3. Update runtime helper naming and defaults:
   - Rename or rewrite `tools/lib/runtime-bundle.mjs` if useful; the concept
     is provider-owned runtime, not a shared bundle for a remote runner.
   - Default root is `/data/research-runtimes`.
   - Keep manifest schema/id/version compatibility checks.
   - Keep Linux-container-only preparation.

4. Update `tools/prepare-runtime.mjs`:
   - Build in `/data/research-runtimes/open-interpreter/.tmp-*`.
   - Install with
     `python3 -m pip install --target <tmp>/python open-interpreter==0.4.3`.
   - Copy `runtime/research-open-interpreter.py` into `<tmp>/bin/`.
   - Write a manifest that declares id, version, entrypoint, Python path, and
     compatibility with the bwrap-runner image.
   - Atomically rename into
     `/data/research-runtimes/open-interpreter/0.4.3/`.
   - Reuse an existing matching runtime.
   - Return a natural-language repair message for invalid existing runtime
     directories; do not delete them in place.

5. Update `tools/open-interpreter-run-task.mjs`:
   - Keep Ploinky invocation-token validation for the provider MCP call.
   - Never pass that token to the inner bwrap job.
   - Validate prompt, resources, origin, and timeout.
   - Stage `prompt.md`, `config/open-interpreter.json`, and `input/*` through
     the local runner's typed `files` input.
   - Invoke `/usr/local/bin/bwrap-sandbox-exec` or the Basic local runner
     module inside the provider container.
   - Pass provider-selected runtime metadata rooted at `OI_RUNTIME_ROOT`.
   - Run the backend command through `/runtime/bin/research-open-interpreter.py`.
   - Normalize structured runner stdout/stderr into a natural-language answer.
   - Missing model/provider/local endpoint must return a natural-language
     configuration message, not a traceback.

6. Update `tools/status.mjs`:
   - Report provider runtime readiness.
   - Report local bwrap health.
   - Report model topology and telemetry posture.
   - Do not check or mention remote bwrap-runner reachability.
   - Do not expose secrets, tokens, raw prompts, or resource payloads.

## Phase 4: Keep Research Relay Generic

1. Update `researchRelay/tools/lib/backends.mjs` descriptions:
   - `@open-interpreter` is provider-backed.
   - It is executed by `openInterpreterAgent` in a local sandbox based on the
     shared image.
   - The relay does not know runtime roots, versions, shim paths, bwrap argv,
     or provider command strings.

2. Update `researchRelay/tools/status.mjs`:
   - Remove `RESEARCH_BWRAP_AGENT`.
   - Remove bwrap-runner reachability checks.
   - If status checks providers, use provider MCP status tools through
     secure-wire and keep failures natural-language or structured.

3. Keep `research_task_submit` behavior:
   - Known tags route to provider MCP tools.
   - Unknown `@word` mentions fall through at the chat surface.
   - Relay forwards `x-ploinky-caller-jwt` agent-to-agent.
   - Relay never forwards credentials or invocation JWTs into sandbox payloads.

## Phase 5: Update Bundle And Manifests

1. Update `research-agents/manifest.json`:
   - Remove every `bwrap-runner global no-wait`.
   - Default/dev/qa/prod enable only:

     ```text
     researchRelay global
     openInterpreterAgent global no-wait
     ```

   - Update `about` so it says providers execute locally in containers based
     on the shared bwrap-runner image.

2. Update `research-agents/mcp-config.json` if status text or returned bundle
   information mentions `bwrap-runner` as an enabled agent.

3. Confirm `scripts/validate-manifests.mjs` accepts
   `containerSecurity.privileged` on `openInterpreterAgent` if the schema
   validates that field.

## Phase 6: Update Tests

Basic unit tests:

- Dockerfile contains generic Python and bwrap tooling.
- Dockerfile or image build context installs the local runner entrypoint.
- Dockerfile does not install `open-interpreter`.
- Local runner validates staged files and provider-selected runtime metadata.
- Runtime validation rejects traversal, absolute paths, bad id/version,
  missing manifest, manifest mismatch, digest mismatch, and symlink escape.
- Generated bwrap argv binds only the validated provider runtime at
  `/runtime`.
- Generated bwrap argv does not bind `/shared`.
- Compatibility MCP tests, if kept, do not assert that research providers must
  call the runner agent.

Copilot-agent unit tests:

- `research-agents` bundle does not enable `bwrap-runner`.
- `researchRelay` backend catalog delegates `@open-interpreter` to
  `openInterpreterAgent`.
- `researchRelay` status does not check bwrap-runner reachability.
- `openInterpreterAgent` prepares or recognizes a runtime under
  `/data/research-runtimes`.
- `openInterpreterAgent` invokes the local runner and does not call
  `basic/bwrap-runner.sandbox_exec`.
- Task execution does not include `runtimeBundle` in an agent-to-agent payload.
- Task execution does not use embedded Python heredocs or `node -e` setup
  drivers.
- Missing model/provider configuration becomes natural-language output.
- Provider credentials and invocation JWTs are not staged into `/work` and are
  not present in local runner env.

Integration/browser checks:

- Fresh workspace under `~/work/testExplorerFresh`.
- Enable `copilot-agents/research-agents`.
- Start Ploinky.
- Open `/webchat?agent=research-agents&research-tags=1`.
- Send `@open-interpreter Give a one sentence configuration status.`
- Expected result: runtime is prepared or found by `openInterpreterAgent`; if
  no model is configured, the response is a natural-language model/provider
  configuration message.
- The response must not include `bwrap-runner unavailable`, `python missing`,
  `package missing`, or a traceback.

## Phase 7: Update Docs

Update these docs if implementation details change:

- `copilot-agents/docs/specs/DS002-ploinky-runtime-invariants.md`
- `copilot-agents/docs/specs/DS003-agent-inventory.md`
- `copilot-agents/docs/specs/DS004-research-agents-bundle.md`
- `copilot-agents/docs/specs/DS005-research-relay-agent.md`
- `copilot-agents/docs/specs/DS006-open-interpreter-agent.md`
- `copilot-agents/docs/specs/DS011-security-observability.md`
- `copilot-agents/docs/specs/DS012-tagged-research-chat-relay.md`
- `copilot-agents/docs/specs/matrix.md`
- `copilot-agents/docs/index.html`
- `basic/docs/specs/DS002-bwrap-runner-agent.md`
- `basic/docs/specs/matrix.md`
- `basic/bwrap-runner/README.md`
- `basic/docs/bwrap-runner.html`

The DS files are the source of truth. If code and specs diverge, change the
spec first or in the same patch with an explicit decision entry.

## Verification Commands

Run from `basic` after Basic changes:

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

Run from `copilot-agents` after provider and relay changes:

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

Run Ploinky and browser checks after unit tests pass. Keep logs bounded and
redacted.

## Acceptance Criteria

- `research-agents` no longer enables `bwrap-runner`.
- `openInterpreterAgent` no longer calls `basic/bwrap-runner.sandbox_exec`.
- `openInterpreterAgent` prepares runtime under `/data/research-runtimes`.
- `openInterpreterAgent` starts a local inner bwrap job using shared Basic
  runner code installed in the bwrap-runner image.
- `researchRelay` remains a thin provider router and has no sandbox logic.
- Ploinky core contains no research-specific agent ids, tags, or tool names.
- `/shared` is not broadly bound into inner jobs and is not required for
  runtime handoff.
- The fresh-workspace browser check returns a natural-language result.
