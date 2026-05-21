# Browser Use Agent Implementation Plan

Status: proposed. This plan spans `copilot-agents`, AchillesCLI launcher
integration, and possibly Ploinky router HTTP-service WebSocket support.

## Purpose

Implement `browserUseAgent` as an interactive browser provider for AchillesCLI
semantic Copilot routing. The agent must control a browser session while also
exposing a protected viewer URL where the authenticated user can complete
OAuth, password, 2FA, or CAPTCHA flows. After the user finishes login, the
agent resumes in the same browser context and completes the requested task.

The target flow is:

```text
AchillesCLI copilot-router
  -> launch-browser-use
  -> copilotProviderRelay.copilot_provider_task_submit
  -> browserUseAgent.browser_use_run_task
  -> protected browser viewer URL
  -> user login / OAuth completion
  -> browserUseAgent resumes and returns final answer
```

The first provider target is ChatGPT. Gemini and other browser-only services
can be added after the session/viewer contract is stable.

## Existing Integration Points

AchillesCLI already routes ordinary prompts through `copilot-router`, which
chooses launcher skills such as `launch-web-search`. External launcher skills
are discovered from the Ploinky repository skill roots, including
`copilot-agents/achilles-skills/`.

`copilotProviderRelay` is the secure dispatcher for provider-backed Copilot tasks.
It forwards tasks through router-mediated MCP calls using the invocation token
from the selected AchillesCLI/WebChat session. `browserUseAgent` should follow
that existing provider pattern rather than becoming a direct WebChat feature.
The current relay contract uses backend ids only; do not add visible tag
aliases or a `tags` field to the backend catalog.

Ploinky user-visible downstream HTTP surfaces must be declared by the owning
agent in `manifest.json` as `httpServices`. The viewer must therefore be a
protected manifest-declared service, not an ad-hoc exposed container port.

## High-Level Architecture

`browserUseAgent` should own three surfaces:

```text
browserUseAgent/
  manifest.json
  mcp-config.json
  package.json
  scripts/install.sh
  scripts/startAgent.sh
  server/browser-use-server.mjs
  server/browser-session-manager.mjs
  server/viewer-routes.mjs
  tools/status.mjs
  tools/run-task.mjs
  tools/task-status.mjs
  tools/continue-task.mjs
  tools/close-session.mjs
```

The agent process must serve both MCP and browser viewer routes from the agent
port. The default Ploinky AgentServer only handles `/health`, `/getTaskStatus`,
and `/mcp`, so it is not sufficient by itself for `/browser-use/*` routes.

The agent must also be added to:

- `research-agents/manifest.json` as `browserUseAgent global no-wait`;
- `scripts/validate-manifests.mjs` so static validation covers the new agent;
- `docs/specs/matrix.md` after adding the browser-use DS file.

## Manifest Contract

The manifest should declare a protected service and a persistent data volume:

```json
{
  "container": "node:24.15.0-bookworm",
  "lite-sandbox": true,
  "about": "Interactive browser automation provider with protected user viewer for login and OAuth flows.",
  "agent": "sh /code/scripts/startAgent.sh",
  "readiness": {
    "protocol": "mcp"
  },
  "httpServices": [
    {
      "slug": "browser-use",
      "externalPrefix": "/services/browser-use/",
      "internalPrefix": "/browser-use/",
      "auth": "protected",
      "notFoundMessage": "Browser-use route not found."
    }
  ],
  "volumes": {
    ".ploinky/data/browserUseAgent": "/data"
  }
}
```

If noVNC is used, the noVNC/websockify traffic must still be served behind the
manifest-declared HTTP service prefix. Avoid direct public port exposure.

## Viewer Transport Options

### Preferred: noVNC over WebSocket

Use a visible browser stack inside the container:

```text
Xvfb
  -> Chromium on DISPLAY=:99
  -> x11vnc
  -> noVNC / websockify
  -> Ploinky protected httpService route
```

Puppeteer or Playwright connects to Chromium through the remote debugging port,
while the user interacts with the same browser through noVNC.

This provides the best UX, but Ploinky currently needs generic WebSocket
upgrade proxying for manifest-declared `httpServices`. If this is implemented,
it must be generic framework support, not `browserUseAgent`-specific routing.
Update the Ploinky routing spec and targeted router tests in the same change.

### HTTP-Compatible MVP

If WebSocket proxying is not implemented first, build a custom viewer that
uses normal HTTP:

- `GET /browser-use/sessions/:id` returns the viewer HTML.
- `GET /browser-use/sessions/:id/events` streams status and screenshot updates
  through SSE or long-polling.
- `POST /browser-use/sessions/:id/input` sends click, type, key, and scroll
  events to the browser automation layer.
- `POST /browser-use/sessions/:id/user-ready` signals that the user completed
  login and the agent may resume.

This is less smooth than noVNC but fits the current HTTP service proxy.

## Browser Session Lifecycle

The browser session manager should use Chromium through Playwright or
Puppeteer. Use persistent browser profiles per authenticated user and provider:

```text
/data/profiles/<safeUserId>/<provider>/
```

Session state should include:

```json
{
  "sessionId": "sess_...",
  "jobId": "job_...",
  "ownerUserId": "user_...",
  "provider": "chatgpt",
  "state": "waiting_for_user",
  "viewerUrl": "/services/browser-use/sessions/sess_...",
  "pageUrl": "https://chatgpt.com/",
  "createdAt": "2026-05-21T00:00:00.000Z",
  "updatedAt": "2026-05-21T00:00:00.000Z"
}
```

Supported states:

- `starting`
- `ready`
- `waiting_for_user`
- `running`
- `completed`
- `failed`
- `closed`

Implement cleanup for closed and expired sessions. Provide an explicit close
or clear-session path so the user can remove persisted login state.

## MCP Tools

Expose these tools:

- `browser_use_status`: reports agent readiness, configured viewer transport,
  Chromium availability, and active session count.
- `browser_use_run_task`: high-level task entry point used by `copilotProviderRelay`.
- `browser_use_task_status`: returns task/session state by `jobId`.
- `browser_use_continue_task`: resumes after user login if manual continuation
  is required.
- `browser_use_close_session`: closes one session or clears one provider
  profile when explicitly requested.

`browser_use_run_task` input:

```json
{
  "prompt": "string",
  "provider": "chatgpt",
  "timeoutMs": 120000,
  "origin": {}
}
```

When login is required, return:

```json
{
  "ok": true,
  "state": "waiting_for_user",
  "requires_user_action": true,
  "jobId": "job_...",
  "sessionId": "sess_...",
  "viewerUrl": "/services/browser-use/sessions/sess_...",
  "final_answer": ""
}
```

When the task completes, return:

```json
{
  "ok": true,
  "state": "completed",
  "final_answer": "The answer extracted from the browser session.",
  "natural_language_output": "The answer extracted from the browser session.",
  "resources": [],
  "sources": []
}
```

## ChatGPT Adapter

The first adapter should:

1. Navigate to `https://chatgpt.com/`.
2. Detect logged-out state using conservative selectors or URL patterns.
3. If login is required, return `waiting_for_user` with the viewer URL.
4. Resume after either:
   - the user clicks Continue in the viewer;
   - `browser_use_continue_task` is called;
   - the adapter detects a logged-in ChatGPT conversation UI.
5. Submit the original prompt into the ChatGPT composer.
6. Wait for response completion.
7. Extract only the final visible answer text.

The agent must pause on password, OAuth, 2FA, and CAPTCHA screens. Credentials
must never be requested through AchillesCLI chat or logged.

## Relay Integration

Add a provider-backed backend to `copilotProviderRelay`:

```js
{
    id: 'browser-use',
    label: 'Browser Use',
    default_profile: 'default',
    provider: { agent: 'browserUseAgent', tool: 'browser_use_run_task' },
    cacheable: false,
    interactive: true,
    description: 'Interactive browser provider for logged-in web application tasks.'
}
```

Do not add `tags` or `@browser-use` aliases. AchillesCLI chooses the launcher
semantically; `copilotProviderRelay` accepts the literal backend id
`browser-use`.

Update `publicBackendView` and provider-result normalization so the relay
preserves interactive metadata:

- `state`
- `jobId`
- `sessionId`
- `viewerUrl`
- `requires_user_action`
- `interactive`

Do not make `copilotProviderRelay` own provider-specific browser behavior.

## Achilles Launcher

Add `copilot-agents/achilles-skills/launch-browser-use/` as a deterministic
cskill modeled after `launch-web-search`.

The launcher should:

1. Normalize `prompt`, `origin`, `context`, and `invocationToken`.
2. Refuse with a clear unavailable message if no invocation token exists.
3. Query `copilotProviderRelay` for the `browser-use` backend.
4. Probe `browserUseAgent.browser_use_status`.
5. Submit through `copilotProviderRelay.copilot_provider_task_submit`.
6. If the result is `waiting_for_user`, return viewer URL and continuation
   instructions.
7. If the result is `completed`, return the final answer.

The launcher must not revive visible `@agent` dispatch. Unknown `@word` tokens
remain ordinary chat text.

## Copilot Router Integration

Update AchillesCLI `copilot-router` so it may call `launch-browser-use` for
prompts that require logged-in browser web apps. Examples:

- "Use ChatGPT to answer this..."
- "Ask Gemini..."
- "Open the website and log in..."
- "Use my account to..."
- OAuth-gated workflows where the user needs to complete login in-browser.

Keep Ploinky WebChat generic. Do not add browser-use backend ids, agent ids,
or tool names to WebChat or framework-level router code.

## Security And Observability

The viewer route must be `auth: "protected"`. A shared browser is a logged-in
account surface and must not be public.

Do not log by default:

- credentials;
- cookies;
- localStorage/sessionStorage;
- OAuth callback URLs or authorization codes;
- screenshots;
- DOM dumps;
- raw auth headers;
- invocation tokens.

Debug screenshots, if ever added, must be opt-in and written under `/data`, not
tracked source. Logs should use sanitized state names and IDs only.

Browser profiles must be isolated by authenticated user and provider. Do not
share one Chromium profile across users.

## Documentation And Specs

Add `copilot-agents/docs/specs/DS014-browser-use-agent.md` for the new agent.
Keep DS numbering contiguous and update `docs/specs/matrix.md` plus
`docs/index.html`.

Update existing `copilot-agents` specs if the implementation changes bundle
membership, MCP tools, manifest behavior, security behavior, or relay metadata:

- `DS002-ploinky-runtime-invariants.md`
- `DS003-agent-inventory.md`
- `DS004-research-agents-bundle.md`
- `DS005-copilot-provider-relay-agent.md`
- `DS011-security-observability.md`
- `DS012-semantic-copilot-routing.md`

If Ploinky generic WebSocket proxying is added, update:

- `ploinky/docs/specs/DS005-routing-and-web-surfaces.md`;
- targeted router tests;
- any router docs that describe HTTP service passthrough.

## Verification

Run from `copilot-agents`:

```sh
node scripts/validate-manifests.mjs
node --test tests/unit/*.test.mjs
```

Add focused tests for:

- `copilotProviderRelay` backend catalog includes `browser-use`;
- relay normalization preserves interactive metadata;
- relay catalog output does not expose a `tags` field for `browser-use`;
- `launch-browser-use` handles missing invocation tokens;
- `launch-browser-use` returns viewer URL for `waiting_for_user`;
- `research_agents_status` includes `browserUseAgent`;
- manifest validation accepts the protected HTTP service.

If Ploinky WebSocket proxying is added, run targeted Ploinky router tests and a
manual noVNC smoke through `/services/browser-use/`.

## Acceptance Criteria

- AchillesCLI can route a logged-in web-app prompt to `launch-browser-use`.
- `browserUseAgent` returns a protected viewer URL when login is required.
- The user can open the viewer, complete login, and signal continuation.
- The agent resumes in the same browser context and submits the original prompt.
- Browser cookies persist per authenticated user and provider under `/data`.
- No credentials, cookies, screenshots, DOM dumps, or auth tokens are logged by
  default.
- Ploinky WebChat and router framework code remain generic.
