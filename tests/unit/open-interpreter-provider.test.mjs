import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
    BUNDLE_ID,
    BUNDLE_LAYOUT_VERSION,
    BUNDLE_VERSION,
    PYTHON_MAJOR_MINOR,
    RUNNER_ABI,
    RUNNER_IMAGE_HINT,
    RUNNER_PROC_MINIMUM,
    SCHEMA,
    SHIM_HOST_PATH,
    bundleDir,
    buildManifest,
    describeBundleInput,
    readExistingManifest,
    resolvePreparedRuntime,
    resolveRuntimeRoot,
} from '../../openInterpreterAgent/tools/lib/runtime-bundle.mjs';
import { prepareRuntime } from '../../openInterpreterAgent/tools/prepare-runtime.mjs';
import { startOpenAICompatibleBroker } from '../../openInterpreterAgent/tools/lib/openai-compatible-broker.mjs';
import { resolveOpenInterpreterRuntimeConfig } from '../../openInterpreterAgent/tools/lib/achilles-llm-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATUS_TOOL = path.resolve(__dirname, '../../openInterpreterAgent/tools/status.mjs');
const TASK_TOOL = path.resolve(__dirname, '../../openInterpreterAgent/tools/open-interpreter-run-task.mjs');
const REMOVED_AGENT_KEY_ALIAS = ['SOUL_GATEWAY', 'API_KEY'].join('_');
const OPEN_INTERPRETER_UNAVAILABLE_CODE = 'PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE';

function mkroot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'oi-provider-test-'));
}

function writeManifest(dir, manifest) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function preparationFixture(t) {
    const root = mkroot();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const shim = path.resolve(__dirname, '../../openInterpreterAgent/runtime/research-open-interpreter.py');
    for (const method of ['existsSync', 'readFileSync', 'copyFileSync']) {
        const original = fs[method];
        t.mock.method(fs, method, (file, ...args) => original(file === SHIM_HOST_PATH ? shim : file, ...args));
    }
    const calls = path.join(root, 'pip-calls.jsonl');
    const python = path.join(root, 'fixture-python');
    fs.writeFileSync(python, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.slice(0, 3).join(' ') !== '-m pip install') process.exit(2);
const target = args[args.indexOf('--target') + 1];
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'installed-package'), 'fixture package payload');
`, { mode: 0o755 });
    return { root, calls, env: { OI_RUNTIME_ROOT: root, OI_PREPARE_PYTHON: python } };
}

function writeRunnerHealthcheck(dir, {
    mode = RUNNER_PROC_MINIMUM,
    minimum = RUNNER_PROC_MINIMUM,
    runnerAbi = RUNNER_ABI,
    ok = true,
    code = ok ? 'BWRAP_RUNNER_READY' : 'PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE',
} = {}) {
    const healthcheckPath = path.join(dir, 'runner-healthcheck.mjs');
    fs.writeFileSync(healthcheckPath, `#!/usr/bin/env node
const expected = '--minimum=${RUNNER_PROC_MINIMUM}';
if (!process.argv.includes(expected)) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'TEST_MINIMUM_NOT_FORWARDED' }) + '\\n');
    process.exitCode = 2;
} else {
    process.stdout.write(JSON.stringify(${JSON.stringify({
        ok,
        code,
        runnerAbi,
        capability: { mode, minimum },
    })}) + '\\n');
    process.exitCode = ${ok ? 0 : 1};
}
`);
    fs.chmodSync(healthcheckPath, 0o755);
    return healthcheckPath;
}

function writeAchillesConfig(dir, overrides = {}) {
    const configPath = path.join(dir, 'LLMConfig.json');
    const config = {
        defaults: {
            research: 'soul_gateway/deep',
            ...(overrides.defaults || {}),
        },
        providers: {
            soul_gateway: {
                baseURL: 'https://soul.axiologic.dev/v1/chat/completions',
                apiKeyEnv: 'PLOINKY_AGENT_API_KEY',
                module: './utils/LLMProviders/providers/openai.mjs',
                ...(overrides.provider || {}),
            },
        },
        models: [],
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return configPath;
}

function startStubRouter(handler) {
    const calls = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let body = {};
            try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
            const call = { url: req.url, headers: req.headers, body };
            calls.push(call);
            const response = handler(call);
            res.writeHead(response.status || 200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(response.body || {}));
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, port: server.address().port, calls });
        });
    });
}

function runTaskTool(input, env) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [TASK_TOOL], {
            env: { ...process.env, ...env },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const out = [];
        const err = [];
        child.stdout.on('data', (chunk) => out.push(chunk));
        child.stderr.on('data', (chunk) => err.push(chunk));
        const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch (_) {}
            resolve({ status: null, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
        }, 10000);
        child.on('close', (status) => {
            clearTimeout(timer);
            resolve({
                status,
                stdout: Buffer.concat(out).toString('utf8'),
                stderr: Buffer.concat(err).toString('utf8'),
            });
        });
        child.stdin.end(JSON.stringify(input));
    });
}

test('generated-local Open Interpreter fails closed before key access or broker selection', async () => {
    let keyReads = 0;
    const values = {
        PLOINKY_ROUTER_DESCRIPTOR_FILE: '/run/ploinky/router-descriptor.json',
        PLOINKY_AGENT_API_KEY: 'must-not-be-read',
    };
    const env = new Proxy(values, {
        get(target, property, receiver) {
            if (property === 'PLOINKY_AGENT_API_KEY') keyReads += 1;
            return Reflect.get(target, property, receiver);
        },
    });

    const resolution = await resolveOpenInterpreterRuntimeConfig({ env });
    assert.equal(resolution.source, 'box-unavailable');
    assert.equal(resolution.code, 'PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE');
    assert.equal(resolution.terminal, true);
    assert.equal(resolution.broker, null);
    assert.equal(resolution.sandbox.allowNetwork, false);
    assert.match(resolution.reason, /PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE/);
    assert.equal(keyReads, 0);
});

test('resolveRuntimeRoot defaults to /data/research-runtimes and accepts overrides', () => {
    assert.equal(resolveRuntimeRoot({}), '/data/research-runtimes');
    assert.equal(resolveRuntimeRoot({ OI_RUNTIME_ROOT: '/tmp/oi' }), '/tmp/oi');
});

test('buildManifest produces a manifest that matches the runner runtime-bundle schema', () => {
    const manifest = buildManifest();
    assert.equal(manifest.schema, SCHEMA);
    assert.equal(manifest.id, BUNDLE_ID);
    assert.equal(manifest.version, BUNDLE_VERSION);
    assert.equal(manifest.entrypoints.default, '/runtime/bin/research-open-interpreter.py');
    assert.deepEqual(manifest.python.pythonPath, ['/runtime/python']);
    assert.equal(manifest.compatibility.runnerAbi, RUNNER_ABI);
    assert.equal(manifest.compatibility.procMinimum, RUNNER_PROC_MINIMUM);
    assert.equal(manifest.compatibility.runnerImage, RUNNER_IMAGE_HINT);
    assert.equal(manifest.compatibility.pythonMajorMinor, '3.12');
    assert.equal(PYTHON_MAJOR_MINOR, '3.12');
});

test('readExistingManifest recognizes an already-prepared bundle', () => {
    const root = mkroot();
    try {
        const target = bundleDir(root);
        writeManifest(target, buildManifest({ digest: 'sha256:test' }));
        const manifest = readExistingManifest(root);
        assert.equal(manifest && manifest.id, BUNDLE_ID);
        assert.equal(manifest.version, BUNDLE_VERSION);
        assert.equal(manifest.digest, 'sha256:test');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('readExistingManifest rejects manifests for the wrong bundle id/version', () => {
    const root = mkroot();
    try {
        const target = bundleDir(root);
        writeManifest(target, { ...buildManifest(), id: 'something-else' });
        assert.equal(readExistingManifest(root), null);

        writeManifest(target, { ...buildManifest(), version: '0.0.1' });
        assert.equal(readExistingManifest(root), null);

        const incompatible = buildManifest();
        delete incompatible.compatibility.runnerAbi;
        writeManifest(target, incompatible);
        assert.equal(readExistingManifest(root), null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('runner ABI layout migrates additively without treating the populated legacy bundle as compatible', () => {
    const root = mkroot();
    try {
        const legacy = path.join(root, BUNDLE_ID, BUNDLE_VERSION);
        writeManifest(legacy, {
            schema: SCHEMA,
            id: BUNDLE_ID,
            version: BUNDLE_VERSION,
        });
        assert.equal(bundleDir(root), path.join(root, BUNDLE_ID, BUNDLE_LAYOUT_VERSION));
        assert.equal(readExistingManifest(root), null);
        assert.equal(fs.existsSync(path.join(legacy, 'manifest.json')), true,
            'compatibility migration must not delete a populated legacy bundle');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('prepared runtime rejects a different image, Python ABI, runner ABI, or proc contract', () => {
    const root = mkroot();
    try {
        for (const incompatible of [
            { runnerImage: 'docker.io/assistos/bwrap-runner:obsolete-runtime' },
            { pythonMajorMinor: '3.11' },
            { runnerAbi: 1 },
            { procMinimum: 'private-or-empty' },
        ]) {
            const manifest = buildManifest();
            Object.assign(manifest.compatibility, incompatible);
            writeManifest(bundleDir(root), manifest);
            assert.equal(resolvePreparedRuntime(root), null, JSON.stringify(incompatible));
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Python 3.12 preparation preserves the populated Python 3.11 layout and reuses only the new bundle', (t) => {
    const { root, calls, env } = preparationFixture(t);
    const legacyDir = path.join(root, BUNDLE_ID, `${BUNDLE_VERSION}-runner-abi-${RUNNER_ABI}`);
    const legacyManifest = buildManifest();
    legacyManifest.compatibility.pythonMajorMinor = '3.11';
    legacyManifest.compatibility.runnerImage = 'docker.io/assistos/bwrap-runner:node24-python-bookworm';
    writeManifest(legacyDir, legacyManifest);
    fs.writeFileSync(path.join(legacyDir, 'preserved-data'), 'old runtime');

    const prepared = prepareRuntime({ env });
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.reused, false);
    assert.notEqual(prepared.bundleDir, legacyDir);
    assert.match(path.basename(prepared.bundleDir), /-python-3\.12-[a-f0-9]{16}$/);
    assert.equal(prepared.manifest.compatibility.pythonMajorMinor, '3.12');
    assert.equal(prepared.manifest.compatibility.runnerImage, RUNNER_IMAGE_HINT);
    assert.equal(fs.readFileSync(path.join(prepared.bundleDir, 'python', 'installed-package'), 'utf8'), 'fixture package payload');
    assert.equal(fs.readFileSync(path.join(legacyDir, 'preserved-data'), 'utf8'), 'old runtime');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(legacyDir, 'manifest.json'), 'utf8')), legacyManifest);

    const reused = prepareRuntime({ env });
    assert.equal(reused.reused, true);
    assert.equal(reused.prepared, false);
    assert.equal(reused.refreshed, false);
    assert.equal(reused.bundleDir, fs.realpathSync(prepared.bundleDir));
    assert.equal(fs.readFileSync(calls, 'utf8').trim().split('\n').length, 1);
});

test('concurrent preparation adopts the compatible winning bundle and cleans its temporary directory', (t) => {
    const { root, env } = preparationFixture(t);
    const target = bundleDir(root);
    const originalRename = fs.renameSync;
    t.mock.method(fs, 'renameSync', (source, destination) => {
        assert.equal(destination, target);
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, 'winner'), 'keep the winner');
        fs.copyFileSync(path.join(source, 'manifest.json'), path.join(target, 'manifest.json'));
        return originalRename(source, destination);
    });

    const result = prepareRuntime({ env });
    assert.equal(result.reused, true);
    assert.equal(result.prepared, false);
    assert.match(result.message, /concurrently prepared/);
    assert.equal(fs.readFileSync(path.join(target, 'winner'), 'utf8'), 'keep the winner');
    assert.equal(result.manifest.compatibility.pythonMajorMinor, '3.12');
    assert.deepEqual(fs.readdirSync(path.join(root, BUNDLE_ID)), [BUNDLE_LAYOUT_VERSION]);
});

test('prepared runtime detection rejects symlink escapes from the runtime root', () => {
    const root = mkroot();
    const outside = mkroot();
    try {
        fs.mkdirSync(path.join(root, BUNDLE_ID), { recursive: true });
        fs.symlinkSync(outside, bundleDir(root));
        writeManifest(outside, buildManifest({ digest: 'sha256:escape' }));
        assert.equal(readExistingManifest(root), null);
        assert.equal(resolvePreparedRuntime(root), null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test('prepared runtime detection rejects manifest symlinks that leave the selected runtime', () => {
    const root = mkroot();
    try {
        const target = bundleDir(root);
        fs.mkdirSync(target, { recursive: true });
        const sibling = path.join(root, BUNDLE_ID, 'other');
        fs.mkdirSync(sibling, { recursive: true });
        writeManifest(sibling, buildManifest({ digest: 'sha256:sibling' }));
        fs.symlinkSync(path.join(sibling, 'manifest.json'), path.join(target, 'manifest.json'));
        assert.equal(readExistingManifest(root), null);
        assert.equal(resolvePreparedRuntime(root), null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('oi_status reports an unprepared bundle when the runtime root is empty', () => {
    const root = mkroot();
    try {
        const healthcheck = writeRunnerHealthcheck(root);
        const child = spawnSync(process.execPath, [STATUS_TOOL], {
            input: JSON.stringify({ tool: 'oi_status', input: {} }),
            encoding: 'utf8',
            env: {
                ...process.env,
                OI_RUNTIME_ROOT: root,
                OI_RUNNER_HEALTHCHECK_PATH: healthcheck,
                OPEN_INTERPRETER_MODEL: 'local-model',
            },
            timeout: 10000,
        });
        assert.equal(child.status, 0, `status exited ${child.status}: ${child.stderr}`);
        const payload = JSON.parse(child.stdout || '{}');
        assert.equal(payload.ok, true);
        assert.equal(payload.runtime.prepared, false);
        assert.equal(payload.runtime.bundleId, BUNDLE_ID);
        assert.equal(payload.runtime.bundleVersion, BUNDLE_VERSION);
        assert.equal(payload.telemetry.disabled, true);
        assert.ok(payload.sandbox && typeof payload.sandbox === 'object',
            'status must report local sandbox health, not remote runner reachability');
        assert.equal(payload.sandbox.available, true);
        assert.equal(payload.sandbox.procMinimum, RUNNER_PROC_MINIMUM);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('oi_status reports a prepared bundle once the manifest is in place', () => {
    const root = mkroot();
    try {
        writeManifest(bundleDir(root), buildManifest({ digest: 'sha256:abc' }));
        const healthcheck = writeRunnerHealthcheck(root);
        const child = spawnSync(process.execPath, [STATUS_TOOL], {
            input: JSON.stringify({ tool: 'oi_status', input: {} }),
            encoding: 'utf8',
            env: {
                ...process.env,
                OI_RUNTIME_ROOT: root,
                OI_RUNNER_HEALTHCHECK_PATH: healthcheck,
                OPEN_INTERPRETER_MODEL: 'local-model',
            },
            timeout: 10000,
        });
        const payload = JSON.parse(child.stdout || '{}');
        assert.equal(payload.runtime.prepared, true);
        assert.equal(payload.runtime.manifest.id, BUNDLE_ID);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('oi_status and task return the same terminal code when private proc is unavailable', async () => {
    const root = mkroot();
    try {
        const healthcheck = writeRunnerHealthcheck(root, {
            mode: 'private-or-empty',
            minimum: 'private-or-empty',
        });
        const env = {
            OI_RUNTIME_ROOT: root,
            OI_RUNNER_HEALTHCHECK_PATH: healthcheck,
            OPEN_INTERPRETER_MODEL: 'local-model',
            OPEN_INTERPRETER_API_BASE: 'http://127.0.0.1:11434/v1',
        };
        const statusChild = spawnSync(process.execPath, [STATUS_TOOL], {
            input: JSON.stringify({ tool: 'oi_status', input: {} }),
            encoding: 'utf8',
            env: { ...process.env, ...env },
            timeout: 10000,
        });
        const statusPayload = JSON.parse(statusChild.stdout || '{}');
        const taskChild = await runTaskTool({
            tool: 'open_interpreter_run_task',
            input: { prompt: 'hello world', timeoutMs: 5000 },
            metadata: { invocationToken: 'test-token' },
        }, env);
        const taskPayload = JSON.parse(taskChild.stdout || '{}');

        assert.equal(statusPayload.availability.code, OPEN_INTERPRETER_UNAVAILABLE_CODE);
        assert.equal(statusPayload.availability.terminal, true);
        assert.equal(taskPayload.code, statusPayload.availability.code);
        assert.equal(taskPayload.status, statusPayload.availability.status);
        assert.equal(taskPayload.terminal, true);
        assert.equal(taskPayload.cause.code, 'PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE');
        assert.equal(fs.existsSync(path.join(root, BUNDLE_ID)), false,
            'private-proc rejection must happen before runtime preparation');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('open_interpreter_run_task refuses without an invocation token', () => {
    const child = spawnSync(process.execPath, [TASK_TOOL], {
        input: JSON.stringify({ tool: 'open_interpreter_run_task', input: { prompt: 'hello' } }),
        encoding: 'utf8',
        env: { ...process.env, OI_RUNTIME_ROOT: '/tmp' },
        timeout: 10000,
    });
    const payload = JSON.parse(child.stdout || '{}');
    assert.equal(payload.ok, false);
    assert.match(payload.error, /invocation token/);
});

test('open_interpreter_run_task returns a natural-language message when the bundle is missing', () => {
    const root = mkroot();
    try {
        const healthcheck = writeRunnerHealthcheck(root);
        const child = spawnSync(process.execPath, [TASK_TOOL], {
            input: JSON.stringify({
                tool: 'open_interpreter_run_task',
                input: { prompt: 'hello world', timeoutMs: 5000 },
                metadata: { invocationToken: 'test-token' },
            }),
            encoding: 'utf8',
            env: {
                ...process.env,
                OI_RUNTIME_ROOT: root,
                OI_RUNTIME_AUTO_PREPARE: 'false',
                OI_RUNNER_HEALTHCHECK_PATH: healthcheck,
            },
            timeout: 10000,
        });
        assert.equal(child.status, 0, `task exited ${child.status}: ${child.stderr}`);
        const payload = JSON.parse(child.stdout || '{}');
        // The tool completes without crashing but reports an unprepared bundle
        // so the relay can surface the natural-language guidance to chat.
        assert.equal(payload.ok, false);
        assert.equal(payload.backend_ok, false);
        assert.equal(payload.sandbox_ok, false);
        assert.match(payload.final_answer, /not prepared/);
        assert.match(payload.final_answer, /prepare_runtime/);
        assert.deepEqual(payload.runtimeBundle, describeBundleInput());
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('open_interpreter_run_task returns missing-model guidance without invoking the sandbox runner', async () => {
    const root = mkroot();
    writeManifest(bundleDir(root), buildManifest({ digest: 'sha256:abc' }));
    try {
        const healthcheck = writeRunnerHealthcheck(root);
        const child = await runTaskTool({
            tool: 'open_interpreter_run_task',
            input: { prompt: 'hello world', timeoutMs: 5000 },
            metadata: { invocationToken: 'test-token' },
        }, {
            OI_RUNTIME_ROOT: root,
            OI_RUNTIME_AUTO_PREPARE: 'false',
            OI_LOCAL_RUNNER_BIN: '/nonexistent/path/to/bwrap-sandbox-exec',
            OI_RUNNER_HEALTHCHECK_PATH: healthcheck,
            OPEN_INTERPRETER_MODEL: '',
            OPEN_INTERPRETER_API_BASE: '',
            OPEN_INTERPRETER_LOCAL: '',
        });
        assert.equal(child.status, 0, `task exited ${child.status}: ${child.stderr}`);
        const payload = JSON.parse(child.stdout || '{}');
        assert.equal(payload.ok, true, `expected ok=true; got ${JSON.stringify(payload)}`);
        assert.equal(payload.backend_ok, true);
        assert.equal(payload.sandbox_ok, false);
        assert.match(payload.final_answer, /runtime bundle open-interpreter@0\.4\.3 is prepared/);
        assert.match(payload.final_answer, /no Soul Gateway, model, or local endpoint is configured/);
        assert.doesNotMatch(payload.final_answer, /PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE/);
        assert.match(
            payload.final_answer,
            /OPEN_INTERPRETER_MODEL and OPEN_INTERPRETER_API_BASE/,
        );
        assert.doesNotMatch(payload.final_answer, /sandbox runner|local bwrap|not installed/);
        assert.deepEqual(payload.runtimeBundle, describeBundleInput());
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('open_interpreter_run_task validates prompt presence and resource size', () => {
    const child = spawnSync(process.execPath, [TASK_TOOL], {
        input: JSON.stringify({
            tool: 'open_interpreter_run_task',
            input: { prompt: '' },
            metadata: { invocationToken: 'test-token' },
        }),
        encoding: 'utf8',
        env: { ...process.env, OI_RUNTIME_ROOT: '/tmp' },
        timeout: 10000,
    });
    const payload = JSON.parse(child.stdout || '{}');
    assert.equal(payload.ok, false);
    assert.match(payload.error, /prompt is required/);
});

test('open_interpreter_run_task invokes the local sandbox runner, not a remote MCP runner', async () => {
    const root = mkroot();
    writeManifest(bundleDir(root), buildManifest({ digest: 'sha256:abc' }));

    // Stub local sandbox runner: prints a single JSON record to stdout that
    // mimics the structured result the real /usr/local/bin/bwrap-sandbox-exec
    // emits. The stub also writes a marker file with the staged input so we
    // can assert what the provider passed in.
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-local-runner-stub-'));
    const stubBin = path.join(stubDir, 'stub-runner.mjs');
    const stubMarker = path.join(stubDir, 'received.json');
    fs.writeFileSync(stubBin, `#!/usr/bin/env node
import fs from 'node:fs';
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    fs.writeFileSync(${JSON.stringify(stubMarker)}, JSON.stringify({
        argv: process.argv.slice(2),
        env: {
            BWRAP_RUNNER_RUNTIME_ROOT: process.env.BWRAP_RUNNER_RUNTIME_ROOT || null,
            BWRAP_RUNNER_ALLOW_NETWORK: process.env.BWRAP_RUNNER_ALLOW_NETWORK || null,
            PLOINKY_AGENT_API_KEY: process.env.PLOINKY_AGENT_API_KEY || null,
            PLOINKY_AGENT_PRIVATE_SECRET: process.env.PLOINKY_AGENT_PRIVATE_SECRET || null,
        },
        payload: JSON.parse(text || '{}'),
    }));
    process.stdout.write(JSON.stringify({
        ok: true,
        jobId: 'local-job-1',
        exitCode: 0,
        signal: null,
        timedOut: false,
        elapsedMs: 7,
        network: 'none',
        runnerAbi: ${RUNNER_ABI},
        procMode: '${RUNNER_PROC_MINIMUM}',
        procMinimum: '${RUNNER_PROC_MINIMUM}',
        stdout: { text: 'configured response from local sandbox', truncated: false, byteLength: 33 },
        stderr: { text: '', truncated: false, byteLength: 0 },
    }) + '\\n');
});
`);
    fs.chmodSync(stubBin, 0o755);

    // The provider uses OI_LOCAL_RUNNER_BIN to find the local runner; the stub
    // is invoked through process.execPath because the provider treats anything
    // it can't fs.existsSync at OI_LOCAL_RUNNER_BIN as missing.
    // To exercise the OI_LOCAL_RUNNER_BIN path, we wrap it in a tiny shell
    // script.
    const wrapper = path.join(stubDir, 'bwrap-sandbox-exec');
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${stubBin}" "$@"\n`);
    fs.chmodSync(wrapper, 0o755);

    try {
        const healthcheck = writeRunnerHealthcheck(stubDir);
        const child = await runTaskTool({
            tool: 'open_interpreter_run_task',
            input: { prompt: 'hello world', timeoutMs: 5000 },
            metadata: { invocationToken: 'test-token' },
        }, {
            OI_RUNTIME_ROOT: root,
            OI_RUNTIME_AUTO_PREPARE: 'false',
            OI_LOCAL_RUNNER_BIN: wrapper,
            OI_RUNNER_HEALTHCHECK_PATH: healthcheck,
            OPEN_INTERPRETER_MODEL: 'local-model',
            OPEN_INTERPRETER_API_BASE: 'http://127.0.0.1:11434/v1',
            OPEN_INTERPRETER_CONTEXT_WINDOW: '12345',
            OPEN_INTERPRETER_MAX_TOKENS: '1234',
            PLOINKY_AGENT_PRIVATE_SECRET: 'private-secret-should-not-pass',
            // No PLOINKY_ROUTER_URL: the provider must not call the router.
        });
        assert.equal(child.status, 0, `task exited ${child.status}: ${child.stderr}`);
        const payload = JSON.parse(child.stdout || '{}');
        assert.equal(payload.ok, true, `expected ok=true; got ${JSON.stringify(payload)}`);
        assert.equal(payload.jobId, 'local-job-1');
        assert.equal(payload.final_answer, 'configured response from local sandbox');

        const received = JSON.parse(fs.readFileSync(stubMarker, 'utf8'));
        assert.equal(received.env.BWRAP_RUNNER_RUNTIME_ROOT, root,
            'local runner must receive BWRAP_RUNNER_RUNTIME_ROOT pointing at the provider-owned runtime root');
        assert.equal(received.env.BWRAP_RUNNER_ALLOW_NETWORK, null,
            'explicit Open Interpreter overrides must not force broker network mode');
        assert.equal(received.env.PLOINKY_AGENT_API_KEY, null,
            'child runner env must not receive PLOINKY_AGENT_API_KEY');
        assert.equal(received.env.PLOINKY_AGENT_PRIVATE_SECRET, null,
            'child runner env must not receive PLOINKY_AGENT_PRIVATE_SECRET');
        assert.deepEqual(received.argv, [`--minimum=${RUNNER_PROC_MINIMUM}`]);
        assert.deepEqual(received.payload.runtimeBundle, describeBundleInput());
        assert.match(received.payload.command, /\/work\/config\/open-interpreter\.json/);
        const configFile = received.payload.files.find((file) => file.path === 'config/open-interpreter.json');
        assert.ok(configFile, 'expected staged Open Interpreter config');
        const config = JSON.parse(configFile.content);
        assert.equal(config.model, 'local-model');
        assert.equal(config.api_base, 'http://127.0.0.1:11434/v1');
        assert.equal(config.context_window, 12345);
        assert.equal(config.max_tokens, 1234);
        assert.equal(config.api_key, null);
        const serialized = JSON.stringify(received);
        assert.ok(!serialized.includes('OPENAI_API_KEY'), 'credentials must not be staged');
        assert.ok(!serialized.includes('private-secret-should-not-pass'), 'private agent credentials must not be staged');
        assert.ok(!serialized.includes('test-token'), 'invocation token must not be passed to the inner sandbox');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(stubDir, { recursive: true, force: true });
    }
});

test('open_interpreter_run_task bounds outer adapter output and reports discarded bytes', async () => {
    const root = mkroot();
    writeManifest(bundleDir(root), buildManifest({ digest: 'sha256:abc' }));
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-output-bound-stub-'));
    const stubBin = path.join(stubDir, 'stub-runner.mjs');
    fs.writeFileSync(stubBin, `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => {
    process.stdout.write('x'.repeat(80 * 1024) + '\\n');
    process.stderr.write('y'.repeat(24 * 1024));
    process.stdout.write(JSON.stringify({
        ok: true,
        jobId: 'bounded-job',
        exitCode: 0,
        runnerAbi: ${RUNNER_ABI},
        procMode: '${RUNNER_PROC_MINIMUM}',
        procMinimum: '${RUNNER_PROC_MINIMUM}',
        stdout: { text: 'bounded response', truncated: false, byteLength: 16 },
        stderr: { text: '', truncated: false, byteLength: 0 }
    }) + '\\n');
});
`);
    fs.chmodSync(stubBin, 0o755);
    const wrapper = path.join(stubDir, 'bwrap-sandbox-exec');
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${stubBin}" "$@"\n`);
    fs.chmodSync(wrapper, 0o755);

    try {
        const healthcheck = writeRunnerHealthcheck(stubDir);
        const child = await runTaskTool({
            tool: 'open_interpreter_run_task',
            input: { prompt: 'hello world', timeoutMs: 5000 },
            metadata: { invocationToken: 'test-token' },
        }, {
            OI_RUNTIME_ROOT: root,
            OI_RUNTIME_AUTO_PREPARE: 'false',
            OI_LOCAL_RUNNER_BIN: wrapper,
            OI_RUNNER_HEALTHCHECK_PATH: healthcheck,
            OPEN_INTERPRETER_MODEL: 'local-model',
            OPEN_INTERPRETER_API_BASE: 'http://127.0.0.1:11434/v1',
        });
        assert.equal(child.status, 0, `task exited ${child.status}: ${child.stderr}`);
        const payload = JSON.parse(child.stdout || '{}');
        assert.equal(payload.ok, true, JSON.stringify(payload));
        assert.equal(payload.final_answer, 'bounded response');
        assert.equal(payload.outer_stdout_truncated, true);
        assert.equal(payload.outer_stderr_truncated, true);
        assert.ok(payload.outer_stdout_discarded_bytes > 16 * 1024);
        assert.equal(payload.outer_stderr_discarded_bytes, 8 * 1024);
        assert.ok(Buffer.byteLength(child.stdout, 'utf8') < 16 * 1024,
            'outer runner noise must not escape through the provider response');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(stubDir, { recursive: true, force: true });
    }
});

test('open_interpreter_run_task safety-disables generated-local before runner or broker construction', async () => {
    const root = mkroot();
    writeManifest(bundleDir(root), buildManifest({ digest: 'sha256:abc' }));

    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-soul-runner-stub-'));
    const achillesConfigPath = writeAchillesConfig(stubDir);
    const stubBin = path.join(stubDir, 'stub-runner.mjs');
    const stubMarker = path.join(stubDir, 'received.json');
    fs.writeFileSync(stubBin, `#!/usr/bin/env node
import fs from 'node:fs';
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    fs.writeFileSync(${JSON.stringify(stubMarker)}, JSON.stringify({
        env: {
            BWRAP_RUNNER_RUNTIME_ROOT: process.env.BWRAP_RUNNER_RUNTIME_ROOT || null,
            BWRAP_RUNNER_ALLOW_NETWORK: process.env.BWRAP_RUNNER_ALLOW_NETWORK || null,
            PLOINKY_AGENT_API_KEY: process.env.PLOINKY_AGENT_API_KEY || null,
        },
        payload: JSON.parse(text || '{}'),
    }));
    process.stdout.write(JSON.stringify({
        ok: true,
        jobId: 'soul-job-1',
        exitCode: 0,
        signal: null,
        timedOut: false,
        elapsedMs: 9,
        network: 'inherit',
        stdout: { text: 'configured response through broker', truncated: false, byteLength: 34 },
        stderr: { text: '', truncated: false, byteLength: 0 },
    }) + '\\n');
});
`);
    fs.chmodSync(stubBin, 0o755);
    const wrapper = path.join(stubDir, 'bwrap-sandbox-exec');
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${stubBin}" "$@"\n`);
    fs.chmodSync(wrapper, 0o755);

    try {
        const child = await runTaskTool({
            tool: 'open_interpreter_run_task',
            input: { prompt: 'hello world', timeoutMs: 5000 },
            metadata: { invocationToken: 'test-token' },
        }, {
            OI_RUNTIME_ROOT: root,
            OI_RUNTIME_AUTO_PREPARE: 'false',
            OI_LOCAL_RUNNER_BIN: wrapper,
            LLM_MODELS_CONFIG_PATH: achillesConfigPath,
            PLOINKY_AGENT_API_KEY: 'soul-secret-for-test',
            OPEN_INTERPRETER_MODEL: '',
            OPEN_INTERPRETER_API_BASE: '',
            OPEN_INTERPRETER_LOCAL: '',
            OPEN_INTERPRETER_OFFLINE: 'true',
        });
        assert.equal(child.status, 0, `task exited ${child.status}: ${child.stderr}`);
        const payload = JSON.parse(child.stdout || '{}');
        assert.equal(payload.ok, false, `expected ok=false; got ${JSON.stringify(payload)}`);
        assert.equal(payload.code, 'PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE');
        assert.equal(payload.terminal, true);
        assert.equal(payload.sandbox_ok, false);
        assert.equal(payload.jobId, null);
        assert.match(payload.final_answer, /PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE/);
        assert.equal(fs.existsSync(stubMarker), false, 'local runner must not be started');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(stubDir, { recursive: true, force: true });
    }
});

test('open_interpreter_run_task does not call the router for sandbox execution', async () => {
    const root = mkroot();
    writeManifest(bundleDir(root), buildManifest({ digest: 'sha256:abc' }));

    let routerCalled = false;
    const { server, port } = await startStubRouter((call) => {
        if (call.body && call.body.method === 'tools/call') {
            routerCalled = true;
        }
        return {
            status: 200,
            body: {
                jsonrpc: '2.0',
                id: call.body?.id || 1,
                result: { content: [{ type: 'text', text: '{}' }] },
            },
        };
    });
    try {
        const healthcheck = writeRunnerHealthcheck(root);
        const child = await runTaskTool({
            tool: 'open_interpreter_run_task',
            input: { prompt: 'hello world', timeoutMs: 5000 },
            metadata: { invocationToken: 'test-token' },
        }, {
            OI_RUNTIME_ROOT: root,
            OI_RUNTIME_AUTO_PREPARE: 'false',
            OI_LOCAL_RUNNER_BIN: '/nonexistent/path/to/bwrap-sandbox-exec',
            OI_RUNNER_HEALTHCHECK_PATH: healthcheck,
            PLOINKY_ROUTER_URL: `http://127.0.0.1:${port}`,
            PLOINKY_AGENT_API_KEY: '',
        });
        assert.equal(child.status, 0, `task exited ${child.status}: ${child.stderr}`);
        const payload = JSON.parse(child.stdout || '{}');
        // The provider must not silently delegate to a router-hosted sandbox
        // tool when the local runner is missing. Instead it should surface a
        // structured natural-language failure so the chat surface stays clear.
        assert.equal(routerCalled, false,
            'provider must not call the router for sandbox execution');
        assert.equal(payload.code, OPEN_INTERPRETER_UNAVAILABLE_CODE);
        assert.equal(payload.cause.code, 'OPEN_INTERPRETER_PROVIDER_CONTRACT_UNCERTIFIED');
        assert.equal(payload.terminal, true);
        assert.match(payload.final_answer,
            /unavailable in the Ploinky Box/i,
            `final answer should describe the deterministic Box disposition, got: ${payload.final_answer}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Open Interpreter broker restricts routes, injects upstream authorization, and closes cleanly', async () => {
    const { server, port, calls } = await startStubRouter((call) => ({
        status: 200,
        body: {
            id: 'chatcmpl-test',
            object: 'chat.completion',
            created: 123,
            model: call.body?.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            echoedModel: call.body?.model,
            echoedStream: call.body?.stream,
        },
    }));
    const broker = await startOpenAICompatibleBroker({
        upstreamUrl: `http://127.0.0.1:${port}/v1/chat/completions`,
        upstreamApiKey: 'real-soul-key',
        upstreamModel: 'deep',
        sandboxApiKey: 'sandbox-only-key',
        agentName: 'openInterpreterAgent',
    });
    try {
        const unsupported = await fetch(`${broker.apiBase}/models`);
        assert.equal(unsupported.status, 404);

        const wrongMethod = await fetch(`${broker.apiBase}/chat/completions`);
        assert.equal(wrongMethod.status, 405);

        const unauthorized = await fetch(`${broker.apiBase}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'openai/deep', messages: [] }),
        });
        assert.equal(unauthorized.status, 401);

        const ok = await fetch(`${broker.apiBase}/chat/completions`, {
            method: 'POST',
            headers: {
                authorization: 'Bearer sandbox-only-key',
                'content-type': 'application/json',
            },
            body: JSON.stringify({ model: 'openai/deep', messages: [{ role: 'user', content: 'hello' }] }),
        });
        assert.equal(ok.status, 200);
        const responseBody = await ok.json();
        assert.equal(responseBody.echoedModel, 'deep');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].headers.authorization, 'Bearer real-soul-key');
        assert.equal(calls[0].headers['x-soul-agent'], 'openInterpreterAgent');
        assert.equal(calls[0].body.model, 'deep');
        assert.equal(calls[0].body.messages[0].content, 'hello');

        const streamed = await fetch(`${broker.apiBase}/chat/completions`, {
            method: 'POST',
            headers: {
                authorization: 'Bearer sandbox-only-key',
                'content-type': 'application/json',
                accept: 'text/event-stream',
            },
            body: JSON.stringify({ model: 'openai/deep', messages: [{ role: 'user', content: 'hello' }], stream: true }),
        });
        assert.equal(streamed.status, 200);
        assert.match(streamed.headers.get('content-type') || '', /text\/event-stream/);
        const streamText = await streamed.text();
        assert.match(streamText, /data: /);
        assert.match(streamText, /"content":"ok"/);
        assert.ok(streamText.includes('data: [DONE]'));
        assert.equal(calls.length, 2);
        assert.equal(calls[1].headers.authorization, 'Bearer real-soul-key');
        assert.equal(calls[1].headers['x-soul-agent'], 'openInterpreterAgent');
        assert.equal(calls[1].body.model, 'deep');
        assert.equal(calls[1].body.stream, false,
            'broker must force non-streaming upstream and synthesize the sandbox stream');
    } finally {
        await broker.close();
        await new Promise((resolve) => server.close(resolve));
    }

    await assert.rejects(
        fetch(`${broker.apiBase}/chat/completions`, {
            method: 'POST',
            headers: { authorization: 'Bearer sandbox-only-key', 'content-type': 'application/json' },
            body: JSON.stringify({ messages: [] }),
        }),
    );
});

test('open_interpreter_run_task source must not import the MCP router client', () => {
    const taskSource = fs.readFileSync(TASK_TOOL, 'utf8');
    assert.doesNotMatch(taskSource, /lib\/mcp\.mjs/,
        'provider tool must not import the relay MCP client');
    assert.doesNotMatch(taskSource, /sandbox_exec/,
        'provider tool must not reference the remote sandbox_exec MCP tool');
    assert.doesNotMatch(taskSource, /basic\/bwrap-runner/,
        'provider tool must not reference basic/bwrap-runner');
    assert.doesNotMatch(taskSource, /RESEARCH_BWRAP_AGENT/,
        'provider tool must not look up a RESEARCH_BWRAP_AGENT name');
});

test('openInterpreterAgent manifest requests privileged container security and uses /data runtime root', () => {
    const manifestPath = path.resolve(__dirname, '../../openInterpreterAgent/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(manifest.containerSecurity, { privileged: true });
    assert.match(manifest.agent, /\/opt\/bwrap-runner\/bin\/healthcheck\.mjs --minimum=private/);
    assert.match(manifest.agent, /AgentServer\.sh/);
    assert.deepEqual(manifest.readiness, { protocol: 'mcp' });
    assert.equal(manifest.health.readiness.script, 'healthcheck.sh');
    assert.equal(manifest.profiles.default.env.OI_RUNTIME_ROOT, '/data/research-runtimes');
    assert.ok(!manifest.env.includes(REMOVED_AGENT_KEY_ALIAS),
        'manifest env must not declare the removed Soul Gateway API-key alias');
    assert.ok(!manifest.env.includes('PLOINKY_AGENT_API_KEY'),
        'manifest env must not declare the reserved injected PLOINKY_AGENT_API_KEY');
    assert.ok(manifest.env.includes('OPEN_INTERPRETER_CONTEXT_WINDOW'),
        'manifest env should allow optional local Open Interpreter context window overrides');
    assert.ok(manifest.env.includes('OPEN_INTERPRETER_MAX_TOKENS'),
        'manifest env should allow optional local Open Interpreter max token overrides');
    assert.equal(Object.hasOwn(manifest.profiles.default.env, REMOVED_AGENT_KEY_ALIAS), false,
        'default profile env must not forward the removed Soul Gateway API-key alias');
    assert.equal(Object.hasOwn(manifest.profiles.default.env, 'PLOINKY_AGENT_API_KEY'), false,
        'default profile env must not forward the reserved injected PLOINKY_AGENT_API_KEY');
    assert.ok(!manifest.env.includes('SOUL_GATEWAY_BASE_URL'),
        'manifest env must not require SOUL_GATEWAY_BASE_URL for the normal path');
    assert.ok(!manifest.env.includes('RESEARCH_BWRAP_AGENT'),
        'manifest env must not advertise RESEARCH_BWRAP_AGENT');
    const healthcheckPath = path.resolve(__dirname, '../../openInterpreterAgent/healthcheck.sh');
    assert.ok(fs.existsSync(healthcheckPath), 'provider healthcheck.sh must exist');
    assert.ok((fs.statSync(healthcheckPath).mode & 0o111) !== 0,
        'provider healthcheck.sh must be executable');
});

test('research-open-interpreter shim never embeds a heredoc python driver', () => {
    const shim = fs.readFileSync(path.resolve(__dirname, '../../openInterpreterAgent/runtime/research-open-interpreter.py'), 'utf8');
    assert.doesNotMatch(shim, /python3 - <<['"]?PY/);
    assert.doesNotMatch(shim, /node\s+-e\s/);
    assert.match(shim, /DISABLE_TELEMETRY/);
    assert.match(shim, /auto_run = False/);
    assert.ok(
        shim.indexOf('if not model_is_configured(config):') < shim.indexOf('from interpreter import interpreter'),
        'shim must reject missing model configuration before importing Open Interpreter',
    );
});
