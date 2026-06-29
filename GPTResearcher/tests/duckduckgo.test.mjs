import test from 'node:test';

import { searchDuckDuckGo } from '../../GPTResearcher/scripts/lib/search-providers.mjs';
import {
    MAX_RESULTS,
    REAL_QUERY,
    TIMEOUT_MS,
    logProviderResult,
} from './provider-test-utils.mjs';
import assert from 'node:assert/strict';

test('DuckDuckGo real search provider returns a real API response', async () => {
    const result = await searchDuckDuckGo(REAL_QUERY, {
        maxResults: MAX_RESULTS,
        timeoutMs: TIMEOUT_MS,
    });
    logProviderResult(result);
    assert.equal(result?.ok, true, result?.warning || 'DuckDuckGo did not return ok:true');
    assert.equal(result.provider, 'duckduckgo');
    assert.ok(Array.isArray(result.sources), 'DuckDuckGo sources must be an array');
    assert.ok(result.sources.length > 0, 'DuckDuckGo should return sources for the stable Instant Answer query');
    for (const source of result.sources) {
        assert.equal(typeof source.title, 'string');
        assert.equal(typeof source.url, 'string');
        assert.ok(source.url.startsWith('http'), `DuckDuckGo source URL must be absolute: ${source.url}`);
        assert.equal(typeof source.snippet, 'string');
    }
});
