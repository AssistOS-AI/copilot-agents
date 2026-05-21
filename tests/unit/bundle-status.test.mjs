import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const statusScript = path.resolve(__dirname, '..', '..', 'research-agents', 'tools', 'status.mjs');

function runStatus(envelope) {
    const result = spawnSync(process.execPath, [statusScript], {
        input: JSON.stringify(envelope),
        env: { ...process.env },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, `tool exited with ${result.status}: ${result.stderr}`);
    return JSON.parse(result.stdout);
}

test('research_agents_status returns the default profile by default', () => {
    const payload = runStatus({ tool: 'research_agents_status', input: {} });
    assert.equal(payload.ok, true);
    assert.equal(payload.bundle, 'research-agents');
    assert.equal(payload.profile, 'default');
    const agents = payload.agents.map((a) => a.agent).sort();
    assert.deepEqual(agents, ['browserUseAgent', 'copilotProviderRelay', 'openInterpreterAgent', 'webSearchAgent']);
    assert.ok(!agents.includes('bwrap-runner'), 'research-agents must not enable bwrap-runner');
    assert.ok(payload.availableProfiles.includes('qa'));
    assert.ok(payload.availableProfiles.includes('prod'));
});

test('research_agents_status surfaces a requested profile', () => {
    const payload = runStatus({ tool: 'research_agents_status', input: { profile: 'prod' } });
    assert.equal(payload.ok, true);
    assert.equal(payload.profile, 'prod');
    const agents = payload.agents.map((a) => a.agent).sort();
    assert.deepEqual(agents, ['browserUseAgent', 'copilotProviderRelay', 'openInterpreterAgent', 'webSearchAgent']);
    const noWait = payload.agents.filter((a) => a.noWait).map((a) => a.agent).sort();
    assert.deepEqual(noWait, ['browserUseAgent', 'openInterpreterAgent', 'webSearchAgent']);
});

test('research_agents_status falls back to the default profile for unknown names', () => {
    const payload = runStatus({ tool: 'research_agents_status', input: { profile: 'nonexistent' } });
    assert.equal(payload.ok, true);
    assert.equal(payload.profile, 'default');
});
