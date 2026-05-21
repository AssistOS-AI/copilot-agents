# Launch Browser Use

Dispatch an interactive browser task through
`copilotProviderRelay.copilot_provider_task_submit`.

## Backend
browser-use

## Cacheable
false

## RequiresInvocationToken
true

## Input Format
Accepts a JSON object or plain prompt text.

- **prompt** (string): natural-language task for the logged-in web application.
- **provider** (string, optional): browser provider id. Defaults to `chatgpt`;
  prompts mentioning Gemini infer `gemini`.
- **workingDir** (string, optional): current working directory.
- **origin** (optional): safe Copilot context.

In normal WebChat use, AchillesCLI provides `context.invocationToken` and safe
materialized context.

## Output Format
Returns a structured launcher result with `ok`, `backend`, `cacheable`,
`result_text`, `persistence_hint`, and `diagnostics`.

When user login is required, the result includes `viewerUrl`, `sessionId`,
`jobId`, and `requires_user_action: true`. The caller should present the viewer
URL to the user and wait for the task to complete.

## Constraints
- Never call `browserUseAgent` directly for task execution.
- Always dispatch through `copilotProviderRelay.copilot_provider_task_submit`.
- `@browser-use` is ordinary chat text and must not trigger dispatch.
