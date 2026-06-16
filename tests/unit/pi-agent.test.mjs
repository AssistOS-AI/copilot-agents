import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, '..', '..');
const EXECUTE_TASK_ENTRY = path.join(REPO_ROOT, 'piAgent', 'scripts', 'execute-task.mjs');
const MCP_CONFIG = path.join(REPO_ROOT, 'piAgent', 'mcp-config.json');
const MANIFEST = path.join(REPO_ROOT, 'piAgent', 'manifest.json');

function runExecuteTask(input, env = {}) {
    return new Promise((resolve) => {
        const command = `${process.execPath} ${EXECUTE_TASK_ENTRY}`;
        const child = spawn('sh', ['-c', command], {
            cwd: REPO_ROOT,
            env: {
                ...process.env,
                ...env,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('close', (code) => {
            resolve({ code: code ?? 0, stdout, stderr });
        });

        child.stdin.write(`${JSON.stringify({ input })}\n`);
        child.stdin.end();
    });
}

async function writeFakePi(tempDir, source) {
    const scriptPath = path.join(tempDir, 'fake-pi-main.js');
    const wrapperPath = path.join(tempDir, 'fake-pi');
    await fs.writeFile(scriptPath, source);
    await fs.chmod(scriptPath, 0o755);
    const wrapper = `#!/bin/sh
node ${scriptPath} "$@"
`;
    await fs.writeFile(wrapperPath, wrapper);
    await fs.chmod(wrapperPath, 0o755);
    return wrapperPath;
}

test('pi execute-task is registered as an async MCP tool', async () => {
    const config = JSON.parse(await fs.readFile(MCP_CONFIG, 'utf8'));
    const tool = config.tools.find((entry) => entry.name === 'execute-task');

    assert.equal(tool?.async, true);
});

test('pi manifest uses the non-interactive installer script', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
    const install = manifest.profiles?.default?.install;

    assert.equal(install, 'sh /code/scripts/install-pi.sh');
    assert.doesNotMatch(install, /pi\.dev\/install\.sh/);
    assert.doesNotMatch(install, /^npm install/);
});

test('execute-task streams pi output to stderr and keeps MCP stdout as JSON', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-agent-test-'));
    try {
        const projectDir = path.join(tempDir, 'site');
        await fs.mkdir(projectDir, { recursive: true });
        const argsFile = path.join(tempDir, 'args.json');
        const cwdFile = path.join(tempDir, 'cwd.txt');
        const fakePi = await writeFakePi(tempDir, `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.FAKE_PI_ARGS_FILE, JSON.stringify(args));
fs.writeFileSync(process.env.FAKE_PI_CWD_FILE, process.cwd());
process.stdout.write('pi stdout line 1\\n');
process.stderr.write('pi stderr line 1\\n');
setTimeout(() => {
    process.stdout.write('pi stdout line 2\\n');
    process.stderr.write('pi stderr line 2\\n');
    process.exit(0);
}, 20);
`);

        const result = await runExecuteTask({
            prompt: 'Create a TypeScript utility',
            projectDir,
            model: 'pi/test-model',
        }, {
            PI_BIN: fakePi,
            FAKE_PI_ARGS_FILE: argsFile,
            FAKE_PI_CWD_FILE: cwdFile,
        });

        assert.equal(result.code, 0, result.stderr || result.stdout);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(payload.projectDir, projectDir);
        assert.equal(payload.model, 'pi/test-model');
        assert.match(payload.outputText, /pi stdout line 1/);
        assert.match(payload.outputText, /pi stdout line 2/);
        assert.doesNotMatch(payload.outputText, /pi stderr line 1/);
        assert.doesNotThrow(() => JSON.parse(result.stdout), 'MCP stdout must contain final JSON');

        const args = JSON.parse(await fs.readFile(argsFile, 'utf8'));
        assert.deepEqual(args, [
            '-p',
            '--no-session',
            '--provider',
            'anthropic',
            '--model',
            'pi/test-model',
            'Create a TypeScript utility',
        ]);

        const logs = result.stderr;
        assert.match(logs, new RegExp(`start projectDir=${projectDir}`));
        assert.match(logs, /\[pi stdout\] pi stdout line 1/);
        assert.match(logs, /\[pi stderr\] pi stderr line 1/);
        assert.match(logs, /\[pi stdout\] pi stdout line 2/);
        assert.match(logs, /\[pi stderr\] pi stderr line 2/);

        const runCwd = String(await fs.readFile(cwdFile, 'utf8'));
        assert.equal(trim(runCwd), projectDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task returns bounded output tail on pi failure', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-agent-test-'));
    try {
        await fs.mkdir(path.join(tempDir, 'site'), { recursive: true });
        const fakePi = await writeFakePi(tempDir, `process.stdout.write('before failure\\n');
process.stderr.write('failure details\\n');
process.exit(7);
`);

        const result = await runExecuteTask({
            prompt: 'Create a TypeScript utility',
            projectDir: path.join(tempDir, 'site'),
            model: 'pi/test-model',
        }, {
            PI_BIN: fakePi,
        });

        assert.notEqual(result.code, 0);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, false);
        assert.match(payload.error, /exit code 7/);
        assert.match(payload.error, /failure details/);
        assert.match(payload.outputText, /failure details/);
        assert.equal(payload.model, 'pi/test-model');

        const logs = result.stderr;
        assert.match(logs, /\[pi stdout\] before failure/);
        assert.match(logs, /\[pi stderr\] failure details/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task rejects invalid input', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-agent-test-'));
    try {
        const result = await runExecuteTask({
            projectDir: path.join(tempDir, 'site'),
        }, {
            PI_BIN: '/bin/true',
        });

        assert.notEqual(result.code, 0);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, false);
        assert.match(payload.error, /prompt is required/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}
