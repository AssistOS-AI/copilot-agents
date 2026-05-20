import { clampTimeout, resolveSearchConfig } from './search-config.mjs';

const MAX_QUERY_CHARS = 4000;

export function normalizeSearchInput(input = {}) {
    const query = String(input.query || input.prompt || '').trim();
    if (!query) {
        return { error: 'A search query is required.' };
    }
    if (query.length > MAX_QUERY_CHARS) {
        return { error: `Search query exceeds ${MAX_QUERY_CHARS} characters.` };
    }
    const timeoutMs = clampTimeout(input.timeoutMs);
    const origin = input.origin && typeof input.origin === 'object' ? input.origin : {};
    return { query, timeoutMs, origin };
}

export async function executeSearch(input, env = process.env) {
    const config = resolveSearchConfig(env);
    if (!config.configured) {
        return {
            ok: true,
            backend_ok: false,
            final_answer: `Web search is not available: ${config.reason}`,
            natural_language_output: `Web search is not available: ${config.reason}`,
            sources: [],
            ttl_hint_seconds: config.ttlSeconds,
            cacheable: false,
            origin: input.origin,
            diagnostics: { error_type: 'configuration' },
        };
    }

    const url = `${config.serviceUrl}/search`;

    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        Math.max(1000, input.timeoutMs || config.timeoutMs),
    );

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                query: input.query,
                timeoutMs: input.timeoutMs || config.timeoutMs,
                origin: input.origin || {},
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            return {
                ok: true,
                backend_ok: false,
                final_answer: `Web search failed: local browser service responded ${response.status}.`,
                natural_language_output: `Web search failed: local browser service responded ${response.status}.`,
                sources: [],
                ttl_hint_seconds: config.ttlSeconds,
                cacheable: false,
                origin: input.origin,
            };
        }

        const body = await response.json();
        return normalizeServiceResult(body, input, config);
    } catch (error) {
        if (error?.name === 'AbortError') {
            return {
                ok: true,
                backend_ok: false,
                final_answer: `Web search timed out after ${input.timeoutMs || config.timeoutMs}ms.`,
                natural_language_output: 'Web search timed out.',
                sources: [],
                ttl_hint_seconds: config.ttlSeconds,
                cacheable: false,
                origin: input.origin,
            };
        }
        return {
            ok: true,
            backend_ok: false,
            final_answer: 'Web search is unavailable because the local browser service is not reachable.',
            natural_language_output: 'Web search is unavailable because the local browser service is not reachable.',
            sources: [],
            ttl_hint_seconds: config.ttlSeconds,
            cacheable: false,
            origin: input.origin,
        };
    } finally {
        clearTimeout(timer);
    }
}

function normalizeServiceResult(body, input, config) {
    const content = String(body?.final_answer || body?.natural_language_output || '').trim();
    const backendOk = body?.backend_ok !== undefined ? Boolean(body.backend_ok) : Boolean(content);
    const sources = Array.isArray(body?.sources) ? body.sources : [];
    const cacheable = body?.cacheable !== undefined ? Boolean(body.cacheable) : backendOk;
    return {
        ok: body?.ok !== undefined ? Boolean(body.ok) : true,
        backend_ok: backendOk,
        final_answer: content || `No search results found for: "${input.query}"`,
        natural_language_output: content || `No search results found for: "${input.query}"`,
        sources,
        ttl_hint_seconds: Number(body?.ttl_hint_seconds) || config.ttlSeconds,
        cacheable,
        origin: input.origin,
        diagnostics: body?.diagnostics && typeof body.diagnostics === 'object'
            ? body.diagnostics
            : {},
    };
}
