# Implementation Prompt: Self-Contained Headless Web Search Agent

You are working in:

```text
/Users/danielsava/work/file-parser
```

Read the workspace instructions first:

```text
/Users/danielsava/work/file-parser/CLAUDE.md
/Users/danielsava/work/file-parser/copilot-agents/CLAUDE.md
```

Then implement the plan in:

```text
/Users/danielsava/work/file-parser/copilot-agents/docs/plans/headless-search-agent-implementation-plan.md
```

Goal: add or maintain `webSearchAgent` as a self-contained provider inside
`copilot-agents`. It must own local headless browser search execution and must
not configure or call an external search gateway.

Important constraints:

- Do not restore visible `@agent` dispatch.
- Ploinky WebChat must stay transport-only.
- AchillesCLI owns semantic routing and AKU result-cache policy.
- `researchRelay` remains the secure dispatcher.
- Provider agents own provider-specific setup and execution.
- `webSearchAgent` must not use external search gateway URLs, gateway API keys,
  `achillesAgentLib.callSearch()`, or OpenAI-compatible chat-completions
  endpoints for search.
- Keep edits scoped to `copilot-agents` unless the plan explicitly calls for a
  follow-up mirror into AchillesCLI.

Implementation shape:

1. Keep `webSearchAgent/` as the provider agent with manifest, MCP config,
   status tool, task tool, and local browser service.
2. Start the local browser service from the agent process before AgentServer.
3. Implement browser-pool and result-converter modules based on the reference
   headless-browser patterns.
4. Keep `researchRelay` generic while preserving search `sources`,
   `cacheable`, and `ttl_hint_seconds` metadata.
5. Keep `launch-web-search` as the deterministic cacheable launcher cskill.
6. Update validation, specs, docs, and smoke docs when behavior changes.
7. Add focused tests for provider config, browser helpers, relay metadata,
   launcher cacheability, and manifest validation.

Verification:

```sh
cd /Users/danielsava/work/file-parser/copilot-agents
node --test tests/unit/*.test.mjs
node scripts/validate-manifests.mjs
```

Report exactly what files changed, what tests ran, and any follow-up needed in
AchillesCLI for router wiring or AKU result-cache integration.
