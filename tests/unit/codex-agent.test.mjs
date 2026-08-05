import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { achillesAgentRoot } from '../fixtures/cross-repository-roots.mjs';

const AGENT_ROOT = achillesAgentRoot('codexAgent');
const MANIFEST = path.join(AGENT_ROOT, 'manifest.json');
const MCP_CONFIG = path.join(AGENT_ROOT, 'mcp-config.json');
const INSTALL_SCRIPT = path.join(AGENT_ROOT, 'scripts', 'install-codex.sh');
const EXECUTE_TASK_ENTRY = path.join(AGENT_ROOT, 'scripts', 'execute-task.mjs');
const TASK_SANDBOX_ENTRY = path.join(AGENT_ROOT, 'scripts', 'task-sandbox.mjs');
const RUNNER = path.join(AGENT_ROOT, 'scripts', 'codex-runner.mjs');
const APPROVED_CODING_IMAGE = 'docker.io/assistos/ploinky-node:24-bookworm-tools';

test('codex retains its selector-only dual-runtime manifest contract', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));

    assert.equal(manifest.container, APPROVED_CODING_IMAGE);
    assert.equal(Object.hasOwn(manifest, 'network'), false);
    assert.deepEqual(manifest.containerSecurity, { nestedBwrap: true });
    assert.equal(manifest.startup, 'manual');
    assert.equal(manifest['lite-sandbox'], true);
});

test('codex execute-task uses the async canonical provider execution grammar', async () => {
    const config = JSON.parse(await fs.readFile(MCP_CONFIG, 'utf8'));
    const tool = config.tools.find((entry) => entry.name === 'execute-task');

    assert.deepEqual(config.providerSandbox, { provider: 'codex', readiness: true });
    assert.equal(tool?.async, true);
    assert.deepEqual(tool?.providerExecution, {
        provider: 'codex',
        mode: 'task',
        module: '/code/scripts/execute-task.mjs',
        export: 'executeProviderTask',
    });
    for (const legacyField of ['command', 'args', 'cwd', 'env']) {
        assert.equal(Object.hasOwn(tool, legacyField), false, legacyField);
    }
});

test('codex manifest uses the non-interactive installer script', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
    const install = manifest.profiles?.default?.install;

    assert.equal(install, 'sh /code/scripts/install-codex.sh');
    assert.doesNotMatch(install, /^npm install/);
});

test('codex execution delegates to the canonical provider boundary without raw fallbacks', async () => {
    const executeSource = await fs.readFile(EXECUTE_TASK_ENTRY, 'utf8');
    const sandboxSource = await fs.readFile(TASK_SANDBOX_ENTRY, 'utf8');
    const script = await fs.readFile(RUNNER, 'utf8');

    assert.match(sandboxSource, /const PROVIDER_SANDBOX_MODULE = '\/Agent\/lib\/providerSandbox\.mjs';/);
    assert.match(sandboxSource, /providerSandboxPromise \|\|= import\(PROVIDER_SANDBOX_MODULE\);/);
    assert.match(script, /assertProviderRuntime\(providerRuntime\)\.spawnWith\(\s*spawnTaskSandbox,/);
    assert.match(script, /--sandbox[\s\S]*workspace-write/);
    for (const [label, source] of [
        ['execute-task', executeSource],
        ['task-sandbox', sandboxSource],
        ['runner', script],
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

test('codex installer invokes npm through the absolute npm cli path', async () => {
    const script = await fs.readFile(INSTALL_SCRIPT, 'utf8');

    assert.match(script, /\/opt\/ploinky-node\/lib\/node_modules\/npm\/bin\/npm-cli\.js/);
    assert.match(script, /\/usr\/local\/lib\/node_modules\/npm\/bin\/npm-cli\.js/);
    assert.match(script, /node "\$NPM_CLI" install -g --prefix "\$INSTALL_PREFIX"/);
    assert.match(script, /@openai\/codex/);
    assert.match(script, /exec node "\$HOME\/\.local\/lib\/node_modules\/@openai\/codex\/bin\/codex\.js" "\$@"/);
    assert.doesNotMatch(script, /\bnpm install -g\b/);
});
