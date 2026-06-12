import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, '..', '..');
const EXECUTE_TASK_ENTRY = path.join(REPO_ROOT, 'opencodeAgent', 'scripts', 'execute-task.mjs');

function runExecuteTask(input, env = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [EXECUTE_TASK_ENTRY], {
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

async function writeFakeOpenCode(tempDir, source) {
    const scriptPath = path.join(tempDir, 'fake-opencode.mjs');
    await fs.writeFile(scriptPath, source);
    await fs.chmod(scriptPath, 0o755);
    return scriptPath;
}

test('execute-task streams opencode output to log sink and keeps MCP stdout as JSON', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const projectDir = path.join(tempDir, 'site');
        const argsFile = path.join(tempDir, 'args.json');
        const logFile = path.join(tempDir, 'opencode.log');
        const fakeOpenCode = await writeFakeOpenCode(tempDir, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
fs.writeFileSync(process.env.FAKE_OPENCODE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
const projectDir = process.argv[process.argv.indexOf('--dir') + 1];
fs.mkdirSync(path.join(projectDir, '.aku'), { recursive: true });
fs.writeFileSync(path.join(projectDir, '.aku', 'aku.json'), JSON.stringify({ schemaVersion: 1 }));
process.stdout.write('stdout line 1\\n');
process.stderr.write('stderr line 1\\n');
setTimeout(() => {
    process.stdout.write('stdout line 2\\n');
    process.stderr.write('stderr line 2\\n');
    process.exit(0);
}, 20);
`);

        const result = await runExecuteTask({
            prompt: 'Build .aku from WAC.json',
            projectDir,
            model: 'opencode/test-model',
        }, {
            OPENCODE_BIN: fakeOpenCode,
            OPENCODE_LOG_PATH: logFile,
            FAKE_OPENCODE_ARGS_FILE: argsFile,
        });

        assert.equal(result.code, 0, result.stderr || result.stdout);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(payload.projectDir, projectDir);
        assert.equal(payload.model, 'opencode/test-model');
        assert.equal(result.stdout.includes('stdout line'), false, 'MCP stdout must contain only final JSON');

        const args = JSON.parse(await fs.readFile(argsFile, 'utf8'));
        assert.deepEqual(args, [
            'run',
            '--dangerously-skip-permissions',
            '--dir',
            projectDir,
            '--model',
            'opencode/test-model',
            'Build .aku from WAC.json',
        ]);

        const logs = await fs.readFile(logFile, 'utf8');
        assert.match(logs, /start projectDir=/);
        assert.match(logs, /\[opencode stdout\] stdout line 1/);
        assert.match(logs, /\[opencode stderr\] stderr line 1/);
        assert.match(logs, /\[opencode stdout\] stdout line 2/);
        assert.match(logs, /\[opencode stderr\] stderr line 2/);
        assert.match(logs, /exit code=0/);

        const stats = await fs.lstat(path.join(projectDir, '.opencode', 'skills'));
        assert.equal(stats.isSymbolicLink(), true);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task remaps webAssist workspace projectDir to mounted data root', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const mountedDataRoot = path.join(tempDir, 'mounted-webassist-data');
        const hostProjectDir = path.join(workspaceRoot, '.ploinky', 'agents', 'webAssist', 'data', 'sites', 'localhost');
        const effectiveProjectDir = path.join(mountedDataRoot, 'sites', 'localhost');
        const argsFile = path.join(tempDir, 'args.json');
        const logFile = path.join(tempDir, 'opencode.log');
        const fakeOpenCode = await writeFakeOpenCode(tempDir, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
fs.writeFileSync(process.env.FAKE_OPENCODE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
const projectDir = process.argv[process.argv.indexOf('--dir') + 1];
fs.mkdirSync(path.join(projectDir, '.aku'), { recursive: true });
fs.writeFileSync(path.join(projectDir, '.aku', 'aku.json'), JSON.stringify({ schemaVersion: 1 }));
process.exit(0);
`);

        const result = await runExecuteTask({
            prompt: 'Build .aku from WAC.json',
            projectDir: hostProjectDir,
            model: 'opencode/test-model',
        }, {
            OPENCODE_BIN: fakeOpenCode,
            OPENCODE_LOG_PATH: logFile,
            OPENCODE_WEBASSIST_DATA_ROOT: mountedDataRoot,
            PLOINKY_WORKSPACE_ROOT: workspaceRoot,
            FAKE_OPENCODE_ARGS_FILE: argsFile,
        });

        assert.equal(result.code, 0, result.stderr || result.stdout);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(payload.projectDir, hostProjectDir);
        assert.equal(payload.effectiveProjectDir, effectiveProjectDir);

        const args = JSON.parse(await fs.readFile(argsFile, 'utf8'));
        assert.deepEqual(args, [
            'run',
            '--dangerously-skip-permissions',
            '--dir',
            effectiveProjectDir,
            '--model',
            'opencode/test-model',
            'Build .aku from WAC.json',
        ]);

        const logs = await fs.readFile(logFile, 'utf8');
        assert.match(logs, /effectiveProjectDir=/);
        await fs.access(path.join(effectiveProjectDir, '.aku', 'aku.json'));
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task returns bounded output tail on opencode failure', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const logFile = path.join(tempDir, 'opencode.log');
        const fakeOpenCode = await writeFakeOpenCode(tempDir, `#!/usr/bin/env node
process.stdout.write('before failure\\n');
process.stderr.write('failure details\\n');
process.exit(7);
`);

        const result = await runExecuteTask({
            prompt: 'Build .aku from WAC.json',
            projectDir: path.join(tempDir, 'site'),
            model: 'opencode/test-model',
        }, {
            OPENCODE_BIN: fakeOpenCode,
            OPENCODE_LOG_PATH: logFile,
        });

        assert.notEqual(result.code, 0);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, false);
        assert.match(payload.error, /exit code 7/);
        assert.match(payload.error, /failure details/);
        assert.equal(payload.model, 'opencode/test-model');

        const logs = await fs.readFile(logFile, 'utf8');
        assert.match(logs, /\[opencode stdout\] before failure/);
        assert.match(logs, /\[opencode stderr\] failure details/);
        assert.match(logs, /exit code=7/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task treats opencode permission auto-reject output as failure even with exit code 0', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const logFile = path.join(tempDir, 'opencode.log');
        const fakeOpenCode = await writeFakeOpenCode(tempDir, `#!/usr/bin/env node
process.stderr.write('! permission requested: external_directory (/tmp/site/*); auto-rejecting\\n');
process.stderr.write('✗ Read . failed\\n');
process.stderr.write('Error: The user rejected permission to use this specific tool call.\\n');
process.exit(0);
`);

        const result = await runExecuteTask({
            prompt: 'Build .aku from WAC.json',
            projectDir: path.join(tempDir, 'site'),
            model: 'opencode/test-model',
        }, {
            OPENCODE_BIN: fakeOpenCode,
            OPENCODE_LOG_PATH: logFile,
        });

        assert.notEqual(result.code, 0);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, false);
        assert.match(payload.error, /failed despite exit code 0/);
        assert.match(payload.error, /external_directory/);
        assert.equal(payload.model, 'opencode/test-model');

        const logs = await fs.readFile(logFile, 'utf8');
        assert.match(logs, /permission requested: external_directory/);
        assert.match(logs, /exit code=0/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task treats missing create-akus skill output as failure even with exit code 0', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const logFile = path.join(tempDir, 'opencode.log');
        const fakeOpenCode = await writeFakeOpenCode(tempDir, `#!/usr/bin/env node
process.stderr.write('✗ Skill "create-akus" failed\\n');
process.stderr.write('Error: Skill "create-akus" not found. Available skills: customize-opencode\\n');
process.exit(0);
`);

        const result = await runExecuteTask({
            prompt: 'Build .aku from WAC.json',
            projectDir: path.join(tempDir, 'site'),
            model: 'opencode/test-model',
        }, {
            OPENCODE_BIN: fakeOpenCode,
            OPENCODE_LOG_PATH: logFile,
        });

        assert.notEqual(result.code, 0);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, false);
        assert.match(payload.error, /failed despite exit code 0/);
        assert.match(payload.error, /create-akus/);

        const logs = await fs.readFile(logFile, 'utf8');
        assert.match(logs, /Skill "create-akus" not found/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task rejects successful opencode exit without project AKU manifest', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const projectDir = path.join(tempDir, 'site');
        const fakeOpenCode = await writeFakeOpenCode(tempDir, `#!/usr/bin/env node
process.stdout.write('Created .aku somewhere else\\n');
process.exit(0);
`);

        const result = await runExecuteTask({
            prompt: 'Build .aku from WAC.json',
            projectDir,
            model: 'opencode/test-model',
        }, {
            OPENCODE_BIN: fakeOpenCode,
            OPENCODE_LOG_PATH: path.join(tempDir, 'opencode.log'),
        });

        assert.notEqual(result.code, 0);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, false);
        assert.equal(payload.error.includes('.aku/aku.json was not created'), true);
        assert.equal(payload.projectDir, projectDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task rejects the old wacData-only contract', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const result = await runExecuteTask({
            wacData: { siteInfo: 'legacy' },
            projectDir: path.join(tempDir, 'site'),
        }, {
            OPENCODE_BIN: '/bin/true',
        });

        assert.notEqual(result.code, 0);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, false);
        assert.match(payload.error, /prompt is required/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
