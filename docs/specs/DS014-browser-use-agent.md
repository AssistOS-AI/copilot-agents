---
id: DS014
title: Browser Use Provider Agent
status: implemented
owner: copilot-agents-team
summary: Defines the interactive browser automation provider agent that controls Chromium sessions and exposes a protected viewer URL for login, OAuth, 2FA, and CAPTCHA flows.
---

# DS014 - Browser Use Provider Agent

## Introduction

`browserUseAgent` is an interactive browser automation provider for AchillesCLI
semantic Copilot routing. It controls a persistent Chromium session and exposes
a protected viewer URL where the authenticated user can complete login, OAuth,
2FA, or CAPTCHA flows. After login, the agent resumes in the same browser
context and submits the original prompt to the target web application.

The first provider targets are ChatGPT and Gemini. Additional browser-only
services can be added through agent-local provider adapters without modifying
the session manager, relay, router, or launcher code.

## Core Content

The agent must be a Ploinky agent directory named `browserUseAgent`. It uses
`node:24.15.0-bookworm` as its container base, `lite-sandbox: true`, and
Playwright with Chromium for browser automation.

The agent exposes these MCP tools:

- `browser_use_status`: reports readiness, Chromium availability, viewer
  transport, and active session count.
- `browser_use_run_task`: high-level task entry point used by
  `copilotProviderRelay`. Accepts `prompt`, `provider`, `timeoutMs`, and
  `origin`. Returns a viewer URL with `state: "waiting_for_user"` when login is
  required, or `state: "completed"` with the extracted answer.
- `browser_use_task_status`: returns task and session state by `jobId`.
- `browser_use_continue_task`: resumes a task after user login.
- `browser_use_close_session`: closes one session or clears a provider profile.

The agent must declare a protected HTTP service in its manifest:

```json
{
  "slug": "browser-use",
  "externalPrefix": "/services/browser-use/",
  "internalPrefix": "/browser-use/",
  "auth": "protected"
}
```

The viewer is served behind this protected service path. Users access the
viewer through the Ploinky router, which enforces authentication before
proxying to the agent.

The agent process must expose both MCP and browser viewer routes on the
registered Ploinky agent port. The implementation runs a small front server on
the public agent port, serves `/browser-use/*` directly, and proxies `/mcp`,
`/health`, and `/getTaskStatus` to an internal AgentServer port. This keeps the
manifest-declared HTTP service reachable without adding browser-use-specific
paths to Ploinky core.

The agent owns an agent-local provider adapter registry. Provider-specific
browser automation (login detection, prompt entry, send behavior, response
streaming, and response extraction) lives in adapter modules under
`browserUseAgent/providers/<providerId>/`. Each provider folder contains a
declarative `provider.json` with safe metadata (`id`, `label`, `aliases`,
`startUrl`, `default`, `enabled`, `order`) and an `adapter.mjs` that exports
`detectLoginRequired({ page, session, provider })` and
`submitPrompt({ page, session, provider, prompt, timeoutMs })`, where
`provider` is the resolved provider metadata object. The session manager calls
adapter hooks instead of branching on provider ids. The registry discovers
providers from the local `providers/` tree, validates metadata and adapter
exports, rejects duplicates, and ignores disabled providers. The service must
fail startup when no enabled providers are available. The registry exposes
`getProvider(id)`, `getDefaultProvider()`, `resolveProvider(value)`, and
`listProviders()`. `listProviders()` returns only safe catalog metadata; it
must not expose filesystem paths, selectors, profile directories, or internal
diagnostics.

Browser profiles persist per authenticated user and provider under
`/data/profiles/<safeUserId>/<provider>/`. The manifest declares:

```json
{ ".ploinky/data/browserUseAgent": "/data" }
```

Only one non-terminal Chromium context may be active for a given user/provider
profile at a time. If a new `browser_use_run_task` request arrives while a
same-user/same-provider session is still `starting`, `ready`,
`waiting_for_user`, or `running`, the provider must return the existing
session's viewer URL instead of launching a second browser against the same
profile. Session creation and reuse checks for a user/provider profile must be
serialized so concurrent requests cannot launch two Chromium contexts for the
same persistent profile. When a task reaches `completed`, `failed`, or
`closed`, browser resources must be closed immediately so the persistent
profile lock is released before the next task. If a container restart leaves
stale Chromium `Singleton*` lock symlinks for a profile and no live
same-container Chromium process owns that lock, the agent may remove those
stale profile locks before launching a new browser context.

The MCP tools must derive the profile owner from verified secure-wire
invocation metadata (`metadata.invocation.usr.id` or `sub`). Protected viewer
routes must derive the browser user from `x-ploinky-auth-info.user.id`. Viewer
requests without an authenticated user id, or with a user id that does not
match the session owner, must be rejected. The implementation must not fall
back to a shared `anonymous` profile for authenticated browser-use tasks.

The browser session manager tracks sessions through these states:

- `starting` -> `ready` -> `waiting_for_user` -> `running` -> `completed`
- Any state may transition to `failed` or `closed`.

The viewer uses an HTTP-based SSE transport: `GET /browser-use/sessions/:id`
returns the viewer HTML, `GET /browser-use/sessions/:id/events` streams state
and screenshot updates, `POST /browser-use/sessions/:id/input` sends user
input events, and `POST /browser-use/sessions/:id/user-ready` signals login
completion. The user-ready signal starts the saved task prompt automatically in
the same browser session; it must not only flip session state and wait for a
separate manual MCP continuation call. The saved session must also preserve the
task `timeoutMs` so continuation after login uses the original request timeout.

The relay backend entry uses `id: "browser-use"` with
`provider: { agent: "browserUseAgent", tool: "browser_use_run_task" }`,
`cacheable: false`, and `interactive: true`. The backend catalog entry must not
include a `tags` field.

The `launch-browser-use` deterministic cskill validates relay availability,
probes the provider status, and dispatches through
`copilotProviderRelay.copilot_provider_task_submit`. It returns the viewer URL
and waiting instructions when login is required. Browser sessions may report a
router-relative `viewerUrl`; user-facing launcher text must render it as a full
absolute `http://` or `https://` URL using the public WebChat/router origin when
available and a local `http://localhost:<router-port>` fallback for local
container deployments.

The launcher may pass a provider id to the relay. Provider selection uses
explicit provider input first, then provider aliases from the
`browser_use_status` provider catalog matched against the prompt, then the
provider marked `default` in the registry.

The agent must not log credentials, cookies, localStorage, sessionStorage,
OAuth callback URLs, authorization codes, screenshots, DOM dumps, raw auth
headers, or invocation tokens by default.

## Decisions & Questions

### Question #1: Why does the agent front MCP and browser routes on one port?

Response:
Ploinky `httpServices` forward to the enabled agent's registered host port. If
the viewer listens only on a second unregistered local port, protected viewer
URLs reach AgentServer instead of the viewer. Fronting `/mcp` and
`/browser-use/*` on the same registered port preserves the current Ploinky
service contract without router changes.

### Question #2: Why use HTTP SSE instead of noVNC for the viewer?

Response:
The current Ploinky HTTP service proxy does not support generic WebSocket
upgrades for manifest-declared services. The HTTP-based viewer (SSE for
screenshots, POST for input) works within the existing proxy model. A noVNC
viewer can be added when Ploinky gains generic WebSocket proxying for HTTP
services.

### Question #3: Why persist browser profiles per user and provider?

Response:
Login state (cookies, localStorage) is user-specific and provider-specific.
Sharing one Chromium profile across users would leak sessions. Isolating by
both user and provider prevents cross-contamination while allowing session
reuse across tasks for the same user on the same provider.

### Question #4: Why is the backend not cacheable?

Response:
Browser automation interacts with live web applications whose state changes
between requests. Caching a response from a logged-in ChatGPT session would
return stale answers. Each task must execute fresh.

### Question #5: Why require the protected auth mode?

Response:
The viewer surface is a logged-in browser session. Exposing it without
authentication would allow anyone with the URL to interact with the user's
authenticated web application session. The protected auth mode ensures only
the session owner can access the viewer.

### Question #6: Why are browser providers agent-local adapters instead of separate Ploinky agents or Explorer IDE-plugins?

Response:
Browser providers share one Chromium lifecycle, one protected viewer contract,
one per-user/per-provider profile store, and one session concurrency model.
Splitting each provider into a separate Ploinky agent would duplicate all of
that infrastructure and force the relay to maintain per-provider backend ids.
Explorer IDE-plugins are UI and host-slot oriented; browser automation logic
belongs where the browser session is owned. Agent-local provider adapters keep
the extension point inside `browserUseAgent` while preserving one relay
backend (`browser-use`), one protected HTTP service, and one profile isolation
model.

## Conclusion

`browserUseAgent` is an interactive browser provider that controls persistent
Chromium sessions for logged-in web application tasks. It exposes a protected
viewer for login flows and resumes in the same browser context after the user
completes authentication.
