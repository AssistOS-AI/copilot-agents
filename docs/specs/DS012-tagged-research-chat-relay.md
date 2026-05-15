---
id: DS012
title: Tagged Research Chat Relay
status: planned
owner: copilot-agents-team
summary: Defines the Copilot/WebMeet @tag relay contract, provider routing, local sandbox execution, and natural-language reply invariant.
---

# DS012 - Tagged Research Chat Relay

## Introduction

Research agents are invoked by tagging them from Copilot chat or WebMeet
chat. The tag is the user-facing contract. Direct backend chat sessions are
not the contract.

## Core Content

The active supported tag is `@open-interpreter`. Each active backend must
advertise exactly one tag so autocomplete can present one user-facing agent
entry. Chat surfaces must maintain a known-backend tag set and must not
intercept arbitrary `@word` mentions. Future tags such as `@deepanalyze`,
`@openhands`, `@mljar`, and `@agentic-data-scientist` must not be intercepted
until their provider agents exist.

The invariant is:

1. The user writes a natural-language prompt and tags a backend.
2. The chat surface relays the tag, prompt, origin metadata, and any supported
   resources to `researchRelay.research_task_submit` (the Research Relay).
3. The Research Relay validates the backend, confines paths to
   `PLOINKY_WORKSPACE_ROOT` when it reads paths, resolves real paths to
   reject symlink escapes, materializes small inline resources, and routes
   the task.
4. The backend must have a `provider` (currently `@open-interpreter` →
   `openInterpreterAgent.open_interpreter_run_task`). The relay forwards the
   typed task to that provider agent through Ploinky secure-wire with the
   router invocation token. The provider agent owns runtime preparation,
   sandbox staging, and local bwrap execution inside its own container.
5. The relay returns a natural-language answer to the originating chat.

Ploinky WebChat must not intercept research tags or hardcode the
`researchRelay` agent. For Copilot chat, Explorer exposes the normal
`Open Copilot here` action only. The `researchRelay` plugin contributes
metadata through `file-exp:copilot-launch-extension`, and the AchillesCLI
Copilot launcher uses that metadata to open WebChat with `research-tags=1`,
`forward-envelope=1`, and explicit generic tag-relay parameters naming the
relay agent, tool, and allowed tag set. AchillesCLI's tag-relay mode must only
intercept tags named by the explicit `tag-relay-tags` allowlist or, when that
allowlist is absent, tags returned by
`researchRelay.research_relay_list_backends`. When a tagged message is
handled, it must not be forwarded to AchillesCLI's normal LLM prompt. Unknown
mentions must remain normal chat. AchillesCLI may materialize shared blob
attachments as bounded inline resources for the relay, but shared attachment
paths must resolve inside the mounted shared blob directory after symlink
resolution.

WebMeet MCP chat must dispatch configured tags after persisting the user
message, then append the research result as an agent-kind chat message. This
result is a chat reply and task artifact, not a simulated LiveKit AI
participant. The `research:` author prefix is reserved for relay-generated
messages; normal authenticated MCP chat must derive author identity from
invocation auth when available.

The Research Relay must not own backend command strings, runtime ids, package
versions, shim paths, model/provider setup, or direct backend-specific sandbox
calls. Backends without provider agents are not active research tags.

Provider-backed tasks must travel through MCP, not through direct process
calls. The provider agent receives `prompt`, `resources`, `timeoutMs`, and
`origin` and is responsible for runtime selection, sandbox staging, local
sandbox execution, and natural-language normalization. For the active
`@open-interpreter` backend, normal hosted LLM configuration is provider-owned:
`openInterpreterAgent` autoconfigures from AchillesAgentLib's `research`
default and `soul_gateway` provider when `SOUL_GATEWAY_API_KEY` is present.
The relay must not require or forward `SOUL_GATEWAY_BASE_URL`, raw provider
credentials, or backend-specific model settings. Explicit
`OPEN_INTERPRETER_*` overrides remain an `openInterpreterAgent` local
development concern.

The relay must not pass caller-provided mounts, bind paths, raw bwrap flags,
network selectors, capabilities, provider credentials, or invocation JWTs
into the inner sandbox. It must also avoid generated setup programs such as
`node -e` driver strings or embedded Python heredocs for backend setup; file
staging belongs to the provider's local sandbox runner input, runtime
preparation belongs to provider agents, and backend-specific runtime shims
belong inside provider-owned runtime storage or provider-specific image layers.
Resource size caps must stay below the current provider and local sandbox
runner caps unless the Basic shared runner adds an async artifact interface.

Current relay caps are 16,000 prompt characters, 128 KiB per resource, 384
KiB total raw resource bytes, and 900 KiB encoded provider payload. The
provider must also enforce its own payload cap before local sandbox execution
so users receive a clear provider validation error instead of a lower-level
runner payload failure.

## Decisions & Questions

### Question #1: Why is the provider's local bwrap sandbox the execution boundary?

Response:
It gives all research backends one narrow sandbox contract and prevents chat
surfaces from becoming execution runtimes. Provider agents run the shared local
sandbox runner inside their own containers based on the bwrap-runner image; the
relay never executes backend code itself and never builds backend-specific
sandbox payloads.

### Question #2: Why return configuration errors in natural language?

Response:
The chat invariant requires a natural-language answer in the originating
chat. If a provider or runtime configuration is unavailable, the user should see a clear
operational message instead of a silent failure or a raw stack trace.

### Question #3: Why not pass host paths directly to the sandbox?

Response:
The provider's local sandbox runner deliberately rejects caller-supplied mounts
and bind paths. The safe contract is content materialization into
`/work/input/`, not exposing host filesystem structure to a backend runtime.
Runtime libraries reach the sandbox only through provider-selected runtime
paths that are validated under an agent-owned runtime root.

### Question #4: Why ignore unknown `@word` mentions?

Response:
Copilot and meeting chat are ordinary collaboration surfaces. Intercepting
every mention-shaped token would swallow legitimate messages to teammates and
produce spurious relay errors. AchillesCLI therefore uses the explicit tag
allowlist from the relay launch, or loads the configured backend tag set from
the relay before intercepting a WebChat message. Only configured backend tags
are research invocations.

### Question #5: Why keep absolute workspace paths out of browser URLs?

Response:
AchillesCLI still receives an absolute working directory when spawned, but
that path does not need to be visible in copied browser URLs. Workspace-
relative query parameters preserve launch behavior while reducing accidental
disclosure of host directory layouts.

### Question #6: Why route `@open-interpreter` through a provider agent instead of letting the relay run a sandbox directly?

Response:
The Open Interpreter runtime is a heavy Python dependency closure with its
own version pin and shim. Owning runtime preparation, model/provider
configuration, Achilles Soul Gateway autoconfiguration, broker-mediated
secret handling, and local sandbox execution inside `openInterpreterAgent`
keeps the relay generic. The relay does not need to know runtime ids, paths,
shim locations, provider URLs, or model aliases, and the shared bwrap-runner
image stays free of backend-specific dependencies.

### Question #7: Why stage files through the local sandbox runner instead of passing setup code?

Response:
The relay and provider agents should not own sandbox filesystem mutation
through generated code strings. Provider agents pass typed staged files to the
local sandbox runner, which enforces path and byte limits once, keeps backend
commands readable, and prevents setup mechanics from being mixed with backend
execution logic.

### Question #8: Why are future tags not intercepted yet?

Response:
The architecture requires each research backend to own its runtime setup in a
provider agent. Intercepting a tag before its provider exists would either
force backend-specific command logic back into the relay or create a
misleading chat path that cannot run. Unknown or reserved future tags must
fall through as normal chat until a provider agent activates them.

## Conclusion

The tagged research relay turns Copilot and WebMeet chat mentions into
bounded provider-owned local sandbox jobs (`openInterpreterAgent` for
`@open-interpreter`) and returns normalized natural-language output to the
chat where the task originated. The Research Relay itself owns no backend
runtime.
