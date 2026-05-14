---
id: DS006
title: Open Interpreter Provider Agent
status: planned
owner: copilot-agents-team
summary: Defines the Open Interpreter provider agent. The agent owns Open Interpreter runtime setup and executes tasks inside its own local bwrap sandbox.
---

# DS006 - Open Interpreter Provider Agent

## Introduction

`openInterpreterAgent` is the Open Interpreter provider agent. It owns
preparation of the Open Interpreter runtime and execution of bounded research
tasks inside a local inner bubblewrap sandbox. It does not delegate execution
to a separate `basic/bwrap-runner` Ploinky agent. Chat-facing tasks reach it
only through the Research Relay's `@open-interpreter` tag.

## Core Content

The agent must run inside a Linux container based on
`assistos/bwrap-runner:node24-python-bookworm` or a documented derived image
that preserves the shared sandbox base. This gives Open Interpreter runtime
preparation and inner bwrap execution the same Linux Python ABI on macOS and
Linux hosts. The agent must not use `lite-sandbox: true`, because it is itself
a containerized sandbox host and must run the local bwrap runner. The provider
manifest must request Ploinky's allowlisted
`containerSecurity.privileged: true` setting so the inner bubblewrap process
can create namespaces under common Docker and Podman configurations.
The provider startup command must run the bwrap-runner image health check
before `AgentServer.sh`, and readiness should expose the same health check, so
Ploinky does not mark the provider ready when nested bubblewrap is unavailable.

The agent must own:

- `openInterpreterAgent/runtime/research-open-interpreter.py`: the Python
  shim that runs inside the bwrap sandbox. The shim must force telemetry off,
  keep `auto_run` disabled, and reject missing model/provider/local endpoint
  configuration before importing Open Interpreter, rather than producing a
  Python traceback.
- `openInterpreterAgent/tools/prepare-runtime.mjs`: the idempotent runtime
  preparation tool. It must target an agent-owned runtime root, defaulting to
  `/data/research-runtimes/open-interpreter/<version>/`, build into
  `/data/research-runtimes/open-interpreter/.tmp-*`, install the pinned
  Python package with
  `python3 -m pip install --target <tmp>/python open-interpreter==<version>`,
  copy the shim into `<tmp>/bin/`, write `manifest.json`, and atomically
  rename the temp dir into the versioned runtime dir when the target does not
  already exist. If a valid manifest already exists, the tool must reuse the
  runtime. If an invalid target directory already exists, preparation must
  fail with a natural-language repair message instead of deleting or replacing
  the directory in place.
- `openInterpreterAgent/tools/open-interpreter-run-task.mjs`: the provider
  tool the Research Relay invokes for `@open-interpreter` tasks. It must
  validate input, refuse to proceed without a router invocation token,
  ensure the runtime exists by reusing or preparing it when
  `OI_RUNTIME_AUTO_PREPARE` is enabled, resolve Open Interpreter LLM
  configuration, stage `prompt.md`, `config/open-interpreter.json`, and
  `input/*` files for configured local sandbox jobs, invoke the shared local
  sandbox runner inside the provider container with the runtime directory
  bound read-only at `/runtime`, and normalize stdout/stderr into a
  natural-language final answer. Configuration resolution must prefer
  explicit `OPEN_INTERPRETER_MODEL`, `OPEN_INTERPRETER_API_BASE`, and
  `OPEN_INTERPRETER_LOCAL` overrides for local development; otherwise it must
  autoconfigure from AchillesAgentLib's `research` model default and
  `soul_gateway` provider when `SOUL_GATEWAY_API_KEY` is present. If neither
  path is available, it must return immediate natural-language configuration
  guidance before invoking the sandbox runner.
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

The normal hosted-provider path must require only `SOUL_GATEWAY_API_KEY`.
Soul Gateway's URL and the research model alias must come from
AchillesAgentLib configuration; the current Achilles default maps
`research` to `soul_gateway/deep`. `SOUL_GATEWAY_BASE_URL` is not part of the
required Open Interpreter provider contract. Explicit `OPEN_INTERPRETER_*`
overrides remain allowed for local or development endpoints, but they must not
be required for the normal Ploinky path.

The agent must not pass caller-provided mounts, bind paths, raw bubblewrap
flags, network selectors, capabilities, provider credentials, or invocation
JWTs into the local sandbox runner. Only provider-selected runtime metadata,
staged files, validated `timeoutMs`, and the prompt command line are
forwarded. Non-secret model topology such as explicit
`OPEN_INTERPRETER_MODEL`, `OPEN_INTERPRETER_API_BASE`,
`OPEN_INTERPRETER_OFFLINE`, and `OPEN_INTERPRETER_LOCAL` values may be copied
into the staged `/work/config/open-interpreter.json` file. For Achilles Soul
Gateway autoconfiguration, the provider must start a short-lived
OpenAI-compatible local broker outside the inner bwrap sandbox. The staged
Open Interpreter config may contain the broker's loopback `/v1` API base,
the Open Interpreter-compatible model name, and a dummy broker token, but it
must not contain `SOUL_GATEWAY_API_KEY` or the upstream provider bearer token.
The broker must inject the raw Soul Gateway key only in the outer provider
process, support only the minimum chat-completions route needed by Open
Interpreter, enforce size and timeout limits, avoid logging prompt bodies or
secrets, and shut down after the task.

Broker-backed jobs require the inner bwrap runner to inherit the provider
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

The durable `/data` mount must be declared with Ploinky's manifest volume
object-map shape:

```json
{
  ".ploinky/data/openInterpreterAgent": "/data"
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
interpreted incorrectly and fail the `.ploinky/` confinement policy at
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
therefore returns operator guidance immediately after confirming the runtime
bundle is prepared. The shim keeps the same check before importing Open
Interpreter as defense in depth for direct invocations.

### Question #7: Why does task execution prepare the runtime on demand?

Response:
The chat path must work in a fresh workspace after the `research-agents`
bundle is enabled. Requiring a manual `prepare_runtime` call before the first
`@open-interpreter` task would make the advertised flow incomplete. The
explicit `prepare_runtime` tool remains useful for operators who want to warm
the runtime before chat use or diagnose preparation failures.

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
Other Ploinky agents resolve hosted LLM topology from AchillesAgentLib rather
than each agent owning hardcoded provider URLs and model aliases. Keeping the
Open Interpreter mapping inside an agent-local adapter lets
`openInterpreterAgent` follow that convention while preserving the framework
boundary: Ploinky core still has no knowledge of Open Interpreter,
researchRelay, or Soul Gateway-specific execution.

### Question #11: Why place a broker between Open Interpreter and Soul Gateway?

Response:
Open Interpreter speaks to an OpenAI-compatible `/v1` API base and may require
an API key value in its runtime configuration. Passing the raw
`SOUL_GATEWAY_API_KEY` into the inner bwrap sandbox would violate the provider
credential boundary. A short-lived broker lets the sandbox hold only a dummy
token and a loopback URL while the outer provider process injects the real
Soul Gateway bearer token when forwarding the chat-completions request.

## Conclusion

`openInterpreterAgent` must own Open Interpreter's runtime and bounded task
execution inside its own local bwrap sandbox. It must keep the relay free of
backend command strings and the shared bwrap-runner base image free of
backend-specific dependencies. Telemetry stays off by default and every
externally visible response must be natural language, not a traceback.
