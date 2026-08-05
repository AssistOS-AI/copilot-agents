import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { achillesAgentRoot } from '../fixtures/cross-repository-roots.mjs';

const AGENT_ROOT = achillesAgentRoot('opencodeAgent');
const MANIFEST = path.join(AGENT_ROOT, 'manifest.json');
const MCP_CONFIG = path.join(AGENT_ROOT, 'mcp-config.json');
const EXECUTE_TASK_ENTRY = path.join(AGENT_ROOT, 'scripts', 'execute-task.mjs');
const TASK_SANDBOX_ENTRY = path.join(AGENT_ROOT, 'scripts', 'task-sandbox.mjs');
const RUNNER = path.join(AGENT_ROOT, 'scripts', 'opencode-runner.mjs');
const APPROVED_CODING_IMAGE = 'docker.io/assistos/ploinky-node:24-bookworm-tools';

test('opencode execute-task uses the async canonical provider execution grammar', async () => {
    const config = JSON.parse(await fs.readFile(MCP_CONFIG, 'utf8'));
    const tool = config.tools.find((entry) => entry.name === 'execute-task');

    assert.deepEqual(config.providerSandbox, { provider: 'opencode', readiness: true });
    assert.equal(tool?.async, true);
    assert.deepEqual(tool?.providerExecution, {
        provider: 'opencode',
        mode: 'task',
        module: '/code/scripts/execute-task.mjs',
        export: 'executeProviderTask',
    });
    for (const legacyField of ['command', 'args', 'cwd', 'env']) {
        assert.equal(Object.hasOwn(tool, legacyField), false, legacyField);
    }
});

test('opencode retains its selector-only dual-runtime manifest contract', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));

    assert.equal(manifest.container, APPROVED_CODING_IMAGE);
    assert.equal(Object.hasOwn(manifest, 'network'), false);
    assert.deepEqual(manifest.containerSecurity, { nestedBwrap: true });
    assert.equal(manifest.startup, 'manual');
    assert.equal(manifest['lite-sandbox'], true);
});

test('opencode execution delegates to the canonical provider boundary without raw fallbacks', async () => {
    const executeSource = await fs.readFile(EXECUTE_TASK_ENTRY, 'utf8');
    const sandboxSource = await fs.readFile(TASK_SANDBOX_ENTRY, 'utf8');
    const runnerSource = await fs.readFile(RUNNER, 'utf8');

    assert.match(sandboxSource, /import\('\/Agent\/lib\/providerSandbox\.mjs'\)/);
    assert.match(runnerSource, /providerRuntime\.spawnWith\(\s*spawnTaskSandbox,/);
    for (const [label, source] of [
        ['execute-task', executeSource],
        ['task-sandbox', sandboxSource],
        ['runner', runnerSource],
    ]) {
        for (const forbidden of [
            '/usr/bin/bwrap',
            'PLOINKY_TASK_BWRAP_BIN',
            'PLOINKY_AGENT_API_KEY',
            'PLOINKY_ROUTER_URL',
            'PLOINKY_ENV_SOURCE_',
            'node:child_process',
            'prepareTaskSandbox',
            'createProjectDir',
            '/root',
        ]) {
            assert.equal(source.includes(forbidden), false, `${label}: ${forbidden}`);
        }
        assert.doesNotMatch(source, /\bspawn(?:Sync)?\s*\(/, label);
    }
});
