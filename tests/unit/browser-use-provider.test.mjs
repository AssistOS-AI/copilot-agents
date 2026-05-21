import test from 'node:test';
import assert from 'node:assert/strict';
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
    assert.equal(manifest.httpServices[0].auth, 'protected');
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
