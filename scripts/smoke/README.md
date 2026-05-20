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

The bundle enables `researchRelay`, `openInterpreterAgent`, and
`webSearchAgent`. Active backend tags route through provider agents; the relay
does not own backend command environment variables and the bundle must not
enable a separate `basic/bwrap-runner` Ploinky agent. Code-execution providers
execute their inner bwrap job locally inside their own container based on the
shared `assistos/bwrap-runner` image. `webSearchAgent` owns a local headless
browser service inside its container and does not call an external search
gateway.

## 3. Verify tool discovery

```bash
ploinky client methods research-agents
ploinky client methods researchRelay
ploinky client methods openInterpreterAgent
ploinky client methods webSearchAgent
```

Expected tools:

- `research-agents`: `research_agents_status`
- `researchRelay`: `research_relay_status`, `research_relay_list_backends`,
  `research_relay_dispatch`, `research_task_submit`
- `openInterpreterAgent`: `oi_status`, `prepare_runtime`,
  `open_interpreter_run_task`
- `webSearchAgent`: `web_search_status`, `web_search_run_task`

## 4. Verify semantic Copilot routing

Open Explorer, then use `Open Copilot here` from the toolbar or context menu.
The URL should include generic envelope forwarding only:

```text
agent=achilles-cli&forward-envelope=1
```

When opened from a file or directory context, the URL should use
`workspace-dir=<relative-path>` rather than an absolute host path.

Send:

```text
Run a one sentence Open Interpreter configuration status check.
```

On a fresh workspace the provider should prepare or reuse the Open Interpreter
runtime under `/data/research-runtimes/open-interpreter/<version>/`, start a
local bwrap job inside its own container, and return natural-language output
to the same chat. If no local model endpoint is configured, the reply should
be a natural-language model/local-endpoint configuration message, not a
Python traceback.

Send this separately to confirm provider-looking text remains ordinary chat:

```text
@open-interpreter Give a one sentence configuration status.
```

That message must not dispatch a provider task by itself.

## 5. Verify web search

Send:

```text
Search online for the latest Node.js release date.
```

AchillesCLI should route this to `launch-web-search`, which submits through
`researchRelay` to `webSearchAgent`. The reply should include a markdown
answer with citations, or a clear unavailable/configuration message if
the local browser runtime cannot start.

Send this separately to confirm provider-looking text remains ordinary chat:

```text
@web-search latest Node.js release
```

That message must not dispatch a provider task by itself.

## 6. Verify WebMeet chat

Open a WebMeet room through the WebMeet plugin and send:

```text
@open-interpreter summarize the current meeting goal
```

The user message should remain in chat and no research relay call should be
made. WebMeet provider routing belongs to AchillesCLI Copilot, not the meeting
chat surface.

## 7. Confirm log hygiene

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
