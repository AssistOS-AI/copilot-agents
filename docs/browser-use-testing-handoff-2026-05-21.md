# Browser Use Testing Handoff - 2026-05-21

## Purpose

Resume live testing of the `browserUseAgent` / `launch-browser-use` flow in the
fresh Ploinky workspace. The current source and fresh deployment have been
patched for the duplicate-session/profile-lock failures found during manual
Gemini browser-use testing. The next step is a browser-side WebChat retry.

Use this document as a state handoff, not as an implementation spec. The source
specs remain authoritative.

## Repositories and Workspaces

Source workspace:

```sh
/Users/danielsava/work/file-parser
```

Fresh live deployment workspace:

```sh
/Users/danielsava/work/testExplorerFresh
```

Ploinky CLI used for this deployment:

```sh
/Users/danielsava/work/file-parser/ploinky/bin/ploinky
```

Fresh WebChat URL used manually:

```text
http://localhost:8080/webchat?agent=achilles-cli&forward-envelope=1&dir=%2FUsers%2Fdanielsava%2Fwork%2FtestExplorerFresh%2Ftest
```

Important source-of-truth note:

- Edit source repos under `/Users/danielsava/work/file-parser/...`.
- `.ploinky/repos/...` under `/Users/danielsava/work/testExplorerFresh` are live
  shadow checkouts used by the running deployment. They were hot-patched for
  live testing and may be overwritten by reinstall/update.

## Current Live Deployment State

Checked on 2026-05-21 around 17:32 Europe/Bucharest.

Router:

- Listening on `127.0.0.1:8080`.
- `GET /health` returned HTTP 200 with `"status": "healthy"`.
- Health reported `activeSessions.webchat: 2`.

Relevant containers are running:

- `ploinky_AchillesCLI_achilles-cli_testExplorerFresh_d8f88a10`
- `ploinky_copilot-agents_research-agents_testExplorerFresh_d8f88a10`
- `ploinky_copilot-agents_copilotProviderRelay_testExplorerFresh_d8f88a10`
- `ploinky_copilot-agents_openInterpreterAgent_testExplorerFresh_d8f88a10`
- `ploinky_copilot-agents_webSearchAgent_testExplorerFresh_d8f88a10`
- `ploinky_copilot-agents_browserUseAgent_testExplorerFresh_d8f88a10`

Direct browser-use service status:

```sh
curl -sS http://127.0.0.1:38575/status
```

Returned:

```json
{
  "ok": true,
  "agent": "browserUseAgent",
  "activeSessions": 0,
  "totalSessions": 1,
  "chromiumAvailable": true,
  "viewerTransport": "http-sse"
}
```

That means no browser-use session is currently active. The `totalSessions: 1`
entry is from a direct smoke-test session that was closed after verification.

## Current Manual Test Observation

Prompt sent in WebChat:

```text
use gemini to find what the latest stable version of node is?
```

Visible WebChat state:

```text
Thinking...
User explicitly requests Gemini for browsing function; choose launch-browser-use.
Need current release info; browser provider did not return a natural-language response.
```

This was the last browser-side failure before the latest patch. It is no
longer considered the current expected behavior.

Recent logs confirm:

- `copilotProviderRelay.copilot_provider_task_submit` was called with:
  - `backend: "browser-use"`
  - `provider: "gemini"`
  - `timeoutMs: 120000`
  - origin surface `webchat`
- `browserUseAgent.browser_use_run_task` was called with:
  - `provider: "gemini"`
  - `timeoutMs: 120000`
  - same WebChat origin
- Browser-use status after that prompt showed one active session.

Root causes found after this observation:

- A previous Gemini browser-use session remained active for the same
  `local:admin` user/provider profile. A new Gemini request attempted to launch
  a second Chromium persistent context against the same profile, producing a
  Chromium profile-lock failure and no natural-language answer.
- After container restart, the persisted Gemini profile still contained stale
  Chromium `Singleton*` symlinks from an old container. With no active session,
  Chromium still refused to open the profile until those stale locks were
  cleared.

Fixes applied to source and live shadow:

- `browserUseAgent/server/browser-session-manager.mjs`
  - added same-user/same-provider active-session reuse
  - serializes same-user/same-provider profile operations to prevent concurrent
    launches against one Chromium profile
  - closes browser resources when sessions enter terminal states
  - waits for pending browser close before relaunching a profile
  - clears stale Chromium `Singleton*` symlinks when no live local process owns
    the lock
  - sanitizes launch/navigation errors exposed through public session state
- `browserUseAgent/server/browser-use-server.mjs`
  - reuses active sessions before creating a new persistent context
  - returns safe user-facing startup failure text instead of raw Chromium logs
- `copilotProviderRelay/tools/lib/task.mjs` and `tools/submit-task.mjs`
  - preserve `session_reused`
- `achilles-skills/launch-browser-use/src/index.mjs`
  - renders a reused-session message with the existing full viewer URL instead
    of the generic provider fallback
- `docs/specs/DS014-browser-use-agent.md`
  - documents the one-active-context/profile-lock contract

Direct service smoke after patch and reinstall:

```sh
curl -sS -X POST http://127.0.0.1:38575/browser-use/run-task \
  -H 'content-type: application/json' \
  --data '{"prompt":"What is the latest stable version of Node.js?","provider":"gemini","userId":"local:admin","timeoutMs":120000}'
```

First call returned `ok: true`, `state: "waiting_for_user"`,
`session_reused: false`, and a `/services/browser-use/sessions/<session-id>`
viewer URL.

The immediate second call returned `ok: true`, the same `sessionId` and
`viewerUrl`, and `session_reused: true`. The test session was then closed with
`/browser-use/close-session`.

Parallel service smoke after adding the per-profile lock:

- Two simultaneous `POST /browser-use/run-task` calls for
  `local:admin`/`gemini` both returned `ok: true`.
- Both returned the same `sessionId` and same `viewerUrl`.
- The returned reuse flags were `[true, false]`, proving one request created
  the session while the other reused it.
- The test session was closed afterwards; `activeSessions` returned to `0`.

Validation after patch:

```sh
cd /Users/danielsava/work/file-parser/copilot-agents
node --test tests/unit/*.test.mjs
node scripts/validate-manifests.mjs
git diff --check
```

Result: 112/112 unit tests passed, manifests validated, no whitespace errors.

Latest validation result after the per-profile lock:

```sh
cd /Users/danielsava/work/file-parser/copilot-agents
node --test tests/unit/*.test.mjs
node scripts/validate-manifests.mjs
git diff --check
```

Result: 113/113 unit tests passed, manifests validated, no whitespace errors.

## What Was Tried Already

### Fresh deployment

The old deployment under `/Users/danielsava/work/file-parser/.ploinky` was
stopped and removed. A fresh deployment was created in:

```sh
/Users/danielsava/work/testExplorerFresh
```

The following agents were explicitly enabled and are currently running:

- `research-agents`
- `copilotProviderRelay`
- `openInterpreterAgent`
- `webSearchAgent`
- `browserUseAgent`
- `achilles-cli`

### Earlier smoke-test results from Claude Code

Claude Code reported:

- Static checks passed.
- `node scripts/validate-manifests.mjs` passed.
- `node --test tests/unit/*.test.mjs` passed at that time.
- Workspace start passed.
- Browser-use MCP discovery passed.
- Relay catalog included `browser-use` with `interactive: true`.
- MCP auth failure paths passed.
- Log hygiene passed.
- Initial viewer was blocked until Ploinky protected HTTP service identity
  propagation was fixed.

### Ploinky HTTP service auth fix

Ploinky source contains uncommitted changes for protected HTTP services:

- `ploinky/cli/server/authHandlers.js`
- `ploinky/cli/server/routerHandlers.js`
- `ploinky/tests/unit/httpServiceInvocation.test.mjs`
- `ploinky/docs/specs/DS005-routing-and-web-surfaces.md`
- `ploinky/docs/specs/DS011-security-model.md`

Earlier validation after those changes:

```sh
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/*.test.mjs
git diff --check
```

Result at that point: 326/326 tests passed, no whitespace errors.

### Provider schema fix

`copilotProviderRelay` needed the `provider` argument in the submit-task schema.
Source contains uncommitted changes:

- `copilot-agents/copilotProviderRelay/mcp-config.json`
- `copilot-agents/tests/unit/provider-task.test.mjs`

The fresh live shadow also had this schema hot-patched because the clean clone
did not include the uncommitted local change.

### Browser-use routing fix

Initial manual prompt:

```text
Use Gemini in the browser to search for the latest OpenAI model news. If login is required, open the browser session, wait for me to sign in, then continue and summarize the result.
```

Initially routed to `webSearchAgent` and returned:

```text
Web search is not available: Web search is temporarily blocked by a CAPTCHA challenge.
```

Root cause:

- The AchillesCLI copilot router prioritized current/news lookup before
  logged-in browser service requests.

Fix applied to source and live shadow:

- `AssistOSExplorer/AchillesCLI/achilles-cli/src/skills/copilot-router/oskill.md`
- `AssistOSExplorer/AchillesCLI/tests/copilotRouter.test.mjs`
- `AssistOSExplorer/AchillesCLI/tests/copilotRouter.integration.test.mjs`

Validation:

```sh
cd /Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI
node --test tests/copilotRouter.test.mjs tests/copilotRouter.integration.test.mjs
git diff --check
```

Result: 7/7 tests passed, no whitespace errors.

After this fix, WebChat did call browser-use and returned a relative viewer URL:

```text
/services/browser-use/sessions/sess_...
```

### Full clickable viewer URL fix

WebChat only autolinks full `http://` or `https://` URLs. The browser-use
launcher was returning text with only the router-relative URL from the provider.

Fix applied to source and live shadow:

- `copilot-agents/achilles-skills/launch-browser-use/src/index.mjs`
- `copilot-agents/tests/unit/launcher-browser-use.test.mjs`
- `copilot-agents/docs/specs/DS014-browser-use-agent.md`
- `AssistOSExplorer/AchillesCLI/achilles-cli/src/skills/copilot-router/oskill.md`

The launcher now formats local viewer URLs as:

```text
http://localhost:8080/services/browser-use/sessions/<session-id>
```

and puts the URL on its own line.

Validation:

```sh
cd /Users/danielsava/work/file-parser/copilot-agents
node --test tests/unit/launcher-browser-use.test.mjs
git diff --check
```

Result: 10/10 tests passed, no whitespace errors.

AchillesCLI was reinstalled afterward:

```sh
cd /Users/danielsava/work/testExplorerFresh
/Users/danielsava/work/file-parser/ploinky/bin/ploinky reinstall achilles-cli
```

## Current Uncommitted Source Changes

In `copilot-agents`:

```text
M achilles-skills/launch-browser-use/src/index.mjs
M copilotProviderRelay/mcp-config.json
M docs/specs/DS014-browser-use-agent.md
M tests/unit/launcher-browser-use.test.mjs
M tests/unit/provider-task.test.mjs
```

In `AssistOSExplorer/AchillesCLI`:

```text
M achilles-cli/src/skills/copilot-router/oskill.md
M tests/copilotRouter.integration.test.mjs
M tests/copilotRouter.test.mjs
```

In `ploinky`:

```text
M cli/server/authHandlers.js
M cli/server/routerHandlers.js
M docs/specs/DS005-routing-and-web-surfaces.md
M docs/specs/DS011-security-model.md
M node_modules/achillesAgentLib
M tests/unit/httpServiceInvocation.test.mjs
```

The `node_modules/achillesAgentLib` entry is a gitlink/submodule-ish status item
inside `ploinky`; inspect before staging anything.

## Runtime Invariants Skill Refresh

The file-parser workspace runtime invariants skill was refreshed and mirrored
into the installed Codex plugin cache:

```text
/Users/danielsava/work/file-parser/.claude/plugin-marketplace/plugins/file-parser-workspace/skills/runtime_invariants/SKILL.md
/Users/danielsava/.codex/plugins/cache/file-parser-workspace-local/file-parser-workspace/0.1.0/skills/runtime_invariants/SKILL.md
```

Validation:

- Source and cache copies are identical.
- No non-ASCII characters.
- `git diff --check` passed for the skill file.

## Commands for Resuming

Check deployment:

```sh
cd /Users/danielsava/work/testExplorerFresh
/Users/danielsava/work/file-parser/ploinky/bin/ploinky status
curl -sS -i http://127.0.0.1:8080/health | sed -n '1,80p'
podman ps --format '{{.Names}} {{.Status}} {{.Ports}}' | rg 'achilles-cli|browserUseAgent|copilotProviderRelay|webSearchAgent|research-agents'
curl -sS http://127.0.0.1:16256/status
```

Use bounded log reads on macOS with Perl alarm, because GNU `timeout` is not
available:

```sh
cd /Users/danielsava/work/testExplorerFresh
perl -e 'alarm 3; exec @ARGV' podman logs --tail=120 ploinky_copilot-agents_browserUseAgent_testExplorerFresh_d8f88a10 2>&1 | sed -n '1,180p'
perl -e 'alarm 3; exec @ARGV' podman logs --tail=120 ploinky_copilot-agents_copilotProviderRelay_testExplorerFresh_d8f88a10 2>&1 | sed -n '1,180p'
perl -e 'alarm 3; exec @ARGV' podman logs --tail=160 ploinky_AchillesCLI_achilles-cli_testExplorerFresh_d8f88a10 2>&1 | sed -n '1,220p'
```

After changing AchillesCLI source or live shadow routing text:

```sh
cd /Users/danielsava/work/testExplorerFresh
/Users/danielsava/work/file-parser/ploinky/bin/ploinky reinstall achilles-cli
```

If browser-use is wedged and the active session is not useful, restart the
provider agent rather than the whole workspace:

```sh
cd /Users/danielsava/work/testExplorerFresh
/Users/danielsava/work/file-parser/ploinky/bin/ploinky reinstall browserUseAgent
```

## Suggested Next Debug Steps

1. Reproduce the stuck prompt in WebChat or a fresh WebChat tab:

   ```text
   use gemini to find what the latest stable version of node is?
   ```

2. Determine whether `browserUseAgent.browser_use_run_task` returns:

   - `waiting_for_user` with a viewer URL,
   - `completed` with empty `final_answer`,
   - `completed` with only state/session metadata,
   - an error swallowed by `copilotProviderRelay`, or
   - no response before the launcher timeout.

3. Trace result normalization in:

   - `copilot-agents/browserUseAgent/tools/run-task.mjs`
   - `copilot-agents/browserUseAgent/server/browser-session-manager.mjs`
   - `copilot-agents/copilotProviderRelay/tools/lib/task.mjs`
   - `copilot-agents/copilotProviderRelay/tools/submit-task.mjs`
   - `copilot-agents/achilles-skills/launch-browser-use/src/index.mjs`

4. Confirm whether Gemini requires user login. If it does, `launch-browser-use`
   should return a `waiting_for_user` message with a full clickable URL, not an
   empty natural-language result.

5. Check if `browserUseAgent` can produce a viewer URL for the active session.
   Direct service status says there is one active session, but the latest
   visible WebChat turn did not display a URL.

6. Add/adjust focused unit tests for the exact provider payload shape causing
   the stuck behavior before broad refactors.

## Important Constraints

- Do not hardcode browser-use behavior in Ploinky core. WebChat and the router
  remain generic transports.
- Keep provider routing in AchillesCLI/copilot skills and provider execution in
  `copilot-agents`.
- Protected viewer routes must stay manifest-declared HTTP services and must use
  router-provided identity only.
- Do not log prompts, credentials, cookies, localStorage/sessionStorage, auth
  callback URLs, screenshots, DOM dumps, invocation JWTs, or raw headers.
- If runtime/auth/router/MCP/HTTP behavior changes, update the relevant DS spec
  in the same change.

## Validation to Run Before Reporting Done

At minimum:

```sh
cd /Users/danielsava/work/file-parser/copilot-agents
node scripts/validate-manifests.mjs
node --test tests/unit/*.test.mjs
git diff --check

cd /Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI
node --test tests/copilotRouter.test.mjs tests/copilotRouter.integration.test.mjs
git diff --check

cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/*.test.mjs
git diff --check
```

Then run the live manual WebChat smoke again in
`/Users/danielsava/work/testExplorerFresh`.

## Session 2 Findings (2026-05-21 ~16:15 Europe/Bucharest)

This section records a follow-up live reproduction in the same fresh
`/Users/danielsava/work/testExplorerFresh` deployment. The deployment had been
idle since 13:11 (router log showed only health checks); a single WebChat prompt
was sent through Chrome via the Claude-in-Chrome MCP. Claims are split by the
taxonomy in `~/.claude/CLAUDE.md` (Observed / Inferred / Verified / Delegated /
Not verified).

### Reproduction inputs

- WebChat opened on `http://127.0.0.1:8080/webchat?agent=achilles-cli&forward-envelope=1&dir=%2FUsers%2Fdanielsava%2Fwork%2FtestExplorerFresh%2Ftest`
  via `tabs_create_mcp` from the paired Chrome browser. Tab id `21824032`.
- Auth: local-auth via `POST /auth/login`, user `admin`. Login form appeared
  because workspace SSO is disabled.
- Prompt submitted at `2026-05-21T13:15:27Z`:
  `use gemini to find what the latest stable version of node is?`

### Observed router-log sequence

Router log file: `/Users/danielsava/work/testExplorerFresh/.ploinky/logs/router.log`.

```text
13:15:29.434  POST /webchat/input                              (prompt received)
13:15:32.331  POST /mcps/copilotProviderRelay/mcp
13:15:32.572  POST /mcps/browserUseAgent/mcp                   (browser_use_status)
13:15:32.818  POST /mcps/copilotProviderRelay/mcp
13:15:32.889  POST /mcps/browserUseAgent/mcp                   (browser_use_run_task)
13:15:57.277  GET  /services/browser-use/sessions/sess_33a4d995d58c4058
13:15:57.289  auth_missing_cookie  (same path)
13:15:57.292  GET  /auth/login                                 (login form)
13:16:04.738  POST /auth/login                                 (first user submission)
13:16:04.854  auth_local_login_success user=admin agent=explorer
13:16:04.857  GET  /services/browser-use/sessions/sess_...     (auth_missing_cookie)
13:16:04.860  GET  /auth/login                                 (form re-rendered)
13:16:14.590  GET  /services/browser-use/sessions/sess_...     (auth_missing_cookie)
13:16:14.601  GET  /auth/login
13:16:18.766  POST /auth/login                                 (second user submission)
13:16:18.849  GET  /services/browser-use/sessions/sess_...     (no auth_missing_cookie)
13:16:18.887  GET  /services/browser-use/sessions/sess_.../events
13:16:26.405  POST /services/browser-use/sessions/sess_.../input
13:16:29.741  POST /services/browser-use/sessions/sess_.../input
13:17:20.672  client_error read ECONNRESET
13:18:01.814  client_error read ECONNRESET
13:18:39.447  client_error read ECONNRESET
13:18:39.449  process_signal health_check_kill pid=4018 failures=3 source=Watchdog.healthCheck
13:18:39.451  shutdown reason="Signal: SIGTERM" exitCode=0
13:18:49.455  shutdown reason="forced_exit_timeout" exitCode=1
13:18:50.795  boot_operation webchat_manifest_cli_fallback agent=explorer
13:18:50.802  server_start port=8080                           (Watchdog respawn)
```

### Container-side observed details

From `podman logs ploinky_copilot-agents_browserUseAgent_testExplorerFresh_d8f88a10`:

- `browser_use_run_task` invocation with input:
  - `prompt: '[redacted]'`
  - `provider: 'gemini'`
  - `timeoutMs: 120000`
  - `origin: { type: 'semantic-copilot', surface: 'webchat', working_directory: '/Users/danielsava/work/testExplorerFresh/test', agent: 'achilles-cli' }`
- The `origin` payload received by `browser_use_run_task` carries no URL hint:
  no `publicBaseUrl`, no `webchatOrigin`, no `baseUrl`, no `routerUrl`.

From `podman inspect ploinky_AchillesIDE_explorer_testExplorerFresh_d8f88a10`
(env vars apply uniformly across the workspace agents):

- `PLOINKY_ROUTER_HOST=host.containers.internal`
- `PLOINKY_ROUTER_PORT=8080`
- `PLOINKY_ROUTER_URL=http://host.containers.internal:8080`
- No `PLOINKY_PUBLIC_ROUTER_URL`, no `PLOINKY_PUBLIC_URL`, no `PUBLIC_ROUTER_URL`.

### Observed WebChat behavior

Three screenshots taken via Chrome MCP at +3s, +30s, +~60s after submission:

- +3s: WebChat showed `Thinking...` plus chain-of-thought line
  `User explicitly requested Gemini for an online lookup, so launch browser use with Gemini provider.`
- +30s: `Thinking...` replaced by the assistant reply containing the link
  `http://localhost:8080/services/browser-use/sessions/sess_33a4d995d58c4058`,
  followed by a generic welcome line. A new tab opened for that URL.
- +60s: The browser-use viewer iframe finally showed the real Gemini page with a
  `waiting_for_user` badge — but only after the user manually typed credentials
  in the iframe twice.

### Verified root cause of the cross-origin redirect

File: `copilot-agents/achilles-skills/launch-browser-use/src/index.mjs`,
lines 84-118. Function `routerUrlForUser(env, origin)`:

```javascript
function routerUrlForUser(env = process.env, origin = {}) {
    const originBase = publicBaseFromOrigin(origin);
    if (originBase) return originBase.replace(/\/+$/, '');

    const explicitPublic = trim(env.PLOINKY_PUBLIC_ROUTER_URL || env.PLOINKY_PUBLIC_URL || env.PUBLIC_ROUTER_URL);
    if (explicitPublic) return explicitPublic.replace(/\/+$/, '');

    const internalHosts = new Set(['host.containers.internal', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
    const configuredHost = trim(env.PLOINKY_ROUTER_HOST).toLowerCase();
    const configuredPort = trim(env.PLOINKY_ROUTER_PORT) || '8080';
    if (internalHosts.has(configuredHost)) {
        return `http://localhost:${configuredPort}`;          // line 95
    }

    const resolved = resolveRouterUrl(env);
    try {
        const parsed = new URL(resolved);
        if (internalHosts.has(parsed.hostname.toLowerCase())) {
            return `http://localhost:${parsed.port || configuredPort}`; // line 102
        }
    } catch { /* ignore */ }
    return resolved;
}
```

In the running container, every input on the cascade is empty or matches the
`internalHosts` set:

1. `publicBaseFromOrigin(origin)` returns `''` — the `origin` payload contains
   no URL hint (see container log above).
2. `env.PLOINKY_PUBLIC_ROUTER_URL` / `PLOINKY_PUBLIC_URL` / `PUBLIC_ROUTER_URL`
   are all unset.
3. `env.PLOINKY_ROUTER_HOST === 'host.containers.internal'` → matches
   `internalHosts` → returns `http://localhost:8080`.

`resolveViewerFullUrl(viewerUrl, env, origin)` at lines 110-118 then joins this
base with the relative `viewerUrl` returned by `browser_use_run_task` (which is
`/services/browser-use/sessions/${sessionId}` per
`copilot-agents/browserUseAgent/server/browser-session-manager.mjs:72`), producing:

```text
http://localhost:8080/services/browser-use/sessions/sess_33a4d995d58c4058
```

WebChat is loaded on `http://127.0.0.1:8080`. Chrome treats `127.0.0.1` and
`localhost` as separate origins; the `ploinky_jwt` cookie set on `127.0.0.1`
is not sent to `localhost`. The new tab therefore reports `auth_missing_cookie`
on its first GET and gets redirected into the login form.

This is the same `"Full clickable viewer URL fix"` recorded earlier in this
document — that change introduced the absolute URL specifically so WebChat
autolinks it, but the chosen hostname (`localhost`) does not match the WebChat
tab's hostname under the current deployment.

### Inferred but not verified: why the first iframe login did not stick

After cross-origin entry, the user must log in *inside* the iframe. The log
shows two successful logins (`auth_local_login_success` at 13:16:04.854 and
13:16:18.848), but the GET that followed the first success at 13:16:04.857
still hit `auth_missing_cookie`. The 3 ms gap between the success log and that
GET is too tight for the standard "302 + Set-Cookie → store → follow redirect"
flow.

Hypotheses (none verified yet):

- An in-flight parallel request (the iframe's `/events` SSE retry or a parent-
  frame poll) raced ahead of the cookie commit and consumed the
  `auth_missing_cookie` redirect.
- Chrome's password-manager save dialog (observed earlier in the test
  via the "Save Login Details" overlay) interfered with the redirect.
- The first `Set-Cookie` was set on the response but the iframe's navigation
  state caused the browser to discard it.

To validate, the next run should capture Chrome DevTools network/storage view
for the iframe at the moment of first login submission. The router log alone
does not disambiguate these.

### Inferred but not verified: the router crash at 13:18:39

Three `client_error read ECONNRESET` entries (one per ~40s) ended in a
`process_signal health_check_kill` with `failures=3 source=Watchdog.healthCheck`.
SIGTERM was sent, the graceful shutdown timed out at 10 s, the process exited 1,
and the Watchdog respawned a new RoutingServer on port 8080.

Not yet read: `ploinky/cli/server/Watchdog.js`. The mapping between
`client_error read ECONNRESET` and the health-check failure counter has to be
confirmed there before any change is proposed. The two `/services/browser-use/.../input`
POSTs at 13:16:26 and 13:16:29 (likely long-poll or SSE) preceded the
ECONNRESETs and are the most likely source of the resets, but that is also not
verified.

### Files read in this session

- `ploinky/cli/server/authHandlers.js` — login POST handler (lines 1150-1240),
  `ensureAuthenticated` (lines 859-924), `resolveAuthContext` (lines 598-661).
- `ploinky/cli/server/handlers/common.js` — `buildCookie` (lines 58-72).
- `ploinky/cli/services/docker/agentServiceManager.js` — container router-env
  builder (lines 315-359).
- `copilot-agents/browserUseAgent/server/browser-session-manager.mjs` — relative
  `viewerUrl` creation (line 72).
- `copilot-agents/browserUseAgent/server/browser-use-server.mjs` — `viewerUrl`
  echoed in `executeTask` / `continueTask` (lines 120-185).
- `copilot-agents/browserUseAgent/tools/run-task.mjs` — MCP tool entry that
  POSTs to the local service and returns the JSON unchanged (whole file).
- `copilot-agents/achilles-skills/launch-browser-use/src/index.mjs` — the
  `routerUrlForUser` / `resolveViewerFullUrl` block (lines 40-118).
- `copilot-agents/docs/browser-use-testing-handoff-2026-05-21.md` — prior
  state (this file).

### Delegated

- A single `Explore`-agent pass searched `achillesAgentLib`, `AchillesCLI`,
  `copilotProviderRelay`, `browserUseAgent/server`, and the WebChat handler for
  the `localhost` injection. The agent identified
  `launch-browser-use/src/index.mjs:95` as the primary candidate and
  `:102` as the secondary; both were then independently confirmed by reading
  the file in this session.

### Not verified in this session

- Whether the WebChat handler or the `copilot-router` orchestrator can be made
  to populate `origin.publicBaseUrl` (or any of the other keys
  `publicBaseFromOrigin` accepts at lines 59-82) with the WebChat tab's actual
  origin. The cleanest fix lives there if it can.
- Whether `PLOINKY_PUBLIC_ROUTER_URL` should be set per-deployment as a
  workaround. The launcher already honors it (line 88) — but it must be set on
  each agent that runs the launcher, not just the router itself.
- Whether dropping the `localhost` fallback in favor of `127.0.0.1` is safe
  for users who actually load WebChat on `localhost:8080`. It is not: this
  trades one cross-origin failure for the symmetric one.
- The Watchdog health-check threshold semantics. Not read this session.

### Suggested next steps

1. Decide where the WebChat tab's actual origin should enter the chain
   (WebChat handler → forwarded envelope → orchestrator → launcher) so that
   `publicBaseFromOrigin` wins at line 85 before the hardcoded fallback fires.
   This is the only fix that survives both `localhost` and `127.0.0.1`
   deployments without per-host config.
2. Until then, document and recommend setting `PLOINKY_PUBLIC_ROUTER_URL` on
   the agent that runs `launch-browser-use`. Treat the `localhost` fallback as
   a known foot-gun.
3. Read `ploinky/cli/server/Watchdog.js` to understand the
   `health_check_threshold_exceeded` counter and decide whether
   `client_error read ECONNRESET` should bump it. If not, the watchdog needs a
   condition tweak.
4. Add a regression test in
   `copilot-agents/tests/unit/launcher-browser-use.test.mjs` that asserts the
   launcher uses the supplied `origin.publicBaseUrl` over both env fallbacks
   and the hardcoded `localhost` branch. The current test file already covers
   the absolute-URL path but does not pin the origin precedence.
5. When live-testing after a fix, capture a Chrome DevTools network/storage
   trace for the iframe during the first login submission to settle the
   double-login mystery.

### Status

- No code was modified in this session. All findings are read-only.
- No tests were run in this session.
- The cross-origin cause is identified and ready to fix; the double-login and
  router-crash secondaries remain hypotheses.

## Session 3 Fix Applied: Same-Origin Viewer URL Propagation

### Code changes

- `ploinky/cli/server/handlers/webchat.js` now adds
  `origin.publicBaseUrl` to forwarded WebChat envelopes. The value is derived
  from the incoming WebChat request's browser-visible origin using
  `Host`/`X-Forwarded-Host` and `X-Forwarded-Proto`, and is accepted only as an
  `http` or `https` origin.
- `AssistOSExplorer/AchillesCLI/achilles-cli/src/lib/webchatEnvelope.mjs` now
  normalizes `origin.publicBaseUrl` from the envelope and drops malformed or
  non-HTTP origin hints.
- `AssistOSExplorer/AchillesCLI/achilles-cli/src/index.mjs` now preserves the
  normalized origin in `context.webchatOrigin`.
- `copilot-agents/achilles-skills/launch-browser-use/src/index.mjs` already
  preferred `origin.publicBaseUrl`; the regression test now pins that this wins
  over `PLOINKY_ROUTER_HOST=host.containers.internal`.

### Tests run

```text
cd ploinky
node --test tests/unit/webchatEnvelope.test.mjs tests/unit/httpServiceInvocation.test.mjs
# 8/8 pass

cd AssistOSExplorer/AchillesCLI
node --test tests/webchatEnvelope.test.mjs tests/webchatReferences.test.mjs tests/copilotRouter.test.mjs tests/copilotRouter.integration.test.mjs
# 17/17 pass

cd copilot-agents
node --test tests/unit/launcher-browser-use.test.mjs tests/unit/provider-task.test.mjs
# 23/23 pass

git diff --check
# clean in ploinky, AssistOSExplorer/AchillesCLI, and copilot-agents
```

### Live deployment update

Workspace: `/Users/danielsava/work/testExplorerFresh`

- Synced the updated AchillesCLI files into the live shadow checkout under
  `.ploinky/repos/AchillesCLI`.
- Reinstalled `achilles-cli`.
- Restarted the router so the updated WebChat envelope builder is loaded.
- Verified router health at `http://127.0.0.1:8080/health`.
- Verified the running `achilles-cli` container contains the new
  `publicBaseUrl` normalizer.

Current relevant live ports after restart:

- Router: `http://127.0.0.1:8080`
- `achilles-cli`: `127.0.0.1:15025 -> 7000`
- `browserUseAgent`: `127.0.0.1:16256 -> 7000`
- `copilotProviderRelay`: `127.0.0.1:46779 -> 7000`

### Expected manual retest behavior

Open WebChat on the same host you want the viewer to use, for example:

```text
http://127.0.0.1:8080/webchat?agent=achilles-cli&forward-envelope=1&dir=%2FUsers%2Fdanielsava%2Fwork%2FtestExplorerFresh%2Ftest
```

Then submit a browser-use prompt such as:

```text
Use Gemini in the browser to find the latest stable version of Node.js. If
login is required, open the browser session, wait for me to sign in, then
continue and summarize the result.
```

The assistant reply should now contain a viewer link beginning with the same
origin as the WebChat tab, e.g.
`http://127.0.0.1:8080/services/browser-use/sessions/...`, not
`http://localhost:8080/...`.

### Still not verified

- End-to-end manual browser test after the same-origin fix.
- Whether the previous double-login symptom still occurs once the cross-origin
  redirect is gone.
- Whether the earlier Watchdog/router restart was caused by browser-use viewer
  traffic or an unrelated health-check issue.

## Session 4 Automated E2E Result

### Scenario

Automated browser test against:

```text
http://127.0.0.1:8080/webchat?agent=achilles-cli&forward-envelope=1&dir=%2FUsers%2Fdanielsava%2Fwork%2FtestExplorerFresh%2Ftest
```

Prompt:

```text
Use Gemini in the browser to find the latest stable version of Node.js. If
login is required, open the browser session, wait for me to sign in, then
continue and summarize the result.
```

### Observed result

- WebChat required local router login first; local dev credentials were used
  after explicit approval.
- AchillesCLI routed the prompt to `launch-browser-use`.
- `copilotProviderRelay` submitted a `browser-use` task.
- `browserUseAgent` created session `sess_fd3de801566a4e23`.
- WebChat displayed a full same-origin viewer URL:

```text
http://127.0.0.1:8080/services/browser-use/sessions/sess_fd3de801566a4e23
```

- Opening the viewer did not redirect to `/auth/login`.
- Viewer page loaded with title:

```text
Browser Use - https://gemini.google.com/app
```

- Viewer DOM showed:
  - `Browser Use Viewer`
  - `waiting_for_user`
  - `Browser screenshot`
  - `Login Complete - Continue`
  - text input relay
  - `Close Session`

### Runtime evidence

`browserUseAgent` status after the viewer opened:

```json
{"ok":true,"agent":"browserUseAgent","activeSessions":1,"totalSessions":1,"chromiumAvailable":true,"viewerTransport":"http-sse"}
```

Router log sequence included:

```text
POST /webchat/input
POST /mcps/copilotProviderRelay/mcp
POST /mcps/browserUseAgent/mcp
GET  /services/browser-use/sessions/sess_fd3de801566a4e23
GET  /services/browser-use/sessions/sess_fd3de801566a4e23/events
```

No `auth_missing_cookie` occurred on the viewer URL after the fix.

Container logs showed `browser_use_run_task` received:

```json
{
  "origin": {
    "type": "semantic-copilot",
    "surface": "webchat",
    "working_directory": "/Users/danielsava/work/testExplorerFresh/test",
    "publicBaseUrl": "http://127.0.0.1:8080",
    "agent": "achilles-cli"
  }
}
```

### Remaining boundary

The automated test stopped at Gemini login / `waiting_for_user`, as expected.
Completing the external account login still requires a human to enter provider
credentials and click `Login Complete - Continue`.
