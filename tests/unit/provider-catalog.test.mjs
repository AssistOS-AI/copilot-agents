import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const listBackendsScript = path.resolve(__dirname, '..', '..', 'copilotProviderRelay', 'tools', 'list-backends.mjs');
const statusScript = path.resolve(__dirname, '..', '..', 'copilotProviderRelay', 'tools', 'status.mjs');

function runToolWithEnvelope(scriptPath, envelope, env = {}) {
    const result = spawnSync(process.execPath, [scriptPath], {
        input: JSON.stringify(envelope),
        env: { ...process.env, ...env },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, `tool exited with ${result.status}: ${result.stderr}`);
    return JSON.parse(result.stdout);
}

test('list_backends returns the canonical provider catalog', () => {
    const payload = runToolWithEnvelope(listBackendsScript, { tool: 'copilot_provider_list_backends', input: {} });
    assert.equal(payload.ok, true);
    assert.ok(Array.isArray(payload.backends));
    const ids = payload.backends.map((b) => b.id).sort();
    assert.deepEqual(ids, ['open-interpreter', 'web-search']);
    assert.equal(payload.backends.find((backend) => backend.id === 'open-interpreter').tags, undefined);
    assert.equal(payload.backends.find((backend) => backend.id === 'web-search').tags, undefined);
});

test('list_backends web-search entry declares cacheable and ttl', () => {
    const payload = runToolWithEnvelope(listBackendsScript, { tool: 'copilot_provider_list_backends', input: {} });
    const ws = payload.backends.find((b) => b.id === 'web-search');
    assert.ok(ws);
    assert.equal(ws.provider.agent, 'webSearchAgent');
    assert.equal(ws.provider.tool, 'web_search_run_task');
    assert.equal(ws.cacheable, true);
    assert.equal(ws.ttl_hint_seconds, 86400);
});

test('status reports the provider relay mode without tag dispatch metadata', () => {
    const payload = runToolWithEnvelope(statusScript, { tool: 'copilot_provider_status', input: {} });
    assert.equal(payload.ok, true);
    assert.equal(payload.execution.mode, 'copilot-provider-relay');
    assert.ok(Array.isArray(payload.backends));
});
