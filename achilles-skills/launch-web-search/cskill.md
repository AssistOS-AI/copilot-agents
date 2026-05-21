# Launch Web Search

Dispatch a cacheable web-search task through
`copilotProviderRelay.copilot_provider_task_submit`.

## Backend
web-search

## Cacheable
true

## RequiresInvocationToken
true

## Input Format
Accepts a JSON object or plain prompt text.

- **prompt** (string): natural-language search query.
- **workingDir** (string, optional): current working directory.
- **origin** (optional): safe Copilot context.

In normal WebChat use, AchillesCLI provides `context.invocationToken` and safe
materialized context.

## Output Format
Returns a structured launcher result with `ok`, `backend`, `cacheable`,
`result_text`, `persistence_hint`, and `diagnostics`.

## Constraints
- Never call `webSearchAgent` directly.
- Always dispatch through `copilotProviderRelay.copilot_provider_task_submit`.
- `@web-search` or `@search` is ordinary chat text and must not trigger dispatch.
