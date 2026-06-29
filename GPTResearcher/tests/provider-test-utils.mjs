import assert from 'node:assert/strict';

export const REAL_QUERY = 'Romania';
export const MAX_RESULTS = 5;
export const TIMEOUT_MS = 45000;

export function missingEnvSkip(names) {
    const missing = names.filter((name) => !String(process.env[name] || '').trim());
    return missing.length ? `Missing env vars: ${missing.join(', ')}` : false;
}

export function assertProviderResponse(result, provider) {
    assert.equal(result?.ok, true, result?.warning || `${provider} did not return ok:true`);
    assert.equal(result.provider, provider);
    assert.ok(Array.isArray(result.sources), `${provider} sources must be an array`);
    assert.ok(result.sources.length > 0, `${provider} should return at least one source for "${REAL_QUERY}"`);
    for (const source of result.sources) {
        assert.equal(typeof source.title, 'string');
        assert.equal(typeof source.url, 'string');
        assert.ok(source.url.startsWith('http'), `${provider} source URL must be absolute: ${source.url}`);
        assert.equal(typeof source.snippet, 'string');
    }
}

export function logProviderResult(result) {
    const visible = {
        provider: result.provider,
        ok: result.ok,
        warning: result.warning || '',
        sources: result.sources,
    };
    console.log(JSON.stringify(visible, null, 2));
}
