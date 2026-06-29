# DuckDuckGo Search

Search DuckDuckGo Instant Answer API for a query and return a text summary of
the sources that were found.

## Input Format
Accepts plain text as the search query.

The input may also be JSON:

```json
{
  "query": "Albert Einstein",
  "maxResults": 5
}
```

`query` is required. `maxResults` is optional and is clamped between 1 and 10.

## Output Format
Returns plain text containing the provider name, query, result count, and each
result's title, URL, and snippet.

If DuckDuckGo returns no usable sources, the skill returns a clear no-results
message instead of throwing.

## Constraints
Use DuckDuckGo Instant Answer API only. Do not require API keys, npm
dependencies, or workspace settings. This is not a full web search API; it is a
zero-config best-effort source discovery tool.
