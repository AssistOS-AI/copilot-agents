# copilot-agents smoke path

Manual end-to-end smoke check for the tagged research relay.

## 1. Static validation

From `<workspace-root>/copilot-agents`:

```bash
node scripts/validate-manifests.mjs
node --test tests/unit/*.test.mjs
python3 -m unittest discover -s tests/python -p "test_*.py"
```

## 2. Enable the bundle

```bash
cd <workspace-root>
ploinky add repo basic <basic-repo-url-or-local-path>
ploinky enable repo basic
ploinky add repo copilot-agents <repo-url-or-local-path>
ploinky enable repo copilot-agents
ploinky enable agent copilot-agents/research-agents global
ploinky start explorer 8080
```

The bundle enables `researchRelay` and `openInterpreterAgent`. Active backend
tags route through provider agents; the relay does not own backend command
environment variables and the bundle must not enable a separate
`basic/bwrap-runner` Ploinky agent. Provider agents execute their inner bwrap
job locally inside their own container based on the shared `assistos/bwrap-runner`
image.

## 3. Verify tool discovery

```bash
ploinky client methods research-agents
ploinky client methods researchRelay
ploinky client methods openInterpreterAgent
```

Expected tools:

- `research-agents`: `research_agents_status`
- `researchRelay`: `research_relay_status`, `research_relay_list_backends`,
  `research_relay_dispatch`, `research_task_submit`
- `openInterpreterAgent`: `oi_status`, `prepare_runtime`,
  `open_interpreter_run_task`

## 4. Verify Copilot tags

Open Explorer, then open Research Relay from the toolbar or context menu. The
URL should include:

```text
agent=achilles-cli&research-tags=1&forward-envelope=1&tag-relay-agent=researchRelay&tag-relay-submit-tool=research_task_submit&tag-relay-tags=open-interpreter,oi&tag-relay-list-tool=research_relay_list_backends
```

When opened from a file or directory context, the URL should use
`workspace-dir=<relative-path>` rather than an absolute host path.

Send:

```text
@open-interpreter Give a one sentence configuration status.
```

On a fresh workspace the provider should prepare or reuse the Open Interpreter
runtime under `/data/research-runtimes/open-interpreter/<version>/`, start a
local bwrap job inside its own container, and return natural-language output
to the same chat. If no local model endpoint is configured, the reply should
be a natural-language model/local-endpoint configuration message, not a
Python traceback.

## 5. Verify WebMeet tags

Open a WebMeet room through the WebMeet plugin and send:

```text
@open-interpreter summarize the current meeting goal
```

The user message should remain in chat. A second agent-kind message should be
appended with the research relay result or a natural-language error.

## 6. Confirm log hygiene

Tail the router and watchdog logs while exercising the tools:

```bash
tail -f .ploinky/logs/router.log
tail -f .ploinky/logs/watchdog.log
```

Invocation JWTs, bearer tokens, provider keys, raw prompts, materialized
resource contents, base64 payloads, command stdin, and hidden payload fields
must not appear in logs. Chat transcripts may contain the originating visible
chat prompt and final answer.

## Known limitations

- The current relay is synchronous and bounded by provider and local sandbox
  runner timeout caps.
- Large resources and long-running backend loops need a future async/artifact
  extension in the shared local sandbox runner.
- Future backend tags require provider agents before they become active relay
  tags.
