# Headless Search Agent Implementation Plan

Status: implemented in `copilot-agents`; AchillesCLI router and AKU cache
follow-ups remain outside this repository.

## Purpose

Implement `webSearchAgent` inside `copilot-agents` as a cacheable web-search
provider for AchillesCLI semantic Copilot routing. The agent must be
self-contained: it owns local headless browser execution and does not configure
or call an external search gateway.

The durable flow is:

```text
AchillesCLI copilot-router
  -> launch-web-search
  -> researchRelay.research_task_submit
  -> webSearchAgent.web_search_run_task
  -> webSearchAgent local headless browser service
```

## Reference Patterns

The implementation adapts the browser-runtime patterns from the existing
headless search reference:

- lazy Puppeteer import;
- config-gated browser pool;
- isolated browser contexts per request;
- user-agent rotation;
- abort handling and context cleanup;
- idle browser shutdown;
- CAPTCHA, timeout, missing-Chromium, and disconnected-browser classification;
- normalized markdown answer plus structured citations.

The reference implementation is only a source of patterns. `webSearchAgent`
must not delegate search execution to that service.

## Implemented Shape

`webSearchAgent` contains:

```text
webSearchAgent/
  manifest.json
  mcp-config.json
  scripts/startAgent.sh
  scripts/check-service.mjs
  server/headless-search-service.mjs
  tools/status.mjs
  tools/run-task.mjs
  tools/lib/browser-pool.mjs
  tools/lib/envelope.mjs
  tools/lib/headless-search-converter.mjs
  tools/lib/search-config.mjs
  tools/lib/search-executor.mjs
```

The agent manifest starts `scripts/startAgent.sh`, which starts the local
loopback browser service before handing off to the default AgentServer. MCP
tools talk to that local service; the service owns the browser pool.

## Runtime Contract

- `web_search_status` reports local service readiness, browser-pool state,
  cacheability, TTL, and sanitized configuration errors.
- `web_search_run_task` accepts `{ prompt, query, timeoutMs, origin }`,
  requires the router invocation token, and returns normalized JSON:

```json
{
  "ok": true,
  "backend_ok": true,
  "final_answer": "Markdown answer with citations",
  "natural_language_output": "Markdown answer with citations",
  "sources": [
    { "title": "Example", "url": "https://example.com" }
  ],
  "ttl_hint_seconds": 86400,
  "cacheable": true,
  "origin": {}
}
```

The provider result must not include secrets, invocation tokens, hidden
reasoning, raw private prompts, browser cookies, raw upstream HTML, or
sensitive file contents.

## Configuration

The agent supports:

- `WEB_SEARCH_SERVICE_HOST`
- `WEB_SEARCH_SERVICE_PORT`
- `WEB_SEARCH_SERVICE_URL`
- `WEB_SEARCH_TIMEOUT_MS`
- `WEB_SEARCH_DEBUG_SCREENSHOTS`
- `BROWSER_POOL_SIZE`
- `BROWSER_EXECUTABLE_PATH`
- `BROWSER_HEADLESS_MODE`
- `BROWSER_PROXY_URL`
- `BROWSER_USER_DATA_DIR`
- `BROWSER_MIN_REQUEST_INTERVAL_MS`

`BROWSER_POOL_SIZE=0` disables browser search and returns a clear unavailable
message. Debug screenshots, when enabled, must be written under `/data`, not to
tracked source.

## Relay And Launcher

`researchRelay` exposes `web-search` as a provider-backed backend:

```js
{
    id: 'web-search',
    tags: ['web-search'],
    label: 'Web Search',
    default_profile: 'default',
    provider: { agent: 'webSearchAgent', tool: 'web_search_run_task' },
    cacheable: true,
    ttl_hint_seconds: 86400,
}
```

The relay must preserve `sources`, `cacheable`, and `ttl_hint_seconds` in the
normalized provider result so the launcher can return AKU-ready metadata.

`launch-web-search` remains the deterministic AchillesCLI launcher. It
validates the relay catalog, probes provider status through router-mediated
MCP, submits through `researchRelay.research_task_submit`, and returns:

```json
{
  "backend": "web-search",
  "cacheable": true,
  "persistence_hint": {
    "ku_type": "agent.result.web-search",
    "record_result": true,
    "ttl_hint_seconds": 86400
  }
}
```

Deprecated tokens such as `@web-search` and `@search` remain ordinary chat
text. Web search is selected semantically by AchillesCLI.

## Follow-Up Boundary

This repository owns the compatibility launcher copy under
`copilot-agents/achilles-skills/`. AchillesCLI still needs the runtime
discoverable launcher copy, semantic router wiring, and AKU result-cache
lookup/persistence.

Required AchillesCLI follow-ups:

- Mirror `launch-web-search` into the AchillesCLI built-in skill root.
- Route prompts such as "search online for", "look up the latest", and "find
  recent articles about" to the launcher.
- Keep negative examples out of web search: memory search, workspace file
  search, and prompts that merely discuss search.
- Implement AKU cache lookup and persistence for
  `agent.result.web-search`.

## Verification

Run from `copilot-agents`:

```sh
node --test tests/unit/*.test.mjs
node scripts/validate-manifests.mjs
```

Manual smoke should confirm:

- `web_search_status` reports the local browser service state.
- A search prompt returns markdown with citations or a sanitized unavailable
  message.
- No external search gateway environment is required by `webSearchAgent`.
- No visible `@agent` dispatch is restored.
