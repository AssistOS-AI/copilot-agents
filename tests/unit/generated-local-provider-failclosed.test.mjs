import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    GENERATED_LOCAL_DESCRIPTOR_SIGNALS,
    resolveOpenInterpreterGeneratedLocalPreflight,
    resolveOpenInterpreterRuntimeConfig,
} from '../../openInterpreterAgent/tools/lib/achilles-llm-config.mjs';
import { callAgentTool as callBrowserUseAgentTool } from '../../achilles-skills/launch-browser-use/src/index.mjs';
import { callAgentTool as callOpenInterpreterAgentTool } from '../../achilles-skills/launch-open-interpreter/src/index.mjs';
import { callAgentTool as callWebSearchAgentTool } from '../../achilles-skills/launch-web-search/src/index.mjs';
import { callAgentTool as callRelayAgentTool } from '../../copilotProviderRelay/tools/lib/mcp.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const productionExtensions = new Set([
    '.cjs', '.js', '.json', '.jsonc', '.mjs', '.py', '.sh', '.toml', '.yaml', '.yml',
]);
const ignoredDirectories = new Set(['.git', '.ploinky', 'docs', 'node_modules', 'tests']);
const generatedLocalDescriptorSignalPattern = GENERATED_LOCAL_DESCRIPTOR_SIGNALS
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
const generatedLocalConsumerSignal = new RegExp([
    generatedLocalDescriptorSignalPattern,
    'PLOINKY_ENV_SOURCE_PLOINKY_',
    'x-ploinky-caller-jwt',
    '\\/mcps\\/',
    '\\/Agent\\/client\\/AgentMcpClient\\.mjs',
    'resolveOpenInterpreterGeneratedLocalPreflight',
].join('|'));

const EXECUTABLE_DISPOSITIONS = Object.freeze({
    'achilles-skills/launch-browser-use/src/index.mjs': 'verified-agent-mcp-client',
    'achilles-skills/launch-open-interpreter/src/index.mjs': 'verified-agent-mcp-client',
    'achilles-skills/launch-web-search/src/index.mjs': 'verified-agent-mcp-client',
    'copilotProviderRelay/tools/lib/mcp.mjs': 'verified-agent-mcp-client',
    'browserUseAgent/manifest.json': 'runtime-declaration-only',
    'copilotProviderRelay/manifest.json': 'runtime-declaration-only',
    'openInterpreterAgent/manifest.json': 'runtime-declaration-only',
    'webSearchAgent/manifest.json': 'runtime-declaration-only',
    'openInterpreterAgent/tools/lib/achilles-llm-config.mjs': 'generated-local-fail-closed-resolver',
    'openInterpreterAgent/tools/open-interpreter-run-task.mjs': 'generated-local-preflight-before-side-effects',
});

function recursiveProductionExecutables(directory = repositoryRoot) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) {
                files.push(...recursiveProductionExecutables(path.join(directory, entry.name)));
            }
            continue;
        }
        if (entry.isFile() && productionExtensions.has(path.extname(entry.name))) {
            files.push(path.join(directory, entry.name));
        }
    }
    return files;
}

function repositoryRelative(file) {
    return path.relative(repositoryRoot, file).split(path.sep).join('/');
}

test('every generated-local descriptor signal safety-disables Open Interpreter before key access', async () => {
    const signals = [
        ...GENERATED_LOCAL_DESCRIPTOR_SIGNALS,
        ...GENERATED_LOCAL_DESCRIPTOR_SIGNALS.map((name) => `PLOINKY_ENV_SOURCE_${name}`),
        'PLOINKY_ENV_SOURCE_PLOINKY_UNKNOWN_RUNTIME_FIELD',
    ];
    for (const signal of signals) {
        let keyReads = 0;
        const env = new Proxy({
            [signal]: signal.startsWith('PLOINKY_ENV_SOURCE_') ? 'generated' : 'present',
            PLOINKY_AGENT_API_KEY: 'must-not-be-read',
        }, {
            get(target, property, receiver) {
                if (property === 'PLOINKY_AGENT_API_KEY') keyReads += 1;
                return Reflect.get(target, property, receiver);
            },
        });
        const preflight = resolveOpenInterpreterGeneratedLocalPreflight({ env });
        const resolution = await resolveOpenInterpreterRuntimeConfig({ env });
        assert.equal(preflight?.source, 'generated-local-unsupported', signal);
        assert.equal(resolution.source, 'generated-local-unsupported', signal);
        assert.equal(resolution.broker, null, signal);
        assert.equal(resolution.sandbox.allowNetwork, false, signal);
        assert.equal(keyReads, 0, signal);
    }
});

test('ordinary Ploinky identity does not claim generated-local Open Interpreter authority', async () => {
    const env = {
        PLOINKY_AGENT_ID: 'agent:repo/interpreter',
        PLOINKY_AGENT_PRINCIPAL: 'agent:repo/interpreter',
        PLOINKY_AGENT_INSTANCE_ID: 'ordinary-instance',
        PLOINKY_AGENT_ENABLE_GENERATION: 'ordinary-generation',
    };
    assert.equal(resolveOpenInterpreterGeneratedLocalPreflight({ env }), null);
    const resolution = await resolveOpenInterpreterRuntimeConfig({ env });
    assert.notEqual(resolution.source, 'generated-local-unsupported');
    assert.equal(resolution.source, 'missing');
});

test('explicit Open Interpreter endpoints remain separate from generated-local selection', () => {
    const preflight = resolveOpenInterpreterGeneratedLocalPreflight({
        env: {
            PLOINKY_ROUTER_DESCRIPTOR_FILE: '/run/ploinky/router-descriptor.json',
            OPEN_INTERPRETER_MODEL: 'openai/local-model',
            OPEN_INTERPRETER_API_BASE: 'http://127.0.0.1:11434/v1',
        },
    });
    assert.equal(preflight, null);
});

test('Open Interpreter entrypoint fails closed before envelope/token parsing, filesystem, or installer calls', () => {
    const entrypoint = pathToFileURL(path.join(
        repositoryRoot,
        'openInterpreterAgent/tools/open-interpreter-run-task.mjs',
    )).href;
    const script = `
        import childProcess from 'node:child_process';
        import fs from 'node:fs';
        import { syncBuiltinESMExports } from 'node:module';

        const events = [];
        for (const name of ['mkdirSync', 'existsSync', 'realpathSync', 'statSync', 'mkdtempSync', 'chmodSync', 'copyFileSync', 'readFileSync', 'writeFileSync', 'renameSync']) {
            fs[name] = (...args) => {
                events.push([name, String(args[0] || '')]);
                throw new Error('unexpected filesystem side effect: ' + name);
            };
        }
        childProcess.spawnSync = (...args) => {
            events.push(['spawnSync', String(args[0] || '')]);
            throw new Error('unexpected installer process');
        };
        syncBuiltinESMExports();

        for (const name of ['OPEN_INTERPRETER_MODEL', 'OPEN_INTERPRETER_API_BASE', 'OPEN_INTERPRETER_LOCAL']) {
            delete process.env[name];
        }
        process.env.PLOINKY_ROUTER_DESCRIPTOR_FILE = '/run/ploinky/router-descriptor.json';
        const entrypoint = await import(${JSON.stringify(entrypoint)});
        await entrypoint.mainPromise;
        process.stderr.write('SIDE_EFFECT_EVENTS=' + JSON.stringify(events));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        input: '{"metadata":{"invocationToken":',
        env: { ...process.env },
        timeout: 5000,
    });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stderr, /SIDE_EFFECT_EVENTS=\[\]/);
    assert.doesNotMatch(child.stderr, /Invalid JSON envelope/);
    const payload = JSON.parse(child.stdout || '{}');
    assert.equal(payload.ok, true);
    assert.equal(payload.sandbox_ok, false);
    assert.deepEqual(payload.resources, []);
    assert.deepEqual(payload.origin, {});
    assert.match(payload.final_answer, /PLOINKY_LOCAL_GENERATED_CONSUMER_NOT_CERTIFIED/);
    assert.match(payload.final_answer, /before runtime preparation/);
});

test('recursive inventory includes operational JSON, YAML, and TOML declarations', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-local-inventory-'));
    const dispositions = Object.freeze({
        'agent.json': 'runtime-declaration-only',
        'agent.toml': 'runtime-declaration-only',
        'agent.yaml': 'runtime-declaration-only',
        'agent.yml': 'runtime-declaration-only',
    });
    try {
        fs.writeFileSync(path.join(fixtureRoot, 'agent.json'), JSON.stringify({
            env: { PLOINKY_ROUTER_DESCRIPTOR_FILE: '/run/ploinky/router-descriptor.json' },
        }));
        fs.writeFileSync(path.join(fixtureRoot, 'agent.toml'),
            'PLOINKY_ROUTER_DESCRIPTOR_FILE = "/run/ploinky/router-descriptor.json"\n');
        fs.writeFileSync(path.join(fixtureRoot, 'agent.yaml'),
            'PLOINKY_ROUTER_DESCRIPTOR_FILE: /run/ploinky/router-descriptor.json\n');
        fs.writeFileSync(path.join(fixtureRoot, 'agent.yml'),
            'PLOINKY_ROUTER_DESCRIPTOR_FILE: /run/ploinky/router-descriptor.json\n');

        const discovered = recursiveProductionExecutables(fixtureRoot)
            .filter((file) => generatedLocalConsumerSignal.test(fs.readFileSync(file, 'utf8')))
            .map((file) => path.relative(fixtureRoot, file).split(path.sep).join('/'))
            .sort();
        assert.deepEqual(discovered, Object.keys(dispositions).sort());

        for (const [relativePath, disposition] of Object.entries(dispositions)) {
            assert.equal(disposition, 'runtime-declaration-only', relativePath);
            const source = fs.readFileSync(path.join(fixtureRoot, relativePath), 'utf8');
            assert.doesNotMatch(
                source,
                /x-ploinky-caller-jwt|\/mcps\/|\bfetch\s*\(|node:https?|https?\.request/,
                relativePath,
            );
        }
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
});

test('recursive executable inventory has an explicit disposition for every direct consumer', () => {
    const discovered = recursiveProductionExecutables()
        .filter((file) => generatedLocalConsumerSignal.test(fs.readFileSync(file, 'utf8')))
        .map(repositoryRelative)
        .sort();
    assert.deepEqual(discovered, Object.keys(EXECUTABLE_DISPOSITIONS).sort());

    for (const [relativePath, disposition] of Object.entries(EXECUTABLE_DISPOSITIONS)) {
        const source = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
        if (disposition === 'verified-agent-mcp-client') {
            assert.match(source, /\/Agent\/client\/AgentMcpClient\.mjs/, relativePath);
            assert.match(source, /createAgentClient/, relativePath);
            assert.doesNotMatch(source, /x-ploinky-caller-jwt|\/mcps\/|\bfetch\s*\(|node:https?|https?\.request/, relativePath);
        } else if (disposition === 'generated-local-fail-closed-resolver') {
            assert.match(source, /resolveOpenInterpreterGeneratedLocalPreflight/, relativePath);
            assert.match(source, /PLOINKY_LOCAL_GENERATED_CONSUMER_NOT_CERTIFIED/, relativePath);
        } else if (disposition === 'generated-local-preflight-before-side-effects') {
            const preflight = source.indexOf('const generatedLocalPreflight = resolveOpenInterpreterGeneratedLocalPreflight');
            assert.ok(preflight >= 0, relativePath);
            for (const operation of [
                'const envelope = await readEnvelope()',
                'const invocationToken = getInvocationToken(envelope)',
                'const runtimeRoot = resolveRuntimeRoot(process.env)',
                'readExistingManifest(runtimeRoot)',
                'prepareRuntime({ env: process.env })',
                'await resolveOpenInterpreterRuntimeConfig({ env: process.env })',
                'await startOpenAICompatibleBroker({',
                'await invokeLocalRunner(sandboxInput, {',
            ]) {
                assert.ok(preflight < source.indexOf(operation), `${relativePath}: preflight must precede ${operation}`);
            }
        } else if (disposition === 'runtime-declaration-only') {
            assert.doesNotMatch(source, /x-ploinky-caller-jwt|\/mcps\/|\bfetch\s*\(|node:https?|https?\.request/, relativePath);
        } else {
            assert.fail(`unknown executable disposition: ${disposition}`);
        }
    }
});

test('all four direct Router callers verify before delegation-token or socket use', async () => {
    for (const [name, callAgentTool] of [
        ['launch-open-interpreter', callOpenInterpreterAgentTool],
        ['launch-web-search', callWebSearchAgentTool],
        ['launch-browser-use', callBrowserUseAgentTool],
        ['copilotProviderRelay', callRelayAgentTool],
    ]) {
        const events = [];
        const options = {
            createAgentClient: async () => {
                events.push('descriptor-verified');
                return {
                    async callTool(_toolName, _input, callOptions) {
                        events.push('agent-secret-read');
                        const token = callOptions.userDelegationToken;
                        events.push(`delegation-token:${token}`);
                        events.push('socket-created');
                        return { ok: true };
                    },
                    async close() {
                        events.push('closed');
                    },
                };
            },
        };
        Object.defineProperty(options, 'invocationToken', {
            get() {
                events.push('invocation-token-read');
                return 'caller-token';
            },
        });

        const response = await callAgentTool('targetAgent', 'probe', {}, options);
        assert.deepEqual(response, { result: { ok: true } }, name);
        assert.deepEqual(events, [
            'descriptor-verified',
            'agent-secret-read',
            'invocation-token-read',
            'delegation-token:caller-token',
            'socket-created',
            'closed',
        ], name);
    }
});
