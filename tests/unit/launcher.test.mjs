import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

import {
    TARGET_AGENT,
    BUNDLE_ENABLE_COMMAND,
    isPathSafe,
    buildLaunchUrl,
    detectDeployment,
    describeDeployment,
    action,
} from '../../achilles-skills/launch-open-interpreter/src/index.mjs';

test('TARGET_AGENT references the openInterpreterAgent', () => {
    assert.equal(TARGET_AGENT, 'openInterpreterAgent');
});

test('isPathSafe rejects path traversal and accepts paths with spaces', () => {
    const root = '/workspace';
    assert.equal(isPathSafe('/workspace/sub', root), true);
    assert.equal(isPathSafe('../etc/passwd', root), false);
    assert.equal(isPathSafe('/workspace/with space', root), true);
});

test('isPathSafe accepts relative paths confined to the workspace', () => {
    const root = '/workspace';
    assert.equal(isPathSafe('sub/dir', root), true);
    assert.equal(isPathSafe('sub/../other', root), true);
    assert.equal(isPathSafe('sub/../../escape', root), false);
});

test('buildLaunchUrl emits agent only when no workingDir', () => {
    const url = buildLaunchUrl();
    assert.equal(url, '/webchat?agent=openInterpreterAgent');
});

test('buildLaunchUrl includes safe absolute workingDir', () => {
    const root = '/workspace';
    const url = buildLaunchUrl({ workingDir: '/workspace/projects/lab', workspaceRoot: root });
    assert.equal(url, '/webchat?agent=openInterpreterAgent&dir=%2Fworkspace%2Fprojects%2Flab');
});

test('buildLaunchUrl drops unsafe workingDir', () => {
    const root = '/workspace';
    const url = buildLaunchUrl({ workingDir: '../etc/passwd', workspaceRoot: root });
    assert.equal(url, '/webchat?agent=openInterpreterAgent');
});

test('buildLaunchUrl resolves relative workingDir against workspace', () => {
    const root = '/workspace';
    const url = buildLaunchUrl({ workingDir: 'projects/lab', workspaceRoot: root });
    const decoded = decodeURIComponent(url.split('dir=')[1]);
    assert.equal(decoded, path.resolve(root, 'projects/lab'));
});

test('describeDeployment mentions the supported bundle enable command', () => {
    assert.equal(describeDeployment({ deployed: true }), null);
    const note = describeDeployment({ deployed: false });
    assert.ok(note && note.startsWith('note:'));
    assert.ok(note.includes(BUNDLE_ENABLE_COMMAND));
});

test('action returns a URL line; includes deployment note when agent missing', async () => {
    const original = process.env.PLOINKY_WORKSPACE_ROOT;
    process.env.PLOINKY_WORKSPACE_ROOT = '/workspace';
    try {
        const output = await action({ context: { workingDir: '/workspace' } });
        const [firstLine, secondLine] = output.split('\n');
        assert.ok(firstLine.startsWith('/webchat?agent=openInterpreterAgent'));
        assert.ok(secondLine && secondLine.startsWith('note:'));
    } finally {
        if (original === undefined) {
            delete process.env.PLOINKY_WORKSPACE_ROOT;
        } else {
            process.env.PLOINKY_WORKSPACE_ROOT = original;
        }
    }
});

test('detectDeployment finds openInterpreterAgent in Ploinky routing', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-agent-launcher-'));
    try {
        await fs.mkdir(path.join(workspace, '.ploinky'), { recursive: true });
        await fs.writeFile(
            path.join(workspace, '.ploinky', 'routing.json'),
            JSON.stringify({ routes: { openInterpreterAgent: { port: 7001 } } })
        );
        const deployment = detectDeployment({ workspaceRoot: workspace, workingDir: workspace });
        assert.equal(deployment.deployed, true);
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
});

test('action omits the deployment note when routing contains openInterpreterAgent', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-agent-launcher-'));
    const original = process.env.PLOINKY_WORKSPACE_ROOT;
    process.env.PLOINKY_WORKSPACE_ROOT = workspace;
    try {
        await fs.mkdir(path.join(workspace, '.ploinky'), { recursive: true });
        await fs.writeFile(
            path.join(workspace, '.ploinky', 'routing.json'),
            JSON.stringify({ routes: { openInterpreterAgent: { port: 7001 } } })
        );
        const output = await action({ context: { workingDir: workspace } });
        assert.ok(!output.includes('note:'));
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
        if (original === undefined) {
            delete process.env.PLOINKY_WORKSPACE_ROOT;
        } else {
            process.env.PLOINKY_WORKSPACE_ROOT = original;
        }
    }
});
