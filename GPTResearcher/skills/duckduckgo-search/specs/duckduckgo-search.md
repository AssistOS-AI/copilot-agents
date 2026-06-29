# DuckDuckGo Search C-Skill

## Core Content

`duckduckgo-search` is a GPTResearcher C-Skill that performs one query against
DuckDuckGo Instant Answer API and returns a plain-text summary suitable for an
LLM agent.

The skill accepts plain text or JSON. JSON input may include `query` and
`maxResults`. `maxResults` defaults to 5 and is clamped from 1 to 10.

The runtime delegates the HTTP call and result normalization to
`GPTResearcher/scripts/lib/search-providers.mjs`. Output is intentionally text,
not JSON, because `MainAgent` exposes C-Skills as text-returning tools in loop
sessions.

DuckDuckGo may return a valid response with zero sources or an empty body for
some query shapes. The skill must return a no-results message with the provider
and query rather than throwing an unhandled parse error.

## Decisions & Questions

1. DuckDuckGo is zero-config and requires no API key.
2. This skill does not read `gpt-researcher-settings.json`.
3. Full web search providers will be added as separate skills later.
