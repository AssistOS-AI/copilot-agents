import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    resolveSearchConfig,
    resolveServiceUrl,
} from '../../webSearchAgent/tools/lib/search-config.mjs';
import { normalizeSearchInput } from '../../webSearchAgent/tools/lib/search-executor.mjs';
import {
    buildGoogleAiModeUrl,
    classifySearchError,
} from '../../webSearchAgent/server/headless-search-service.mjs';
import { formatAiModeResponse } from '../../webSearchAgent/tools/lib/headless-search-converter.mjs';
import { BrowserPool } from '../../webSearchAgent/tools/lib/browser-pool.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('web-search-provider resolveSearchConfig', () => {
    it('reports configured=true when local browser pool is enabled', () => {
        const config = resolveSearchConfig({
            BROWSER_POOL_SIZE: '2',
        });
        assert.equal(config.configured, true);
        assert.equal(config.mode, 'local-headless-browser');
        assert.equal(config.poolSize, 2);
        assert.equal(config.ttlSeconds, 86400);
    });

    it('reports configured=false when local browser pool is disabled', () => {
        const config = resolveSearchConfig({ BROWSER_POOL_SIZE: '0' });
        assert.equal(config.configured, false);
        assert.match(config.reason, /BROWSER_POOL_SIZE/);
    });

    it('defaults service URL to loopback', () => {
        assert.equal(resolveServiceUrl({}), 'http://127.0.0.1:47731');
    });

    it('allows overriding service URL explicitly', () => {
        assert.equal(
            resolveServiceUrl({ WEB_SEARCH_SERVICE_URL: 'http://127.0.0.1:4999/' }),
            'http://127.0.0.1:4999',
        );
    });

    it('clamps WEB_SEARCH_TIMEOUT_MS to valid range', () => {
        const low = resolveSearchConfig({ WEB_SEARCH_TIMEOUT_MS: '100' });
        assert.equal(low.timeoutMs, 1000);

        const high = resolveSearchConfig({ WEB_SEARCH_TIMEOUT_MS: '999999' });
        assert.equal(high.timeoutMs, 90000);

        const normal = resolveSearchConfig({ WEB_SEARCH_TIMEOUT_MS: '45000' });
        assert.equal(normal.timeoutMs, 45000);
    });
});

describe('web-search-provider normalizeSearchInput', () => {
    it('extracts query from prompt field', () => {
        const result = normalizeSearchInput({ prompt: 'latest Node.js release' });
        assert.equal(result.query, 'latest Node.js release');
    });

    it('extracts query from query field', () => {
        const result = normalizeSearchInput({ query: 'search this' });
        assert.equal(result.query, 'search this');
    });

    it('returns error when no search query is provided', () => {
        const result = normalizeSearchInput({});
        assert.ok(result.error);
        assert.match(result.error, /query is required/i);
    });

    it('returns error when query exceeds max length', () => {
        const result = normalizeSearchInput({ prompt: 'x'.repeat(5000) });
        assert.ok(result.error);
        assert.match(result.error, /exceeds/);
    });

    it('preserves origin object', () => {
        const result = normalizeSearchInput({
            prompt: 'test',
            origin: { tabId: 'tab-1' },
        });
        assert.deepEqual(result.origin, { tabId: 'tab-1' });
    });

    it('defaults origin to empty object', () => {
        const result = normalizeSearchInput({ prompt: 'test' });
        assert.deepEqual(result.origin, {});
    });
});

describe('web-search-provider local browser runtime helpers', () => {
    it('builds the Google AI Mode browser URL', () => {
        assert.equal(
            buildGoogleAiModeUrl('latest node release'),
            'https://www.google.com/search?q=latest%20node%20release&udm=50',
        );
    });

    it('classifies missing puppeteer as configuration instead of exposing raw errors', () => {
        const classified = classifySearchError(new Error('puppeteer runtime not available: Cannot find package'));
        assert.equal(classified.type, 'configuration');
        assert.match(classified.message, /Puppeteer runtime/);
        assert.equal(classified.retryable, false);
        assert.ok(!classified.message.includes('Cannot find package'));
    });

    it('formats browser results with structured citations', () => {
        const text = formatAiModeResponse(
            'This is the answer.',
            [{ title: 'Example', url: 'https://example.com' }],
            'test query',
        );
        assert.match(text, /Search results for/);
        assert.match(text, /This is the answer/);
        assert.match(text, /\[1\] \[Example\]\(https:\/\/example.com\)/);
    });

    it('BrowserPool can be inspected before warmup without loading puppeteer', () => {
        const pool = new BrowserPool({
            poolSize: 1,
            executablePath: '/usr/bin/chromium',
            headlessMode: 'new',
            proxyUrl: null,
            userDataDir: null,
        });
        assert.deepEqual(pool.status(), { total: 1, available: 0, busy: 0 });
    });

    it('BrowserPool status supports Puppeteer connected property', () => {
        const pool = new BrowserPool({
            poolSize: 1,
            executablePath: '/usr/bin/chromium',
            headlessMode: 'new',
            proxyUrl: null,
            userDataDir: null,
        });
        pool._slots.push({
            browser: { connected: true },
            busy: false,
            lastUsed: Date.now(),
        });
        assert.deepEqual(pool.status(), { total: 1, available: 1, busy: 0 });
    });

    it('BrowserPool acquire supports Puppeteer connected property', async () => {
        const page = {
            setUserAgent: async () => {},
            evaluateOnNewDocument: async () => {},
        };
        const context = {
            newPage: async () => page,
            close: async () => {},
        };
        const pool = new BrowserPool({
            poolSize: 1,
            executablePath: '/usr/bin/chromium',
            headlessMode: 'new',
            proxyUrl: null,
            userDataDir: null,
        });
        pool._slots.push({
            browser: {
                connected: true,
                createBrowserContext: async () => context,
            },
            busy: false,
            lastUsed: Date.now(),
        });

        const handle = await pool.acquire();
        assert.equal(handle.page, page);
        await pool.release(handle);
        assert.deepEqual(pool.status(), { total: 1, available: 1, busy: 0 });
    });

    it('declares Puppeteer Core and a Chromium install hook for the browser runtime', () => {
        const manifest = JSON.parse(readFileSync(
            join(repoRoot, 'webSearchAgent', 'manifest.json'),
            'utf8',
        ));
        const packageJson = JSON.parse(readFileSync(
            join(repoRoot, 'webSearchAgent', 'package.json'),
            'utf8',
        ));

        assert.equal(manifest.container, 'node:24.15.0-bookworm-slim');
        assert.equal(manifest.profiles.default.install, 'sh /code/scripts/install.sh');
        assert.equal(packageJson.dependencies['puppeteer-core'], '25.0.4');
        assert.equal(packageJson.dependencies.puppeteer, undefined);
    });
});
