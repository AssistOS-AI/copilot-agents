---
title: DS013-headless-search-agent
summary: Defines the cacheable web-search provider agent backed by its own local headless browser runtime.
---

# DS013 - Web Search Provider Agent

## Introduction

The [`webSearchAgent`](wiki.html#definition-web-search) is a self-contained provider agent that executes cacheable web searches with an agent-owned local headless browser pool. It follows the provider agent pattern established by [`openInterpreterAgent`](wiki.html#definition-open-interpreter): the relay forwards tasks, while the provider owns runtime setup, execution, and result normalization.

## Core Content

The agent must be a Ploinky MCP provider agent with a local loopback browser service started by the agent process before the default `AgentServer`. The MCP tools remain command tools, but search execution runs through the local service so browser state, browser slots, and cleanup are owned by the long-lived [`webSearchAgent`](wiki.html#definition-web-search) process rather than by one-shot tool commands.

The agent must not know about, configure, or call external LLM/search gateways. It must not use `SOUL_GATEWAY_URL`, `PLOINKY_AGENT_API_KEY`, `achillesAgentLib.callSearch()`, or an OpenAI-compatible `/v1/chat/completions` endpoint for web search. The only outbound search traffic is the browser navigation performed by the local headless browser runtime.

The agent must expose:

- `web_search_status`: reports readiness, local browser-pool state, cacheability, TTL, and any configuration issue.
- `web_search_run_task`: accepts `{ prompt, query, timeoutMs, origin }`, requires a router invocation token, executes search through the local headless browser service, and returns normalized JSON with `final_answer`, `sources`, `cacheable`, and `ttl_hint_seconds`.

The local browser runtime must preserve the tested headless-search patterns:

- lazy Puppeteer import from the Ploinky-managed `/code/node_modules` dependency tree, with `puppeteer-core` preferred when an explicit browser executable path is configured;
- a [`webSearchAgent/package.json`](wiki.html#definition-web-search) dependency on `puppeteer-core` and a manifest install hook that installs Chromium into the agent container when the browser pool is enabled;
- config-gated browser pool controlled by `BROWSER_POOL_SIZE`;
- isolated browser contexts per request;
- user-agent rotation;
- abort handling and context cleanup;
- idle browser shutdown;
- explicit CAPTCHA, timeout, missing-Chromium, and disconnected-browser classification;
- normalized markdown answer plus structured citation sources.

The provider result must not include secrets, invocation tokens, hidden reasoning, raw private prompts, browser cookies, raw upstream HTML, or sensitive file contents. User-facing failure messages must be sanitized and must not include raw exception text unless a separate debug-only surface is explicitly added.

The `web-search` backend entry in [`copilotProviderRelay`](wiki.html#definition-copilot-provider-relay) declares:

- `cacheable: true`
- `ttl_hint_seconds: 86400`
- [`provider: { agent: 'webSearchAgent', tool: 'web_search_run_task' }`](wiki.html#definition-web-search)

The relay must preserve provider `sources`, `cacheable`, and `ttl_hint_seconds` metadata so AchillesCLI can make AKU cache decisions from the launcher result.

The `launch-web-search` cskill is the deterministic AchillesCLI launcher. It validates relay and provider availability, submits through [`copilotProviderRelay.copilot_provider_task_submit`](wiki.html#definition-copilot-provider-relay) using Ploinky's verified [`AgentMcpClient`](wiki.html#definition-agent-mcp-client), and returns structured output with:

- `backend: 'web-search'`
- `cacheable: true`
- `persistence_hint.ku_type: 'agent.result.web-search'`
- `persistence_hint.ttl_hint_seconds: 86400`

Deprecated tokens such as `@web-search` and `@search` are ordinary chat text and must not trigger provider dispatch. Web search is selected semantically through AchillesCLI's `copilot-router`.

### Configuration

The agent supports these environment variables:

- `WEB_SEARCH_SERVICE_HOST` (optional): loopback host for the private local browser service; defaults to `127.0.0.1`.
- `WEB_SEARCH_SERVICE_PORT` (optional): loopback port for the private local browser service; defaults to `47731`.
- `WEB_SEARCH_SERVICE_URL` (optional): explicit local service URL override.
- `WEB_SEARCH_TIMEOUT_MS` (optional): search timeout; defaults to 60000, clamped to 1000-90000.
- `WEB_SEARCH_DEBUG_SCREENSHOTS` (optional): debug-only screenshot capture under `/data/screenshots`.
- `BROWSER_POOL_SIZE` (optional): local browser pool size; defaults to 1. A value of 0 disables search and returns a clear unavailable message.
- `BROWSER_EXECUTABLE_PATH` (optional): Chrome/Chromium executable override. If unset, the start script auto-detects `chromium`, `chromium-browser`, or `google-chrome` after the install hook runs.
- `BROWSER_HEADLESS_MODE` (optional): headless mode; defaults to `new`.
- `BROWSER_PROXY_URL` (optional): browser proxy server.
- `BROWSER_USER_DATA_DIR` (optional): browser user-data directory.
- `BROWSER_MIN_REQUEST_INTERVAL_MS` (optional): minimum delay before browser navigation; defaults to 2000.

### Rationale

#### Rationale 1

[`webSearchAgent`](wiki.html#definition-web-search) is a provider agent, and provider agents own provider-specific runtime setup and execution. Keeping browser search self-contained prevents the agent from depending on an external search gateway, keeps the relay boundary generic, and gives operators one local provider runtime to inspect, configure, and disable.

#### Rationale 2

MCP command tools are short-lived processes. Browser automation needs a long-lived owner for pooling, isolated context cleanup, idle shutdown, and readiness reporting. The service is bound to loopback inside the agent container and is not a public Ploinky HTTP surface.

#### Rationale 3

Web search returns factual information with a known staleness window. The same query within 24 hours can safely return a cached answer. Open Interpreter performs execution with side effects; caching would hide changed state.

#### Rationale 4

The token mirrors the security contract of `open_interpreter_run_task`. It ensures the caller has a valid Ploinky session and prevents unauthorized tool invocation.

#### Rationale 5

Ploinky installs agent npm dependencies into a prepared read-only `/code/node_modules` cache before starting the container. Declaring `puppeteer-core` there keeps [`webSearchAgent`](wiki.html#definition-web-search) aligned with normal Ploinky dependency staging. The agent uses a Debian Node image plus a manifest install hook for Chromium, mirroring the Soul Gateway headless-browser deployment shape and avoiding reliance on image-user-local Node modules or amd64-only browser images in local arm64 deployments.

#### Rationale 6

On 2026-06-24, hosted provider credentials were standardized on `PLOINKY_AGENT_API_KEY`. [`webSearchAgent`](wiki.html#definition-web-search) remains a browser-search provider, so it must not depend on the router-issued provider credential or the Soul Gateway URL path.

#### Rationale 7

It uses Ploinky's [`AgentMcpClient`](wiki.html#definition-agent-mcp-client), which verifies the signed [Router](wiki.html#definition-router) descriptor before agent-secret or user-delegation-token access and before creating the [Router](wiki.html#definition-router) socket. The launcher does not construct a direct `/mcps/` request or retry a different authority after HTTP 421.


The [`webSearchAgent`](wiki.html#definition-web-search) provides cacheable web search through its own local headless browser runtime. It is enabled by the [`research-agents`](wiki.html#definition-research-agents) bundle, dispatched through [`copilotProviderRelay`](wiki.html#definition-copilot-provider-relay), and launched semantically by AchillesCLI's `launch-web-search` cskill.
