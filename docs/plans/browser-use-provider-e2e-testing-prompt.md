# Browser Use Provider E2E Testing Prompt

You are working in `/Users/danielsava/work/file-parser`.

Task: run an end-to-end test pass for the browser-use provider adapter
implementation and report high-signal results. Use
`copilot-agents/docs/plans/browser-use-provider-e2e-testing-plan.md` as the
execution plan.

## Ground Rules

1. Read the workspace and repo instructions before touching anything:
   - `/Users/danielsava/work/file-parser/CLAUDE.md`
   - `/Users/danielsava/work/file-parser/copilot-agents/CLAUDE.md`
   - `/Users/danielsava/work/file-parser/ploinky/CLAUDE.md`
   - `/Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI/CLAUDE.md`
2. Read the browser-use source contracts:
   - `copilot-agents/docs/specs/DS014-browser-use-agent.md`
   - `copilot-agents/docs/browser-use-testing-handoff-2026-05-21.md`
   - `copilot-agents/docs/plans/browser-use-provider-adapters-implementation-plan.md`
   - `copilot-agents/docs/plans/browser-use-provider-e2e-testing-plan.md`
3. Source repos under `/Users/danielsava/work/file-parser` are canonical.
   Do not treat `.ploinky/repos/` shadow checkouts as source.
4. Do not commit unless explicitly asked.
5. Do not write credentials, cookies, OAuth callback URLs, auth codes,
   invocation JWTs, screenshots, DOM dumps, or full provider transcripts to
   tracked files.
6. Keep temporary outputs under `/tmp/browser-use-e2e-*`.
7. If login, OAuth, 2FA, or CAPTCHA appears, ask the human to complete it in the
   protected viewer. Do not script credential entry.
8. If you make a code fix, keep it tightly scoped, update affected specs/tests
   when behavior changes, rerun the relevant validation, and clearly separate
   the fix from the e2e results.

## What To Test

Validate this path:

```text
WebChat / AchillesCLI semantic copilot routing
  -> launch-browser-use
  -> copilotProviderRelay.copilot_provider_task_submit
  -> browserUseAgent.browser_use_run_task
  -> provider registry and adapter
  -> protected /services/browser-use/... viewer
  -> user-ready continuation
```

Also use direct browser-use service calls for focused diagnosis:

- `GET /status`
- `POST /browser-use/run-task`
- `GET /browser-use/task-status`
- `POST /browser-use/continue-task`
- `POST /browser-use/close-session`
- `GET /browser-use/sessions/:id`
- `POST /browser-use/sessions/:id/user-ready`

## Required Checks

Run static validation first:

```sh
cd /Users/danielsava/work/file-parser/copilot-agents
node --test tests/unit/*.test.mjs
node scripts/validate-manifests.mjs
git diff --check

cd /Users/danielsava/work/file-parser/ploinky
node --test tests/unit/*.test.mjs
git diff --check

cd /Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI
node --test tests/*.test.mjs
git diff --check
```

Then use or create a local Ploinky workspace with these enabled:

- `achilles-cli`
- `research-agents`
- `copilotProviderRelay`
- `browserUseAgent`
- `openInterpreterAgent`
- `webSearchAgent`

Verify:

1. Router health returns healthy.
2. Browser-use `/status` returns `ok: true`, `viewerTransport: "http-sse"`,
   and a safe provider catalog containing `chatgpt`, `gemini`, and
   `perplexity`.
3. Unknown provider requests return a safe unsupported-provider error.
4. Direct `run-task` works or reaches `waiting_for_user` for:
   - ChatGPT
   - Gemini
   - Perplexity
5. If waiting for user, open the router viewer URL, let the human log in, use
   the viewer ready flow, and confirm the saved prompt continues in the same
   session.
6. Concurrent same-user/same-provider direct runs return the same `sessionId`
   and at least one `session_reused: true`.
7. Viewer route ownership is enforced:
   - missing auth -> 401
   - wrong user -> 403
   - owner -> viewer HTML
8. WebChat prompts route through the launcher and relay with provider as an
   argument, not as separate backend ids.
9. Launcher output shows a full browser-visible viewer URL.
10. Literal `@browser-use` text does not trigger dispatch by itself.
11. Sessions close cleanly and active session count returns to zero.
12. Logs contain no secrets, cookies, localStorage/sessionStorage, OAuth
    callback URLs, authorization codes, raw auth headers, invocation JWTs,
    screenshots, DOM dumps, or full provider transcripts.

Use exact-token prompts, for example:

```text
Reply with exactly BROWSER_USE_E2E_CHATGPT_<timestamp> and nothing else.
Reply with exactly BROWSER_USE_E2E_GEMINI_<timestamp> and nothing else.
Reply with exactly BROWSER_USE_E2E_PERPLEXITY_<timestamp> and nothing else.
```

## Important Expected Behavior

- There is one relay backend: `browser-use`.
- ChatGPT, Gemini, and Perplexity are browser-use subproviders selected through
  the provider catalog.
- Explicit provider input wins over prompt alias matching.
- Prompt aliases come from `browser_use_status.providers`.
- If no provider is explicit or matched, the catalog default is used.
- The session manager must not branch on provider ids for prompt submission.
- Same authenticated user and provider can have only one non-terminal Chromium
  context.
- User-ready continuation must use the original saved prompt and timeout.
- Public launcher text must use the WebChat/router-visible URL, not a
  container-internal URL.

## Failure Handling

Classify each failure as one of:

- implementation bug
- provider UI selector drift
- environment/setup issue
- authentication/manual-login blocker
- known proof-adapter limitation

For Perplexity, selector drift or empty extraction may be acceptable as a
proof-adapter followup if registry, routing, viewer auth, and session lifecycle
all work.

If a profile is wedged, do not clear profile state without explicit human
approval. If approval is given, call `browser-use/close-session` with
`clearProfile: true` for that provider and user.

## Final Response Format

Return a concise e2e report with:

- source commit/branch for each repo touched or tested
- test workspace and router URL
- validation commands and pass/fail results
- provider catalog contents
- direct provider run results
- session reuse result
- viewer auth result
- WebChat/launcher result
- cleanup status
- log hygiene result
- exact failures and followups

Do not include secrets, screenshots, DOM dumps, auth callback URLs, cookies,
tokens, or full provider transcripts in the report.
