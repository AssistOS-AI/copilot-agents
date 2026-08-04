import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { achillesAgentRoot } from '../fixtures/cross-repository-roots.mjs';

const AGENT_ROOT = achillesAgentRoot('piAgent');
const MANIFEST = path.join(AGENT_ROOT, 'manifest.json');
const MCP_CONFIG = path.join(AGENT_ROOT, 'mcp-config.json');
const EXECUTE_TASK_ENTRY = path.join(AGENT_ROOT, 'scripts', 'execute-task.mjs');
const TASK_SANDBOX_ENTRY = path.join(AGENT_ROOT, 'scripts', 'task-sandbox.mjs');
const sandbox = await import(pathToFileURL(TASK_SANDBOX_ENTRY));

test('pi execute-task remains an async cross-repository consumer', async () => {
    const config = JSON.parse(await fs.readFile(MCP_CONFIG, 'utf8'));
    const tool = config.tools.find((entry) => entry.name === 'execute-task');

    assert.equal(tool?.async, true);
    assert.deepEqual(tool?.args, ['/code/scripts/execute-task.mjs']);
});

test('pi remains a manual coding selector during the container cleanup phase', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));

    assert.equal(manifest.container, 'docker.io/assistos/ploinky-node:24-bookworm-tools');
    assert.equal(manifest.containerSecurity, undefined);
    assert.equal(manifest.startup, 'manual');
    assert.equal(manifest['lite-sandbox'], true);
    assert.equal(manifest.profiles?.default?.install, 'sh /code/scripts/install-pi.sh');
});

test('pi production task path fixes Bubblewrap and exposes the stable capability code', async () => {
    const executeSource = await fs.readFile(EXECUTE_TASK_ENTRY, 'utf8');
    const sandboxSource = await fs.readFile(TASK_SANDBOX_ENTRY, 'utf8');

    assert.equal(sandbox.BWRAP_CAPABILITY_ERROR_CODE, 'PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE');
    assert.match(sandboxSource, /DEFAULT_BWRAP_PATH = '\/usr\/bin\/bwrap'/);
    assert.doesNotMatch(executeSource, /PLOINKY_TASK_BWRAP_BIN/);
    assert.doesNotMatch(sandboxSource, /PLOINKY_TASK_BWRAP_BIN/);
});

test('pi outer-proc rejection is terminal before project mutation and credentials are filtered', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cross-repo-'));
    const workspaceRoot = path.join(root, 'workspace');
    const projectDir = path.join(workspaceRoot, 'new-project');
    await fs.mkdir(workspaceRoot);
    try {
        assert.throws(
            () => sandbox.prepareTaskSandbox({
                projectDir,
                env: { PLOINKY_WORKSPACE_ROOT: workspaceRoot },
                createProjectDir: true,
                dependencies: {
                    bwrapPath: '/definitely/not-used/bwrap',
                    procInspector: () => ({
                        ok: false,
                        processPid: process.pid,
                        procSelfPid: process.pid + 1,
                        pidNamespaceVisible: true,
                        namespaceDevice: 'test',
                        namespaceInode: 'test',
                        error: null,
                    }),
                },
            }),
            (error) => error?.code === 'PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE'
                && error?.status === 422,
        );
        await assert.rejects(fs.access(projectDir));

        const taskEnv = Object.fromEntries(sandbox.__testables.sandboxEnvironment({
            PLOINKY_ROUTER_URL: 'http://router.test',
            PLOINKY_AGENT_API_KEY: 'must-not-pass',
            ANTHROPIC_API_KEY: 'must-not-pass',
        }));
        assert.equal(taskEnv.PLOINKY_ROUTER_URL, undefined);
        assert.equal(taskEnv.PLOINKY_AGENT_API_KEY, undefined);
        assert.equal(taskEnv.ANTHROPIC_API_KEY, undefined);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
