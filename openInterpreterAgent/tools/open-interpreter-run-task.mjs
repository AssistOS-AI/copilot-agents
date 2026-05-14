#!/usr/bin/env node
// Provider tool for the Open Interpreter research backend.
//
// The Research Relay (researchRelay.research_task_submit) forwards a
// natural-language task here when the user tags @open-interpreter. This tool
// owns Open Interpreter runtime preparation and inner bwrap execution:
//   1. Ensure the provider-owned runtime exists under
//      /data/research-runtimes/open-interpreter/<version>/.
//   2. Stage prompt.md, config/open-interpreter.json, and input/* files for
//      the inner sandbox.
//   3. Invoke the local sandbox runner (/usr/local/bin/bwrap-sandbox-exec)
//      inside this provider container with the runtime directory bound
//      read-only at /runtime.
//   4. Normalize stdout/stderr into a natural-language final answer.

import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import {
    BUNDLE_ID,
    BUNDLE_VERSION,
    bundleDir,
    describeBundleInput,
    readExistingManifest,
    resolveRuntimeRoot,
} from './lib/runtime-bundle.mjs';
import { prepareRuntime } from './prepare-runtime.mjs';

const MAX_PROMPT_CHARS = 16000;
const MAX_RESOURCE_BYTES = 128 * 1024;
const MAX_TOTAL_RESOURCE_BYTES = 384 * 1024;
const MAX_SANDBOX_PAYLOAD_BYTES = 900 * 1024;
const DEFAULT_TIMEOUT_MS = 110000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;
const STDERR_PREVIEW_CHARS = 4000;
const ENTRYPOINT_PATH = `/runtime/bin/research-open-interpreter.py`;
const CONFIG_PATH = 'config/open-interpreter.json';
const LOCAL_RUNNER_BIN = process.env.OI_LOCAL_RUNNER_BIN || '/usr/local/bin/bwrap-sandbox-exec';
const LOCAL_RUNNER_FALLBACK = '/opt/bwrap-runner/bin/sandbox-exec.mjs';

function boolEnv(name, defaultValue = false) {
    const raw = process.env[name];
    if (raw == null || raw === '') return defaultValue;
    return ['1', 'true', 'yes', 'on', 'y'].includes(String(raw).trim().toLowerCase());
}

function autoPrepareEnabled() {
    return boolEnv('OI_RUNTIME_AUTO_PREPARE', true);
}

function reject(message) {
    const error = new Error(message);
    error.code = 'OI_RUN_TASK_INVALID_INPUT';
    throw error;
}

function safeBasename(value, fallback) {
    const raw = String(value || '').trim();
    const base = path.basename(raw).replace(/[^A-Za-z0-9._-]/g, '_');
    return base || fallback;
}

function getInvocationToken(envelope) {
    return envelope.metadata && typeof envelope.metadata.invocationToken === 'string'
        ? envelope.metadata.invocationToken
        : '';
}

function normalizeInput(input = {}) {
    const prompt = String(input.prompt || input.task || '').trim();
    if (!prompt) reject('prompt is required');
    if (prompt.length > MAX_PROMPT_CHARS) reject(`prompt exceeds ${MAX_PROMPT_CHARS} characters`);

    const timeoutMs = input.timeoutMs == null ? DEFAULT_TIMEOUT_MS : Number(input.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
        reject(`timeoutMs must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
    }

    const rawResources = Array.isArray(input.resources) ? input.resources : [];
    const resources = [];
    let totalBytes = 0;
    rawResources.forEach((raw, index) => {
        if (!raw || typeof raw !== 'object') reject('resource entries must be objects');
        const encoding = String(raw.encoding || 'utf8').toLowerCase();
        if (encoding !== 'utf8' && encoding !== 'base64') {
            reject(`resource '${raw.name || index}' uses unsupported encoding '${encoding}'`);
        }
        const content = typeof raw.content === 'string' ? raw.content : null;
        if (content == null) reject(`resource '${raw.name || index}' is missing content`);
        const size = encoding === 'base64'
            ? Buffer.from(content, 'base64').length
            : Buffer.byteLength(content, 'utf8');
        if (size > MAX_RESOURCE_BYTES) {
            reject(`resource '${raw.name || index}' exceeds ${MAX_RESOURCE_BYTES} bytes`);
        }
        totalBytes += size;
        resources.push({
            name: safeBasename(raw.name || `resource-${index + 1}`, `resource-${index + 1}`),
            mime: String(raw.mime || raw.contentType || 'application/octet-stream'),
            encoding,
            content,
            size,
        });
    });
    if (totalBytes > MAX_TOTAL_RESOURCE_BYTES) {
        reject(`resources exceed ${MAX_TOTAL_RESOURCE_BYTES} bytes total`);
    }

    return {
        prompt,
        timeoutMs: Math.floor(timeoutMs),
        resources,
        origin: input.origin && typeof input.origin === 'object' ? input.origin : {},
    };
}

function stagedResourcePath(name, index, seen) {
    const base = safeBasename(name, `resource-${index + 1}`);
    let candidate = `input/${base}`;
    if (!seen.has(candidate)) {
        seen.add(candidate);
        return candidate;
    }
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    let suffix = 2;
    while (seen.has(candidate)) {
        candidate = `input/${stem}-${suffix}${ext}`;
        suffix += 1;
    }
    seen.add(candidate);
    return candidate;
}

function buildRuntimeConfig(env = process.env) {
    const model = String(env.OPEN_INTERPRETER_MODEL || '').trim();
    const apiBase = String(env.OPEN_INTERPRETER_API_BASE || '').trim();
    const local = String(env.OPEN_INTERPRETER_LOCAL || '').trim();
    return {
        schema: 'ploinky.open-interpreter.config.v1',
        model: model || null,
        api_base: apiBase || null,
        local: local || null,
        offline: boolEnv('OPEN_INTERPRETER_OFFLINE', true),
    };
}

function buildSandboxPayload(task) {
    const seen = new Set(['prompt.md', CONFIG_PATH]);
    const staged = task.resources.map((resource, index) => ({
        resource,
        path: stagedResourcePath(resource.name, index, seen),
    }));
    const resourceLines = staged.length
        ? staged.map(({ resource, path: stagedPath }) => `- /work/${stagedPath} (${resource.mime}, ${resource.size} bytes)`).join('\n')
        : '- none';
    const promptBody = [
        task.prompt,
        '',
        'Sandbox resources:',
        resourceLines,
    ].join('\n');

    const files = [
        { path: 'prompt.md', content: promptBody, encoding: 'utf8' },
        { path: CONFIG_PATH, content: `${JSON.stringify(buildRuntimeConfig(process.env), null, 2)}\n`, encoding: 'utf8' },
        ...staged.map(({ resource, path: stagedPath }) => ({
            path: stagedPath,
            content: resource.content,
            encoding: resource.encoding,
        })),
    ];

    const payload = {
        command: `/usr/bin/python3 ${ENTRYPOINT_PATH} /work/prompt.md /work/${CONFIG_PATH}`,
        timeoutMs: task.timeoutMs,
        files,
        runtimeBundle: describeBundleInput(),
    };
    const encodedBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (encodedBytes > MAX_SANDBOX_PAYLOAD_BYTES) {
        reject(`sandbox payload exceeds ${MAX_SANDBOX_PAYLOAD_BYTES} bytes after encoding`);
    }
    return payload;
}

function naturalLanguageFromBwrap(bwrapPayload) {
    const stdout = String(bwrapPayload?.stdout?.text || '').trim();
    if (stdout) return stdout;
    if (bwrapPayload?.ok) {
        return 'Open Interpreter finished without a natural-language response.';
    }
    const runnerMessage = String(bwrapPayload?.message || bwrapPayload?.error?.message || '').trim();
    return runnerMessage
        || 'Open Interpreter could not complete the task. Verify the runtime and configured model/provider.';
}

function runtimePreparationFailure(task, runtimeRoot, error) {
    const message = error && error.message ? error.message : String(error || 'unknown error');
    return {
        ok: false,
        backend_ok: false,
        sandbox_ok: false,
        jobId: null,
        final_answer: `Open Interpreter runtime ${BUNDLE_ID}@${BUNDLE_VERSION} could not be prepared at ${bundleDir(runtimeRoot)}. ${message}`,
        stderr_preview: '',
        resources: task.resources.map((resource) => ({ name: resource.name, mime: resource.mime, size: resource.size })),
        origin: task.origin,
        runtimeBundle: describeBundleInput(),
        timedOut: false,
        stdout_truncated: false,
        stderr_truncated: false,
    };
}

function resolveLocalRunnerCommand() {
    if (LOCAL_RUNNER_BIN && fs.existsSync(LOCAL_RUNNER_BIN)) {
        return { command: LOCAL_RUNNER_BIN, args: [] };
    }
    if (fs.existsSync(LOCAL_RUNNER_FALLBACK)) {
        return { command: process.execPath, args: [LOCAL_RUNNER_FALLBACK] };
    }
    return null;
}

function invokeLocalRunner(payload, { runtimeRoot, timeoutMs }) {
    return new Promise((resolve) => {
        const launch = resolveLocalRunnerCommand();
        if (!launch) {
            resolve({
                ok: false,
                error: {
                    code: 'OI_LOCAL_RUNNER_MISSING',
                    message: `local bwrap sandbox runner is not installed at ${LOCAL_RUNNER_BIN} or ${LOCAL_RUNNER_FALLBACK}`,
                },
                stdout: { text: '', truncated: false, byteLength: 0 },
                stderr: { text: '', truncated: false, byteLength: 0 },
            });
            return;
        }

        const childEnv = {
            PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            HOME: process.env.HOME || '/data',
            LANG: process.env.LANG || 'C.UTF-8',
            BWRAP_RUNNER_RUNTIME_ROOT: runtimeRoot,
        };
        if (process.env.BWRAP_RUNNER_STATE) {
            childEnv.BWRAP_RUNNER_STATE = process.env.BWRAP_RUNNER_STATE;
        }
        if (process.env.BWRAP_RUNNER_ALLOW_NETWORK) {
            childEnv.BWRAP_RUNNER_ALLOW_NETWORK = process.env.BWRAP_RUNNER_ALLOW_NETWORK;
        }

        const child = spawn(launch.command, launch.args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: childEnv,
        });
        const stdoutChunks = [];
        const stderrChunks = [];
        let killed = false;
        const watchdog = setTimeout(() => {
            killed = true;
            try { child.kill('SIGKILL'); } catch (_) {}
        }, Math.max(timeoutMs + 15000, 30000));

        child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
        child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
        child.on('error', (err) => {
            clearTimeout(watchdog);
            resolve({
                ok: false,
                error: {
                    code: 'OI_LOCAL_RUNNER_SPAWN_FAILED',
                    message: err?.message || String(err),
                },
                stdout: { text: '', truncated: false, byteLength: 0 },
                stderr: { text: Buffer.concat(stderrChunks).toString('utf8'), truncated: false, byteLength: 0 },
            });
        });
        child.on('close', (code) => {
            clearTimeout(watchdog);
            const stdoutText = Buffer.concat(stdoutChunks).toString('utf8').trim();
            const stderrText = Buffer.concat(stderrChunks).toString('utf8');
            const lastLine = stdoutText ? stdoutText.split('\n').pop() : '';
            let parsed = null;
            try {
                parsed = lastLine ? JSON.parse(lastLine) : null;
            } catch (_) {
                parsed = null;
            }
            if (parsed && typeof parsed === 'object') {
                resolve(parsed);
                return;
            }
            resolve({
                ok: false,
                error: {
                    code: killed ? 'OI_LOCAL_RUNNER_TIMEOUT' : 'OI_LOCAL_RUNNER_BAD_OUTPUT',
                    message: killed
                        ? 'local sandbox runner timed out'
                        : `local sandbox runner exited with code ${code} and no parseable record`,
                },
                stdout: { text: stdoutText, truncated: false, byteLength: Buffer.byteLength(stdoutText, 'utf8') },
                stderr: { text: stderrText, truncated: false, byteLength: Buffer.byteLength(stderrText, 'utf8') },
            });
        });

        child.stdin.end(JSON.stringify(payload));
    });
}

async function main() {
    try {
        const envelope = await readEnvelope();
        const invocationToken = getInvocationToken(envelope);
        if (!invocationToken) {
            writeError('open_interpreter_run_task requires a router invocation token');
            return;
        }

        const task = normalizeInput(envelope.input || {});

        const runtimeRoot = resolveRuntimeRoot(process.env);
        let preparation;
        try {
            if (!autoPrepareEnabled()) {
                const existingManifest = readExistingManifest(runtimeRoot);
                if (existingManifest) {
                    preparation = {
                        manifest: existingManifest,
                        prepared: false,
                        reused: true,
                        runtimeRoot,
                        bundleDir: bundleDir(runtimeRoot),
                    };
                } else {
                    writeOk({
                        ok: false,
                        backend_ok: false,
                        sandbox_ok: false,
                        jobId: null,
                        final_answer: `Open Interpreter runtime ${BUNDLE_ID}@${BUNDLE_VERSION} is not prepared at ${bundleDir(runtimeRoot)}. Ask the operator to run the openInterpreterAgent prepare_runtime tool or enable OI_RUNTIME_AUTO_PREPARE.`,
                        stderr_preview: '',
                        resources: task.resources.map((resource) => ({ name: resource.name, mime: resource.mime, size: resource.size })),
                        origin: task.origin,
                        runtimeBundle: describeBundleInput(),
                        timedOut: false,
                        stdout_truncated: false,
                        stderr_truncated: false,
                    });
                    return;
                }
            } else {
                preparation = prepareRuntime({ env: process.env });
            }
        } catch (error) {
            writeOk({
                ...runtimePreparationFailure(task, runtimeRoot, error),
            });
            return;
        }
        if (!preparation?.manifest) {
            writeOk(runtimePreparationFailure(task, runtimeRoot, new Error('prepare_runtime did not return a runtime manifest.')));
            return;
        }

        const sandboxInput = buildSandboxPayload(task);
        const runnerResult = await invokeLocalRunner(sandboxInput, { runtimeRoot, timeoutMs: task.timeoutMs });
        const stdout = String(runnerResult?.stdout?.text || '').trim();
        const stderr = String(runnerResult?.stderr?.text || '').trim();
        const finalAnswer = naturalLanguageFromBwrap(runnerResult);
        const sandboxOk = Boolean(runnerResult?.ok);
        const backendOk = sandboxOk && (runnerResult?.exitCode === 0) && Boolean(stdout);

        writeOk({
            ok: backendOk,
            jobId: runnerResult?.jobId || null,
            sandbox_ok: sandboxOk,
            backend_ok: backendOk,
            final_answer: finalAnswer,
            natural_language_output: finalAnswer,
            exitCode: runnerResult?.exitCode ?? null,
            stderr_preview: stderr.slice(-STDERR_PREVIEW_CHARS),
            resources: task.resources.map((resource) => ({ name: resource.name, mime: resource.mime, size: resource.size })),
            origin: task.origin,
            runtimeBundle: describeBundleInput(),
            timedOut: Boolean(runnerResult?.timedOut),
            stdout_truncated: Boolean(runnerResult?.stdout?.truncated),
            stderr_truncated: Boolean(runnerResult?.stderr?.truncated),
        });
    } catch (error) {
        writeError(error && error.message ? error.message : 'open_interpreter_run_task failed');
    }
}

main();
