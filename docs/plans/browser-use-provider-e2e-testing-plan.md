# Browser Use Provider E2E Testing Plan

Status: proposed.

## Purpose

Validate the browser-use provider adapter implementation end to end after the
provider registry refactor. The test pass should prove that ChatGPT, Gemini,
Perplexity, and future browser providers can be selected through the provider
catalog without changing browser-use core code, relay code, WebChat dispatch, or
Ploinky router code.

This plan is intentionally operational. It is not a replacement for
`docs/specs/DS014-browser-use-agent.md`; use the DS file as the authoritative
contract.

## Scope

Test the full path:

```text
WebChat / AchillesCLI semantic copilot routing
  -> launch-browser-use cskill
  -> copilotProviderRelay.copilot_provider_task_submit
  -> browserUseAgent.browser_use_run_task
  -> browserUseAgent provider registry and provider adapter
  -> protected /services/browser-use/... viewer
  -> user-ready continuation in the same browser session
```

Also test lower-level service paths directly when that makes failures easier to
diagnose:

```text
/status
/browser-use/run-task
/browser-use/task-status
/browser-use/continue-task
/browser-use/close-session
/browser-use/sessions/:id
/browser-use/sessions/:id/user-ready
```

## Non-Goals

- Do not redesign the provider registry or adapters during the e2e pass.
- Do not add provider-specific dispatch to Ploinky, WebChat, Explorer, or the
  relay backend catalog.
- Do not create or commit credentials, cookies, screenshots, DOM dumps, auth
  callback URLs, invocation tokens, or provider transcripts.
- Do not edit live shadow checkouts under `.ploinky/repos/` as the source of
  truth. If a live deployment needs a temporary hot patch for diagnosis, mirror
  the real fix back into `/Users/danielsava/work/file-parser`.
- Do not commit the e2e result unless explicitly asked.

## Safety And Hygiene

- Use existing authenticated browser profiles or manual login through the
  protected viewer. Never automate credential entry outside the viewer.
- If OAuth, 2FA, or CAPTCHA appears, complete it manually in the viewer.
- Use short non-sensitive prompts such as exact-token echo prompts.
- Store temporary JSON outputs and logs under `/tmp/browser-use-e2e-*`.
- Redact provider account identifiers, URLs with auth codes, cookies, tokens,
  localStorage/sessionStorage data, and full model transcripts from any notes.
- After each provider test, close the session unless the next test explicitly
  checks session reuse.

## Required Source Context

Read these before running live tests:

- `/Users/danielsava/work/file-parser/CLAUDE.md`
- `/Users/danielsava/work/file-parser/copilot-agents/CLAUDE.md`
- `/Users/danielsava/work/file-parser/copilot-agents/docs/specs/DS014-browser-use-agent.md`
- `/Users/danielsava/work/file-parser/copilot-agents/docs/browser-use-testing-handoff-2026-05-21.md`
- `/Users/danielsava/work/file-parser/copilot-agents/docs/plans/browser-use-provider-adapters-implementation-plan.md`

The handoff is useful history. The DS file is the contract.

## Test Matrix

| Area | Coverage | Expected result |
|---|---|---|
| Static validation | Unit tests, manifests, whitespace | All pass |
| Provider registry | Status exposes ChatGPT, Gemini, Perplexity | Safe metadata only; no adapter internals |
| Unsupported provider | Unknown provider through service | Safe unsupported-provider error |
| Direct provider run | ChatGPT, Gemini, Perplexity | Either completed answer or waiting viewer |
| Provider aliases | Prompt alias and explicit provider selection | Explicit wins; aliases map to catalog ids; default falls back to ChatGPT |
| Viewer auth | Owner, missing user, wrong user | Owner allowed; missing user 401; wrong user 403 |
| User-ready continuation | Login flow resumes saved prompt | Same session runs prompt automatically |
| Timeout propagation | Custom timeout reaches adapter and continuation | No fallback to fixed 120000 unless omitted |
| Session reuse | Two same-user/same-provider requests | One active session/profile; reused viewer URL |
| Profile cleanup | Terminal close and relaunch | Active sessions return to zero; no profile-lock wedge |
| Relay path | Relay backend forwards provider | `browser-use` remains one backend; provider is argument |
| Launcher path | `launch-browser-use` output | Full browser-visible viewer URL |
| WebChat path | Real forwarded-envelope prompt | Viewer opens and task resumes/answers |
| Log hygiene | Agent/router/container logs | No secrets, auth headers, cookies, DOM dumps, screenshots |

## Phase 1: Baseline Validation

Run from the source repositories:

```sh
cd /Users/danielsava/work/file-parser/copilot-agents
node --test tests/unit/*.test.mjs
node scripts/validate-manifests.mjs
git diff --check

cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/*.test.mjs
git diff --check

cd /Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI
node --test tests/*.test.mjs
git diff --check
```

If a broad test suite is slow or blocked, run the narrowest relevant tests and
record exactly what was skipped and why.

## Phase 2: Prepare A Live Workspace

Use either an existing known-good local deployment or a fresh disposable one.
Prefer a clean workspace such as:

```sh
/Users/danielsava/work/browserUseE2E
```

Use the source Ploinky CLI:

```sh
/Users/danielsava/work/file-parser/ploinky/bin/ploinky
```

Discover exact lifecycle commands with `--help` if needed. The deployment must
include these agents or bundles:

- `achilles-cli`
- `research-agents`
- `copilotProviderRelay`
- `browserUseAgent`
- `openInterpreterAgent`
- `webSearchAgent`

Verify the router:

```sh
curl -sS http://127.0.0.1:8080/health
```

Then find the browser-use service URL. In a container deployment it is often a
host-mapped local port. Use Ploinky status, container status, or logs to resolve
it, then export:

```sh
export ROUTER_URL=http://localhost:8080
export BUS=http://127.0.0.1:<browser-use-service-port>
export TEST_USER=local:admin
export RUN_ID=E2E_$(date +%Y%m%d_%H%M%S)
export ARTIFACT_DIR=/tmp/browser-use-e2e-$RUN_ID
mkdir -p "$ARTIFACT_DIR"
```

## Phase 3: Direct Service Smoke

Check status:

```sh
curl -sS "$BUS/status" | tee "$ARTIFACT_DIR/status.json"
```

Expected:

- `ok: true`
- `agent: "browserUseAgent"`
- `viewerTransport: "http-sse"`
- `providers` contains `chatgpt`, `gemini`, and `perplexity`
- provider entries contain safe catalog metadata only, such as `id`, `label`,
  `aliases`, `default`, and `order`
- provider entries do not expose `adapter`, filesystem paths, selectors,
  profile directories, cookies, auth state, or diagnostics

Check unsupported provider behavior:

```sh
curl -sS -X POST "$BUS/browser-use/run-task" \
  -H 'content-type: application/json' \
  --data "{\"prompt\":\"hello\",\"provider\":\"not-a-provider\",\"userId\":\"$TEST_USER\",\"timeoutMs\":120000}" \
  | tee "$ARTIFACT_DIR/unsupported-provider.json"
```

Expected: JSON error containing `unsupported provider` with no stack trace.

## Phase 4: Provider E2E Runs

For each provider in `chatgpt`, `gemini`, and `perplexity`, run:

```sh
PROVIDER=chatgpt
TOKEN="BROWSER_USE_${PROVIDER}_${RUN_ID}"
curl -sS -X POST "$BUS/browser-use/run-task" \
  -H 'content-type: application/json' \
  --data "{\"prompt\":\"Reply with exactly ${TOKEN} and nothing else.\",\"provider\":\"${PROVIDER}\",\"userId\":\"${TEST_USER}\",\"timeoutMs\":120000}" \
  | tee "$ARTIFACT_DIR/${PROVIDER}-run.json"
```

Accepted outcomes:

- `state: "completed"` with `final_answer` containing the exact token.
- `state: "waiting_for_user"` with a `viewerUrl` under
  `/services/browser-use/sessions/<sessionId>` and `requires_user_action: true`.

If waiting for user:

1. Open `${ROUTER_URL}${viewerUrl}` in a browser.
2. Complete login, OAuth, 2FA, or CAPTCHA manually.
3. Click the viewer's ready button.
4. Poll task status until terminal:

```sh
JOB_ID=<job-id-from-run-json>
curl -sS "$BUS/browser-use/task-status?jobId=${JOB_ID}&userId=${TEST_USER}" \
  | tee "$ARTIFACT_DIR/${PROVIDER}-status.json"
```

Expected terminal result:

- `state: "completed"` and the final answer contains the token, or
- a safe bounded failure that identifies a provider selector/runtime issue
  without exposing credentials, cookies, DOM dumps, screenshots, or auth URLs.

Close the session unless the next test needs it:

```sh
SESSION_ID=<session-id-from-run-json>
curl -sS -X POST "$BUS/browser-use/close-session" \
  -H 'content-type: application/json' \
  --data "{\"sessionId\":\"${SESSION_ID}\",\"userId\":\"${TEST_USER}\"}" \
  | tee "$ARTIFACT_DIR/${PROVIDER}-close.json"
```

Perplexity is currently a proof adapter. If its UI selectors fail, record the
observed safe failure and classify it separately from registry, relay, auth, or
session lifecycle failures.

## Phase 5: Session Reuse And Profile Locking

Start from no active session for the selected provider:

```sh
PROVIDER=gemini
TOKEN="BROWSER_USE_REUSE_${RUN_ID}"

curl -sS -X POST "$BUS/browser-use/run-task" \
  -H 'content-type: application/json' \
  --data "{\"prompt\":\"Reply with exactly ${TOKEN}.\",\"provider\":\"${PROVIDER}\",\"userId\":\"${TEST_USER}\",\"timeoutMs\":120000}" \
  > "$ARTIFACT_DIR/reuse-a.json" &

curl -sS -X POST "$BUS/browser-use/run-task" \
  -H 'content-type: application/json' \
  --data "{\"prompt\":\"Reply with exactly ${TOKEN}.\",\"provider\":\"${PROVIDER}\",\"userId\":\"${TEST_USER}\",\"timeoutMs\":120000}" \
  > "$ARTIFACT_DIR/reuse-b.json" &

wait
cat "$ARTIFACT_DIR/reuse-a.json"
cat "$ARTIFACT_DIR/reuse-b.json"
```

Expected:

- both responses are `ok: true`
- both responses return the same `sessionId`
- at least one response has `session_reused: true`
- no Chromium profile-lock error appears in the user-facing result
- `/status` reports one active session for that provider/user while it is open

Close the reused session and verify `activeSessions` returns to `0` when no
other browser-use sessions are open.

## Phase 6: Viewer Auth And User-Ready Continuation

Using an open waiting session, test direct viewer route ownership:

```sh
SESSION_ID=<session-id>

curl -i "$BUS/browser-use/sessions/${SESSION_ID}" \
  | tee "$ARTIFACT_DIR/viewer-no-auth.txt"

curl -i "$BUS/browser-use/sessions/${SESSION_ID}" \
  -H 'x-ploinky-auth-info: {"user":{"id":"other-user"}}' \
  | tee "$ARTIFACT_DIR/viewer-wrong-user.txt"

curl -i "$BUS/browser-use/sessions/${SESSION_ID}" \
  -H "x-ploinky-auth-info: {\"user\":{\"id\":\"${TEST_USER}\"}}" \
  | tee "$ARTIFACT_DIR/viewer-owner.txt"
```

Expected:

- missing auth returns 401
- wrong owner returns 403
- owner returns viewer HTML

After manual login, trigger user-ready through the viewer UI. If diagnosing
directly, this direct call is equivalent:

```sh
curl -sS -X POST "$BUS/browser-use/sessions/${SESSION_ID}/user-ready" \
  -H "x-ploinky-auth-info: {\"user\":{\"id\":\"${TEST_USER}\"}}" \
  | tee "$ARTIFACT_DIR/user-ready.json"
```

Expected:

- state transitions to `running`, then `completed` or `failed`
- the saved prompt runs automatically in the same session
- the original task timeout is honored after login

## Phase 7: Relay, Launcher, And WebChat

Use the real WebChat surface so the router invocation token and forwarded origin
are exercised:

```text
http://localhost:8080/webchat?agent=achilles-cli&forward-envelope=1&dir=<workspace-test-dir>
```

Send these prompts:

```text
use ChatGPT to reply with exactly BROWSER_USE_WEBCHAT_CHATGPT_<RUN_ID>
use Gemini to reply with exactly BROWSER_USE_WEBCHAT_GEMINI_<RUN_ID>
use Perplexity to reply with exactly BROWSER_USE_WEBCHAT_PERPLEXITY_<RUN_ID>
Please discuss the literal token @browser-use without opening a browser.
```

Expected:

- provider-specific prompts route through `launch-browser-use`
- relay backend remains `browser-use`; provider is an argument, not a backend id
- ChatGPT/Gemini/Perplexity provider selection follows explicit provider first,
  then status catalog aliases, then default provider
- when login is needed, launcher output contains a full browser-visible URL,
  not a container-internal URL
- `@browser-use` is ordinary chat text and does not dispatch by itself
- after ready, the browser session resumes automatically

## Phase 8: Cleanup

Close all test sessions:

```sh
curl -sS "$BUS/status"
curl -sS -X POST "$BUS/browser-use/close-session" \
  -H 'content-type: application/json' \
  --data "{\"provider\":\"chatgpt\",\"clearProfile\":false,\"userId\":\"${TEST_USER}\"}"
curl -sS -X POST "$BUS/browser-use/close-session" \
  -H 'content-type: application/json' \
  --data "{\"provider\":\"gemini\",\"clearProfile\":false,\"userId\":\"${TEST_USER}\"}"
curl -sS -X POST "$BUS/browser-use/close-session" \
  -H 'content-type: application/json' \
  --data "{\"provider\":\"perplexity\",\"clearProfile\":false,\"userId\":\"${TEST_USER}\"}"
curl -sS "$BUS/status"
```

If a profile is wedged and the user approves clearing login state, use
`clearProfile: true` for that provider and user. Do not clear profiles
silently.

## Phase 9: Log Hygiene

Inspect browser-use, relay, AchillesCLI, and router logs. The exact command
depends on the deployment, so use Ploinky status/log commands or container logs.

Check that logs do not contain:

- cookies
- localStorage/sessionStorage
- OAuth callback URLs
- authorization codes
- raw `x-ploinky-auth-info`
- invocation JWTs
- screenshots or base64 image payloads
- DOM dumps
- full provider transcripts
- account credentials

Only record sanitized excerpts in the final report.

## Acceptance Criteria

The e2e pass is successful when:

1. Static validations pass or skipped validations are explicitly justified.
2. Browser-use status exposes the expected provider catalog with safe metadata.
3. Direct service provider runs work for ChatGPT and Gemini, or produce bounded
   safe failures tied to provider UI/login state.
4. Perplexity at least proves registry, routing, viewer, auth, and session
   lifecycle behavior; selector failures are recorded as proof-adapter followup.
5. Same-user/same-provider concurrent runs reuse one session/profile.
6. Viewer ownership checks return 401/403/200 as expected.
7. WebChat produces full viewer URLs and user-ready continuation resumes the
   original prompt automatically.
8. Closing sessions releases browser resources and active session count returns
   to zero.
9. No logs or artifacts contain secrets, auth headers, cookies, DOM dumps, or
   screenshots.
10. Any failures are categorized as implementation bug, provider UI drift,
    environment/setup issue, authentication/manual-login blocker, or known
    proof-adapter limitation.

## Final Report Template

```md
# Browser Use Provider E2E Results - <date>

## Environment

- Source workspace:
- Test workspace:
- Router URL:
- Browser-use service URL:
- Branch/commit per repo:

## Static Validation

- copilot-agents:
- ploinky:
- AchillesCLI:

## Provider Catalog

- Providers:
- Safe metadata check:

## Direct Provider Runs

| Provider | Result | Session | Notes |
|---|---|---|---|
| chatgpt |  |  |  |
| gemini |  |  |  |
| perplexity |  |  |  |

## Session And Auth Checks

- Reuse:
- Viewer auth:
- User-ready continuation:
- Cleanup:

## WebChat Checks

- ChatGPT:
- Gemini:
- Perplexity:
- `@browser-use` literal:

## Log Hygiene

- Checked logs:
- Findings:

## Failures And Followups

- 
```
