import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dispatchScript = path.resolve(__dirname, '..', '..', 'researchRelay', 'tools', 'dispatch.mjs');
const listBackendsScript = path.resolve(__dirname, '..', '..', 'researchRelay', 'tools', 'list-backends.mjs');

function runToolWithEnvelope(scriptPath, envelope, env = {}) {
    const result = spawnSync(process.execPath, [scriptPath], {
        input: JSON.stringify(envelope),
        env: { ...process.env, ...env },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, `tool exited with ${result.status}: ${result.stderr}`);
    return JSON.parse(result.stdout);
}

test('list_backends returns the canonical research catalog', () => {
    const payload = runToolWithEnvelope(listBackendsScript, { tool: 'research_relay_list_backends', input: {} });
    assert.equal(payload.ok, true);
    assert.ok(Array.isArray(payload.backends));
    const ids = payload.backends.map((b) => b.id).sort();
    assert.deepEqual(ids, ['open-interpreter']);
    assert.ok(payload.backends.find((backend) => backend.id === 'open-interpreter').tags.includes('oi'));
});

test('dispatch composes a tagged Copilot launch URL for the requested backend', () => {
    const workspaceRoot = path.resolve(__dirname, '..', '..');
    const payload = runToolWithEnvelope(
        dispatchScript,
        {
            tool: 'research_relay_dispatch',
            input: { backend: 'open-interpreter', working_directory: workspaceRoot },
        },
        { PLOINKY_WORKSPACE_ROOT: workspaceRoot },
    );
    assert.equal(payload.ok, true);
    assert.equal(payload.backend, 'open-interpreter');
    assert.equal(payload.agent, 'researchRelay');
    assert.equal(payload.tag, '@open-interpreter');
    assert.ok(payload.launch_url.startsWith('/webchat?agent=achilles-cli'));
    assert.ok(payload.launch_url.includes('research-tags=1'));
    assert.ok(payload.launch_url.includes('tag-relay-agent=researchRelay'));
    assert.ok(payload.launch_url.includes('tag-relay-submit-tool=research_task_submit'));
    assert.ok(payload.launch_url.includes('tag-relay-list-tool=research_relay_list_backends'));
    assert.ok(payload.launch_url.includes('tag-relay-tags=open-interpreter%2Coi'));
    assert.ok(payload.launch_url.includes('workspace-dir=.'));
    assert.ok(!decodeURIComponent(payload.launch_url).includes(workspaceRoot));
    assert.ok(payload.relay_url.startsWith('/webchat?agent=achilles-cli'));
});

test('dispatch rejects unknown backends', () => {
    const workspaceRoot = path.resolve(__dirname, '..', '..');
    const payload = runToolWithEnvelope(
        dispatchScript,
        { tool: 'research_relay_dispatch', input: { backend: 'no-such-backend' } },
        { PLOINKY_WORKSPACE_ROOT: workspaceRoot },
    );
    assert.equal(payload.ok, false);
    assert.ok(payload.error);
});

test('dispatch refuses working_directory outside the workspace', () => {
    const workspaceRoot = path.resolve(__dirname, '..', '..');
    const payload = runToolWithEnvelope(
        dispatchScript,
        {
            tool: 'research_relay_dispatch',
            input: { backend: 'open-interpreter', working_directory: '/etc/passwd' },
        },
        { PLOINKY_WORKSPACE_ROOT: workspaceRoot },
    );
    assert.equal(payload.ok, false);
    assert.match(payload.error, /escapes workspace root/);
});
