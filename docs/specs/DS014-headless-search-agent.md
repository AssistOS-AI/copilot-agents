---
id: DS014
title: Web Search Provider Agent
status: implemented
owner: copilot-agents-team
summary: Defines the cacheable web-search provider agent backed by its own local headless browser runtime.
---

# DS014 - Web Search Provider Agent

## Introduction

The `webSearchAgent` is a self-contained provider agent that executes
cacheable web searches with an agent-owned local headless browser pool. It
follows the provider agent pattern established by `openInterpreterAgent`: the
relay forwards tasks, while the provider owns runtime setup, execution, and
result normalization.

## Core Content

The agent must be a Ploinky MCP provider agent with a local loopback browser
service started by the agent process before the default `AgentServer`. The
MCP tools remain command tools, but search execution runs through the local
service so browser state, browser slots, and cleanup are owned by the
long-lived `webSearchAgent` process rather than by one-shot tool commands.

The agent must not know about, configure, or call external LLM/search gateways.
It must not use `SOUL_GATEWAY_URL`, `SOUL_GATEWAY_API_KEY`,
`achillesAgentLib.callSearch()`, or an OpenAI-compatible
`/v1/chat/completions` endpoint for web search. The only outbound search
traffic is the browser navigation performed by the local headless browser
runtime.

The agent must expose:

- `web_search_status`: reports readiness, local browser-pool state,
  cacheability, TTL, and any configuration issue.
- `web_search_run_task`: accepts `{ prompt, query, timeoutMs, origin }`,
  requires a router invocation token, executes search through the local
  headless browser service, and returns normalized JSON with `final_answer`,
  `sources`, `cacheable`, and `ttl_hint_seconds`.

The local browser runtime must preserve the tested headless-search patterns:

- lazy Puppeteer import from the Ploinky-managed `/code/node_modules`
  dependency tree, with `puppeteer` preferred unless an explicit browser
  executable path is configured;
- a `webSearchAgent/package.json` dependency on Puppeteer that matches the
  pinned `ghcr.io/puppeteer/puppeteer` browser image version;
- config-gated browser pool controlled by `BROWSER_POOL_SIZE`;
- isolated browser contexts per request;
- user-agent rotation;
- abort handling and context cleanup;
- idle browser shutdown;
- explicit CAPTCHA, timeout, missing-Chromium, and disconnected-browser
  classification;
- normalized markdown answer plus structured citation sources.

The provider result must not include secrets, invocation tokens, hidden
reasoning, raw private prompts, browser cookies, raw upstream HTML, or
sensitive file contents. User-facing failure messages must be sanitized and
must not include raw exception text unless a separate debug-only surface is
explicitly added.

The `web-search` backend entry in `researchRelay` declares:

- `cacheable: true`
- `ttl_hint_seconds: 86400`
- `provider: { agent: 'webSearchAgent', tool: 'web_search_run_task' }`

The relay must preserve provider `sources`, `cacheable`, and
`ttl_hint_seconds` metadata so AchillesCLI can make AKU cache decisions from
the launcher result.

The `launch-web-search` cskill is the deterministic AchillesCLI launcher. It
validates relay and provider availability, submits through
`researchRelay.research_task_submit`, and returns structured output with:

- `backend: 'web-search'`
- `cacheable: true`
- `persistence_hint.ku_type: 'agent.result.web-search'`
- `persistence_hint.ttl_hint_seconds: 86400`

Deprecated tokens such as `@web-search` and `@search` are ordinary chat text
and must not trigger provider dispatch. Web search is selected semantically
through AchillesCLI's `copilot-router`.

## Configuration

The agent supports these environment variables:

- `WEB_SEARCH_SERVICE_HOST` (optional): loopback host for the private local
  browser service; defaults to `127.0.0.1`.
- `WEB_SEARCH_SERVICE_PORT` (optional): loopback port for the private local
  browser service; defaults to `47731`.
- `WEB_SEARCH_SERVICE_URL` (optional): explicit local service URL override.
- `WEB_SEARCH_TIMEOUT_MS` (optional): search timeout; defaults to 60000,
  clamped to 1000-90000.
- `WEB_SEARCH_DEBUG_SCREENSHOTS` (optional): debug-only screenshot capture
  under `/data/screenshots`.
- `BROWSER_POOL_SIZE` (optional): local browser pool size; defaults to 1. A
  value of 0 disables search and returns a clear unavailable message.
- `BROWSER_EXECUTABLE_PATH` (optional): Chrome/Chromium executable override.
- `BROWSER_HEADLESS_MODE` (optional): headless mode; defaults to `new`.
- `BROWSER_PROXY_URL` (optional): browser proxy server.
- `BROWSER_USER_DATA_DIR` (optional): browser user-data directory.
- `BROWSER_MIN_REQUEST_INTERVAL_MS` (optional): minimum delay before browser
  navigation; defaults to 2000.

## Decisions & Questions

### Question #1: Why must the search agent own its own browser runtime?

Response:
`webSearchAgent` is a provider agent, and provider agents own provider-specific
runtime setup and execution. Keeping browser search self-contained prevents the
agent from depending on an external search gateway, keeps the relay boundary
generic, and gives operators one local provider runtime to inspect, configure,
and disable.

### Question #2: Why keep a local service instead of launching a browser in each MCP command?

Response:
MCP command tools are short-lived processes. Browser automation needs a
long-lived owner for pooling, isolated context cleanup, idle shutdown, and
readiness reporting. The service is bound to loopback inside the agent
container and is not a public Ploinky HTTP surface.

### Question #3: Why is web search cacheable but Open Interpreter is not?

Response:
Web search returns factual information with a known staleness window. The same
query within 24 hours can safely return a cached answer. Open Interpreter
performs execution with side effects; caching would hide changed state.

### Question #4: Why require a router invocation token?

Response:
The token mirrors the security contract of `open_interpreter_run_task`. It
ensures the caller has a valid Ploinky session and prevents unauthorized tool
invocation.

### Question #5: Why declare Puppeteer in `webSearchAgent/package.json`?

Response:
Ploinky installs agent npm dependencies into a prepared read-only
`/code/node_modules` cache before starting the container. Declaring Puppeteer
there keeps `webSearchAgent` aligned with normal Ploinky dependency staging and
avoids relying on modules installed under the browser image user's home
directory. The browser image is pinned to the same Puppeteer version so the
runtime package and bundled browser stay in sync.

## Conclusion

The `webSearchAgent` provides cacheable web search through its own local
headless browser runtime. It is enabled by the `research-agents` bundle,
dispatched through `researchRelay`, and launched semantically by
AchillesCLI's `launch-web-search` cskill.
