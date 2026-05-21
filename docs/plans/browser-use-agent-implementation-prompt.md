# Implementation Prompt: Interactive Browser Use Agent

You are working in:

```text
/Users/danielsava/work/file-parser
```

Read the workspace instructions first:

```text
/Users/danielsava/work/file-parser/CLAUDE.md
/Users/danielsava/work/file-parser/copilot-agents/CLAUDE.md
/Users/danielsava/work/file-parser/AssistOSExplorer/CLAUDE.md
/Users/danielsava/work/file-parser/ploinky/docs/specs/DS005-routing-and-web-surfaces.md
/Users/danielsava/work/file-parser/copilot-agents/docs/specs/DS002-ploinky-runtime-invariants.md
/Users/danielsava/work/file-parser/copilot-agents/docs/specs/DS011-security-observability.md
```

Then implement the plan in:

```text
/Users/danielsava/work/file-parser/copilot-agents/docs/plans/browser-use-agent-implementation-plan.md
```

Goal: implement a new provider agent named `browserUseAgent` that lets
AchillesCLI route logged-in browser tasks to an interactive browser session.
The agent must control Chromium and expose a protected viewer URL where the
authenticated user can complete OAuth, login, 2FA, or CAPTCHA flows. After
login, the agent must resume in the same browser context and submit the
original prompt to the target web app, initially ChatGPT.

Important constraints:

- Do not hardcode `browserUseAgent`, backend ids, or tool names into Ploinky
  WebChat or generic router dispatch logic.
- User-visible downstream service routes must be declared in `manifest.json`
  as `httpServices`.
- Request-time LLM access, if any, must go through `achillesAgentLib`; do not
  call vendor APIs directly.
- MCP calls between agents must go through the Ploinky router with invocation
  JWTs.
- Store durable browser profiles only under `.ploinky/data/browserUseAgent`.
- Never log credentials, cookies, localStorage, OAuth callback URLs,
  screenshots, DOM dumps, raw auth headers, or invocation tokens by default.
- Do not add AI or coding-agent attribution to commits, docs, comments,
  release notes, changelogs, or metadata.

Implementation target:

Create `copilot-agents/browserUseAgent` and integrate it with the existing
AchillesCLI -> `copilot-router` -> `launch-*` skill -> `copilotProviderRelay` ->
provider-agent pattern.

The relay contract is backend-id based. Do not add visible provider tags,
`@browser-use` aliases, or a `tags` field to backend catalog entries.

## Step 1: Scaffold `browserUseAgent`

Create:

```text
copilot-agents/browserUseAgent/manifest.json
copilot-agents/browserUseAgent/mcp-config.json
copilot-agents/browserUseAgent/package.json
copilot-agents/browserUseAgent/scripts/install.sh
copilot-agents/browserUseAgent/scripts/startAgent.sh
```

Manifest requirements:

- Use `node:24.15.0-bookworm` or `node:24.15.0-bookworm-slim` if all browser
  dependencies work.
- Add volume:

```json
{
  ".ploinky/data/browserUseAgent": "/data"
}
```

Also update:

```text
copilot-agents/research-agents/manifest.json
copilot-agents/scripts/validate-manifests.mjs
```

The `research-agents` bundle should enable:

```text
browserUseAgent global no-wait
```

The manifest validator must include `browserUseAgent` in its agent directory
list and should validate the protected `httpServices` shape if it does not
already.

- Add protected HTTP service:

```json
{
  "slug": "browser-use",
  "externalPrefix": "/services/browser-use/",
  "internalPrefix": "/browser-use/",
  "auth": "protected",
  "notFoundMessage": "Browser-use route not found."
}
```

## Step 2: Implement The Agent HTTP/MCP Server

Implement a single Node server for:

- `/health`
- `/mcp`
- `/browser-use/*`

Do not rely on the default Ploinky `AgentServer` alone, because it only handles
`/health`, `/getTaskStatus`, and `/mcp`. Reuse the existing MCP server patterns
from `ploinky/Agent/server/AgentServer.mjs` where practical.

For protected HTTP service requests, parse `x-ploinky-auth-info` only for
session ownership and isolation. Do not trust arbitrary caller-supplied identity
outside the router-proxied service path.

## Step 3: Implement Browser Session Lifecycle

Add:

```text
copilot-agents/browserUseAgent/server/browser-session-manager.mjs
```

Use Playwright or Puppeteer with Chromium. Run Chromium with a persistent user
data directory:

```text
/data/profiles/<safeUserId>/<provider>/
```

Initial provider target: `chatgpt`.

Track:

- `sessionId`
- `ownerUserId`
- `provider`
- `state`
- `viewerUrl`
- `pageUrl`
- `createdAt`
- `updatedAt`
- `jobId`

Supported states:

- `starting`
- `ready`
- `waiting_for_user`
- `running`
- `completed`
- `failed`
- `closed`

Add cleanup for expired or closed sessions. Add explicit close and clear-session
support.

## Step 4: Implement The Viewer

Choose one approach.

Preferred approach:

- Use Xvfb + Chromium + x11vnc + noVNC/websockify.
- Serve noVNC behind the protected Ploinky service path
  `/services/browser-use/sessions/:id`.
- If needed, add generic WebSocket upgrade proxy support for manifest-declared
  Ploinky `httpServices`.
- Do not add `browserUseAgent`-specific router logic.
- Update `ploinky/docs/specs/DS005-routing-and-web-surfaces.md` and targeted
  router tests if WebSocket proxying is added.

Fallback MVP:

- Implement a normal HTTP viewer.
- `GET /browser-use/sessions/:id` returns HTML.
- `GET /browser-use/sessions/:id/events` streams state and screenshots through
  SSE or long-polling.
- `POST /browser-use/sessions/:id/input` sends click, type, key, and scroll
  events to the browser automation layer.
- `POST /browser-use/sessions/:id/user-ready` marks login complete.

## Step 5: Implement MCP Tools

Add these tools in `mcp-config.json`:

- `browser_use_status`
- `browser_use_run_task`
- `browser_use_task_status`
- `browser_use_continue_task`
- `browser_use_close_session`

`browser_use_run_task` input:

```json
{
  "prompt": "string",
  "provider": "chatgpt",
  "timeoutMs": 120000,
  "origin": {}
}
```

Behavior:

1. Create or reuse a browser profile for the authenticated user and provider.
2. Navigate to `https://chatgpt.com`.
3. Detect whether login is required.
4. If login is required, return:

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

5. After `user-ready` or logged-in state detection, submit the prompt to
   ChatGPT.
6. Extract the final visible answer text and return:

```json
{
  "ok": true,
  "state": "completed",
  "final_answer": "...",
  "natural_language_output": "...",
  "resources": [],
  "sources": []
}
```

## Step 6: Integrate `copilotProviderRelay`

Update:

```text
copilot-agents/copilotProviderRelay/tools/lib/backends.mjs
```

Add:

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

Do not add `tags` to this catalog entry. `copilotProviderRelay` should accept
the literal backend id `browser-use`.

Update `publicBackendView` and relay result normalization so interactive
provider results preserve:

- `state`
- `jobId`
- `sessionId`
- `viewerUrl`
- `requires_user_action`
- `interactive`

Add or update unit tests.

## Step 7: Add Achilles Launcher

Create:

```text
copilot-agents/achilles-skills/launch-browser-use/
```

Model it after:

```text
copilot-agents/achilles-skills/launch-web-search/
```

The launcher must:

1. Normalize `prompt`, `origin`, `context`, and `invocationToken`.
2. Require `invocationToken`.
3. Check `copilotProviderRelay` backend availability.
4. Probe `browserUseAgent.browser_use_status`.
5. Call `copilotProviderRelay.copilot_provider_task_submit`.
6. Return viewer URL and waiting instructions if state is `waiting_for_user`.
7. Return final answer if state is `completed`.

Add tests similar to the launcher web-search tests.

## Step 8: Update AchillesCLI `copilot-router`

Update:

```text
AssistOSExplorer/AchillesCLI/achilles-cli/src/skills/copilot-router/oskill.md
```

Add `launch-browser-use` as an allowed launcher. Route logged-in web-app tasks
to it, including prompts such as:

- "Use ChatGPT to..."
- "Ask Gemini..."
- "Open the site and log in..."
- "Use my account to..."
- OAuth-gated browser workflows.

Keep `@word` tokens ordinary chat text. Do not reintroduce provider mention
dispatch.

## Step 9: Documentation And Specs

Add:

```text
copilot-agents/docs/specs/DS014-browser-use-agent.md
```

Keep DS numbering contiguous. Update:

```text
copilot-agents/docs/specs/matrix.md
copilot-agents/docs/index.html
copilot-agents/docs/specs/DS002-ploinky-runtime-invariants.md
copilot-agents/docs/specs/DS003-agent-inventory.md
copilot-agents/docs/specs/DS004-research-agents-bundle.md
copilot-agents/docs/specs/DS005-copilot-provider-relay-agent.md
copilot-agents/docs/specs/DS011-security-observability.md
copilot-agents/docs/specs/DS012-semantic-copilot-routing.md
```

If Ploinky router WebSocket support is added, update:

```text
ploinky/docs/specs/DS005-routing-and-web-surfaces.md
```

and add targeted router tests for generic manifest-declared HTTP service
WebSocket upgrades.

## Step 10: Validation

Run:

```sh
cd /Users/danielsava/work/file-parser/copilot-agents
node scripts/validate-manifests.mjs
node --test tests/unit/*.test.mjs
```

If router code changes, also run targeted Ploinky router tests or the narrowest
available smoke path.

Acceptance criteria:

- AchillesCLI can route a logged-in web-app prompt to `launch-browser-use`.
- `browserUseAgent` returns a protected viewer URL when login is required.
- `copilotProviderRelay` exposes backend id `browser-use` without a `tags`
  field.
- The user can open the viewer, log in, and signal Continue.
- The agent resumes in the same browser session and submits the original prompt.
- Browser cookies persist per authenticated user and provider under `/data`.
- Credentials, cookies, screenshots, DOM dumps, and auth tokens are not logged
  by default.
- Ploinky WebChat and generic router code remain provider-agnostic.

Report exactly what files changed, what tests ran, and any remaining follow-up.
