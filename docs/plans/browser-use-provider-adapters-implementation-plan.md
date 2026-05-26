# Browser Use Provider Adapter Implementation Plan

Status: proposed.

## Purpose

Refactor `browserUseAgent` so browser-only services such as ChatGPT, Gemini,
Perplexity, and future web application targets can be added through
agent-local provider adapters instead of changing the core browser-use session
manager or relay code for every provider.

The desired result is an open/closed design:

- `browserUseAgent` core remains stable for sessions, viewer routing, MCP tools,
  protected HTTP service handling, auth, profile isolation, and result shape.
- Provider-specific browser automation lives in provider adapter folders.
- `copilotProviderRelay` continues to expose one backend, `browser-use`.
- Ploinky core, WebChat, and Explorer do not gain provider-specific agent ids,
  backend tags, route handlers, or tool names.

## Current State

`browserUseAgent` already has the correct high-level placement in the
architecture. It is a single Ploinky provider agent reached through:

```text
AchillesCLI copilot-router
  -> launch-browser-use
  -> copilotProviderRelay.copilot_provider_task_submit
  -> browserUseAgent.browser_use_run_task
  -> protected /services/browser-use/... viewer
```

The current implementation is not yet open/closed for browser providers:

- `browserUseAgent/server/browser-use-server.mjs` hardcodes provider start URLs.
- `browserUseAgent/server/browser-session-manager.mjs` branches on provider ids
  for login detection, prompt entry, send behavior, stream completion, and
  response extraction.
- `achilles-skills/launch-browser-use/src/index.mjs` infers only Gemini versus
  ChatGPT.
- Tests assert the current hardcoded behavior rather than a provider catalog.

Explorer already has an `IDE-plugins` model, but that model is UI and host-slot
oriented. Browser provider logic should not be implemented as Explorer
`IDE-plugins`. The provider extension point belongs inside `browserUseAgent`,
where the browser session, protected viewer, and per-user browser profile state
are owned.

`DS014-browser-use-agent.md` and
`browser-use-testing-handoff-2026-05-21.md` add several preservation
requirements for this refactor:

- The protected viewer URL contract is already live-tested. The launcher must
  continue rendering router-relative `viewerUrl` values as full, browser-visible
  URLs, and `origin.publicBaseUrl` from the WebChat forwarded envelope must keep
  precedence over container-internal router host fallbacks. This prevents the
  `127.0.0.1` versus `localhost` cross-origin cookie failure captured in the
  handoff.
- Same-user/same-provider session reuse is part of the DS014 contract. The
  refactor must preserve one active non-terminal Chromium context per
  authenticated user/provider profile, serialized profile operations, stale
  `Singleton*` lock cleanup, immediate browser close on terminal states, and
  `session_reused` propagation through the relay and launcher.
- Source repositories under `/Users/danielsava/work/file-parser` are canonical.
  The live shadow checkout under `/Users/danielsava/work/testExplorerFresh` is
  useful for manual verification only and should not become the implementation
  target.
- The handoff is context, not a replacement spec. DS files remain authoritative,
  but the implementation must not regress behavior that the handoff documents
  as fixed and verified.

## Non-Goals

- Do not split ChatGPT, Gemini, or Perplexity into separate Ploinky agents unless
  a provider later needs materially different runtime isolation, lifecycle,
  secrets, or dependencies.
- Do not add ChatGPT, Gemini, or Perplexity as separate
  `copilotProviderRelay` backend ids.
- Do not add provider-specific routes, dispatch, tags, or tool names to Ploinky
  core, WebChat, or Explorer.
- Do not load provider adapters from arbitrary workspace paths. Adapter loading
  should be local to the packaged `browserUseAgent` code.
- Do not store credentials, cookies, screenshots, DOM dumps, prompts, auth
  callback URLs, or invocation tokens in docs, plugin assets, fixtures, or logs.
- Do not regress same-origin viewer URL propagation. Provider adapter work must
  not replace `origin.publicBaseUrl` with `localhost` or another container
  fallback when WebChat supplied the browser-visible origin.
- Do not remove same-user/same-provider session reuse or per-profile launch
  serialization while extracting provider-specific logic.

## Target Design

Add an agent-local provider adapter registry:

```text
browserUseAgent/
  server/
    provider-registry.mjs
    browser-use-server.mjs
    browser-session-manager.mjs
    viewer-routes.mjs
  providers/
    chatgpt/
      provider.json
      adapter.mjs
    gemini/
      provider.json
      adapter.mjs
    perplexity/
      provider.json
      adapter.mjs
```

`provider.json` should be declarative metadata:

```json
{
  "id": "chatgpt",
  "label": "ChatGPT",
  "aliases": ["chatgpt", "chat gpt", "openai"],
  "startUrl": "https://chatgpt.com/",
  "default": true,
  "enabled": true,
  "order": 10
}
```

`adapter.mjs` should own provider-specific page automation:

```js
export async function detectLoginRequired({ page, session, provider }) {}
export async function submitPrompt({ page, session, provider, prompt, timeoutMs }) {}
```

The adapter return shape for `submitPrompt` should match the current core
expectation:

```json
{
  "ok": true,
  "final_answer": "..."
}
```

Failures should return bounded, user-safe errors:

```json
{
  "ok": false,
  "final_answer": "",
  "error": "Task execution failed."
}
```

## Provider Registry Responsibilities

`provider-registry.mjs` should:

1. Discover providers from the local `/code/providers` tree, with a development
   fallback to the source-relative `../providers` path when not running in the
   container.
2. Validate each `provider.json`.
3. Require stable provider ids that match the existing safe provider character
   set.
4. Reject duplicate ids and duplicate aliases.
5. Ignore disabled providers.
6. Import the local `adapter.mjs` for each enabled provider.
7. Verify required adapter functions are exported.
8. Expose:

```js
export async function loadProviderRegistry(options = {}) {}
```

The loaded registry should support:

```js
registry.getProvider(id)
registry.getDefaultProvider()
registry.resolveProvider(value)
registry.listProviders()
```

`listProviders()` should return only safe metadata, such as `id`, `label`,
`aliases`, `default`, and `order`. It must not expose filesystem paths,
selectors, profile directories, cookies, prompts, auth state, or internal
diagnostics.

## Core Refactor Steps

### 1. Update Specs First

Update these specs before changing implementation:

- `docs/specs/DS014-browser-use-agent.md`
- `docs/specs/DS012-semantic-copilot-routing.md`
- `docs/specs/DS005-copilot-provider-relay-agent.md`

Required spec changes:

- Define the provider adapter registry.
- State that browser providers are subproviders of `browserUseAgent`, not
  separate relay backends.
- State that launcher provider selection should use explicit provider input,
  then provider aliases/capabilities from `browser_use_status`, then the
  registry default.
- Add a numbered decision explaining why these are agent-local provider
  adapters instead of Explorer `IDE-plugins` or separate Ploinky agents.

Also update `docs/index.html` if it summarizes the browser-use provider
contract.

### 2. Add Provider Registry and Adapters

Add:

```text
browserUseAgent/server/provider-registry.mjs
browserUseAgent/providers/chatgpt/provider.json
browserUseAgent/providers/chatgpt/adapter.mjs
browserUseAgent/providers/gemini/provider.json
browserUseAgent/providers/gemini/adapter.mjs
```

Move the existing ChatGPT-specific logic into the ChatGPT adapter.
Move the existing Gemini-specific logic into the Gemini adapter.

Keep selectors and provider-specific wait behavior out of
`browser-session-manager.mjs`.

### 3. Make the Session Manager Provider-Agnostic

Refactor `BrowserSessionManager` so it receives or loads a provider registry.
Core flow should become:

```js
const provider = registry.resolveProvider(requestedProvider);
const session = await manager.createSession(userId, provider.id, { prompt });
await manager.launchBrowser(session);
await manager.navigateTo(session, provider.startUrl);
const loginRequired = await provider.adapter.detectLoginRequired({ page, session, provider });
const result = await provider.adapter.submitPrompt({ page, session, provider, prompt, timeoutMs });
```

Retain current invariants:

- Browser profiles remain per authenticated user and provider under
  `/data/profiles/<safeUserId>/<provider>/`.
- Only one non-terminal Chromium context may be active for a given
  user/provider profile.
- Same-user/same-provider profile operations remain serialized, including
  launch, reuse, close, and relaunch after terminal state.
- Stale Chromium `Singleton*` lock cleanup remains available only when no live
  same-container Chromium process owns the profile lock.
- Viewer URLs remain `/services/browser-use/sessions/<sessionId>`.
- Viewer route auth still checks the protected service identity and session
  owner.
- `user-ready` continues to resume the saved prompt automatically.
- Terminal states still close browser resources.
- Public launcher text still converts relative viewer URLs to full URLs using
  `origin.publicBaseUrl` first, then explicit public router env, then local
  fallback.

### 4. Refactor the Server Entry Point

In `browser-use-server.mjs`:

- Remove hardcoded `PROVIDER_URLS`.
- Load the provider registry at startup.
- Return `unsupported provider` when `registry.resolveProvider()` fails.
- Include safe provider catalog metadata in `/status`.
- Keep `runTask()` result shape backward compatible.
- Preserve `session_reused` in direct service, MCP, relay, and launcher results.
- Keep startup/navigation error messages bounded and user-safe; do not expose
  raw Chromium launch logs through public state.

### 5. Extend MCP Status

In `browserUseAgent/tools/status.mjs`, include provider metadata returned by the
local service:

```json
{
  "providers": [
    {
      "id": "chatgpt",
      "label": "ChatGPT",
      "aliases": ["chatgpt", "chat gpt", "openai"],
      "default": true
    }
  ]
}
```

This is the catalog that `launch-browser-use` should use for provider
selection. Keep it safe and bounded.

### 6. Update Launcher Provider Selection

In `achilles-skills/launch-browser-use/src/index.mjs`:

1. Preserve explicit `provider` input as highest priority.
2. Probe `browser_use_status` as it does today.
3. Use returned provider aliases to select a provider from the prompt.
4. Fall back to the provider marked `default`, or `chatgpt` if no default is
   supplied.
5. Continue submitting only to
   `copilotProviderRelay.copilot_provider_task_submit`.

The launcher should not import provider adapter modules and should not call
`browserUseAgent.browser_use_run_task` directly for execution.

Also preserve the same-origin viewer URL behavior introduced during browser-use
testing:

- `origin.publicBaseUrl` wins over `PLOINKY_PUBLIC_ROUTER_URL`,
  `PLOINKY_PUBLIC_URL`, `PUBLIC_ROUTER_URL`, `PLOINKY_ROUTER_HOST`, and
  `PLOINKY_ROUTER_URL`.
- The generated viewer URL should use the same origin as the WebChat tab when
  WebChat forwarded that origin.
- Reused-session responses should render the existing full viewer URL instead
  of a generic provider fallback message.

### 7. Keep Relay Stable

Do not change the relay backend catalog shape except documentation and tests
that clarify the unchanged contract:

```js
{
  id: 'browser-use',
  provider: { agent: 'browserUseAgent', tool: 'browser_use_run_task' },
  cacheable: false,
  interactive: true
}
```

The relay may continue forwarding the `provider` string. Provider validation
belongs to `browserUseAgent`.

### 8. Add Perplexity as the Proof Case

After the registry is in place, add:

```text
browserUseAgent/providers/perplexity/provider.json
browserUseAgent/providers/perplexity/adapter.mjs
```

The Perplexity adapter should be the proof that a new provider can be added
without editing:

- `browser-use-server.mjs`
- `browser-session-manager.mjs`
- `copilotProviderRelay/tools/lib/backends.mjs`
- Ploinky router code
- Explorer plugin code

If Perplexity selectors are not stable enough for complete automation in the
first pass, add the provider metadata and a conservative adapter that detects
login and returns a clear unavailable or incomplete-provider message. Prefer a
safe partial adapter over brittle hidden assumptions.

## Testing Plan

Add or update unit tests:

- Provider registry discovers ChatGPT and Gemini.
- Provider registry rejects duplicate ids.
- Provider registry rejects duplicate aliases.
- Provider registry omits disabled providers.
- Provider registry rejects adapters missing required functions.
- `browser_use_status` returns safe provider catalog metadata.
- `BrowserSessionManager` calls adapter hooks rather than provider-specific
  branches.
- Existing session reuse still keys by user and provider.
- Same-user/same-provider concurrent run-task calls serialize and return one
  shared session.
- Terminal session states close browser resources before a new launch for the
  same profile.
- `session_reused` survives the direct service response, MCP tool response,
  relay response, and launcher text.
- Launcher explicit `provider` input wins.
- Launcher matches provider aliases from `browser_use_status`.
- Launcher falls back to the default provider.
- Launcher preserves `origin.publicBaseUrl` precedence when making full viewer
  URLs, even when container router env points at `host.containers.internal`.
- Relay still has one `browser-use` backend and no tags field.
- Adding a fixture provider folder is enough for discovery.

Run:

```bash
node --test tests/unit/browser-use-provider.test.mjs tests/unit/launcher-browser-use.test.mjs tests/unit/provider-task.test.mjs
node scripts/validate-manifests.mjs
git diff --check
```

If implementation touches docs/spec sync checks or broader provider catalog
tests, also run:

```bash
node --test tests/unit/*.test.mjs
```

If any change touches same-origin WebChat envelope propagation or AchillesCLI
origin normalization, also run the relevant cross-repository tests from the
handoff:

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/webchatEnvelope.test.mjs tests/unit/httpServiceInvocation.test.mjs
git diff --check

cd /Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI
node --test tests/webchatEnvelope.test.mjs tests/webchatReferences.test.mjs tests/copilotRouter.test.mjs tests/copilotRouter.integration.test.mjs
git diff --check
```

## Manual Smoke Plan

1. Start the workspace with the `research-agents` bundle enabled.
2. Call `browser_use_status` and confirm provider catalog output.
3. Submit a ChatGPT browser-use prompt.
4. Submit a Gemini browser-use prompt.
5. Submit a Perplexity browser-use prompt.
6. Confirm protected viewer URLs are still under `/services/browser-use/...`.
7. Open WebChat with `forward-envelope=1` on the same host expected for viewer
   access, for example `http://127.0.0.1:8080/...`, and confirm the assistant's
   viewer link uses that same origin rather than `localhost`.
8. Confirm opening the viewer does not redirect to `/auth/login` when the user
   is already authenticated in WebChat on that origin.
9. Confirm the `browser_use_run_task` origin received by the agent includes the
   safe `publicBaseUrl` value when launched from WebChat.
10. Submit two same-user/same-provider prompts close together and confirm they
   reuse one session/profile instead of launching two Chromium contexts.
11. Confirm login state remains isolated by authenticated user and provider.
12. Confirm no provider-specific behavior appears in Ploinky core, WebChat, or
   Explorer.

## Rollout Notes

- Keep existing ChatGPT and Gemini behavior as compatible as possible.
- Introduce the registry in a way that defaults to ChatGPT when older callers do
  not pass a provider.
- Keep result JSON shape backward compatible for relay and launcher tests.
- Treat existing uncommitted source changes as user-owned context. Inspect
  `git status` before editing and do not revert unrelated work.
- Do not implement from the live shadow checkout under
  `/Users/danielsava/work/testExplorerFresh/.ploinky/repos`; use it only to
  reproduce or verify the live workflow after source changes are installed.
- Avoid large unrelated cleanup while moving provider-specific selectors into
  adapter modules.

## Risks

- Provider UIs change frequently. Adapters should fail with clear bounded
  messages rather than leaking DOM dumps or internal traces.
- Selector duplication can creep back into the session manager. Tests should
  guard against provider-id branches in core logic.
- Dynamic module loading can become unsafe if it accepts arbitrary paths. Keep
  provider discovery inside the agent-owned packaged provider directory.
- Perplexity may require login, rate limits, or bot checks. Treat that as a
  normal interactive provider flow through the protected viewer.
- URL-origin regressions can look like provider login failures. If the viewer
  unexpectedly asks for router login, first verify that the rendered viewer URL
  uses the same origin as the WebChat tab and that `origin.publicBaseUrl` reached
  `launch-browser-use`.
- Provider extraction can accidentally weaken profile locking. Keep concurrency
  tests focused on same-user/same-provider launches while moving browser launch
  and navigation logic.
```
