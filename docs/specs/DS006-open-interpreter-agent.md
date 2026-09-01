---
id: DS006
title: Open Interpreter Provider Agent
status: planned
owner: copilot-agents-team
summary: Defines Open Interpreter's terminal Box disposition, private-proc runner contract, compatible runtime bundle, and gated rootless transition.
---

# DS006 - Open Interpreter Provider Agent

## Introduction

`openInterpreterAgent` is the Open Interpreter provider agent. In a Ploinky
Box it currently returns a deterministic terminal unavailable result because
neither a scoped provider broker nor empty-proc support has been certified.
Separately configured local-development endpoints retain the provider-owned
runtime and inner Bubblewrap path. The agent never delegates execution to a
separate `basic/bwrap-runner` Ploinky agent. Chat-facing tasks reach it only
through the Copilot Provider Relay's `open-interpreter` backend id.

## Core Content

The rootless target uses an immutable digest of the shared Linux
`docker.io/assistos/bwrap-runner` image, runner ABI `2`, and the strict
`private` proc minimum. The current manifest intentionally remains on
`docker.io/assistos/bwrap-runner:node24-python-bookworm` with
`containerSecurity.privileged: true` until native amd64/arm64 image,
private-proc, Open Interpreter disposition, and GPTResearcher cold-task proof
exist. This exact declaration is a validator transition gate, not an accepted
release posture. Privilege must not be removed before that evidence, and the
mutable tag must not be replaced by an invented digest. Once the immutable
candidate is recorded, digest pinning and privilege removal occur together.

The agent must not use `lite-sandbox: true`, because it is itself a
containerized sandbox host. Startup and readiness invoke the canonical shared
runner healthcheck with `--minimum=private`; status interprets that same
capability record instead of maintaining a duplicate namespace probe. An
empty-only or absent capability returns terminal
`PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE` with status `422`.

The agent must own:

- `openInterpreterAgent/runtime/research-open-interpreter.py`: the Python
  shim that runs inside the bwrap sandbox. The shim must force telemetry off,
  keep `auto_run` disabled, and reject missing model/provider/local endpoint
  configuration before importing Open Interpreter, rather than producing a
  Python traceback.
- `openInterpreterAgent/tools/prepare-runtime.mjs`: the idempotent runtime
  preparation tool. It must target an agent-owned runtime root. For Open
  Interpreter `0.4.3` and runner ABI `2`, the compatible layout is
  `/data/research-runtimes/open-interpreter/0.4.3-runner-abi-2/`; it builds into
  `/data/research-runtimes/open-interpreter/.tmp-*`, install the pinned
  Python package with
  `python3 -m pip install --target <tmp>/python open-interpreter==<version>`,
  copy the shim into `<tmp>/bin/`, write `manifest.json`, and atomically
  rename the temp dir into the compatible runtime dir when the target does not
  already exist. The manifest must record runner image identity, runner ABI
  `2`, proc minimum `private`, and Python major/minor ABI. A manifest lacking
  any of those exact inputs is incompatible. A populated legacy
  `/data/research-runtimes/open-interpreter/0.4.3/` directory is left intact
  but is not reused. If a valid compatible manifest already exists, the tool
  reuses the runtime. If an invalid target directory already exists, preparation must
  fail with a natural-language repair message instead of deleting or replacing
  the directory in place.
- `openInterpreterAgent/tools/open-interpreter-run-task.mjs`: the provider
  tool the Copilot Provider Relay invokes for `open-interpreter` tasks. Before
  reading the invocation envelope, resolving the runtime root, inspecting a
  manifest, preparing or installing the runtime, resolving a provider key,
  opening a broker or network socket, or starting the sandbox runner, it must
  detect generated-local Ploinky descriptor signals. Open Interpreter is
  unavailable in Box in this release and must return
  `PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE`, status `422`,
  `terminal: true`, and cause
  `OPEN_INTERPRETER_PROVIDER_CONTRACT_UNCERTIFIED`, with no such side effect.
  Explicit `OPEN_INTERPRETER_*` values cannot override a Box descriptor signal.
  After that preflight passes, the tool validates input, refuses to proceed
  without a router invocation token, and checks the canonical runner
  capability with the `private` minimum before runtime preparation. It then
  ensures the runtime exists by reusing or preparing it when
  `OI_RUNTIME_AUTO_PREPARE` is enabled, resolve Open Interpreter LLM
  configuration, stage `prompt.md`, `config/open-interpreter.json`, and
  `input/*` files for configured local sandbox jobs, invoke the shared local
  sandbox runner inside the provider container with the runtime directory
  bound read-only at `/runtime`, and normalize stdout/stderr into a
  natural-language final answer. The runner invocation also carries
  `--minimum=private`, and its result must prove runner ABI `2`, proc mode
  `private`, and proc minimum `private`. Capability failure returns the same
  stable terminal Open Interpreter code as status. Configuration resolution must prefer
  explicit `OPEN_INTERPRETER_MODEL`, `OPEN_INTERPRETER_API_BASE`, and
  `OPEN_INTERPRETER_LOCAL` overrides for local development. It must not
  autoconfigure from `PLOINKY_AGENT_API_KEY` in this release, because that
  credential is part of generated-local selection. If no explicit path is
  available, it must return immediate natural-language configuration
  guidance before invoking the sandbox runner. The staged Open Interpreter
  config must include explicit `context_window` and `max_tokens` values when
  they are known or defaulted, because the Soul Gateway aliases are not
  necessarily present in Open Interpreter's bundled LiteLLM model metadata.
  The adapter retains at most 64 KiB of outer runner stdout and 16 KiB of outer
  runner stderr independently of the inner runner's own bounds. Responses
  expose truncation flags and discarded-byte counts; outer runner noise must
  not escape into the MCP response.
- `openInterpreterAgent/tools/status.mjs`: a status tool that reports whether
  the runtime is prepared, the configured model topology, the local sandbox
  health, and the telemetry posture. Status must not expose provider
  credentials or invocation tokens.

The agent must not bake Open Interpreter into the shared bwrap-runner base
image. Runtime preparation may install the package into agent-owned persistent
storage or a provider-specific derived image, but the shared base image must
remain generic. The inner sandbox should see Open Interpreter through the
provider-selected `/runtime` bind or through the provider image's documented
runtime layer, never through a central runner agent.

The hosted-provider path based on `PLOINKY_AGENT_API_KEY` is safety-disabled in
this release. The key must not be read and AchillesAgentLib model topology must
not be loaded after generated-local detection. The canonical Box result is
terminal and must not be retried until the provider/runner contract changes.
Explicit `OPEN_INTERPRETER_*` overrides remain allowed only for separately
configured non-Box local or development endpoints. `OPEN_INTERPRETER_CONTEXT_WINDOW` and
`OPEN_INTERPRETER_MAX_TOKENS` remain optional tuning overrides for those
explicit endpoints.

The agent must not pass caller-provided mounts, bind paths, raw bubblewrap
flags, network selectors, capabilities, provider credentials, or invocation
JWTs into the local sandbox runner. Only provider-selected runtime metadata,
staged files, validated `timeoutMs`, and the prompt command line are
forwarded. Non-secret model topology such as explicit
`OPEN_INTERPRETER_MODEL`, `OPEN_INTERPRETER_API_BASE`,
`OPEN_INTERPRETER_OFFLINE`, and `OPEN_INTERPRETER_LOCAL` values may be copied
into the staged `/work/config/open-interpreter.json` file. The dormant Achilles
Soul Gateway adapter and short-lived OpenAI-compatible local broker remain
future certification work and must not be entered from generated-local
selection in this release. If restored after certification, the staged
Open Interpreter config may contain the broker's loopback `/v1` API base,
the Open Interpreter-compatible model name, and a dummy broker token, but it
must not contain `PLOINKY_AGENT_API_KEY` or the upstream provider bearer token.
The broker must inject the raw Soul Gateway key only in the outer provider
process, support only the minimum chat-completions route needed by Open
Interpreter, enforce size and timeout limits, avoid logging prompt bodies or
secrets, and shut down after the task. If Open Interpreter requests streaming,
the broker may request a non-streaming upstream completion and synthesize the
minimal OpenAI-compatible server-sent event stream back to the sandbox, so
provider-specific streaming behavior does not leak into the runtime shim.
The broker must also forward the provider container's `AGENT_NAME` or
`PLOINKY_AGENT_NAME` as `X-Soul-Agent` so Soul Gateway observability records
the provider agent instead of `unknown`.

Any future broker-backed jobs require the inner bwrap runner to inherit the provider
container network so the sandbox can reach the loopback broker. This network
change must be scoped to `openInterpreterAgent` broker-backed jobs. It
protects the raw provider key from the sandbox, but it does not claim to block
all sandbox outbound network access for that job.

Telemetry must be disabled by default. The agent must set or enforce the
upstream-supported telemetry controls such as `DISABLE_TELEMETRY=true` and
`ANONYMIZED_TELEMETRY=false`. The shim must also force these inside the
inner sandbox.

The agent must expose at least:

- `oi_status` (renamed conceptually, still `oi_status` as MCP tool name)
- `prepare_runtime`
- `open_interpreter_run_task`

Long or stateful research work is out of scope for this provider tool; if
introduced later, it must move to async MCP tasks and status polling.

The Copilot Provider Relay must preserve the Open Interpreter `code`, `status`,
structured `cause`, and `terminal` fields exactly. It also preserves runner
ABI/proc evidence and bounded outer-output counters in diagnostics. A terminal
unavailable provider is not a successful backend result and cannot be reduced
to an unstructured natural-language fallback.

The durable `/data` mount must be declared with Ploinky's manifest volume
object-map shape:

```json
{
  ".data/openInterpreterAgent": "/data"
}
```

Array or Docker-style `host:container` volume strings are not valid for this
repository.

## Decisions & Questions

### Question #1: Why run Open Interpreter inside the provider's inner sandbox?

Response:
Running Open Interpreter directly in the MCP server process would mix tool
wiring, provider configuration, and untrusted code execution. The provider
agent should own Open Interpreter runtime setup, then run the backend command
inside a local inner bwrap sandbox using the shared bwrap-runner policy.

### Question #2: Why disable telemetry by default?

Response:
The agent processes local code, prompts, and workspace context. Default-off
telemetry keeps data movement explicit and aligns with the repository's
redaction and observability posture.

### Question #3: Why require the Ploinky object-map volume shape?

Response:
Ploinky resolves `manifest.volumes` with `Object.entries()` and applies
host-path policy checks to each map key. Docker-style strings are
interpreted incorrectly and fail the `.data/` confinement policy at
startup.

### Question #4: Why prepare the runtime in a Linux container instead of on the host?

Response:
The runtime is loaded by the provider's inner sandbox, which runs Linux with
the bwrap-runner image's Python ABI. macOS host wheels and binaries are not
portable into that sandbox. Preparing the runtime inside the provider's Linux
Ploinky container avoids ABI drift.

### Question #5: Why use the bwrap-runner image for the provider agent's container?

Response:
The provider agent needs Python 3.11, pip, Node 24, and the same dependency
toolchain that the bwrap-runner image already publishes. Reusing the image
avoids publishing and maintaining a second sandbox base just to keep ABI
compatibility.

### Question #6: Why return missing-model guidance before entering Open Interpreter?

Response:
The chat invariant requires a natural-language answer in the originating
chat. A Python traceback from an unconfigured model is not actionable for the
user and pollutes the chat with implementation details. The provider tool
returns generated-local operator guidance before runtime preparation. For
other missing-model cases it returns guidance after confirming the runtime
bundle is prepared. The shim keeps the same check before importing Open
Interpreter as defense in depth for direct invocations.

### Question #7: Why does task execution prepare the runtime on demand?

Response:
After the generated-local preflight passes, the chat path may prepare its
runtime on demand. The explicit `prepare_runtime` tool remains useful for
operators who want to warm a separately configured runtime before chat use or
diagnose preparation failures.

### Question #8: Why stage model topology instead of passing environment variables?

Response:
The local sandbox runner clears the environment and accepts only a generic,
allowlisted environment plus provider-selected runtime values. That is the
right sandbox boundary. The provider therefore stages a small non-secret
config file for the shim and still refuses to forward provider credentials or
invocation JWTs into the inner sandbox.

### Question #9: Why not call a separate `basic/bwrap-runner` agent?

Response:
Open Interpreter already needs a provider agent for model topology, runtime
installation, shim behavior, resource validation, and natural-language result
normalization. Calling a second runner agent would add a remote MCP hop and a
shared runtime handoff without reducing provider complexity. Running the same
local sandbox runner inside the provider container keeps the bwrap policy DRY
and keeps execution machine independent through the shared Linux image.

### Question #10: Why use Achilles Soul Gateway autoconfiguration?

Response:
The adapter is dormant for generated-local execution in this release.
Other Ploinky agents resolve hosted LLM topology from AchillesAgentLib rather
than each agent owning hardcoded provider URLs and model aliases. Keeping the
Open Interpreter mapping inside an agent-local adapter lets
`openInterpreterAgent` follow that convention while preserving the framework
boundary: Ploinky core still has no knowledge of Open Interpreter,
copilotProviderRelay, or Soul Gateway-specific execution.

### Question #11: Why place a broker between Open Interpreter and Soul Gateway?

Response:
The broker is retained only as a future certification target.
Open Interpreter speaks to an OpenAI-compatible `/v1` API base and may require
an API key value in its runtime configuration. Passing the raw
`PLOINKY_AGENT_API_KEY` into the inner bwrap sandbox would violate the provider
credential boundary. A short-lived broker lets the sandbox hold only a dummy
token and a loopback URL while the outer provider process injects the real
Soul Gateway bearer token when forwarding the chat-completions request.

### Question #12: Why use `PLOINKY_AGENT_API_KEY` for hosted provider credentials?

Response:
On 2026-06-24, router-issued signed-subject credentials were standardized on
the agent-owned `PLOINKY_AGENT_API_KEY` name. The `soul_gateway` provider
identifier and Soul Gateway URL configuration remain provider topology, while
the credential name is owned by the Ploinky agent identity contract. Open
Interpreter detects that generated-local credential surface and fails before
reading the value in this release.

### Decision #13: Why is generated-local Open Interpreter disabled before preparation?

Response:
On 2026-07-31, generated-local Open Interpreter was classified as an
uncertified direct generated-key consumer. Its local broker does not yet use
the signed descriptor's authority transport or have the required flow-control
proof. The preflight therefore runs before every filesystem, installer,
credential, broker, network, and runner operation. Explicit
`OPEN_INTERPRETER_*` endpoints remain a separate operator-selected path.

### Decision #14: What is the accepted Box, proc, image, and bundle contract for the rootless transition?

Response:
On 2026-08-03, the accepted implementation decision was deterministic Box
unavailability with `PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE` unless a scoped
Ploinky-owned broker is implemented and proven in the same candidate. Open
Interpreter requires private proc until an installed real task proves empty
proc. Runner ABI `2` and that proc minimum are part of runtime-bundle
compatibility, so incompatible populated bundles migrate additively. The
current privileged mutable-image manifest remains gated until native immutable
image and consumer smoke evidence exists; no local-only test can satisfy that
publication boundary.

## Conclusion

`openInterpreterAgent` must return deterministic terminal unavailability in a
Ploinky Box until its provider and private-proc contract is certified. Its
separate development path owns a runner-ABI-compatible runtime and bounded
task adapter inside a local bwrap sandbox. The relay remains free of backend
command strings, telemetry stays off, and externally visible failures preserve
stable structured evidence alongside natural-language guidance.
