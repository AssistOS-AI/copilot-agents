import { providerDiagnostics } from './settings.mjs';

export const SEARCH_TIMEOUT_MS = 45000;

export async function searchWeb(query, settings, env = process.env) {
    const diagnostics = providerDiagnostics(settings, env);
    if (!diagnostics.configured) {
        return {
            ok: false,
            provider: diagnostics.provider,
            sources: [],
            warning: `Search provider ${diagnostics.provider} is missing: ${diagnostics.missing.join(', ')}`,
        };
    }

    const provider = diagnostics.provider;
    const timeoutMs = SEARCH_TIMEOUT_MS;
    const maxResults = settings.maxResults;
    try {
        if (provider === 'duckduckgo') return await searchDuckDuckGo(query, { timeoutMs, maxResults });
        if (provider === 'tavily') return await searchTavily(query, { timeoutMs, maxResults, apiKey: env.TAVILY_API_KEY });
        if (provider === 'serper') return await searchSerper(query, { timeoutMs, maxResults, apiKey: env.SERPER_API_KEY });
        if (provider === 'google') return await searchGoogle(query, { timeoutMs, maxResults, apiKey: env.GOOGLE_API_KEY, cseId: env.GOOGLE_CSE_ID });
        if (provider === 'bing') return await searchBing(query, { timeoutMs, maxResults, apiKey: env.BING_API_KEY });
        if (provider === 'searxng') return await searchSearxng(query, { timeoutMs, maxResults, baseUrl: settings.searxngUrl });
    } catch (error) {
        return {
            ok: false,
            provider,
            sources: [],
            warning: `Search provider ${provider} failed: ${error?.message || 'request failed'}`,
        };
    }
    return { ok: false, provider, sources: [], warning: `Unsupported provider ${provider}` };
}

export async function searchDuckDuckGo(query, options) {
    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('skip_disambig', '1');
    const payload = await fetchJson(url, { timeoutMs: options.timeoutMs });
    const sources = [];
    if (payload.AbstractURL) {
        sources.push({
            title: payload.Heading || payload.AbstractURL,
            url: payload.AbstractURL,
            snippet: payload.AbstractText || '',
        });
    }
    collectDuckTopics(payload.RelatedTopics, sources, options.maxResults);
    return { ok: true, provider: 'duckduckgo', sources: uniqueSources(sources).slice(0, options.maxResults) };
}

export async function searchTavily(query, options) {
    const payload = await fetchJson('https://api.tavily.com/search', {
        timeoutMs: options.timeoutMs,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({ query, max_results: options.maxResults, include_answer: false }),
    });
    return {
        ok: true,
        provider: 'tavily',
        sources: uniqueSources((payload.results || []).map((item) => ({
            title: item.title,
            url: item.url,
            snippet: item.content || item.snippet || '',
        }))).slice(0, options.maxResults),
    };
}

export async function searchSerper(query, options) {
    const payload = await fetchJson('https://google.serper.dev/search', {
        timeoutMs: options.timeoutMs,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': options.apiKey,
        },
        body: JSON.stringify({ q: query, num: options.maxResults }),
    });
    return {
        ok: true,
        provider: 'serper',
        sources: uniqueSources((payload.organic || []).map((item) => ({
            title: item.title,
            url: item.link,
            snippet: item.snippet || '',
        }))).slice(0, options.maxResults),
    };
}

export async function searchGoogle(query, options) {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', options.apiKey);
    url.searchParams.set('cx', options.cseId);
    url.searchParams.set('q', query);
    url.searchParams.set('num', String(Math.min(options.maxResults, 10)));
    const payload = await fetchJson(url, { timeoutMs: options.timeoutMs });
    return {
        ok: true,
        provider: 'google',
        sources: uniqueSources((payload.items || []).map((item) => ({
            title: item.title,
            url: item.link,
            snippet: item.snippet || '',
        }))).slice(0, options.maxResults),
    };
}

export async function searchBing(query, options) {
    const url = new URL('https://api.bing.microsoft.com/v7.0/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(options.maxResults));
    const payload = await fetchJson(url, {
        timeoutMs: options.timeoutMs,
        headers: { 'Ocp-Apim-Subscription-Key': options.apiKey },
    });
    return {
        ok: true,
        provider: 'bing',
        sources: uniqueSources((payload.webPages?.value || []).map((item) => ({
            title: item.name,
            url: item.url,
            snippet: item.snippet || '',
        }))).slice(0, options.maxResults),
    };
}

export async function searchSearxng(query, options) {
    const url = new URL(`${String(options.baseUrl || '').replace(/\/+$/, '')}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    const payload = await fetchJson(url, { timeoutMs: options.timeoutMs });
    return {
        ok: true,
        provider: 'searxng',
        sources: uniqueSources((payload.results || []).map((item) => ({
            title: item.title,
            url: item.url,
            snippet: item.content || '',
        }))).slice(0, options.maxResults),
    };
}

async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, options.timeoutMs || 30000));
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (!text.trim()) return {};
        return JSON.parse(text);
    } finally {
        clearTimeout(timer);
    }
}

function collectDuckTopics(items, output, maxResults) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
        if (output.length >= maxResults) return;
        if (Array.isArray(item.Topics)) {
            collectDuckTopics(item.Topics, output, maxResults);
            continue;
        }
        if (!item.FirstURL) continue;
        output.push({
            title: item.Text ? item.Text.split(' - ')[0] : item.FirstURL,
            url: item.FirstURL,
            snippet: item.Text || '',
        });
    }
}

function uniqueSources(sources) {
    const seen = new Set();
    return sources
        .filter((source) => source?.url)
        .map((source) => ({
            title: String(source.title || source.url).trim(),
            url: String(source.url || '').trim(),
            snippet: String(source.snippet || '').trim(),
        }))
        .filter((source) => {
            if (!source.url || seen.has(source.url)) return false;
            seen.add(source.url);
            return true;
        });
}
