import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import {
    findBackend,
    publicBackendView,
} from '../../copilotProviderRelay/tools/lib/backends.mjs';

import {
    normalizeProviderResult,
} from '../../copilotProviderRelay/tools/lib/task.mjs';

import {
    getUserId,
} from '../../browserUseAgent/tools/lib/identity.mjs';

import {
    BrowserSessionManager,
} from '../../browserUseAgent/server/browser-session-manager.mjs';

import {
    loadProviderRegistry,
    providerAdapterContext,
} from '../../browserUseAgent/server/provider-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('backend catalog includes browser-use with interactive flag', () => {
    const backend = findBackend('browser-use');
    assert.ok(backend, 'browser-use backend must exist');
    assert.equal(backend.id, 'browser-use');
    assert.equal(backend.label, 'Browser Use');
    assert.equal(backend.provider.agent, 'browserUseAgent');
    assert.equal(backend.provider.tool, 'browser_use_run_task');
    assert.equal(backend.cacheable, false);
    assert.equal(backend.interactive, true);
});

test('browser-use backend catalog entry has no tags field', () => {
    const backend = findBackend('browser-use');
    assert.equal(backend.tags, undefined);
});

test('publicBackendView exposes interactive flag for browser-use', () => {
    const backend = findBackend('browser-use');
    const view = publicBackendView(backend);
    assert.equal(view.id, 'browser-use');
    assert.equal(view.interactive, true);
    assert.equal(view.cacheable, false);
    assert.equal(view.configured, true);
    assert.equal(view.tags, undefined);
});

test('publicBackendView omits interactive for non-interactive backends', () => {
    const backend = findBackend('web-search');
    const view = publicBackendView(backend);
    assert.equal(view.interactive, undefined);
});

test('normalizeProviderResult preserves interactive metadata from provider', () => {
    const task = {
        backend: findBackend('browser-use'),
        resources: [],
    };
    const providerPayload = {
        ok: true,
        state: 'waiting_for_user',
        requires_user_action: true,
        session_reused: true,
        jobId: 'job_test123',
        sessionId: 'sess_test456',
        viewerUrl: '/services/browser-use/sessions/sess_test456',
        final_answer: '',
    };
    const result = normalizeProviderResult(providerPayload, task);
    assert.equal(result.state, 'waiting_for_user');
    assert.equal(result.requires_user_action, true);
    assert.equal(result.sessionId, 'sess_test456');
    assert.equal(result.viewerUrl, '/services/browser-use/sessions/sess_test456');
    assert.equal(result.jobId, 'job_test123');
    assert.equal(result.interactive, true);
    assert.equal(result.session_reused, true);
    assert.equal(result.cacheable, false);
});

test('normalizeProviderResult preserves completed state from browser-use', () => {
    const task = {
        backend: findBackend('browser-use'),
        resources: [],
    };
    const providerPayload = {
        ok: true,
        backend_ok: true,
        state: 'completed',
        final_answer: 'The translated text is: Bonjour',
        sources: [],
    };
    const result = normalizeProviderResult(providerPayload, task);
    assert.equal(result.state, 'completed');
    assert.equal(result.final_answer, 'The translated text is: Bonjour');
    assert.equal(result.requires_user_action, false);
    assert.equal(result.interactive, true);
});

test('normalizeProviderResult does not set interactive for non-interactive backends', () => {
    const task = {
        backend: findBackend('web-search'),
        resources: [],
    };
    const providerPayload = {
        ok: true,
        final_answer: 'search results',
    };
    const result = normalizeProviderResult(providerPayload, task);
    assert.equal(result.interactive, false);
    assert.equal(result.state, null);
    assert.equal(result.sessionId, null);
    assert.equal(result.viewerUrl, null);
});

test('browserUseAgent manifest is valid JSON with required fields', () => {
    const manifestPath = path.resolve(__dirname, '..', '..', 'browserUseAgent', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.container, 'node:24.15.0-bookworm');
    assert.equal(manifest['lite-sandbox'], true);
    assert.ok(Array.isArray(manifest.httpServices));
    assert.equal(manifest.httpServices.length, 1);
    assert.equal(manifest.httpServices[0].slug, 'browser-use');
    assert.equal(manifest.httpServices[0].access, 'authenticated');
    assert.equal(manifest.httpServices[0].externalPrefix, '/services/browser-use/');
    assert.equal(manifest.httpServices[0].internalPrefix, '/browser-use/');
    assert.ok(manifest.volumes);
    assert.equal(manifest.volumes['.ploinky/data/browserUseAgent'], '/data');
    assert.equal(manifest.profiles.default.env.BROWSER_USE_SERVICE_PORT, '7000');
    assert.equal(manifest.profiles.default.env.BROWSER_USE_MCP_PORT, '7001');
    assert.equal(manifest.profiles.default.env.BROWSER_USE_BIND_HOST, '0.0.0.0');
});

test('browserUseAgent mcp-config has all required tools', () => {
    const mcpPath = path.resolve(__dirname, '..', '..', 'browserUseAgent', 'mcp-config.json');
    const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    assert.ok(Array.isArray(config.tools));
    const toolNames = config.tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, [
        'browser_use_close_session',
        'browser_use_continue_task',
        'browser_use_run_task',
        'browser_use_status',
        'browser_use_task_status',
    ]);
});

test('research-agents bundle enables browserUseAgent in all profiles', () => {
    const bundlePath = path.resolve(__dirname, '..', '..', 'research-agents', 'manifest.json');
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
    assert.ok(bundle.enable.includes('browserUseAgent global no-wait'));
    for (const [name, profile] of Object.entries(bundle.profiles)) {
        assert.ok(
            profile.enable.includes('browserUseAgent global no-wait'),
            `profile ${name} must enable browserUseAgent`,
        );
    }
});

test('browserUseAgent resolves user identity from secure-wire invocation metadata', () => {
    assert.equal(getUserId({
        metadata: {
            invocation: {
                usr: { id: 'local:alice', sub: 'ignored' },
            },
        },
    }), 'local:alice');
});

test('browserUseAgent resolves user identity from protected HTTP service auth info', () => {
    assert.equal(getUserId({
        metadata: {
            authInfo: {
                user: { id: 'local:bob' },
            },
        },
    }), 'local:bob');
});

test('browserUseAgent front server proxies MCP on the public agent port', () => {
    const serverPath = path.resolve(__dirname, '..', '..', 'browserUseAgent', 'server', 'browser-use-server.mjs');
    const source = fs.readFileSync(serverPath, 'utf8');
    assert.match(source, /function proxyAgentServer/);
    assert.match(source, /pathname === '\/mcp'/);

    const startPath = path.resolve(__dirname, '..', '..', 'browserUseAgent', 'scripts', 'startAgent.sh');
    const startScript = fs.readFileSync(startPath, 'utf8');
    assert.match(startScript, /BROWSER_USE_MCP_PORT/);
    assert.match(startScript, /PORT="\$BROWSER_USE_MCP_PORT" sh \/Agent\/server\/AgentServer\.sh/);
});

test('browser-use viewer captures keyboard input after clicking the screenshot', () => {
    const viewerPath = path.resolve(__dirname, '..', '..', 'browserUseAgent', 'server', 'viewer-routes.mjs');
    const source = fs.readFileSync(viewerPath, 'utf8');

    assert.match(source, /id="viewer" tabindex="0"/);
    assert.match(source, /function sendBrowserInput\(action\)/);
    assert.match(source, /let inputChain = Promise\.resolve\(\)/);
    assert.match(source, /function flushPendingTextInput\(\)/);
    assert.match(source, /setTimeout\(flushPendingTextInput, 35\)/);
    assert.match(source, /function focusKeyboardCapture\(\)/);
    assert.match(source, /screenshot\.addEventListener\('click'/);
    assert.match(source, /sendBrowserInput\(\{ type: 'click', x: x, y: y \}\)/);
    assert.match(source, /document\.addEventListener\('keydown'/);
    assert.match(source, /queueTextInput\(e\.key\)/);
    assert.match(source, /sendBrowserInput\(\{ type: 'key', key: e\.key \}\)/);
    assert.match(source, /document\.addEventListener\('paste'/);
    assert.match(source, /sendBrowserInput\(\{ type: 'type', text: text \}\)/);
    assert.match(source, /localControlFocused\(\)/);
    assert.match(source, /const VIEWER_REFRESH_INTERVAL_MS = 500/);
    assert.match(source, /refreshSessionFrame\(sessionId\)/);
});

test('BrowserSessionManager reuses only active sessions for same owner and provider', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-use-provider-'));
    const manager = new BrowserSessionManager({ dataDir: tmp });
    try {
        const session = await manager.createSession('local:admin', 'gemini', { prompt: 'first' });
        session.state = 'waiting_for_user';

        assert.equal(manager.getReusableSession('local:admin', 'gemini'), session);
        assert.equal(manager.getReusableSession('local:admin', 'chatgpt'), null);
        assert.equal(manager.getReusableSession('local:other', 'gemini'), null);

        manager.updateSessionPrompt(session, 'second');
        assert.equal(session.prompt, 'second');

        manager._updateState(session, 'closed');
        assert.equal(manager.getReusableSession('local:admin', 'gemini'), null);
    } finally {
        manager.stop();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('BrowserSessionManager forwards viewer text and key actions to the page', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-use-provider-'));
    const manager = new BrowserSessionManager({ dataDir: tmp });
    try {
        const session = await manager.createSession('local:admin', 'gemini');
        const actions = [];
        session.page = {
            keyboard: {
                type: async (text) => actions.push(['type', text]),
                press: async (key) => actions.push(['key', key]),
            },
            mouse: {
                click: async (x, y) => actions.push(['click', x, y]),
                wheel: async (x, y) => actions.push(['scroll', x, y]),
            },
        };

        assert.deepEqual(await manager.sendInput(session, { type: 'click', x: 12, y: 34 }), { ok: true });
        assert.deepEqual(await manager.sendInput(session, { type: 'type', text: 'name@example.test' }), { ok: true });
        assert.deepEqual(await manager.sendInput(session, { type: 'key', key: 'Enter' }), { ok: true });

        assert.deepEqual(actions, [
            ['click', 12, 34],
            ['type', 'name@example.test'],
            ['key', 'Enter'],
        ]);
    } finally {
        manager.stop();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('BrowserSessionManager serializes viewer input actions per session', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-use-provider-'));
    const manager = new BrowserSessionManager({ dataDir: tmp });
    try {
        const session = await manager.createSession('local:admin', 'gemini');
        const actions = [];
        let releaseFirst;
        session.page = {
            keyboard: {
                type: async (text) => {
                    actions.push(['type:start', text]);
                    if (text === 'first') {
                        await new Promise((resolve) => {
                            releaseFirst = resolve;
                        });
                    }
                    actions.push(['type:end', text]);
                },
                press: async (key) => actions.push(['key', key]),
            },
            mouse: {
                click: async (x, y) => actions.push(['click', x, y]),
                wheel: async (x, y) => actions.push(['scroll', x, y]),
            },
        };

        const first = manager.sendInput(session, { type: 'type', text: 'first' });
        await Promise.resolve();
        const second = manager.sendInput(session, { type: 'type', text: 'second' });
        await Promise.resolve();

        assert.deepEqual(actions, [['type:start', 'first']]);
        releaseFirst();
        assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
        assert.deepEqual(actions, [
            ['type:start', 'first'],
            ['type:end', 'first'],
            ['type:start', 'second'],
            ['type:end', 'second'],
        ]);
    } finally {
        manager.stop();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('BrowserSessionManager closes browser resources when a session reaches a terminal state', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-use-provider-'));
    const manager = new BrowserSessionManager({ dataDir: tmp });
    try {
        const session = await manager.createSession('local:admin', 'gemini');
        let closeCount = 0;
        session.context = {
            close: () => {
                closeCount += 1;
                return Promise.resolve();
            },
        };
        session.browser = { fake: true };
        session.page = { fake: true };

        manager._updateState(session, 'completed');
        await session.resourceClosePromise;

        assert.equal(closeCount, 1);
        assert.equal(session.context, null);
        assert.equal(session.browser, null);
        assert.equal(session.page, null);
    } finally {
        manager.stop();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('BrowserSessionManager waits for pending profile release before relaunch', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-use-provider-'));
    const manager = new BrowserSessionManager({ dataDir: tmp });
    try {
        const session = await manager.createSession('local:admin', 'gemini');
        let releaseClose;
        session.context = {
            close: () => new Promise((resolve) => {
                releaseClose = resolve;
            }),
        };

        manager._updateState(session, 'completed');

        let released = false;
        const wait = manager.waitForProfileRelease('local:admin', 'gemini').then(() => {
            released = true;
        });
        await Promise.resolve();
        assert.equal(released, false);

        releaseClose();
        await wait;
        assert.equal(released, true);
        assert.equal(session.resourceClosePromise, null);
    } finally {
        manager.stop();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('BrowserSessionManager clears stale Chromium singleton locks for reused profiles', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-use-provider-'));
    const manager = new BrowserSessionManager({ dataDir: tmp });
    try {
        const profile = manager.profileDir('local:admin', 'gemini');
        fs.mkdirSync(profile, { recursive: true });
        fs.symlinkSync('old-container-999999', path.join(profile, 'SingletonLock'));
        fs.symlinkSync('cookie', path.join(profile, 'SingletonCookie'));
        fs.symlinkSync('/tmp/old-chromium-socket', path.join(profile, 'SingletonSocket'));

        assert.equal(manager._clearStaleProfileSingletons(profile), true);
        assert.equal(fs.existsSync(path.join(profile, 'SingletonLock')), false);
        assert.equal(fs.existsSync(path.join(profile, 'SingletonCookie')), false);
        assert.equal(fs.existsSync(path.join(profile, 'SingletonSocket')), false);
    } finally {
        manager.stop();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('BrowserSessionManager keeps Chromium singleton locks for a live local process', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-use-provider-'));
    const manager = new BrowserSessionManager({ dataDir: tmp });
    try {
        const profile = manager.profileDir('local:admin', 'gemini');
        const lockPath = path.join(profile, 'SingletonLock');
        fs.mkdirSync(profile, { recursive: true });
        fs.symlinkSync(`${os.hostname()}-${process.pid}`, lockPath);

        assert.equal(manager._clearStaleProfileSingletons(profile), false);
        assert.equal(fs.lstatSync(lockPath).isSymbolicLink(), true);
    } finally {
        manager.stop();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('BrowserSessionManager serializes profile operations per owner and provider', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-use-provider-'));
    const manager = new BrowserSessionManager({ dataDir: tmp });
    try {
        const order = [];
        let releaseFirst;
        const first = manager.withProfileLock('local:admin', 'gemini', async () => {
            order.push('first:start');
            await new Promise((resolve) => {
                releaseFirst = resolve;
            });
            order.push('first:end');
            return 'first';
        });
        const second = manager.withProfileLock('local:admin', 'gemini', async () => {
            order.push('second:start');
            return 'second';
        });

        await Promise.resolve();
        await Promise.resolve();
        assert.deepEqual(order, ['first:start']);

        releaseFirst();
        assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
        assert.deepEqual(order, ['first:start', 'first:end', 'second:start']);
    } finally {
        manager.stop();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('browserUseAgent run-task reuses active sessions before creating a new profile context', () => {
    const serverPath = path.resolve(__dirname, '..', '..', 'browserUseAgent', 'server', 'browser-use-server.mjs');
    const source = fs.readFileSync(serverPath, 'utf8');
    const lockIndex = source.indexOf('withProfileLock(userId, provider');
    const reuseIndex = source.indexOf('getReusableSession(userId, provider)');
    const releaseIndex = source.indexOf('waitForProfileRelease(userId, provider)');
    const createIndex = source.indexOf('createSession(userId, provider');

    assert.ok(lockIndex >= 0, 'runTask should serialize per-profile operations');
    assert.ok(reuseIndex >= 0, 'runTask should check for reusable sessions');
    assert.ok(releaseIndex >= 0, 'runTask should wait for pending profile close');
    assert.ok(createIndex >= 0, 'runTask should still create a session when no active session exists');
    assert.ok(lockIndex < reuseIndex, 'runTask must acquire the profile lock before reuse/create checks');
    assert.ok(reuseIndex < createIndex, 'runTask must reuse before creating a new persistent context');
    assert.ok(releaseIndex < createIndex, 'runTask must wait for profile release before relaunch');
    assert.doesNotMatch(source, /error:\s*session\.error/);
    assert.match(source, /browser_session_start_failed/);

    assert.match(source, /providerRegistry\.resolveProvider/, 'runTask resolves providers via the registry');
    assert.doesNotMatch(source, /PROVIDER_URLS/, 'hardcoded PROVIDER_URLS map must be removed');
    assert.match(source, /resolved\.adapter/, 'runTask extracts the adapter from the resolved provider');
    assert.match(source, /resolved\.startUrl/, 'runTask uses the registry startUrl, not a hardcoded map');
    assert.match(source, /provider registry loaded zero enabled providers/, 'server must fail fast when no providers load');
    assert.match(source, /createSession\(userId, provider, \{ prompt, timeoutMs \}\)/, 'runTask must store timeoutMs on new sessions');
    assert.match(source, /updateSessionPrompt\(reusableSession, prompt, \{ timeoutMs \}\)/, 'reused waiting sessions must keep the latest timeout');
    assert.match(source, /providerAdapterContext\(resolved\)/, 'adapter hooks should receive adapter-safe provider metadata');
    assert.match(source, /detectLoginRequired\(session, adapter, providerContext\)/, 'detect hooks should receive provider metadata');
    assert.match(source, /submitPrompt\(session, prompt, adapter, providerContext\)/, 'submit hooks should receive provider metadata');
});

test('provider registry discovers chatgpt, gemini, and perplexity', async () => {
    const providersDir = path.resolve(__dirname, '..', '..', 'browserUseAgent', 'providers');
    const registry = await loadProviderRegistry({
        providersDir,
        importAdapter: (p) => import(new URL(`file://${p}`).href),
    });

    assert.ok(registry.size >= 3, `expected at least 3 providers, got ${registry.size}`);

    const chatgpt = registry.getProvider('chatgpt');
    assert.ok(chatgpt, 'chatgpt must be registered');
    assert.equal(chatgpt.label, 'ChatGPT');
    assert.equal(chatgpt.default, true);
    assert.equal(chatgpt.startUrl, 'https://chatgpt.com/');
    assert.equal(typeof chatgpt.adapter.detectLoginRequired, 'function');
    assert.equal(typeof chatgpt.adapter.submitPrompt, 'function');

    const gemini = registry.getProvider('gemini');
    assert.ok(gemini, 'gemini must be registered');
    assert.equal(gemini.label, 'Gemini');
    assert.equal(gemini.default, false);
    assert.equal(gemini.startUrl, 'https://gemini.google.com/app');

    const perplexity = registry.getProvider('perplexity');
    assert.ok(perplexity, 'perplexity must be registered');
    assert.equal(perplexity.label, 'Perplexity');
    assert.equal(perplexity.startUrl, 'https://www.perplexity.ai/');
});

test('provider registry resolves aliases', async () => {
    const providersDir = path.resolve(__dirname, '..', '..', 'browserUseAgent', 'providers');
    const registry = await loadProviderRegistry({
        providersDir,
        importAdapter: (p) => import(new URL(`file://${p}`).href),
    });

    assert.equal(registry.resolveProvider('openai').id, 'chatgpt');
    assert.equal(registry.resolveProvider('chat gpt').id, 'chatgpt');
    assert.equal(registry.resolveProvider('google gemini').id, 'gemini');
    assert.equal(registry.resolveProvider('perplexity ai').id, 'perplexity');
    assert.equal(registry.resolveProvider('nonexistent'), null);
});

test('provider registry default provider is chatgpt', async () => {
    const providersDir = path.resolve(__dirname, '..', '..', 'browserUseAgent', 'providers');
    const registry = await loadProviderRegistry({
        providersDir,
        importAdapter: (p) => import(new URL(`file://${p}`).href),
    });

    const def = registry.getDefaultProvider();
    assert.ok(def, 'default provider must exist');
    assert.equal(def.id, 'chatgpt');
    assert.equal(registry.resolveProvider('').id, 'chatgpt');
    assert.equal(registry.resolveProvider(null).id, 'chatgpt');
});

test('provider registry listProviders returns safe metadata without adapters', async () => {
    const providersDir = path.resolve(__dirname, '..', '..', 'browserUseAgent', 'providers');
    const registry = await loadProviderRegistry({
        providersDir,
        importAdapter: (p) => import(new URL(`file://${p}`).href),
    });

    const list = registry.listProviders();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 3);

    for (const entry of list) {
        assert.ok(typeof entry.id === 'string');
        assert.ok(typeof entry.label === 'string');
        assert.ok(Array.isArray(entry.aliases));
        assert.ok(typeof entry.default === 'boolean');
        assert.ok(typeof entry.order === 'number');
        assert.equal(entry.adapter, undefined, 'adapter must not appear in listProviders output');
        assert.equal(entry.startUrl, undefined, 'startUrl must not appear in listProviders output');
    }

    const ids = list.map((p) => p.id);
    assert.ok(ids.indexOf('chatgpt') < ids.indexOf('gemini'), 'chatgpt (order 10) before gemini (order 20)');
    assert.ok(ids.indexOf('gemini') < ids.indexOf('perplexity'), 'gemini (order 20) before perplexity (order 30)');
});

test('provider registry builds adapter context without adapter internals', async () => {
    const providersDir = path.resolve(__dirname, '..', '..', 'browserUseAgent', 'providers');
    const registry = await loadProviderRegistry({
        providersDir,
        importAdapter: (p) => import(new URL(`file://${p}`).href),
    });

    const context = providerAdapterContext(registry.getProvider('chatgpt'));
    assert.deepEqual(Object.keys(context).sort(), ['aliases', 'default', 'id', 'label', 'order', 'startUrl']);
    assert.equal(context.id, 'chatgpt');
    assert.equal(context.label, 'ChatGPT');
    assert.equal(context.startUrl, 'https://chatgpt.com/');
    assert.equal(context.adapter, undefined);
    assert.notEqual(context.aliases, registry.getProvider('chatgpt').aliases);
});

test('provider registry rejects duplicate provider ids', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dup-id-'));
    try {
        for (const name of ['alpha', 'beta']) {
            const dir = path.join(tmp, name);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'provider.json'), JSON.stringify({
                id: 'same-id', label: name, aliases: [name], startUrl: 'https://example.com/', order: 10,
            }));
            fs.writeFileSync(path.join(dir, 'adapter.mjs'), 'export function detectLoginRequired() {} export function submitPrompt() {}');
        }
        await assert.rejects(
            () => loadProviderRegistry({ providersDir: tmp, importAdapter: (p) => import(new URL(`file://${p}`).href) }),
            /duplicate provider id/,
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('provider registry rejects duplicate aliases across providers', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dup-alias-'));
    try {
        for (const [name, id] of [['alpha', 'alpha-id'], ['beta', 'beta-id']]) {
            const dir = path.join(tmp, name);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'provider.json'), JSON.stringify({
                id, label: name, aliases: ['shared-alias'], startUrl: 'https://example.com/', order: 10,
            }));
            fs.writeFileSync(path.join(dir, 'adapter.mjs'), 'export function detectLoginRequired() {} export function submitPrompt() {}');
        }
        await assert.rejects(
            () => loadProviderRegistry({ providersDir: tmp, importAdapter: (p) => import(new URL(`file://${p}`).href) }),
            /duplicate provider alias/,
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('provider registry omits disabled providers', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disabled-'));
    try {
        const dir = path.join(tmp, 'disabled-prov');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'provider.json'), JSON.stringify({
            id: 'disabled-prov', label: 'Disabled', aliases: ['disabled'], startUrl: 'https://example.com/', enabled: false, order: 10,
        }));
        fs.writeFileSync(path.join(dir, 'adapter.mjs'), 'export function detectLoginRequired() {} export function submitPrompt() {}');

        const registry = await loadProviderRegistry({
            providersDir: tmp,
            importAdapter: (p) => import(new URL(`file://${p}`).href),
        });
        assert.equal(registry.size, 0);
        assert.equal(registry.getProvider('disabled-prov'), null);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('provider registry rejects adapters missing required exports', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bad-adapter-'));
    try {
        const dir = path.join(tmp, 'bad');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'provider.json'), JSON.stringify({
            id: 'bad', label: 'Bad', aliases: ['bad'], startUrl: 'https://example.com/', order: 10,
        }));
        fs.writeFileSync(path.join(dir, 'adapter.mjs'), 'export function detectLoginRequired() {}');

        await assert.rejects(
            () => loadProviderRegistry({ providersDir: tmp, importAdapter: (p) => import(new URL(`file://${p}`).href) }),
            /missing required export 'submitPrompt'/,
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('provider registry returns empty when providers directory does not exist', async () => {
    const registry = await loadProviderRegistry({ providersDir: '/nonexistent/path' });
    assert.equal(registry.size, 0);
    assert.equal(registry.getDefaultProvider(), null);
    assert.deepEqual(registry.listProviders(), []);
});

test('adding a fixture provider folder is enough for registry discovery', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-'));
    try {
        const dir = path.join(tmp, 'test-provider');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'provider.json'), JSON.stringify({
            id: 'test-provider', label: 'Test', aliases: ['testing'], startUrl: 'https://test.example.com/', default: true, order: 1,
        }));
        fs.writeFileSync(path.join(dir, 'adapter.mjs'), 'export function detectLoginRequired() { return false; } export function submitPrompt() { return { ok: true, final_answer: "test" }; }');

        const registry = await loadProviderRegistry({
            providersDir: tmp,
            importAdapter: (p) => import(new URL(`file://${p}`).href),
        });
        assert.equal(registry.size, 1);
        assert.equal(registry.getProvider('test-provider').label, 'Test');
        assert.equal(registry.getDefaultProvider().id, 'test-provider');
        assert.equal(registry.resolveProvider('testing').id, 'test-provider');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('BrowserSessionManager delegates detectLoginRequired to adapter hook', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-detect-'));
    const manager = new BrowserSessionManager({ dataDir: tmp });
    try {
        const session = await manager.createSession('local:admin', 'chatgpt', { prompt: 'test' });
        session.page = { url: () => 'https://chatgpt.com/' };

        let adapterCalled = false;
        const adapter = {
            detectLoginRequired: async ({ page, session: s, provider }) => {
                adapterCalled = true;
                assert.ok(page, 'adapter receives page');
                assert.equal(s.sessionId, session.sessionId);
                assert.equal(provider.id, 'chatgpt');
                assert.equal(provider.label, 'ChatGPT');
                return true;
            },
        };

        const provider = { id: 'chatgpt', label: 'ChatGPT' };
        const loginRequired = await manager.detectLoginRequired(session, adapter, provider);
        assert.equal(adapterCalled, true, 'adapter detectLoginRequired must be called');
        assert.equal(loginRequired, true);
    } finally {
        manager.stop();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('BrowserSessionManager delegates submitPrompt to adapter hook', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-submit-'));
    const manager = new BrowserSessionManager({ dataDir: tmp });
    try {
        const session = await manager.createSession('local:admin', 'gemini', {
            prompt: 'translate hello',
            timeoutMs: 45000,
        });
        session.state = 'running';
        session.page = { url: () => 'https://gemini.google.com/app' };

        let adapterCalled = false;
        const adapter = {
            submitPrompt: async ({ prompt, provider, timeoutMs }) => {
                adapterCalled = true;
                assert.equal(prompt, 'translate hello');
                assert.equal(provider.id, 'gemini');
                assert.equal(provider.label, 'Gemini');
                assert.equal(timeoutMs, 45000);
                return { ok: true, final_answer: 'Bonjour' };
            },
        };

        const provider = { id: 'gemini', label: 'Gemini' };
        const result = await manager.submitPrompt(session, 'translate hello', adapter, provider);
        assert.equal(adapterCalled, true, 'adapter submitPrompt must be called');
        assert.equal(result.ok, true);
        assert.equal(result.final_answer, 'Bonjour');
    } finally {
        manager.stop();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('BrowserSessionManager converts thrown adapter errors to failed terminal state', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-throw-'));
    const manager = new BrowserSessionManager({ dataDir: tmp });
    try {
        const session = await manager.createSession('local:admin', 'chatgpt', { prompt: 'test' });
        let closeCount = 0;
        session.page = { url: () => 'https://chatgpt.com/' };
        session.context = {
            close: () => {
                closeCount += 1;
                return Promise.resolve();
            },
        };

        const result = await manager.submitPrompt(session, 'test', {
            submitPrompt: async () => {
                throw new Error('selector exploded with internal detail');
            },
        }, { id: 'chatgpt', label: 'ChatGPT' });

        assert.equal(result.ok, false);
        assert.equal(result.error, 'Task execution failed.');
        assert.equal(session.state, 'failed');
        assert.equal(session.error, 'Task execution failed.');
        assert.match(session.diagnosticError, /Provider adapter failed/);
        await session.resourceClosePromise;
        assert.equal(closeCount, 1);
        assert.equal(session.context, null);
        assert.equal(session.page, null);
    } finally {
        manager.stop();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('BrowserSessionManager preserves timeoutMs for user-ready continuation', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-continuation-timeout-'));
    const manager = new BrowserSessionManager({ dataDir: tmp });
    try {
        const session = await manager.createSession('local:admin', 'gemini', {
            prompt: 'continue after login',
            timeoutMs: 23456,
        });
        session.state = 'waiting_for_user';
        session.page = { url: () => 'https://gemini.google.com/app' };

        let observedTimeout = null;
        const result = await manager.continueAfterUserReady(session, {
            submitPrompt: async ({ timeoutMs }) => {
                observedTimeout = timeoutMs;
                return { ok: true, final_answer: 'continued' };
            },
        }, { id: 'gemini', label: 'Gemini' });

        assert.equal(result.ok, true);
        assert.equal(result.final_answer, 'continued');
        assert.equal(observedTimeout, 23456);
        assert.equal(session.state, 'completed');
    } finally {
        manager.stop();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
