// Tests that researchRelay.research_task_submit delegates @open-interpreter to
// the openInterpreterAgent provider tool through MCP and normalizes natural-
// language output, instead of calling bwrap-runner directly.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const submitTaskScript = path.resolve(__dirname, '../../researchRelay/tools/submit-task.mjs');

function startStubRouter(handler) {
    const calls = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const bodyText = Buffer.concat(chunks).toString('utf8');
            let body = {};
            try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = {}; }
            const call = {
                method: req.method,
                url: req.url,
                jwt: req.headers['x-ploinky-caller-jwt'] || null,
                body,
            };
            calls.push(call);
            const response = handler(call);
            res.writeHead(response.status || 200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(response.body || {}));
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, port, calls });
        });
    });
}

function runSubmitTask(input, env) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [submitTaskScript], {
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
        }, 6000);
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

test('relay forwards @open-interpreter to openInterpreterAgent via MCP', async () => {
    const providerResponse = {
        ok: true,
        jobId: 'job-1',
        sandbox_ok: true,
        backend_ok: true,
        final_answer: 'Open Interpreter says hello.',
        stderr_preview: '',
        exitCode: 0,
        timedOut: false,
        stdout_truncated: false,
        stderr_truncated: false,
    };
    const { server, port, calls } = await startStubRouter((call) => ({
        status: 200,
        body: {
            jsonrpc: '2.0',
            id: call.body.id,
            result: { content: [{ type: 'text', text: JSON.stringify(providerResponse) }] },
        },
    }));
    try {
        const child = await runSubmitTask({
            input: { backend: '@open-interpreter', prompt: 'hello' },
            metadata: { invocationToken: 'relay-token' },
        }, {
            PLOINKY_ROUTER_URL: `http://127.0.0.1:${port}`,
            PLOINKY_WORKSPACE_ROOT: process.cwd(),
        });
        assert.equal(child.status, 0, `submit-task exited ${child.status}: ${child.stderr}`);
        const payload = JSON.parse(child.stdout || '{}');
        assert.equal(payload.ok, true);
        assert.equal(payload.backend, 'open-interpreter');
        assert.equal(payload.provider_agent, 'openInterpreterAgent');
        assert.equal(payload.provider_tool, 'open_interpreter_run_task');
        assert.equal(payload.bwrap_agent, null);
        assert.equal(payload.final_answer, 'Open Interpreter says hello.');
        assert.equal(payload.jobId, 'job-1');
        assert.equal(payload.sandbox_ok, true);
        assert.equal(payload.backend_ok, true);

        const toolsCall = calls.find((c) => c.body?.method === 'tools/call');
        assert.ok(toolsCall, 'expected a tools/call to the router');
        assert.match(toolsCall.url, /openInterpreterAgent/);
        assert.equal(toolsCall.body.params.name, 'open_interpreter_run_task');
        assert.equal(toolsCall.jwt, 'relay-token', 'invocation token must be forwarded as x-ploinky-caller-jwt');
        assert.equal(toolsCall.body.params.arguments.prompt, 'hello');
        assert.ok(!('runtimeBundle' in toolsCall.body.params.arguments), 'relay must not own runtimeBundle');
        assert.ok(!('command' in toolsCall.body.params.arguments), 'relay must not own backend command strings');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('relay falls back to natural-language message if provider returns no output', async () => {
    const { server, port } = await startStubRouter((call) => ({
        status: 200,
        body: {
            jsonrpc: '2.0', id: call.body.id,
            result: { content: [{ type: 'text', text: JSON.stringify({ ok: false, final_answer: '' }) }] },
        },
    }));
    try {
        const child = await runSubmitTask({
            input: { backend: 'open-interpreter', prompt: 'silence' },
            metadata: { invocationToken: 'relay-token' },
        }, {
            PLOINKY_ROUTER_URL: `http://127.0.0.1:${port}`,
            PLOINKY_WORKSPACE_ROOT: process.cwd(),
        });
        const payload = JSON.parse(child.stdout || '{}');
        assert.equal(payload.ok, true, `submit-task error: ${payload.error || ''}`);
        assert.equal(payload.backend_ok, false);
        assert.match(payload.final_answer, /Open Interpreter did not return/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('relay never resolves backend commands for provider-backed backends', async () => {
    const { server, port, calls } = await startStubRouter((call) => ({
        status: 200,
        body: {
            jsonrpc: '2.0', id: call.body.id,
            result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, final_answer: 'ok' }) }] },
        },
    }));
    try {
        const child = await runSubmitTask({
            input: { backend: 'open-interpreter', prompt: 'hi' },
            metadata: { invocationToken: 'relay-token' },
        }, {
            PLOINKY_ROUTER_URL: `http://127.0.0.1:${port}`,
            PLOINKY_WORKSPACE_ROOT: process.cwd(),
            // Even if a legacy command env is set, it must be ignored:
            RESEARCH_OPEN_INTERPRETER_COMMAND: 'should-be-ignored',
        });
        const toolsCall = calls.find((c) => c.body?.method === 'tools/call');
        assert.ok(toolsCall, 'tools/call must have been issued');
        const argsString = JSON.stringify(toolsCall.body.params.arguments);
        assert.doesNotMatch(argsString, /should-be-ignored/);
        const payload = JSON.parse(child.stdout || '{}');
        assert.equal(payload.provider_agent, 'openInterpreterAgent');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
