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
    BUNDLE_VERSION,
    SCHEMA,
    bundleDir,
    buildManifest,
    readExistingManifest,
    resolvePreparedRuntime,
    resolveRuntimeRoot,
} from '../../openInterpreterAgent/tools/lib/runtime-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATUS_TOOL = path.resolve(__dirname, '../../openInterpreterAgent/tools/status.mjs');
const TASK_TOOL = path.resolve(__dirname, '../../openInterpreterAgent/tools/open-interpreter-run-task.mjs');

function mkroot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'oi-provider-test-'));
}

function writeManifest(dir, manifest) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
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
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('prepared runtime detection rejects symlink escapes from the runtime root', () => {
    const root = mkroot();
    const outside = mkroot();
    try {
        fs.mkdirSync(path.join(root, BUNDLE_ID), { recursive: true });
        fs.symlinkSync(outside, path.join(root, BUNDLE_ID, BUNDLE_VERSION));
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
        const child = spawnSync(process.execPath, [STATUS_TOOL], {
            input: JSON.stringify({ tool: 'oi_status', input: {} }),
            encoding: 'utf8',
            env: { ...process.env, OI_RUNTIME_ROOT: root },
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
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('oi_status reports a prepared bundle once the manifest is in place', () => {
    const root = mkroot();
    try {
        writeManifest(bundleDir(root), buildManifest({ digest: 'sha256:abc' }));
        const child = spawnSync(process.execPath, [STATUS_TOOL], {
            input: JSON.stringify({ tool: 'oi_status', input: {} }),
            encoding: 'utf8',
            env: { ...process.env, OI_RUNTIME_ROOT: root },
            timeout: 10000,
        });
        const payload = JSON.parse(child.stdout || '{}');
        assert.equal(payload.runtime.prepared, true);
        assert.equal(payload.runtime.manifest.id, BUNDLE_ID);
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
        const child = spawnSync(process.execPath, [TASK_TOOL], {
            input: JSON.stringify({
                tool: 'open_interpreter_run_task',
                input: { prompt: 'hello world', timeoutMs: 5000 },
                metadata: { invocationToken: 'test-token' },
            }),
            encoding: 'utf8',
            env: { ...process.env, OI_RUNTIME_ROOT: root, OI_RUNTIME_AUTO_PREPARE: 'false' },
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
        assert.deepEqual(payload.runtimeBundle, { id: BUNDLE_ID, version: BUNDLE_VERSION });
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
        env: {
            BWRAP_RUNNER_RUNTIME_ROOT: process.env.BWRAP_RUNNER_RUNTIME_ROOT || null,
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
        const child = await runTaskTool({
            tool: 'open_interpreter_run_task',
            input: { prompt: 'hello world', timeoutMs: 5000 },
            metadata: { invocationToken: 'test-token' },
        }, {
            OI_RUNTIME_ROOT: root,
            OI_RUNTIME_AUTO_PREPARE: 'false',
            OI_LOCAL_RUNNER_BIN: wrapper,
            OPEN_INTERPRETER_MODEL: 'local-model',
            OPEN_INTERPRETER_API_BASE: 'http://127.0.0.1:11434/v1',
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
        assert.deepEqual(received.payload.runtimeBundle, { id: BUNDLE_ID, version: BUNDLE_VERSION });
        assert.match(received.payload.command, /\/work\/config\/open-interpreter\.json/);
        const configFile = received.payload.files.find((file) => file.path === 'config/open-interpreter.json');
        assert.ok(configFile, 'expected staged Open Interpreter config');
        const config = JSON.parse(configFile.content);
        assert.equal(config.model, 'local-model');
        assert.equal(config.api_base, 'http://127.0.0.1:11434/v1');
        const serialized = JSON.stringify(received);
        assert.ok(!serialized.includes('OPENAI_API_KEY'), 'credentials must not be staged');
        assert.ok(!serialized.includes('test-token'), 'invocation token must not be passed to the inner sandbox');
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
        const child = await runTaskTool({
            tool: 'open_interpreter_run_task',
            input: { prompt: 'hello world', timeoutMs: 5000 },
            metadata: { invocationToken: 'test-token' },
        }, {
            OI_RUNTIME_ROOT: root,
            OI_RUNTIME_AUTO_PREPARE: 'false',
            OI_LOCAL_RUNNER_BIN: '/nonexistent/path/to/bwrap-sandbox-exec',
            PLOINKY_ROUTER_URL: `http://127.0.0.1:${port}`,
        });
        assert.equal(child.status, 0, `task exited ${child.status}: ${child.stderr}`);
        const payload = JSON.parse(child.stdout || '{}');
        // The provider must not silently delegate to a router-hosted sandbox
        // tool when the local runner is missing. Instead it should surface a
        // structured natural-language failure so the chat surface stays clear.
        assert.equal(routerCalled, false,
            'provider must not call the router for sandbox execution');
        assert.match(payload.final_answer,
            /local sandbox|runtime|not prepared|local bwrap|sandbox runner/i,
            `final answer should describe the local sandbox failure, got: ${payload.final_answer}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
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
    assert.match(manifest.agent, /\/opt\/bwrap-runner\/bin\/healthcheck\.mjs/);
    assert.match(manifest.agent, /AgentServer\.sh/);
    assert.deepEqual(manifest.readiness, { protocol: 'mcp' });
    assert.equal(manifest.health.readiness.script, 'healthcheck.sh');
    assert.equal(manifest.profiles.default.env.OI_RUNTIME_ROOT, '/data/research-runtimes');
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
});
