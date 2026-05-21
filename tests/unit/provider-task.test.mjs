import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
    buildProviderInput,
    normalizeProviderResult,
    normalizeProviderTaskInput,
} from '../../copilotProviderRelay/tools/lib/task.mjs';

const submitTaskScript = fileURLToPath(new URL('../../copilotProviderRelay/tools/submit-task.mjs', import.meta.url));

test('normalizeProviderTaskInput accepts backend ids and inline resources', () => {
    const task = normalizeProviderTaskInput({
        backend: 'open-interpreter',
        prompt: 'summarize this',
        resources: [{ filename: 'notes.md', mime: 'text/markdown', content: '# Notes' }],
    }, { PLOINKY_WORKSPACE_ROOT: process.cwd() });

    assert.equal(task.backend.id, 'open-interpreter');
    assert.equal(task.resources.length, 1);
    assert.equal(task.resources[0].name, 'notes.md');
    assert.equal(task.resources[0].encoding, 'utf8');
});

test('normalizeProviderTaskInput rejects unknown backend ids', () => {
    assert.throws(
        () => normalizeProviderTaskInput({ backend: 'unknown', prompt: 'run' }, { PLOINKY_WORKSPACE_ROOT: process.cwd() }),
        /known provider backend id/,
    );
});

test('provider input keeps the natural-language prompt and resources', () => {
    const task = normalizeProviderTaskInput({
        backend: 'open-interpreter',
        prompt: 'analyze the dataset',
        resources: [{ filename: 'data.csv', mime: 'text/csv', content: 'a,b\n1,2\n' }],
    }, {
        PLOINKY_WORKSPACE_ROOT: process.cwd(),
    });
    const payload = buildProviderInput(task);
    assert.equal(payload.prompt, 'analyze the dataset');
    assert.equal(payload.timeoutMs, task.timeoutMs);
    assert.deepEqual(payload.resources[0], {
        name: 'data.csv',
        mime: 'text/csv',
        encoding: 'utf8',
        content: 'a,b\n1,2\n',
        size: 8,
    });
});

test('provider result preserves search cache and citation metadata', () => {
    const normalized = normalizeProviderResult({
        ok: true,
        backend_ok: true,
        final_answer: 'answer',
        cacheable: true,
        ttl_hint_seconds: 123,
        sources: [{ title: 'Example', url: 'https://example.com' }],
    }, {
        backend: { label: 'Web Search' },
        resources: [],
    });

    assert.equal(normalized.cacheable, true);
    assert.equal(normalized.ttl_hint_seconds, 123);
    assert.deepEqual(normalized.sources, [{ title: 'Example', url: 'https://example.com' }]);
});

test('non-provider backends are not advertised until they have provider agents', () => {
    assert.throws(
        () => normalizeProviderTaskInput({ backend: 'mljar', prompt: 'run' }, { PLOINKY_WORKSPACE_ROOT: process.cwd() }),
        /known provider backend id/,
    );
    assert.throws(
        () => normalizeProviderTaskInput({ backend: 'deepanalyze', prompt: 'run' }, { PLOINKY_WORKSPACE_ROOT: process.cwd() }),
        /known provider backend id/,
    );
});

test('Open Interpreter is routed to the openInterpreterAgent provider', () => {
    const task = normalizeProviderTaskInput({
        backend: 'open-interpreter',
        prompt: 'check runtime',
    }, {
        PLOINKY_WORKSPACE_ROOT: process.cwd(),
    });
    assert.equal(task.backend.id, 'open-interpreter');
    assert.deepEqual(task.backend.provider, {
        agent: 'openInterpreterAgent',
        tool: 'open_interpreter_run_task',
    });
    assert.equal(task.configured, true);
});

test('normalizeProviderTaskInput rejects symlink paths escaping the workspace', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-task-'));
    const workspace = path.join(tmp, 'workspace');
    const outside = path.join(tmp, 'outside.txt');
    fs.mkdirSync(workspace);
    fs.writeFileSync(outside, 'secret outside workspace');
    fs.symlinkSync(outside, path.join(workspace, 'leak.txt'));
    try {
        assert.throws(
            () => normalizeProviderTaskInput({
                backend: 'open-interpreter',
                prompt: 'read leak',
                paths: ['leak.txt'],
            }, {
                PLOINKY_WORKSPACE_ROOT: workspace,
            }),
            /escapes workspace root/,
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('submit-task rejects non-provider backends instead of invoking bwrap-runner directly', () => {
    const child = spawnSync(process.execPath, [submitTaskScript], {
        input: JSON.stringify({
            input: {
                backend: 'mljar',
                prompt: 'run this configured backend',
            },
            metadata: {
                invocationToken: 'test-invocation-token',
            },
        }),
        encoding: 'utf8',
        env: {
            ...process.env,
            PLOINKY_WORKSPACE_ROOT: process.cwd(),
        },
        timeout: 5000,
    });
    assert.equal(child.status, 0, `submit-task failed: stdout=${child.stdout} stderr=${child.stderr}`);
    const payload = JSON.parse(String(child.stdout || '').trim());
    assert.equal(payload.ok, false);
    assert.match(payload.error, /known provider backend id/);
});
