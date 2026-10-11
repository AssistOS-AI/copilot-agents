---
title: DS003-main-behavior
summary: Defines explicit provider deployment, authenticated task forwarding, web search, interactive browsing and Open Interpreter refusal in a managed Box.
---

## Introduction

The provider suite lets authorized callers request web information, use a persistent browser or submit bounded execution tasks through Ploinky. The operator deploys the suite explicitly. The relay validates each task and forwards it to the provider that owns the selected runtime; it does not interpret chat or install provider software itself.

## Core Content

### Main Behavior Components

| Name | Explanation |
| --- | --- |
| Explicit provider deployment | An operator enables the [research-agents](wiki.html#definition-research-agents) bundle without adding these providers to Explorer's default dependencies. |
| Authenticated provider-task relay | An authorized caller submits a supported backend and bounded resources through one authenticated MCP contract. |
| Headless web search | A caller receives a search answer and citations from the provider's local headless browser. |
| Interactive browser sessions | A caller uses a persistent browser and an authenticated viewer when login or another human action is required. |
| Open Interpreter admission boundary | A managed Box request receives an explicit terminal refusal before Open Interpreter preparation or execution. |

### Explicit provider deployment

An operator starts the [research-agents](wiki.html#definition-research-agents) bundle through Ploinky. Its default, dev, qa and prod profiles enable [copilotProviderRelay](wiki.html#definition-copilot-provider-relay), [openInterpreterAgent](wiki.html#definition-open-interpreter), [webSearchAgent](wiki.html#definition-web-search), [browserUseAgent](wiki.html#definition-browser-use) and the AchillesCLI-owned [GPTResearcher](wiki.html#definition-gpt-researcher) worker. The provider children declare no-wait startup. Deployment does not imply every provider is ready or able to execute a task; callers must inspect provider results. The bundle must not enable a separate basic/bwrap-runner agent or become an Explorer default dependency. DS004 defines the bundle contract.

### Authenticated provider-task relay

An authorized caller invokes copilot_provider_task_submit with a backend id and prompt. [copilotProviderRelay](wiki.html#definition-copilot-provider-relay) must require the [Router](wiki.html#definition-router) invocation token, validate the supported backend and resource limits, confine workspace file reads, and forward the request through [AgentMcpClient](wiki.html#definition-agent-mcp-client) to the declared provider tool. The active ids are open-interpreter, web-search and browser-use. The relay returns normalized natural-language output, provider status, sources and applicable viewer metadata. It must not accept caller-provided mounts, credentials or sandbox flags. Provider agents own execution and private state. DS005 and DS011 define transport and security obligations.

### Headless web search

A web-search request reaches [webSearchAgent](wiki.html#definition-web-search), which uses its own headless browser service and returns an answer with citations. The backend advertises cacheable true and a TTL hint of 86400 seconds. The relay preserves that metadata; a consuming application owns cache lookup and storage. An unavailable browser service must produce a failure, not fabricated search results. DS013 defines provider configuration and results.

### Interactive browser sessions

A browser-use request reaches [browserUseAgent](wiki.html#definition-browser-use) with an optional provider selection. The provider owns persistent Chromium sessions and its provider adapter registry. When a session needs login, OAuth or another human action, the result identifies that requirement and exposes a protected viewer URL. A caller continues the provider session through the supported task tools. Interactive browser results must not be reused as cache hits. Cookies and browser state stay in provider-private storage. DS014 defines viewer authentication and session boundaries.

### Open Interpreter admission boundary

An open-interpreter request carrying generated-local Box descriptor signals must return PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE as a terminal refusal before runtime preparation. Operator OPEN_INTERPRETER_* values must not override that Box decision. Separate non-Box development configuration is a distinct path and does not certify managed Box execution. The immutable shared image establishes an image identity; native private-proc and provider certification remain prerequisites to removing the retained privilege allowance. DS006 defines this boundary.
