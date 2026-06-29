import { SEARCH_TIMEOUT_MS, searchDuckDuckGo } from '../../../scripts/lib/search-providers.mjs';

const DEFAULT_MAX_RESULTS = 5;
const MIN_MAX_RESULTS = 1;
const MAX_MAX_RESULTS = 10;

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function clampInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(number)));
}

export function parseInput(args = {}) {
    const raw = typeof args.promptText === 'string'
        ? args.promptText
        : typeof args.query === 'string'
            ? args.query
            : '';
    const text = trim(raw);
    if (!text) {
        return { query: '', maxResults: DEFAULT_MAX_RESULTS };
    }
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return {
                query: trim(parsed.query || parsed.prompt || parsed.q),
                maxResults: clampInteger(parsed.maxResults, DEFAULT_MAX_RESULTS, MIN_MAX_RESULTS, MAX_MAX_RESULTS),
            };
        }
    } catch {
    }
    return {
        query: text,
        maxResults: DEFAULT_MAX_RESULTS,
    };
}

export function formatDuckDuckGoResult(result, query) {
    const sources = Array.isArray(result?.sources) ? result.sources : [];
    const lines = [
        'Provider: DuckDuckGo Instant Answer',
        `Query: ${query}`,
        `Results: ${sources.length}`,
        '',
    ];

    if (!sources.length) {
        lines.push('No DuckDuckGo Instant Answer sources were found for this query.');
        return lines.join('\n').trim();
    }

    sources.forEach((source, index) => {
        lines.push(`${index + 1}. ${source.title || source.url}`);
        lines.push(`URL: ${source.url}`);
        if (source.snippet) {
            lines.push(`Snippet: ${source.snippet}`);
        }
        lines.push('');
    });

    return lines.join('\n').trim();
}

export async function action(args = {}) {
    const { query, maxResults } = parseInput(args);
    if (!query) {
        return 'DuckDuckGo search needs a query.';
    }

    try {
        const result = await searchDuckDuckGo(query, {
            maxResults,
            timeoutMs: SEARCH_TIMEOUT_MS,
        });
        return formatDuckDuckGoResult(result, query);
    } catch (error) {
        return [
            'Provider: DuckDuckGo Instant Answer',
            `Query: ${query}`,
            'Results: 0',
            '',
            `DuckDuckGo search failed: ${error?.message || 'request failed'}`,
        ].join('\n');
    }
}

export default action;
