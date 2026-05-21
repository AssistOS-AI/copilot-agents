# Launch Open Interpreter

Dispatch an execution-oriented Copilot task to Open Interpreter through
`copilotProviderRelay.copilot_provider_task_submit`.

## Backend
open-interpreter

## Cacheable
false

## RequiresInvocationToken
true

## Input Format
Accepts a JSON object or plain prompt text.

- **prompt** (string): natural-language execution task.
- **workingDir** (string, optional): current working directory.
- **resources**, **paths**, **origin** (optional): safe Copilot context.

In normal WebChat use, AchillesCLI provides `context.invocationToken` and safe
materialized context.

## Output Format
Returns a structured launcher result with `ok`, `backend`, `cacheable`,
`result_text`, `persistence_hint`, and `diagnostics`.

## Constraints
- Never call `openInterpreterAgent` directly.
- Always dispatch through `copilotProviderRelay.copilot_provider_task_submit`.
- `@open-interpreter` is ordinary chat text and must not trigger provider dispatch.
