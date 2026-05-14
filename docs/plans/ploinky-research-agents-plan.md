# Ploinky Tagged Research Agents Implementation Plan

Status: active implementation plan
Last analyzed: 2026-05-14

## Purpose

Implement explicitly deployed research agents as chat-tagged,
provider-backed backend adapters. Users tag a backend from Copilot chat or
WebMeet chat, provide a natural-language task and optional resources, and
receive a natural-language answer back in the same chat.

Detailed migration work for the provider-local bwrap sandbox invariant lives in
`docs/plans/provider-local-bwrap-sandbox-migration-plan.md`. Use that plan for
the implementation that removes the research dependency on a separate
`basic/bwrap-runner` Ploinky agent.

Active backend tags:

- `@open-interpreter`

Reserved future tags such as `@agentic-data-scientist`, `@openhands`,
`@mljar`, and `@deepanalyze` must not be intercepted until provider agents
exist for them.

## Non-negotiable Invariant

The research suite must not require a `basic/bwrap-runner` Ploinky agent.
The shared execution artifact is the bwrap-runner Docker image and reusable
local sandbox runner. Every research provider agent runs in a container based
on that image and starts its own inner bubblewrap sandbox locally.

The target flow is:

```text
Copilot WebChat / WebMeet MCP chat
  -> configured @backend tag detection
  -> researchRelay.research_task_submit
  -> backend provider agent MCP tool
  -> provider-owned runtime setup
  -> provider-local sandbox runner inside the provider container
  -> backend command in inner bwrap with /work and optional /runtime
  -> natural-language answer appended to originating chat
```

Ploinky core must stay generic. It must not hardcode `researchRelay`,
`openInterpreterAgent`, research tags, provider tool names, or any other
optional agent-specific routing. Research-specific behavior belongs in
research agents, Explorer plugins, and generic AchillesCLI tag-relay launch
parameters.

## Source Of Truth

The authoritative contracts are the DS files, especially:

- `docs/specs/DS002-ploinky-runtime-invariants.md`
- `docs/specs/DS003-agent-inventory.md`
- `docs/specs/DS004-research-agents-bundle.md`
- `docs/specs/DS005-research-relay-agent.md`
- `docs/specs/DS006-open-interpreter-agent.md`
- `docs/specs/DS010-achilles-cli-launch-integration.md`
- `docs/specs/DS011-security-observability.md`
- `docs/specs/DS012-tagged-research-chat-relay.md`
- `../basic/docs/specs/DS002-bwrap-runner-agent.md`

Spec-code synchronization is an invariant. When behavior changes, update the
affected DS file in the same change.

## Step-by-Step Implementation

### 1. Baseline And Dirty State

1. Inspect status and diffs before editing:
   - `git -C basic status --short && git -C basic diff --stat`
   - `git -C copilot-agents status --short && git -C copilot-agents diff --stat`
   - `git -C ploinky status --short && git -C ploinky diff --stat`
2. Preserve unrelated dirty changes. Do not revert sibling repo work.
3. Confirm the current implementation still calls `basic/bwrap-runner` from
   `openInterpreterAgent`; that is the main coupling to remove.

### 2. Convert Basic To Image And Local Runner

1. Keep `basic/bwrap-runner/Dockerfile` as the shared sandbox image:
   - Base remains `node:24.15.0-bookworm-slim`.
   - Keep bubblewrap, Node, Python 3, pip, venv, Python headers, and build
     helpers.
   - Do not install backend-specific packages such as Open Interpreter.
2. Extract the reusable local runner contract:
   - Keep shared code in `bwrap-runner/lib/` for input validation, staging,
     bwrap argv policy, runtime manifest validation, output truncation, and
     structured result formatting.
   - Provide a local CLI/module entrypoint that provider agents can invoke
     inside their own container without AgentServer and without an MCP router.
   - Preserve the typed staged `files` contract for `/work` materialization.
   - Preserve the fixed bwrap argv policy and empty environment inheritance.
   - Preserve optional read-only `/runtime` binding, but make it a
     provider-selected local runtime path validated under a provider-owned
     root such as `/data/research-runtimes`.
   - Do not bind all `/shared` into inner jobs.
3. Retire the research-facing `sandbox_exec` agent dependency:
   - Remove or mark `bwrap-runner/manifest.json` and `mcp-config.json` as
     compatibility-only, not part of the research bundle.
   - Remove tests and docs that describe `basic/bwrap-runner.sandbox_exec` as
     the research execution path.
   - If a compatibility MCP tool remains, it must be optional and must not be
     referenced by `copilot-agents` manifests or runtime tools.
4. Keep image publishing:
   - `.github/workflows/publish-bwrap-runner.yml` remains manual dispatch.
   - `scripts/build-image.sh` continues to build or reuse
     `assistos/bwrap-runner:node24-python-bookworm`.

### 3. Migrate Open Interpreter To Provider-Local Sandbox

1. Update `openInterpreterAgent/manifest.json`:
   - Container must be `assistos/bwrap-runner:node24-python-bookworm` or a
     documented derived image.
   - Add `containerSecurity.privileged: true` because this provider starts
     inner bwrap jobs.
   - Keep `.ploinky/data/openInterpreterAgent` mounted at `/data`.
   - Use `OI_RUNTIME_ROOT=/data/research-runtimes`.
   - Remove `RESEARCH_BWRAP_AGENT` and any other setting that points at a
     runner agent.
2. Update runtime preparation:
   - Build into `/data/research-runtimes/open-interpreter/.tmp-*`.
   - Install with
     `python3 -m pip install --target <tmp>/python open-interpreter==0.4.3`.
   - Copy `runtime/research-open-interpreter.py` into `<tmp>/bin/`.
   - Write a manifest with schema/id/version, Python path, entrypoint, and
     compatibility metadata.
   - Atomically rename into
     `/data/research-runtimes/open-interpreter/0.4.3/`.
   - Reuse an existing matching manifest; fail with a natural-language repair
     message for invalid existing directories.
   - Never build Python dependencies on the macOS host.
3. Update task execution:
   - `open_interpreter_run_task` still requires a router invocation token
     from the relay call, but that token must not enter the inner sandbox.
   - Validate prompt, resources, timeout, and origin.
   - Stage `prompt.md`, non-secret `config/open-interpreter.json`, and
     `input/*` resources through the local runner's typed files input.
   - Invoke the local runner inside the provider container with
     `/runtime/bin/research-open-interpreter.py` as the backend shim.
   - Bind only the validated Open Interpreter runtime read-only at `/runtime`.
   - Normalize stdout/stderr into natural language.
   - If no model/provider/local endpoint is configured, return a clear
     natural-language configuration message, not a traceback.
4. Update provider status:
   - Report runtime readiness, local sandbox health, model topology, and
     telemetry posture.
   - Do not report or require remote bwrap-runner reachability.
   - Do not expose credentials, invocation JWTs, raw prompts, or resource
     payloads.

### 4. Keep Research Relay Thin

1. `researchRelay` keeps known-tag interception only.
2. Unknown `@word` mentions pass through as normal chat.
3. `researchRelay.research_task_submit` delegates `@open-interpreter` to
   `openInterpreterAgent.open_interpreter_run_task` through Ploinky
   secure-wire and forwards `x-ploinky-caller-jwt`.
4. The relay must not know runtime roots, runtime versions, shim paths,
   bwrap argv, provider command strings, or model credentials.
5. `research_relay_status` reports relay configuration and provider
   reachability only. It must not check a bwrap-runner agent.

### 5. Update Bundle Enablement

1. `research-agents/manifest.json` default, dev, qa, and prod profiles must
   enable:
   - `researchRelay global`
   - `openInterpreterAgent global no-wait`
2. Remove every `bwrap-runner global no-wait` enable entry.
3. Keep direct backend chat agents out of the bundle.
4. Keep the bundle out of AssistOSExplorer default dependencies.

### 6. Preserve Generic Ploinky And AchillesCLI Boundaries

1. Ploinky WebChat remains a generic transport.
2. AchillesCLI owns generic tag-relay interception through launch parameters:
   - `research-tags=1`
   - `forward-envelope=1`
   - `tag-relay-agent=researchRelay`
   - `tag-relay-submit-tool=research_task_submit`
   - `tag-relay-tags=<known-tags>`
3. No Ploinky framework file may hardcode research agent ids, backend tags,
   or provider tool names.
4. Explorer plugin code may name the research relay because the plugin belongs
   to the research relay agent, not to Ploinky framework core.

### 7. Update Documentation And Schemas

1. Keep DS files aligned with the invariant above.
2. Update `docs/specs/matrix.md` after DS frontmatter changes.
3. Update `openInterpreterAgent/mcp-config.json` descriptions so they no
   longer mention `/shared/research-runtimes`,
   `basic/bwrap-runner.sandbox_exec`, or shared runtime-bundle delegation.
4. Update `research-agents/manifest.json` and `researchRelay` descriptions so
   they say provider agents execute locally in containers based on the shared
   bwrap-runner image.
5. Update Basic README and HTML docs to describe the image/local runner
   contract rather than a required research runner agent.

### 8. Tests To Add Or Change

Basic:

- Local runner validation accepts valid staged files and provider-selected
  runtime metadata.
- Local runner rejects traversal, absolute runtime paths, bad id/version,
  missing manifest, manifest mismatch, digest mismatch, and symlink escape.
- Generated bwrap argv includes read-only `/runtime` bind only for the
  validated provider-owned runtime directory.
- Generated bwrap argv does not bind `/shared`.
- Dockerfile includes generic Python tooling and excludes `open-interpreter`.
- Compatibility MCP tests, if retained, are clearly separate from the research
  execution path.

Copilot agents:

- `research-agents` bundle does not enable `bwrap-runner`.
- `researchRelay` delegates `@open-interpreter` to
  `openInterpreterAgent.open_interpreter_run_task`.
- `researchRelay` status does not check remote bwrap-runner reachability.
- `openInterpreterAgent` prepares or recognizes the runtime manifest under
  `/data/research-runtimes`.
- `openInterpreterAgent` invokes the local sandbox runner and does not call
  `basic/bwrap-runner.sandbox_exec`.
- The sandbox command does not use embedded Python heredocs or `node -e`
  setup drivers.
- Missing model/provider configuration becomes natural-language output.
- Provider credentials and invocation JWTs are not staged into the sandbox.

Browser end-to-end:

- Create a fresh workspace under `~/work/testExplorerFresh`.
- Enable the `research-agents` bundle.
- Start Ploinky.
- Open `/webchat?agent=research-agents&research-tags=1` through headless
  browser automation.
- Send `@open-interpreter Give a one sentence configuration status.`
- Expected result: Open Interpreter runtime is prepared or found inside the
  provider container; if no model credentials are configured, the chat returns
  a natural-language model/provider configuration message. It must not return
  "python missing", "package missing", "bwrap-runner unavailable", or a
  traceback.

## Verification Commands

Run from `basic`:

```bash
node --check bwrap-runner/bin/sandbox-exec.mjs \
  bwrap-runner/lib/policy.mjs \
  bwrap-runner/lib/staging.mjs
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
  openInterpreterAgent/tools/prepare-runtime.mjs \
  openInterpreterAgent/tools/open-interpreter-run-task.mjs \
  openInterpreterAgent/tools/status.mjs
python3 -m py_compile openInterpreterAgent/runtime/research-open-interpreter.py
node --test tests/unit/*.test.mjs
node scripts/validate-manifests.mjs
git diff --check
```

Run Ploinky and browser checks after unit tests pass. Do not deploy to
`skills.axiologic.dev`, do not print Docker Hub tokens or local auth secrets,
and do not revert unrelated dirty changes in sibling repositories.
